#!/usr/bin/env bash
#
# Testa a corrente inteira e diz onde quebrou.
#
#   ./diagnostico.sh
#
# Não muda nada. Só olha. Pode colar a saída — os segredos saem
# mascarados.

cd "$(dirname "$0")"

ok()    { printf '  \033[1;32m[ok]\033[0m    %s\n' "$*"; }
falha() { printf '  \033[1;31m[FALHA]\033[0m %s\n' "$*"; PROBLEMAS=$((PROBLEMAS+1)); }
nota()  { printf '          %s\n' "$*"; }
titulo(){ printf '\n\033[1;34m%s\033[0m\n' "$*"; }
PROBLEMAS=0

mascara() { printf '%s' "${1:0:6}…${1: -4}"; }

[ -f .env ] || { echo 'Sem .env. Rode ./bootstrap.sh'; exit 1; }
set -a; . ./.env; set +a
[ -f .supabase ] && { set -a; . ./.supabase; set +a; }

# ---------------------------------------------------------------
titulo '1. Os containers'
for c in evolution evolution_postgres evolution_redis evolution_caddy; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then ok "$c de pé"; else falha "$c fora do ar"; fi
done

# ---------------------------------------------------------------
titulo '2. A Evolution responde'
CODIGO=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${DOMINIO}/" || echo 000)
if [ "$CODIGO" = '200' ]; then ok "https://${DOMINIO} responde"
else falha "https://${DOMINIO} devolveu HTTP ${CODIGO}"; nota 'DNS, Caddy ou o container.'; fi

NO_CONTAINER=$(docker compose exec -T evolution printenv AUTHENTICATION_API_KEY 2>/dev/null | tr -d '\r\n')
if [ "$NO_CONTAINER" = "$API_KEY" ]; then ok 'a chave do .env é a que o container usa'
else falha 'chave do .env diferente da do container'; nota 'docker compose up -d --force-recreate evolution'; fi

# ---------------------------------------------------------------
titulo '3. A instância do WhatsApp'
INST=$(curl -s --max-time 15 "https://${DOMINIO}/instance/fetchInstances" -H "apikey: ${API_KEY}")
NOME=$(printf '%s' "$INST" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for i in (d if isinstance(d,list) else []):
    n=i.get("name") or (i.get("instance") or {}).get("instanceName")
    if n: print(n); break' 2>/dev/null)
STATUS=$(printf '%s' "$INST" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
for i in (d if isinstance(d,list) else []):
    s=i.get("connectionStatus") or (i.get("instance") or {}).get("state")
    if s: print(s); break' 2>/dev/null)

if [ -n "$NOME" ]; then ok "instância \"${NOME}\" · estado: ${STATUS:-?}"
  [ "$STATUS" = 'open' ] || { falha 'a instância NÃO está conectada'; nota "Escaneie o QR em https://${DOMINIO}/manager"; }
else falha 'nenhuma instância'; nota "Resposta: ${INST:0:200}"; fi

# ---------------------------------------------------------------
titulo '4. O webhook aponta pro app'
WH=$(curl -s --max-time 10 "https://${DOMINIO}/webhook/find/${NOME}" -H "apikey: ${API_KEY}")
URL_WH=$(printf '%s' "$WH" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
print((d.get("webhook") or d).get("url",""))' 2>/dev/null)
ATIVO=$(printf '%s' "$WH" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit()
print((d.get("webhook") or d).get("enabled",""))' 2>/dev/null)

if [ -n "$URL_WH" ]; then
  ok "url: $(printf '%s' "$URL_WH" | sed 's/token=.*/token=***/')"
  [ "$ATIVO" = 'True' ] || [ "$ATIVO" = 'true' ] || falha "webhook DESLIGADO (enabled=${ATIVO})"
  case "$URL_WH" in
    *"${PROJECT_REF:-XXNADAXX}"*) ok 'aponta para o projeto certo' ;;
    *) falha 'a URL não tem o ref do projeto que está no .supabase' ;;
  esac
else falha 'nenhum webhook configurado'; nota "Resposta: ${WH:0:200}"; fi

# ---------------------------------------------------------------
titulo '5. O Supabase'
if [ -z "${PROJECT_REF:-}" ] || [ -z "${SERVICE_ROLE_KEY:-}" ]; then
  falha 'sem .supabase — rode ./disparar.sh uma vez para gravar'
else
  API="https://${PROJECT_REF}.supabase.co/rest/v1"
  H1="apikey: ${SERVICE_ROLE_KEY}"
  H2="Authorization: Bearer ${SERVICE_ROLE_KEY}"

  CH=$(curl -s --max-time 10 "${API}/whatsapp_channels?select=canal,identificador,ativo" -H "$H1" -H "$H2")
  case "$CH" in
    \[*)
      ok "canais: ${CH}"
      case "$CH" in
        *'"canal":"evolution"'*) ok 'algum salão está no canal evolution' ;;
        *) falha 'nenhum salão no canal evolution — a fila nunca sai'
           nota "update public.whatsapp_channels set canal='evolution', identificador='${NOME}' where salon_id=(select id from public.salons where slug='espaco-mel');" ;;
      esac
      case "$CH" in
        *"\"identificador\":\"${NOME}\""*) ok "identificador bate com a instância (${NOME})" ;;
        *) falha "o identificador no banco não é \"${NOME}\"" ;;
      esac ;;
    *) falha "não li whatsapp_channels: ${CH:0:200}" ;;
  esac

  titulo '6. A fila'
  OUT=$(curl -s --max-time 10 "${API}/message_outbox?select=status,canal,kind,erro,criado_em&order=criado_em.desc&limit=5" -H "$H1" -H "$H2")
  echo "  ${OUT:0:900}"
  case "$OUT" in
    '[]') nota 'fila vazia — nenhum aviso virou mensagem ainda' ;;
    *'"status":"falhou"'*) falha 'tem mensagem com falha — veja o campo erro acima' ;;
    *'"status":"na_fila"'*) nota 'tem mensagem esperando: rode ./disparar.sh' ;;
  esac

  titulo '7. As respostas que chegaram'
  IN=$(curl -s --max-time 10 "${API}/whatsapp_inbox?select=recebido_em,texto,acao&order=recebido_em.desc&limit=5" -H "$H1" -H "$H2")
  echo "  ${IN:0:700}"
  [ "$IN" = '[]' ] && nota 'nenhuma resposta registrada — se você respondeu no WhatsApp, o webhook não chegou'

  titulo '8. A função de envio'
  RESP=$(curl -s --max-time 30 -X POST \
    "https://${PROJECT_REF}.supabase.co/functions/v1/enviar-whatsapp" \
    -H "$H2" -H 'Content-Type: application/json' -d '{}')
  echo "  ${RESP:0:300}"
  case "$RESP" in
    *puxadas*) ok 'a função respondeu' ;;
    *) falha 'a função não respondeu como esperado' ;;
  esac
fi

# ---------------------------------------------------------------
titulo 'Resumo'
if [ "$PROBLEMAS" -eq 0 ]; then
  printf '  \033[1;32mNenhum problema encontrado.\033[0m\n'
else
  printf '  \033[1;31m%s ponto(s) com problema acima.\033[0m\n' "$PROBLEMAS"
fi
echo
