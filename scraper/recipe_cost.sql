-- Стоимость рецепта по сетям (черновик сервиса «сколько стоит рецепт»).
-- used — продукты, которые уйдут в блюдо; buy — целыми упаковками / по весу.
-- Три режима: reg — без акций, pub — акции для всех, club — плюс клубные.
-- :names — массив названий рецептов. Пантри (специи, масло, соль) — отдельно.
with r as (
  select r.name, r.portions, x->>'key' as key, (x->>'amount')::numeric as amt, x->>'unit' as unit,
         coalesce((x->>'pantry')::boolean, g.pantry, false) as pantry, g.base_unit, g.piece_g, g.tbsp_g, g.tsp_g
    from menu_recipes r, jsonb_array_elements(r.ingredients) x
    join g_ingredients g on g.key = x->>'key'
   where r.name = any(:names) and x->>'unit' <> 'по вкусу' and x->>'key' <> 'water'
), need as (   -- в базовой единице ингредиента (как toBase на странице)
  select r.*, case
    when base_unit = 'шт' then case when unit = 'шт' then amt
         when piece_g > 0 then (case unit when 'г' then amt when 'кг' then amt*1000 when 'мл' then amt when 'л' then amt*1000
              when 'ст.л.' then amt*coalesce(tbsp_g,15) when 'ч.л.' then amt*coalesce(tsp_g,5) end) / piece_g end
    when unit = 'шт' then amt * piece_g
    else case unit when 'г' then amt when 'кг' then amt*1000 when 'мл' then amt when 'л' then amt*1000
              when 'ст.л.' then amt*coalesce(tbsp_g,15) when 'ч.л.' then amt*coalesce(tsp_g,5) end end as need
    from r
), off as (    -- share: сколько упаковок (или кг для весовых) нужно
  select n.name, n.portions, n.key, n.pantry, o.chain, o.barcode, o.name as product, o.price, o.is_weighted,
    case when o.is_weighted then (case when n.base_unit = 'шт' then n.need * n.piece_g else n.need end) / 1000.0
         when o.pack_unit = n.base_unit then n.need / o.pack
         when o.pack_unit = 'шт' and n.piece_g > 0 then n.need / n.piece_g / o.pack
         when n.base_unit = 'шт' and n.piece_g > 0 then n.need * n.piece_g / o.pack end as share
    from need n join g_ingredient_offers(array(select distinct key from need)) o on o.key = n.key
   where n.need > 0
), deals as (
  select pi.chain_id as chain, pi.barcode, pr.description as text, coalesce(pr.is_club, false) as club,
         pi.deal_qty as q, pi.deal_total as total, pi.deal_fraction as fraction, pi.price_per_unit as per_unit,
         coalesce(pi.min_qty, pr.min_qty) as min_q, pr.max_qty as max_q
    from g_promo_items pi join g_promos pr using (chain_id, promo_id)
   where (pi.deal_qty is not null or pi.price_per_unit is not null)
     and not coalesce(pr.is_coupon, false) and not coalesce(pr.is_gift, false)
     and coalesce(pr.min_purchase, 0) = 0
     and (pr.starts_at is null or pr.starts_at <= now()) and (pr.ends_at is null or pr.ends_at > now())
), base as (   -- без акций
  select off.*, greatest(1, ceil(share - 0.05)) as n from off where share is not null
), opt as (    -- варианты: без акции + каждая подходящая акция
  select b.*, 'reg'::text as how, null::text as deal, false as club,
         case when is_weighted then share * price else n * price end as buy,
         case when is_weighted then share else n end as got
    from base b
  union all
  select b.*, 'deal', d.text, d.club, x.buy, x.got
    from base b join deals d on d.chain = b.chain and d.barcode = b.barcode
    cross join lateral (
      -- весовой: цена за кг по акции, от минимального веса, до максимального
      select case when ppk < b.price then
               case when b.share >= coalesce(d.min_q, 0)
                    then least(b.share, coalesce(d.max_q, 1e9)) * ppk + greatest(0, b.share - coalesce(d.max_q, 1e9)) * b.price
                    when d.min_q <= b.share * 2 and d.min_q * ppk <= b.share * b.price then d.min_q * ppk end end as buy,
             greatest(b.share, coalesce(d.min_q, 0)) as got
        from (select case when d.q > 0 and d.total is not null then d.total / d.q else d.per_unit end as ppk) p
       where b.is_weighted
      union all
      -- фасованный: «N за X» / «N со скидкой», можно докупить до кратного N, если не дороже
      select c.cost, c.m
        from (select greatest(1, round(d.q))::int as qq) q0
        cross join lateral (select m, floor(m / q0.qq)::numeric * least(coalesce(d.total, b.price * q0.qq * d.fraction), b.price * q0.qq)
                                     + (m % q0.qq) * b.price as cost
                              from unnest(array[b.n::int, (ceil(b.n / q0.qq) * q0.qq)::int]) m) c
       where not b.is_weighted and d.q >= 1 and (d.total is not null or d.fraction is not null)
         and (c.m = b.n or c.cost <= b.n * b.price + 0.005)
    ) x
   where x.buy is not null
), modes as (
  select o.*, m.mode, o.buy * least(o.share, o.got) / nullif(o.got, 0) as used
    from opt o cross join (values ('reg'), ('pub'), ('club')) m(mode)
   where o.how = 'reg' or (m.mode = 'pub' and not o.club) or m.mode = 'club'
), best as (
  select distinct on (name, key, chain, mode) * from modes
   order by name, key, chain, mode, buy, used, got desc
)
select name, portions, chain, mode,
       round(sum(used) filter (where not pantry), 1) as used_core,
       round(sum(used) filter (where not pantry) / portions, 1) as per_portion,
       round(sum(buy) filter (where not pantry), 1) as buy_core,
       round(coalesce(sum(used) filter (where pantry), 0), 1) as used_pantry,
       string_agg(key || ': ' || deal, '; ') filter (where deal is not null and not pantry) as deals_used
  from best group by name, portions, chain, mode
 order by name, mode, used_core;
