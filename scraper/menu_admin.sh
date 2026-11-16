#!/usr/bin/env bash
# Служебные действия функции menu: разметка товаров по справочнику ингредиентов.
#   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… scraper/menu_admin.sh tag_new|backfill|classify|tax_propose [категории]
# Повторяет вызов, пока функция говорит, что работа ещё есть (не больше 80 раз).
# tax_propose: по одному вызову на каждую категорию из списка через пробел.
set -euo pipefail
action="${1:-tag_new}"
cats="${2:-}"
call() {
  curl -sS --max-time 400 -X POST "$SUPABASE_URL/functions/v1/menu" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "$1"
}
if [ "$action" = "tax_propose" ]; then
  # по очереди: после каждой категории сразу применяем узлы, чтобы следующая видела их и не дублировала
  for c in $cats; do
    echo "[$c] $(call "{\"action\":\"tax_propose\",\"category\":\"$c\"}")"
    echo "[$c] apply: $(curl -sS -X POST "$SUPABASE_URL/rest/v1/rpc/g_apply_proposals" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"p_category\":\"$c\"}")"
  done
  exit 0
fi
body="{\"action\":\"$action\"}"
[ -n "$cats" ] && body="{\"action\":\"$action\",\"category\":\"$cats\"}"
# сбой (таймаут функции, 5xx) — повторяем; стоп только когда функция явно ответила more:false или 5 сбоев подряд
fails=0
for i in $(seq 1 120); do
  out=$(call "$body" || true)
  echo "[$i] $out"
  if echo "$out" | grep -q '"more":true'; then fails=0; continue; fi
  if echo "$out" | grep -q '"more":false'; then break; fi
  fails=$((fails + 1)); [ "$fails" -ge 5 ] && break; sleep 15
done
