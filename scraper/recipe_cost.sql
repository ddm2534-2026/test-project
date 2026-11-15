-- Стоимость рецепта по сетям (черновик сервиса «сколько стоит рецепт»): used — продукты, что уйдут в блюдо; buy — целыми упаковками.
-- :names — массив названий рецептов. Пантри (специи, масло, соль) считается отдельно.
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
), off as (
  select n.name, n.portions, n.key, n.pantry, n.need, o.chain, o.name as product, o.price,
    case when o.is_weighted then (case when n.base_unit = 'шт' then n.need * n.piece_g else n.need end) / 1000.0
         when o.pack_unit = n.base_unit then n.need / o.pack
         when o.pack_unit = 'шт' and n.piece_g > 0 then n.need / n.piece_g / o.pack
         when n.base_unit = 'шт' and n.piece_g > 0 then n.need * n.piece_g / o.pack end as share,
    o.is_weighted
    from need n join g_ingredient_offers(array(select distinct key from need)) o on o.key = n.key
   where n.need > 0
), c as (
  select *, share * price as used,
         case when is_weighted then share * price else greatest(1, ceil(share - 0.05)) * price end as buy
    from off where share is not null
), best as (
  select distinct on (name, key, chain) * from c order by name, key, chain, buy, used
)
select name, portions, chain,
       round(sum(used) filter (where not pantry), 2) as used_core,
       round(sum(used) filter (where not pantry) / portions, 2) as per_portion,
       round(sum(buy) filter (where not pantry), 2) as buy_core,
       round(sum(used) filter (where pantry), 2) as used_pantry,
       count(*) filter (where not pantry) as found,
       (select count(distinct key) from need n where n.name = best.name and not n.pantry and n.need > 0) as needed
  from best group by name, portions, chain order by name, used_core;
