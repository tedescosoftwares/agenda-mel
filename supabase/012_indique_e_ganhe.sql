-- =============================================================
-- Agenda Mel — 012: indique e ganhe
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 011).
--
-- REGRA CENTRAL: o crédito das duas pontas só nasce quando o primeiro
-- atendimento da indicada é CONCLUÍDO pela profissional. Creditar no
-- agendamento seria convite a agendamento fantasma.
-- =============================================================

-- 1. Regras do programa (uma linha só, editável pelo admin) --------------
create table if not exists public.referral_settings (
  id boolean primary key default true check (id),
  ativo boolean not null default true,
  -- quanto cada lado ganha, em centavos
  premio_indicou_cents integer not null default 2000 check (premio_indicou_cents >= 0),
  premio_indicada_cents integer not null default 1000 check (premio_indicada_cents >= 0),
  -- teto mensal de indicações premiadas por pessoa (trava antifraude)
  max_premios_por_mes integer not null default 10 check (max_premios_por_mes > 0),
  -- validade do crédito
  validade_dias integer not null default 180 check (validade_dias > 0)
);

insert into public.referral_settings (id) values (true) on conflict do nothing;

alter table public.referral_settings enable row level security;

drop policy if exists "ver regras de indicacao" on public.referral_settings;
create policy "ver regras de indicacao"
  on public.referral_settings for select
  to anon, authenticated using (true);

drop policy if exists "admin edita regras de indicacao" on public.referral_settings;
create policy "admin edita regras de indicacao"
  on public.referral_settings for update
  to authenticated using (public.is_admin());

-- 2. Código pessoal de cada cliente --------------------------------------
alter table public.profiles
  add column if not exists referral_code text unique;

create or replace function public.gerar_codigo_indicacao(nome text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidato text;
  tentativa integer := 0;
begin
  base := upper(regexp_replace(
    translate(coalesce(split_part(nome, ' ', 1), 'MEL'),
              'ÁÀÃÂÉÊÍÓÔÕÚÇáàãâéêíóôõúç', 'AAAAEEIOOOUCAAAAEEIOOOUC'),
    '[^A-Za-z]', '', 'g'));
  if base = '' or base is null then
    base := 'MEL';
  end if;
  base := left(base, 6);

  loop
    candidato := base || lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from public.profiles where referral_code = candidato);
    tentativa := tentativa + 1;
    if tentativa > 20 then
      candidato := base || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      exit;
    end if;
  end loop;

  return candidato;
end;
$$;

-- toda conta nova já nasce com código
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    public.gerar_codigo_indicacao(new.raw_user_meta_data ->> 'full_name')
  );
  return new;
end;
$$;

-- quem já tinha conta ganha o código agora
update public.profiles
set referral_code = public.gerar_codigo_indicacao(full_name)
where referral_code is null;

-- 3. Indicações -----------------------------------------------------------
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles (id) on delete cascade,
  -- cada pessoa só pode ser indicada uma vez na vida
  referred_id uuid not null unique references public.profiles (id) on delete cascade,
  code text not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'creditada', 'bloqueada')),
  appointment_id uuid references public.appointments (id) on delete set null,
  motivo_bloqueio text,
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, status, credited_at);

-- 4. Carteira de créditos -------------------------------------------------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  -- positivo = ganhou, negativo = usou
  amount_cents integer not null,
  kind text not null check (kind in ('indicacao', 'indicacao_bonus', 'uso', 'ajuste', 'expiracao')),
  description text,
  referral_id uuid references public.referrals (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists credit_client_idx
  on public.credit_transactions (client_id, created_at desc);

alter table public.referrals enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "ver minhas indicacoes" on public.referrals;
create policy "ver minhas indicacoes"
  on public.referrals for select
  to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid() or public.is_admin());

drop policy if exists "ver meus creditos" on public.credit_transactions;
create policy "ver meus creditos"
  on public.credit_transactions for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.appointments a
      where a.id = credit_transactions.appointment_id
        and public.is_professional(a.professional_id)
    )
  );

revoke insert, update, delete on public.referrals from authenticated, anon;
revoke insert, update, delete on public.credit_transactions from authenticated, anon;

-- 5. Saldo ----------------------------------------------------------------
create or replace function public.saldo_creditos(cliente uuid default auth.uid())
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce(sum(amount_cents), 0)::integer
  from public.credit_transactions
  where client_id = cliente
    and (expires_at is null or expires_at > now());
$$;

