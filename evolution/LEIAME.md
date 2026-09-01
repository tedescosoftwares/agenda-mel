# Subir a Evolution numa EC2 Ubuntu

Do zero até o lembrete saindo sozinho. Uns 40 minutos, e a maior parte
é esperar download.

---

## 0. Antes de tocar no servidor

Duas coisas fora dele.

### O chip

Compre um **pré-pago dedicado**. Nunca o número comercial de ninguém —
se der ban, você perde o chip, não a agenda de uma profissional.

E **esquente o número por uns 3 dias antes**: use como WhatsApp normal
no celular, converse com gente de verdade, mande e receba áudio, entre
num grupo. Número que nasce mandando mensagem para desconhecido é
exatamente o padrão que a Meta caça. Esse passo é chato e é o que mais
importa.

### O domínio

O Supabase precisa alcançar a sua Evolution, e por HTTPS — senão a
chave de API viaja em texto puro pela internet.

Tem domínio? Crie um registro **A** apontando para o IP público da EC2
(ex.: `wa.seudominio.com.br` → `18.230.x.x`).

> **Aloque um Elastic IP antes.** O IP público de uma EC2 muda toda vez
> que a instância é parada e ligada de novo — e aí o domínio aponta para
> o vazio, o certificado quebra e o Supabase não alcança mais a
> Evolution. Elastic IP anexado à instância é gratuito e resolve isso
> para sempre. EC2 → Elastic IPs → Allocate → Associate.

