# Agenda Mel 🌸

App de agendamento de serviços estéticos — PWA em React, multi-profissional:

- **Link público da profissional** (`/p/<slug>`) — qualquer pessoa abre, vê os
  serviços e os horários livres; o login só entra na hora de fechar
- **Área da cliente** (`/`) — meus agendamentos e com quem agendar
- **App da profissional** (`/pro`) — agenda dela, serviços que atende,
  horários dela e o link para divulgar
- **Área do salão / admin** (`/admin`) — agenda de todas, equipe, catálogo de
  serviços, horário padrão e clientes

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
3. No painel do projeto, abra **SQL Editor**, cole o conteúdo de
   [`supabase/001_schema.sql`](supabase/001_schema.sql) e clique em **Run**.
4. Repita com os demais arquivos de [`supabase/`](supabase/) **na ordem dos
   números**: `002_services.sql`, `003_business_hours.sql`,
   `004_appointments.sql`, `005_service_images_e_slots.sql`,
   `006_combos.sql`, `007_profissionais.sql`, `008_foto_profissional.sql`,
   `009_notificacoes.sql`, `010_adiantar_agenda.sql`,
   `011_lista_espera.sql`, `012_indique_e_ganhe.sql`, `013_seguranca.sql`, …

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
    pro/ProAgenda.jsx | ProServicos.jsx | ProHorarios.jsx | ProLink.jsx
    admin/AdminAgenda.jsx | AdminProfissionais.jsx | AdminServices.jsx
    admin/AdminHours.jsx | AdminClientes.jsx
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
```

## Papéis

| Papel          | Entra em  | O que faz                                            |
| -------------- | --------- | ---------------------------------------------------- |
| `cliente`      | `/`       | agenda, acompanha e cancela os próprios horários      |
| `profissional` | `/pro`    | vê a agenda dela, escolhe serviços, horários e o link |
| `admin`        | `/admin`  | equipe, catálogo de serviços, agenda de todas         |

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
- [ ] Publicar (Vercel/Netlify) e instalar como PWA no celular
- [ ] Notificações (lembrete de horário)
- [ ] Migrar depois para React Native / Expo reaproveitando o Supabase
