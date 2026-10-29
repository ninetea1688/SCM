#!/bin/sh
# Registers SCM in the shared Kong Gateway (DB-backed) — idempotent named upserts, safe to
# re-run on every deploy. Run ON the gateway host (Admin API is on host loopback):
#   DOMAIN=scm.officesoft.shop MEDIA_DOMAIN=scm-media.officesoft.shop ./kong-routes.sh
# Kong joins the stack's compose network (docker-compose.kong.yml) and reaches the services
# by name: web:3000 (UI/BFF), api:4000 (/api, /webhooks, /health), s3:8333 (media host).
set -eu
KONG="${KONG:-http://127.0.0.1:8001}"
DOMAIN="${DOMAIN:?set DOMAIN=scm.officesoft.shop}"
MEDIA_DOMAIN="${MEDIA_DOMAIN:?set MEDIA_DOMAIN=scm-media.officesoft.shop}"

put() { # put <kind> <name> <json>
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$KONG/$1s/$2" \
    -H 'content-type: application/json' -d "$3")
  # 200 = updated, 201 = created
  if [ "$code" = "200" ] || [ "$code" = "201" ]; then
    echo "ok    $1/$2"
  else
    echo "FAIL  $1/$2 (HTTP $code)"; exit 1
  fi
}

put service scm-web '{"name":"scm-web","host":"web","port":3000,"protocol":"http","connect_timeout":10000,"read_timeout":60000,"write_timeout":60000,"retries":3}'
put service scm-api '{"name":"scm-api","host":"api","port":4000,"protocol":"http","connect_timeout":10000,"read_timeout":120000,"write_timeout":120000,"retries":3}'
put service scm-s3 '{"name":"scm-s3","host":"s3","port":8333,"protocol":"http","connect_timeout":10000,"read_timeout":120000,"write_timeout":120000,"retries":3}'

put route scm-web-route '{"name":"scm-web-route","service":{"name":"scm-web"},"protocols":["http","https"],"hosts":["'"$DOMAIN"'"],"paths":["/"],"strip_path":false}'
put route scm-api-route '{"name":"scm-api-route","service":{"name":"scm-api"},"protocols":["http","https"],"hosts":["'"$DOMAIN"'"],"paths":["/api","/webhooks","/health"],"strip_path":false}'
put route scm-s3-route '{"name":"scm-s3-route","service":{"name":"scm-s3"},"protocols":["http","https"],"hosts":["'"$MEDIA_DOMAIN"'"],"paths":["/"],"strip_path":false}'

echo "--- verify (local Kong proxy) ---"
echo "web  /login -> $(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/login)"
echo "api  /health -> $(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/health)"
echo "media / -> $(curl -s -o /dev/null -w '%{http_code}' -H "Host: $MEDIA_DOMAIN" http://127.0.0.1/)"
