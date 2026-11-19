-- Применено через MCP: cls_copy_by_name — непривязанные товары получают ингредиент
-- от товара с тем же названием (и той же весовостью), если совпадение однозначное.
-- Нужно для магазинных кодов весовых товаров (напр. Рами Леви 7290000000117 «לימון»).
-- pg_cron: cls-copy-by-name, ежедневно 03:15 UTC.
create or replace function g_cls_copy_by_name() returns int language sql security definer set search_path = public as $$
  with u as (select i.barcode, i.name, i.is_weighted from g_items i where i.ingredient is null and exists (select 1 from g_prices p where p.barcode = i.barcode)),
  m as (select u.barcode, (select array_agg(distinct j.ingredient) from g_items j where j.ingredient is not null and j.name = u.name and j.is_weighted = u.is_weighted) ings from u),
  up as (update g_items i set ingredient = m.ings[1], ingredient_src = 'name' from m where m.barcode = i.barcode and cardinality(m.ings) = 1 returning 1)
  select count(*)::int from up;
$$;
revoke all on function g_cls_copy_by_name() from public, anon, authenticated;
select cron.schedule('cls-copy-by-name', '15 3 * * *', 'select g_cls_copy_by_name()');
