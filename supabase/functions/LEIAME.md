# WhatsApp: os três canais

O app escreve a mensagem uma vez. Quem entrega é o canal configurado
em `whatsapp_channels`, por salão. Trocar de canal é um `update`.

| canal | custo | manda sozinho? | precisa de quê |
| --- | --- | --- | --- |
| `manual` | zero | não | nada — funciona assim que você instala |
| `evolution` | zero (fora dos termos do WhatsApp) | sim | um chip dedicado e um servidor |
| `cloud` | centavos por mensagem iniciada | sim | CNPJ verificado na Meta |

O padrão é `manual`. Ninguém precisa configurar nada para o app ser útil.

---

## Canal manual — já está funcionando

A profissional abre **Ajustes → Pra enviar** (ou toca no aviso no topo da
agenda). Cada mensagem aparece escrita, do jeito que vai chegar. Um toque
abre o WhatsApp dela com o texto pronto, ela envia, volta e marca.

Chega do número que a cliente conhece, custa zero e não depende de nada.

---

## Canal evolution — de graça, mandando sozinho

A Evolution API pilota o WhatsApp Web. O número **continua no aplicativo**
(a profissional não perde nada), e não tem template nem aprovação.

**Está fora dos termos do WhatsApp: o número pode ser banido.** Use um chip
pré-pago dedicado, nunca o número comercial de alguém.

O passo a passo completo — servidor, Docker, HTTPS, QR code e o teste de
ponta a ponta — está em [`evolution/LEIAME.md`](../../evolution/LEIAME.md),
junto com o `docker-compose.yml` pronto.

Resumo: sobe a stack no servidor, escaneia o QR pelo painel, aponta o
webhook para cá, e troca o canal do salão:

```sql
update public.whatsapp_channels
set canal = 'evolution',
    identificador = 'espaco-mel',        -- o nome da instância
    numero_exibicao = '+55 13 99999-0000'
where salon_id = (select id from public.salons where slug = 'espaco-mel');
```

---

## Canal cloud — a API oficial da Meta

Mesma estrutura; muda o adaptador. `identificador` recebe o
`phone_number_id`.

Uma diferença que importa: **fora de uma janela de 24 horas aberta, a Meta
só aceita template aprovado.** O adaptador em `_shared/canais.ts` manda
texto livre, que funciona para responder a quem acabou de escrever. Para o
lembrete de véspera (que inicia a conversa) é preciso trocar o corpo do
JSON por um template. A estrutura fica igual.

---

## Publicar as funções

```bash
supabase functions deploy enviar-whatsapp
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

O `--no-verify-jwt` no webhook é necessário: quem chama é o WhatsApp, que
não tem JWT do Supabase. A função se protege sozinha — assinatura
`X-Hub-Signature-256` no caso da Meta, segredo na URL no caso da Evolution.

### Segredos

```bash
supabase secrets set \
  EVOLUTION_URL=http://SEU_IP:8080 \
  EVOLUTION_API_KEY=uma-chave-longa-que-voce-inventa \
  EVOLUTION_WEBHOOK_TOKEN=SEGREDO_DA_URL

# só para o canal cloud:
supabase secrets set \
  WHATSAPP_TOKEN=... \
  WHATSAPP_PHONE_NUMBER_ID=... \
  WHATSAPP_VERIFY_TOKEN=... \
  WHATSAPP_APP_SECRET=...
```

Nenhum destes entra no `.env` do front. São segredos de servidor.

### Fazer a fila andar

Sem agendamento, a fila só é drenada quando alguém chama a função. O bloco
comentado no fim de `024_resposta_whatsapp.sql` liga o `pg_cron` para rodar
de minuto em minuto.

Para testar na mão:

```bash
curl -X POST https://SEU-PROJETO.supabase.co/functions/v1/enviar-whatsapp \
  -H "Authorization: Bearer SUA_SERVICE_ROLE_KEY"
```

---

## O que o banco garante, em qualquer canal

- **Não manda para quem desligou.** `accepts_reminders` no perfil, e o
  "SAIR" pelo WhatsApp desliga sozinho.
- **Não manda de madrugada.** Janela de silêncio por salão (21h às 8h por
  padrão), que não se aplica ao canal manual — ali quem decide é gente.
- **Não manda duas vezes.** Índice único por atendimento no lembrete.
- **Não manda demais.** Teto diário por salão, 300 por padrão.
- **Não age fora de contexto.** "1" só confirma se a última mensagem
  enviada foi o lembrete.
- **Tenta de novo com juízo.** 2, 8 e 32 minutos; erro que não melhora
  (número errado, fora da janela) desiste na hora.