-- 6. Registrar a indicação (chamado logo após o cadastro) -----------------
create or replace function public.registrar_indicacao(codigo text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  quem_indicou public.profiles%rowtype;
  eu public.profiles%rowtype;
  cfg public.referral_settings%rowtype;
  tel_meu text;
  tel_dele text;
begin
  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return 'programa_inativo';
  end if;

  if auth.uid() is null then
    raise exception 'Entre na sua conta primeiro';
  end if;

  select * into eu from public.profiles where id = auth.uid();
  select * into quem_indicou from public.profiles
  where referral_code = upper(trim(codigo));

  if not found then
    return 'codigo_invalido';
  end if;

  -- autoindicação
  if quem_indicou.id = eu.id then
    return 'codigo_proprio';
  end if;

  -- já foi indicada alguma vez
  if exists (select 1 from public.referrals where referred_id = eu.id) then
    return 'ja_indicada';
  end if;

  -- conta antiga não vale como indicação nova
  if exists (
    select 1 from public.appointments
    where client_id = eu.id and status = 'concluido'
  ) then
    return 'conta_antiga';
  end if;

  -- mesmo telefone dos dois lados: trava de conta fantasma
  tel_meu := regexp_replace(coalesce(eu.phone, ''), '[^0-9]', '', 'g');
  tel_dele := regexp_replace(coalesce(quem_indicou.phone, ''), '[^0-9]', '', 'g');
  if length(tel_meu) >= 10 and tel_meu = tel_dele then
    insert into public.referrals (referrer_id, referred_id, code, status, motivo_bloqueio)
    values (quem_indicou.id, eu.id, upper(trim(codigo)), 'bloqueada', 'mesmo telefone');
    return 'bloqueada';
  end if;

  insert into public.referrals (referrer_id, referred_id, code)
  values (quem_indicou.id, eu.id, upper(trim(codigo)));

  return 'registrada';
end;
$$;

-- 7. O crédito nasce quando o atendimento é CONCLUÍDO ---------------------
create or replace function public.creditar_indicacao_se_couber()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  ind public.referrals%rowtype;
  cfg public.referral_settings%rowtype;
  premiados_no_mes integer;
  nome_indicada text;
  nome_indicou text;
  validade timestamptz;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  select * into ind from public.referrals
  where referred_id = new.client_id and status = 'pendente';
  if not found then
    return new;
  end if;

  -- precisa ser o PRIMEIRO atendimento concluído dela
  if exists (
    select 1 from public.appointments
    where client_id = new.client_id
      and status = 'concluido'
      and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  -- teto mensal de quem indica
  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and credited_at >= date_trunc('month', now());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    update public.referrals
    set status = 'bloqueada', motivo_bloqueio = 'teto mensal atingido'
    where id = ind.id;
    return new;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if cfg.premio_indicou_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referrer_id, cfg.premio_indicou_cents, 'indicacao',
            format('Indicação de %s', coalesce(nome_indicada, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referrer_id, 'indicacao_creditada', 'Seu crédito chegou! 🎁',
      format('%s fez o primeiro atendimento e você ganhou %s de crédito.',
             coalesce(nome_indicada, 'Sua indicada'),
             to_char(cfg.premio_indicou_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  if cfg.premio_indicada_cents > 0 then
    insert into public.credit_transactions
      (client_id, amount_cents, kind, description, referral_id, appointment_id, expires_at)
    values (ind.referred_id, cfg.premio_indicada_cents, 'indicacao_bonus',
            format('Bônus de boas-vindas (indicada por %s)', coalesce(nome_indicou, 'uma amiga')),
            ind.id, new.id, validade);

    perform public.notificar(
      ind.referred_id, 'indicacao_creditada', 'Bônus de boas-vindas 🎁',
      format('Você ganhou %s de crédito para o próximo atendimento.',
             to_char(cfg.premio_indicada_cents / 100.0, 'FM999G990D00')),
      '/indique', jsonb_build_object('referral_id', ind.id), null
    );
  end if;

  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where id = ind.id;

  return new;
end;
$$;

drop trigger if exists on_atendimento_concluido on public.appointments;
create trigger on_atendimento_concluido
  after update on public.appointments
  for each row execute function public.creditar_indicacao_se_couber();

-- 8. Usar o crédito no atendimento ---------------------------------------
create or replace function public.usar_credito(appt_id uuid, valor_cents integer)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  saldo integer;
  preco_cents integer;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin() or public.is_professional(appt.professional_id)) then
    raise exception 'Só a profissional do atendimento pode abater crédito';
  end if;

  if valor_cents <= 0 then
    raise exception 'Valor inválido';
  end if;

  saldo := public.saldo_creditos(appt.client_id);
  if valor_cents > saldo then
    raise exception 'Crédito insuficiente';
  end if;

  select round(price * 100)::integer into preco_cents
  from public.services where id = appt.service_id;

  if preco_cents is not null and valor_cents > preco_cents then
    raise exception 'O abatimento não pode passar do valor do serviço';
  end if;

  if exists (
    select 1 from public.credit_transactions
    where appointment_id = appt_id and kind = 'uso'
  ) then
    raise exception 'Este atendimento já teve crédito abatido';
  end if;

  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (appt.client_id, -valor_cents, 'uso', 'Abatido no atendimento', appt_id);

  perform public.notificar(
    appt.client_id, 'indicacao_creditada', 'Crédito usado',
    format('Abatemos %s no seu atendimento.',
           to_char(valor_cents / 100.0, 'FM999G990D00')),
    '/indique', jsonb_build_object('appointment_id', appt_id), null
  );

  return public.saldo_creditos(appt.client_id);
end;
$$;

-- 9. Resumo do programa para a tela "Indique e ganhe" ---------------------
create or replace function public.meu_resumo_indicacoes()
returns table (
  codigo text,
  saldo_cents integer,
  indicadas_total integer,
  indicadas_creditadas integer,
  premio_indicou_cents integer,
  premio_indicada_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    p.referral_code,
    public.saldo_creditos(auth.uid()),
    (select count(*)::integer from public.referrals r where r.referrer_id = auth.uid()),
    (select count(*)::integer from public.referrals r
      where r.referrer_id = auth.uid() and r.status = 'creditada'),
    s.premio_indicou_cents,
    s.premio_indicada_cents
  from public.profiles p
  cross join public.referral_settings s
  where p.id = auth.uid() and s.id;
$$;

grant execute on function public.saldo_creditos(uuid) to authenticated;
grant execute on function public.registrar_indicacao(text) to authenticated;
grant execute on function public.usar_credito(uuid, integer) to authenticated;
grant execute on function public.meu_resumo_indicacoes() to authenticated;