Não tem? [duckdns.org](https://duckdns.org) dá um de graça em dois
minutos, e funciona com Let's Encrypt.

---

## 1. Abrir as portas no Security Group

**Esta é a etapa que todo mundo esquece.** É no console da AWS, não na
máquina: EC2 → sua instância → Security → Security groups → Inbound
rules → Edit.

| Tipo | Porta | Origem | Para quê |
| --- | --- | --- | --- |
| SSH | 22 | **Meu IP** | você entrar |
| HTTP | 80 | 0.0.0.0/0 | Let's Encrypt validar o certificado |
| HTTPS | 443 | 0.0.0.0/0 | o Supabase falar com a Evolution |

A porta **8080 fica fechada**. Ninguém fala com a Evolution direto — só
o Caddy, por dentro do Docker.

> As Edge Functions do Supabase não saem de um IP fixo, então não dá
> para restringir a origem do 443. Quem protege é a chave de API.

---

## 2. O caminho curto: um script só

Se preferir não digitar nada, o `bootstrap.sh` faz os passos 2 e 3
inteiros — Docker, swap, chaves, stack no ar — e no fim imprime tudo
que você precisa colar no Supabase:

```bash
git clone https://github.com/tedescosoftwares/agenda-mel.git
cd agenda-mel/evolution
./bootstrap.sh
```

Ele pergunta só o domínio e o e-mail; as chaves ele gera sozinho. Se
algo falhar, ele mesmo imprime os logs e aponta os suspeitos.

Pode rodar de novo à vontade: o que já está feito é pulado.

O resto desta página é o mesmo caminho na mão, para quando você quiser
entender ou consertar alguma coisa.

---

## 3. Instalar o Docker (na mão)

Entre na máquina (`ssh -i sua-chave.pem ubuntu@SEU_IP`) e rode:

```bash
sudo apt update && sudo apt upgrade -y

# repositório oficial — o docker.io do Ubuntu vem velho
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# usar docker sem sudo
sudo usermod -aG docker $USER
newgrp docker

docker --version && docker compose version
```

Se a instância for `t2.micro` / `t3.micro` (1 GB de RAM), crie swap —
o Postgres e a Evolution juntos apertam:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Subir a Evolution

```bash
git clone https://github.com/tedescosoftwares/agenda-mel.git
cd agenda-mel/evolution

cp .env.exemplo .env
nano .env        # preencha DOMINIO, EMAIL, API_KEY, POSTGRES_SENHA
```

Gere a chave com `openssl rand -hex 32` — não invente na mão.

```bash
docker compose up -d
docker compose logs -f evolution
```

Espere aparecer que o servidor subiu, e saia com `Ctrl+C`.

Teste:

```bash
curl https://SEU_DOMINIO/
```

Respondeu JSON com a versão? Está no ar, com HTTPS.

> **Deu erro de variável faltando?** Os nomes das variáveis da Evolution
> mudaram entre versões. O log diz qual falta — confira contra a
> documentação da versão que subiu e ajuste o `docker-compose.yml`.
> Quando estiver funcionando, troque `:latest` pela versão exata que o
> `docker compose images` mostra, para não quebrar num deploy futuro.

---

## 5. Conectar o WhatsApp

Abra **`https://SEU_DOMINIO/manager`** no navegador. Entre com a
`API_KEY`.

1. **Create instance** → nome `espaco-mel` (o mesmo que vai no banco)
2. Aparece o QR code na tela
3. No celular do chip: WhatsApp → **Aparelhos conectados** → Conectar

A instância fica verde. O número **continua funcionando no celular** —
ela é um aparelho vinculado a mais, como o WhatsApp Web.

---

## 6. Apontar o webhook para o app

Ainda no Manager, na instância → **Webhook**. Ou por linha de comando:

```bash
curl -X POST https://SEU_DOMINIO/webhook/set/espaco-mel \
  -H 'Content-Type: application/json' \
  -H 'apikey: SUA_API_KEY' \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook?token=SEGREDO_DA_URL",
      "byEvents": false,
      "base64": false,
      "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE"]
    }
  }'
```

Invente o `SEGREDO_DA_URL` (outro `openssl rand -hex 32`). É ele que
impede qualquer um de postar no seu webhook fingindo ser o WhatsApp — a
Evolution não assina os eventos como a Meta faz.

---

## 7. Ligar no Agenda Mel

**Publique as funções** (da sua máquina, onde está o repo):

```bash
supabase functions deploy enviar-whatsapp
supabase functions deploy whatsapp-webhook --no-verify-jwt

supabase secrets set \
  EVOLUTION_URL=https://SEU_DOMINIO \
  EVOLUTION_API_KEY=SUA_API_KEY \
  EVOLUTION_WEBHOOK_TOKEN=SEGREDO_DA_URL
```

O `--no-verify-jwt` no webhook é obrigatório: quem chama é o WhatsApp,
que não tem JWT do Supabase. A função se protege pelo segredo da URL.

**Troque o canal do salão** (SQL Editor do Supabase):

```sql
update public.whatsapp_channels
set canal = 'evolution',
    identificador = 'espaco-mel',
    numero_exibicao = '+55 13 99999-0000'
where salon_id = (select id from public.salons where slug = 'espaco-mel');
```

**Faça a fila andar** — o bloco comentado no fim de
`supabase/024_resposta_whatsapp.sql` liga o `pg_cron` de minuto em
minuto. Enquanto não ligar, chame na mão:

```bash
curl -X POST https://SEU-PROJETO.supabase.co/functions/v1/enviar-whatsapp \
  -H "Authorization: Bearer SUA_SERVICE_ROLE_KEY"
```

---

## 8. O teste que prova tudo

Com o seu celular pessoal como cliente:

1. Entre no app como `cliente@exemplo.com`, ponha o **seu número** no
   perfil e marque um horário para amanhã.
2. Rode `select public.enviar_lembretes();` no SQL Editor.
3. Dispare a fila (curl acima, ou espere o cron).
4. **A mensagem chega no seu WhatsApp.**
5. Responda **1**.
6. Volte ao app: o agendamento está **confirmado** — e chegou a
   confirmação de volta no WhatsApp.

Fechou o ciclo. Se responder **2**, cancela e a vaga já é oferecida
para quem estiver na fila de espera.

---

## Manutenção

```bash
docker compose logs -f evolution     # ver o que está acontecendo
docker compose restart evolution     # sessão travada
docker compose pull && docker compose up -d   # atualizar
```

**Se a sessão cair** (acontece: atualização do WhatsApp, reinício), a
instância fica vermelha no Manager e é só escanear o QR de novo. As
mensagens não se perdem — voltam para a fila e saem quando reconectar.

**O celular do chip precisa entrar na internet de vez em quando.** O
WhatsApp desconecta os aparelhos vinculados se o aparelho principal
ficar umas duas semanas offline. Não deixe o chip na gaveta.

---

## Conferir a saúde pelo banco

```sql
-- o que está esperando, o que falhou
select status, count(*), max(erro) as ultimo_erro
from public.message_outbox
group by status;

-- as últimas respostas das clientes
select recebido_em, telefone, texto, acao
from public.whatsapp_inbox
order by recebido_em desc
limit 20;
```
