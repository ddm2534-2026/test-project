-- Каталог Yango Deli (экспресс-доставка): товары с их сайта, сопоставленные с нашими штрихкодами по названию и фасовке.
create table if not exists public.g_yango_items (
  slug text primary key, yid text, name text not null, brand text, amount_text text,
  pack_amount numeric, pack_kind text, price numeric, old_price numeric, promo_until date,
  in_stock boolean, barcode text, match_sim real, seen_at timestamptz not null default now()
);
create index if not exists g_yango_items_barcode on public.g_yango_items (barcode) where barcode is not null;
create index if not exists g_yango_items_name_trgm on public.g_yango_items using gin (name gin_trgm_ops);
alter table public.g_yango_items enable row level security;
drop policy if exists g_yango_items_read on public.g_yango_items;
create policy g_yango_items_read on public.g_yango_items for select using (true);

create or replace function public.g_yango_match(p_only_new boolean default true)
returns int language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  with c as (
    select y.slug, b.barcode, b.sim
      from g_yango_items y
      cross join lateral (
        select i.barcode, similarity(i.name, y.name) sim
          from g_items i
         where i.name % y.name
           and (y.pack_amount is null or i.pack_amount is null
                or (i.pack_kind = y.pack_kind and abs(i.pack_amount - y.pack_amount) <= greatest(1, y.pack_amount * 0.02)))
           and (y.pack_amount is not null or i.pack_amount is null)
         order by similarity(i.name, y.name) desc
         limit 1) b
     where (not p_only_new or y.barcode is null) and b.sim >= 0.45
  )
  update g_yango_items y set barcode = c.barcode, match_sim = c.sim from c where c.slug = y.slug;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.g_yango_match(boolean) from public, anon, authenticated;

create or replace function public.g_yango_offers(p_barcodes text[])
returns table(barcode text, slug text, name text, amount_text text, price numeric, old_price numeric, in_stock boolean)
language sql stable set search_path to 'public' as $$
  select distinct on (y.barcode) y.barcode, y.slug, y.name, y.amount_text, y.price, y.old_price, y.in_stock
    from g_yango_items y
   where y.barcode = any(p_barcodes) and y.price > 0 and y.seen_at > now() - interval '4 days'
   order by y.barcode, y.match_sim desc nulls last;
$$;
grant execute on function public.g_yango_offers(text[]) to anon, authenticated;

-- Правка после пробного прогона: pg_trgm живёт в схеме extensions; порог 0.55 и фасовка обязана совпасть
-- (иначе «мятная жвачка» вместо «яблочной», мёд 40 г вместо 400 г). Полный пересчёт сбрасывает старые сопоставления.
create or replace function public.g_yango_match(p_only_new boolean default true)
returns int language plpgsql security definer set search_path to public, extensions as $$
declare n int;
begin
  if not p_only_new then update g_yango_items set barcode = null, match_sim = null where barcode is not null; end if;
  with c as (
    select y.slug, b.barcode, b.sim
      from g_yango_items y
      cross join lateral (
        select i.barcode, similarity(i.name, y.name) sim
          from g_items i
         where i.name % y.name
           and ((y.pack_amount is null and i.pack_amount is null)
                or (i.pack_kind = y.pack_kind and abs(i.pack_amount - y.pack_amount) <= greatest(1, y.pack_amount * 0.02)))
         order by similarity(i.name, y.name) desc
         limit 1) b
     where y.barcode is null and b.sim >= 0.55
  )
  update g_yango_items y set barcode = c.barcode, match_sim = c.sim from c where c.slug = y.slug;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.g_yango_match(boolean) to service_role;

-- Применено позже (yango_as_chain, yango_match_batches + правка): Yango как сеть 'yango' (mode express, мин. 99 ₪),
-- свои товары yango:<slug> в g_items; g_yango_match(p_reset, p_limit) — порциями, с колонкой match_checked_at;
-- развесные товары сетей не сопоставляем (у Yango фасовка).
