# Agenda Mel 🌸

App de agendamento de serviços estéticos — PWA em React, multi-profissional:

- **Link público da profissional** (`/p/<slug>`) — qualquer pessoa abre, vê os
  serviços e os horários livres; o login só entra na hora de fechar
- **Área da cliente** (`/`) — meus agendamentos e com quem agendar
- **App da profissional** (`/pro`) — agenda dela, quem sumiu e precisa ser
  chamada de volta, o mês em números, as mensagens prontas pra enviar no
  WhatsApp, serviços que atende, horários e o link
- **Área do salão / admin** (`/admin`) — agenda de todas, o mês do salão,
  equipe, catálogo de serviços, horário padrão e clientes

Backend: [Supabase](https://supabase.com) (plano gratuito — autenticação + banco Postgres).

## Stack

- React 19 + Vite
- React Router (rotas protegidas por papel: `cliente` / `profissional` / `admin`)
- Supabase (Auth + Postgres com Row Level Security)
- PWA via `vite-plugin-pwa` (instalável no celular, pronto pra virar app depois)

## Como rodar

### 1. Criar o projeto no Supabase (grátis)

1. Acesse [supabase.com](https://supabase.com) e crie uma conta (pode usar o GitHub).
2. Crie um projeto novo (região `South America (São Paulo)` é a mais próxima).
3. No painel do projeto, abra **SQL Editor**, cole o conteúdo inteiro de
   [`supabase/setup_completo.sql`](supabase/setup_completo.sql) e clique em
   **Run**. É só isso — um arquivo, uma vez.

   Ele monta o banco inteiro, pode ser rodado em banco vazio **ou** em banco
   que já tem parte das coisas, e pode ser executado de novo quantas vezes
   quiser sem duplicar nada. No fim, cria três contas de teste e um salão de
   exemplo com serviços, horários e agendamentos.

   > Os arquivos numerados (`001_` a `018_`) continuam na pasta como
   > histórico — cada um é um passo da construção. Para instalar, use só o
   > `setup_completo.sql`.

### 2. Configurar as variáveis de ambiente

1. No Supabase, vá em **Project Settings → API** e copie a **URL** e a **anon key**.
2. Na raiz deste projeto:

```bash
cp .env.example .env
# edite o .env e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
```

### 3. Rodar o app

```bash
npm install
npm run dev
```

Abra http://localhost:5173 — a tela de login aparece. Crie uma conta pela aba
**Criar conta** (chega um e-mail de confirmação).

### 4. Entrar

O `setup_completo.sql` já criou estas contas:

| Conta                      | Senha          | Cai em    |
| -------------------------- | -------------- | --------- |
| `admin@exemplo.com`        | `agendamel123` | `/admin`  |
| `profissional@exemplo.com` | `agendamel123` | `/pro`    |
| `cliente@exemplo.com`      | `agendamel123` | `/`       |

Para promover a **sua** conta a admin, rode no **SQL Editor**:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

Depois é só sair e entrar de novo no app.

### Não está vendo as mudanças?

A tela de login mostra a versão no rodapé (`v0.9.0 · salões, agenda real e
afiliadas`). Se aparecer versão diferente ou nenhuma, o código na sua máquina
está velho:

```bash
git fetch origin
git checkout claude/aesthetic-services-booking-app-b327z0
git pull
npm install
# pare o servidor (Ctrl+C) e suba de novo
npm run dev
```

Se ainda assim não mudar, é o cache do navegador/PWA: abra uma janela anônima,
ou aperte Ctrl+Shift+R.

## Publicar o app

O app é estático: HTML, CSS e JS falando direto com o Supabase. Não tem
backend para rodar, então não precisa de servidor — uma hospedagem
estática serve melhor e de graça.

**Vercel** ou **Cloudflare Pages**: aponte para este repositório, e é só.
O `vercel.json` e o `public/_redirects` já estão aqui — sem eles, abrir
`/p/ana-paula` direto no navegador daria 404, porque quem resolve essa
rota é o React, e o servidor precisa devolver o `index.html` para
qualquer caminho.

Configure as duas variáveis no painel da hospedagem:

```
VITE_SUPABASE_URL=https://SEU_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

O envio de WhatsApp **não depende disso**. Quem manda é a Edge Function
no Supabase, então o lembrete das 19h sai mesmo com o app rodando só na
sua máquina — ou fechado.

## Estrutura

```
src/
  lib/
    supabase.js            # cliente Supabase (lê o .env)
    format.js              # preço, duração (combo = tempo médio), data
    booking.js             # grade de horários livres, slug, iniciais
    roles.js               # para onde cada papel vai ao entrar
  context/AuthContext.jsx  # sessão, perfil, papel e ficha da profissional
  components/
    ProtectedRoute.jsx     # rota por papel (cliente | profissional | admin)
    AdminShell.jsx         # abas do salão
    ProShell.jsx           # abas da profissional
    AgendaDia.jsx          # agenda de um dia (usada pelo admin e pela pro)
    AuthModal.jsx          # login rápido dentro do link público
    Avatar.jsx | FotoUpload.jsx  # foto da profissional (cai nas iniciais)
  pages/
    Login.jsx
    publico/PaginaProfissional.jsx  # /p/<slug> — serviço, dia, horário
    cliente/ClienteHome.jsx
    Estilo.jsx                      # /estilo — mostruário do sistema visual
    pro/ProAgenda.jsx | ProRetorno.jsx | ProNumeros.jsx | ProServicos.jsx
    pro/ProHorarios.jsx | ProLink.jsx | ProAjustes.jsx
    admin/AdminAgenda.jsx | AdminNumeros.jsx | AdminProfissionais.jsx
    admin/AdminServices.jsx | AdminHours.jsx | AdminClientes.jsx
public/fontes/             # as três fontes, servidas pelo próprio app
supabase/
  001_schema.sql           # perfis, trigger e políticas de segurança (RLS)
  002_services.sql         # tabela de serviços + políticas
  003_business_hours.sql   # horário padrão do salão
  004_appointments.sql     # agendamentos + admin enxerga perfis
  005_service_images_e_slots.sql # fotos dos serviços + horários ocupados
  006_combos.sql           # combos de serviços (duração = tempo médio)
  007_profissionais.sql    # equipe, agenda e link por profissional
  008_foto_profissional.sql # bucket das fotos das profissionais
  009_notificacoes.sql     # caixa de avisos no app (base das features)
  010_adiantar_agenda.sql  # convite para a cliente vir mais cedo
  011_lista_espera.sql     # fila de espera, vaga liberada e falta da cliente
  012_indique_e_ganhe.sql  # indicação, carteira de créditos e antifraude
  013_seguranca.sql        # travas de permissão e de sobreposição (obrigatório)
  014_correcoes.sql        # correções da revisão (horário no passado, fila, saldo)
  015_saloes.sql           # camada de salão: cada negócio com catálogo e equipe
  016_agenda_real.sql      # almoço/folga, arrumação, encaixe, preço congelado
  017_afiliados.sql        # cliente traz profissional e recebe parte da taxa
  018_dados_teste.sql      # três contas prontas + salão de exemplo
  019_volta_sozinha.sql    # lembrete de véspera, pós-atendimento e quem sumiu
  020_numeros.sql          # faturamento, ticket, ocupação e falta do mês
  021_dados_teste_historico.sql # dois meses de histórico, para os números terem o que mostrar
  022_gatilhos.sql         # corrige a trava de status que nunca travava
  023_whatsapp.sql         # fila de saída, canal por salão, janela de silêncio
  024_resposta_whatsapp.sql # 1 confirma, 2 cancela, SAIR desliga
  025_botoes.sql           # botão de resposta, com o texto como plano B
  026_botao_so_na_oficial.sql # botão nativo desligado: não desenha fora da API oficial
  027_estilo_do_botao.sql  # estilos de opção tocável: texto, enquete, nativo
  028_primeiro_voto_vale.sql # texto por padrão; na enquete o primeiro voto é o que vale
  setup_completo.sql       # TODOS os arquivos acima juntos — é este que se roda
  functions/               # Edge Functions: envio e webhook (veja o LEIAME de lá)
evolution/                 # stack do WhatsApp automático: compose, Caddy e o passo a passo
```

## Papéis

| Papel          | Entra em  | O que faz                                            |
| -------------- | --------- | ---------------------------------------------------- |
| `cliente`      | `/`       | agenda, acompanha e cancela os próprios horários      |
| `profissional` | `/pro`    | agenda, quem sumiu, o mês em números, serviços e link |
| `admin`        | `/admin`  | equipe, catálogo, agenda de todas e o mês do salão    |

Toda conta nova nasce como `cliente`. Para promover:

```sql
-- admin
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'voce@exemplo.com');

-- profissional (depois de cadastrá-la em Admin → Equipe)
update public.profiles set role = 'profissional'
where id = (select id from auth.users where email = 'ela@exemplo.com');

update public.professionals set user_id =
  (select id from auth.users where email = 'ela@exemplo.com')
where slug = 'slug-dela';
```


## Próximos passos

- [x] Cadastro de serviços (nome, duração, preço) — admin
- [x] Configuração de horários de atendimento — admin
- [x] Painel admin mobile-first (abas: Agenda, Serviços, Horários, Clientes)
- [x] Fluxo de agendamento — cliente
- [x] Listagem/cancelamento de agendamentos
- [x] Fotos dos serviços (até 3 por serviço, Supabase Storage)
- [x] Confirmar/concluir agendamentos pelo admin
- [x] Combos de serviços (soma das durações exibida como tempo médio)
- [x] Equipe: profissionais com agenda, serviços e link próprios
- [x] Link público /p/<slug> — agenda sem precisar estar logada antes
- [x] Foto da profissional (admin e ela mesma trocam)
- [x] Caixa de avisos no app, em tempo real
- [x] Adiantar a agenda (convite com prazo; a cliente decide)
- [x] Lista de espera + falta da cliente libera a vaga
- [x] Indique e ganhe (crédito só depois do atendimento concluído)
- [x] Camada de salão (o produto nasce marketplace)
- [x] Almoço, folga e compromisso; tempo de arrumação entre atendimentos
- [x] Encaixe manual de cliente sem app; preço congelado no atendimento
- [x] Perdoar falta e a semana numa tela só
- [x] Indicação inversa: cliente traz profissional e vira afiliada dela
- [x] Sistema visual próprio (grafite e latão), fontes servidas pelo app
- [x] A cliente volta sozinha: lembrete de véspera, "obrigada pela visita" com
      sugestão de retorno, e a lista de quem passou do tempo de voltar
- [x] O mês em números: faturamento, ticket médio, ocupação da agenda, faltas,
      clientes novas, o que mais rendeu e quem mais volta
- [x] WhatsApp: fila de saída com adaptador de canal — manual (um toque, de
      graça), Evolution (chip próprio) ou Cloud API oficial
- [x] A resposta da cliente mexe na agenda: 1 confirma, 2 cancela e libera a
      vaga para a fila de espera, SAIR desliga os avisos
- [x] Resposta pelo WhatsApp: "Responda 1 ou 2" por padrão (funciona em todo
      aparelho); enquete e botão nativo como estilos opcionais — botão de
      verdade só a API oficial desenha
- [ ] Publicar (Vercel/Netlify) e instalar como PWA no celular
- [ ] Notificações (lembrete de horário)
- [ ] Migrar depois para React Native / Expo reaproveitando o Supabase
