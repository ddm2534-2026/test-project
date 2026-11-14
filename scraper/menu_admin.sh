#!/usr/bin/env bash
# Служебные действия функции menu: разметка товаров по справочнику ингредиентов.
#   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… scraper/menu_admin.sh tag_new|backfill
# Повторяет вызов, пока функция говорит, что работа ещё есть (не больше 80 раз).
set -euo pipefail
action="${1:-tag_new}"
for i in $(seq 1 80); do
  out=$(curl -sS --max-time 400 -X POST "$SUPABASE_URL/functions/v1/menu" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "{\"action\":\"$action\"}")
  echo "[$i] $out"
  echo "$out" | grep -q '"more":true' || break
done
