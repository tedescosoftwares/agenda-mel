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
   números**: `002_services.sql`, `003_business_hours.sql`,
   `004_appointments.sql`, `005_service_images_e_slots.sql`,
   `006_combos.sql`, …

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
    cliente/ClienteHome.jsx  # meus agendamentos + catálogo de serviços
    cliente/AgendarServico.jsx # fluxo: dia -> horário livre -> confirmar
    admin/AdminAgenda.jsx    # agenda do dia — tela inicial do admin (/admin)
    admin/AdminServices.jsx  # CRUD de serviços (/admin/servicos)
    admin/AdminHours.jsx     # horários de atendimento (/admin/horarios)
    admin/AdminClientes.jsx  # lista de clientes (/admin/clientes)
  components/
    AdminShell.jsx           # topo + navegação por abas do admin
supabase/
  001_schema.sql           # perfis, trigger e políticas de segurança (RLS)
  002_services.sql         # tabela de serviços + políticas
  003_business_hours.sql   # horários de atendimento por dia da semana
  004_appointments.sql     # agendamentos + admin enxerga perfis
  005_service_images_e_slots.sql # fotos dos serviços + horários ocupados
  006_combos.sql           # combos de serviços (duração somada = tempo médio)
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
- [ ] Publicar (Vercel/Netlify) e instalar como PWA no celular
- [ ] Notificações (lembrete de horário)
- [ ] Migrar depois para React Native / Expo reaproveitando o Supabase
