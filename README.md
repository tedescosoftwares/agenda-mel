# Agenda Mel 🌸

App de agendamento de serviços estéticos — PWA em React, com dois ambientes:

- **Área da cliente** (`/`) — agendar e acompanhar horários
- **Área admin** (`/admin`) — gerenciar agenda, serviços e clientes

Backend: [Supabase](https://supabase.com) (plano gratuito — autenticação + banco Postgres).

## Stack

- React 19 + Vite
- React Router (rotas protegidas por papel: `cliente` / `admin`)
- Supabase (Auth + Postgres com Row Level Security)
- PWA via `vite-plugin-pwa` (instalável no celular, pronto pra virar app depois)

## Como rodar

### 1. Criar o projeto no Supabase (grátis)

1. Acesse [supabase.com](https://supabase.com) e crie uma conta (pode usar o GitHub).
2. Crie um projeto novo (região `South America (São Paulo)` é a mais próxima).
3. No painel do projeto, abra **SQL Editor**, cole o conteúdo de
   [`supabase/001_schema.sql`](supabase/001_schema.sql) e clique em **Run**.
4. Repita com os demais arquivos de [`supabase/`](supabase/) **na ordem dos
   números**: `002_services.sql`, `003_business_hours.sql`, …

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

### 4. Criar a conta admin

Toda conta nova nasce como `cliente`. Para promover a sua conta a admin,
rode no **SQL Editor** do Supabase:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

Depois é só sair e entrar de novo no app — você cai direto no `/admin`.

## Estrutura

```
src/
  lib/supabase.js          # cliente Supabase (lê o .env)
  context/AuthContext.jsx  # sessão, perfil e papel do usuário logado
  components/ProtectedRoute.jsx
  pages/
    Login.jsx              # login + cadastro
    cliente/ClienteHome.jsx
    admin/AdminHome.jsx
    admin/AdminServices.jsx  # CRUD de serviços (/admin/servicos)
    admin/AdminHours.jsx     # horários de atendimento (/admin/horarios)
supabase/
  001_schema.sql           # perfis, trigger e políticas de segurança (RLS)
  002_services.sql         # tabela de serviços + políticas
  003_business_hours.sql   # horários de atendimento por dia da semana
```

## Próximos passos

- [x] Cadastro de serviços (nome, duração, preço) — admin
- [x] Configuração de horários de atendimento — admin
- [ ] Fluxo de agendamento — cliente
- [ ] Listagem/cancelamento de agendamentos
- [ ] Migrar depois para React Native / Expo reaproveitando o Supabase
