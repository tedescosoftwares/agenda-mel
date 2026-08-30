-- =============================================================
-- Agenda Mel — 017: indicação inversa (cliente traz profissional)
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 016).
--
-- A cliente que traz uma profissional vira AFILIADA dela: enquanto
-- essa profissional usar o app, uma fatia da taxa que a plataforma
-- cobra vai para a cliente, em cashback.
--
-- Se a taxa é 3% e o repasse é 0,5 ponto, a plataforma fica com 2,5
-- e a cliente com 0,5. Tudo em pontos-base (bps) e centavos, com
-- número inteiro — dinheiro nunca em ponto flutuante.
--
-- O pagamento ainda não existe. O que entra aqui é a ATRIBUIÇÃO
-- (quem trouxe quem, de forma permanente) e o livro-razão que vai
-- receber as transações quando o pagamento chegar.
-- =============================================================

-- 1. Regras do programa ---------------------------------------------------
create table if not exists public.affiliate_settings (
  id boolean primary key default true check (id),
  ativo boolean not null default true,
  -- taxa que a plataforma cobra sobre a transação (300 = 3,00%)
  platform_fee_bps integer not null default 300 check (platform_fee_bps between 0 and 10000),
  -- quanto dessa taxa vai para quem indicou (50 = 0,50%)
  affiliate_share_bps integer not null default 50 check (affiliate_share_bps between 0 and 10000),
  -- por quantos meses a cliente recebe; null = enquanto a profissional usar
  duracao_meses integer check (duracao_meses is null or duracao_meses > 0),
  -- teto mensal de cashback por cliente, em centavos (freio de mão)
  teto_mensal_cents integer not null default 50000 check (teto_mensal_cents >= 0),
  check (affiliate_share_bps <= platform_fee_bps)
);

insert into public.affiliate_settings (id) values (true) on conflict do nothing;

alter table public.affiliate_settings enable row level security;

drop policy if exists "ver regras de afiliado" on public.affiliate_settings;
create policy "ver regras de afiliado"
  on public.affiliate_settings for select
  to anon, authenticated using (true);

-- 2. A atribuição: quem trouxe quem, para sempre -------------------------
-- Uma linha por profissional e uma por salão. Existir a linha JÁ
-- fecha a porta: quem entrou direto ganha linha com indicante nulo,
-- e nunca mais pode ser atribuída a um link.
create table if not exists public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('salao', 'profissional')),
  salon_id uuid references public.salons (id) on delete cascade,
  professional_id uuid references public.professionals (id) on delete cascade,
  -- quem indicou; nulo = entrou direto (a porta fecha do mesmo jeito)
  referrer_client_id uuid references public.profiles (id) on delete set null,
  code text,
  status text not null default 'ativa'
    check (status in ('ativa', 'direta', 'bloqueada', 'encerrada')),
  motivo text,
  created_at timestamptz not null default now(),
  -- quando a profissional começou a usar de fato
  first_activity_at timestamptz,
  expires_at timestamptz,
  check (
    (kind = 'salao' and salon_id is not null and professional_id is null)
    or (kind = 'profissional' and professional_id is not null and salon_id is null)
  )
);

create unique index if not exists atribuicao_salao_unica
  on public.affiliate_attributions (salon_id) where salon_id is not null;

create unique index if not exists atribuicao_prof_unica
  on public.affiliate_attributions (professional_id) where professional_id is not null;

create index if not exists atribuicao_indicante_idx
  on public.affiliate_attributions (referrer_client_id, status);

-- 3. Livro-razão: o que a plataforma cobrou ------------------------------
create table if not exists public.platform_transactions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete restrict,
  professional_id uuid references public.professionals (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  -- quanto a cliente pagou pelo atendimento
  amount_cents integer not null check (amount_cents > 0),
  -- a taxa da plataforma naquele momento (congelada, como o preço)
  platform_fee_bps integer not null,
  platform_fee_cents integer not null check (platform_fee_cents >= 0),
  status text not null default 'liquidada'
    check (status in ('pendente', 'liquidada', 'estornada')),
  -- 'pagamento' quando vier do gateway; 'manual' enquanto não existe
  origem text not null default 'manual' check (origem in ('manual', 'pagamento')),
  occurred_at timestamptz not null default now()
);

create index if not exists transacoes_salao_idx
  on public.platform_transactions (salon_id, occurred_at desc);

create unique index if not exists transacao_por_atendimento
  on public.platform_transactions (appointment_id)
  where appointment_id is not null and status <> 'estornada';

-- 4. A comissão de cada transação ----------------------------------------
create table if not exists public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.platform_transactions (id) on delete cascade,
  attribution_id uuid not null references public.affiliate_attributions (id) on delete cascade,
  affiliate_client_id uuid not null references public.profiles (id) on delete cascade,
  share_bps integer not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'creditada'
    check (status in ('creditada', 'estornada', 'retida')),
  motivo text,
  created_at timestamptz not null default now()
);

create unique index if not exists comissao_por_transacao
  on public.affiliate_commissions (transaction_id);

create index if not exists comissao_afiliada_idx
  on public.affiliate_commissions (affiliate_client_id, created_at desc);

-- 5. O cashback entra na carteira que já existe --------------------------
alter table public.credit_transactions drop constraint if exists credit_transactions_kind_check;
alter table public.credit_transactions add constraint credit_transactions_kind_check
  check (kind in ('indicacao', 'indicacao_bonus', 'uso', 'ajuste', 'expiracao', 'afiliado'));

-- 6. Permissões -----------------------------------------------------------
alter table public.affiliate_attributions enable row level security;
alter table public.platform_transactions enable row level security;
alter table public.affiliate_commissions enable row level security;

drop policy if exists "ver minhas atribuicoes" on public.affiliate_attributions;
create policy "ver minhas atribuicoes"
  on public.affiliate_attributions for select
  to authenticated
  using (
    referrer_client_id = auth.uid()
    or public.is_admin_do_salao(salon_id)
    or public.is_professional(professional_id)
  );

drop policy if exists "ver transacoes do salao" on public.platform_transactions;
create policy "ver transacoes do salao"
  on public.platform_transactions for select
  to authenticated
  using (public.is_admin_do_salao(salon_id) or public.is_professional(professional_id));

drop policy if exists "ver minhas comissoes" on public.affiliate_commissions;
create policy "ver minhas comissoes"
  on public.affiliate_commissions for select
  to authenticated
  using (affiliate_client_id = auth.uid());

revoke insert, update, delete on public.affiliate_attributions from authenticated, anon;
revoke insert, update, delete on public.platform_transactions from authenticated, anon;
revoke insert, update, delete on public.affiliate_commissions from authenticated, anon;

-- 7. Fechar a porta: toda profissional e todo salão nascem atribuídos ----
-- Sem indicante, a linha entra como 'direta' — e a exclusividade
-- permanente passa a valer a partir daí.
create or replace function public.fecha_atribuicao_profissional()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.affiliate_attributions (kind, professional_id, status)
  values ('profissional', new.id, 'direta')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_atribuicao_profissional on public.professionals;
create trigger on_atribuicao_profissional
  after insert on public.professionals
  for each row execute function public.fecha_atribuicao_profissional();

create or replace function public.fecha_atribuicao_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.affiliate_attributions (kind, salon_id, status)
  values ('salao', new.id, 'direta')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_atribuicao_salao on public.salons;
create trigger on_atribuicao_salao
  after insert on public.salons
  for each row execute function public.fecha_atribuicao_salao();

revoke execute on function public.fecha_atribuicao_profissional() from public, anon, authenticated;
revoke execute on function public.fecha_atribuicao_salao() from public, anon, authenticated;

-- o que já existe entra como 'direta' (ninguém indicou)
insert into public.affiliate_attributions (kind, professional_id, status)
select 'profissional', p.id, 'direta' from public.professionals p
on conflict do nothing;

insert into public.affiliate_attributions (kind, salon_id, status)
select 'salao', s.id, 'direta' from public.salons s
on conflict do nothing;

-- 8. Registrar a indicação de uma profissional ---------------------------
create or replace function public.registrar_indicacao_profissional(
  codigo text,
  salao uuid default null,
  profissional uuid default null
)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  cfg public.affiliate_settings%rowtype;
  quem_indicou public.profiles%rowtype;
  atual public.affiliate_attributions%rowtype;
  dono uuid;
  vence timestamptz;
begin
  select * into cfg from public.affiliate_settings where id;
  if not cfg.ativo then
    return 'programa_inativo';
  end if;

  if auth.uid() is null then
    raise exception 'Entre na sua conta primeiro';
  end if;

  if (salao is null) = (profissional is null) then
    raise exception 'Informe o salão OU a profissional';
  end if;

  -- só quem manda no salão / é dona da ficha pode declarar quem a trouxe
  if salao is not null then
    if not public.is_admin_do_salao(salao) then
      raise exception 'Sem permissão sobre este salão';
    end if;
    select owner_id into dono from public.salons where id = salao;
  else
    if not public.is_professional(profissional) then
      raise exception 'Sem permissão sobre esta ficha';
    end if;
    select user_id into dono from public.professionals where id = profissional;
  end if;

  select * into quem_indicou from public.profiles
  where referral_code = upper(trim(codigo));
  if not found then
    return 'codigo_invalido';
  end if;

  -- ninguém se indica
  if quem_indicou.id = auth.uid() or quem_indicou.id = dono then
    return 'codigo_proprio';
  end if;

  select * into atual from public.affiliate_attributions
  where (salao is not null and salon_id = salao)
     or (profissional is not null and professional_id = profissional);

  -- a porta já está fechada: entrou direto ou já tem quem indicou
  if found and atual.referrer_client_id is not null then
    return 'ja_atribuida';
  end if;
  if found and atual.status <> 'direta' then
    return 'ja_atribuida';
  end if;

  -- só vale enquanto o cadastro é novo: sem transação nenhuma ainda
  if exists (
    select 1 from public.platform_transactions t
    where (salao is not null and t.salon_id = salao)
       or (profissional is not null and t.professional_id = profissional)
  ) then
    return 'cadastro_antigo';
  end if;

  vence := case when cfg.duracao_meses is null then null
                else now() + make_interval(months => cfg.duracao_meses) end;

  update public.affiliate_attributions
  set referrer_client_id = quem_indicou.id,
      code = upper(trim(codigo)),
      status = 'ativa',
      expires_at = vence
  where id = atual.id;

  perform public.notificar(
    quem_indicou.id,
    'afiliado_novo',
    'Você trouxe uma profissional! 💼',
    'A partir de agora você recebe uma parte da taxa do app sempre que ela atender pelo aplicativo.',
    '/indique',
    jsonb_build_object('attribution_id', atual.id),
    null
  );

  return 'registrada';
end;
$$;

grant execute on function public.registrar_indicacao_profissional(text, uuid, uuid) to authenticated;

-- 9. Registrar uma transação e repartir a taxa ---------------------------
-- Enquanto o pagamento não existe, esta função é chamada à mão pelo
-- salão (origem 'manual'). Quando o gateway entrar, o webhook chama a
-- mesma função com origem 'pagamento' — a repartição não muda.
create or replace function public.registrar_transacao(
  appt_id uuid,
  valor_cents integer default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  cfg public.affiliate_settings%rowtype;
  valor integer;
  taxa integer;
  trans_id uuid;
  atrib public.affiliate_attributions%rowtype;
  comissao integer;
  ja_no_mes integer;
  nome_prof text;
begin
  select * into appt from public.appointments where id = appt_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;

  if not (public.is_admin_do_salao(appt.salon_id)
          or public.is_professional(appt.professional_id)) then
    raise exception 'Sem permissão';
  end if;

  if appt.status <> 'concluido' then
    raise exception 'A transação só entra depois do atendimento concluído';
  end if;

  select * into cfg from public.affiliate_settings where id;
  valor := coalesce(valor_cents, appt.price_cents);
  if valor is null or valor <= 0 then
    raise exception 'Valor do atendimento não informado';
  end if;

  taxa := (valor * cfg.platform_fee_bps) / 10000;

  insert into public.platform_transactions
    (salon_id, professional_id, appointment_id, amount_cents,
     platform_fee_bps, platform_fee_cents)
  values (appt.salon_id, appt.professional_id, appt.id, valor,
          cfg.platform_fee_bps, taxa)
  returning id into trans_id;

  if not cfg.ativo then
    return trans_id;
  end if;

  -- a atribuição da profissional vale mais que a do salão
  select * into atrib from public.affiliate_attributions
  where professional_id = appt.professional_id
    and status = 'ativa' and referrer_client_id is not null;

  if not found then
    select * into atrib from public.affiliate_attributions
    where salon_id = appt.salon_id
      and status = 'ativa' and referrer_client_id is not null;
  end if;

  if not found then
    return trans_id;
  end if;

  if atrib.expires_at is not null and atrib.expires_at <= now() then
    update public.affiliate_attributions set status = 'encerrada' where id = atrib.id;
    return trans_id;
  end if;

  comissao := (valor * cfg.affiliate_share_bps) / 10000;
  if comissao <= 0 then
    return trans_id;
  end if;

  -- teto mensal por afiliada
  select coalesce(sum(amount_cents), 0) into ja_no_mes
  from public.affiliate_commissions
  where affiliate_client_id = atrib.referrer_client_id
    and status = 'creditada'
    and created_at >= date_trunc('month', now());

  if ja_no_mes >= cfg.teto_mensal_cents then
    insert into public.affiliate_commissions
      (transaction_id, attribution_id, affiliate_client_id, share_bps, amount_cents, status, motivo)
    values (trans_id, atrib.id, atrib.referrer_client_id,
            cfg.affiliate_share_bps, 0, 'retida', 'teto mensal atingido');
    return trans_id;
  end if;

  comissao := least(comissao, cfg.teto_mensal_cents - ja_no_mes);

  insert into public.affiliate_commissions
    (transaction_id, attribution_id, affiliate_client_id, share_bps, amount_cents)
  values (trans_id, atrib.id, atrib.referrer_client_id,
          cfg.affiliate_share_bps, comissao);

  -- cashback não expira: é participação em receita, não brinde
  insert into public.credit_transactions
    (client_id, amount_cents, kind, description, appointment_id)
  values (atrib.referrer_client_id, comissao, 'afiliado',
          'Cashback de afiliada', appt.id);

  if atrib.first_activity_at is null then
    update public.affiliate_attributions
    set first_activity_at = now() where id = atrib.id;
  end if;

  select name into nome_prof from public.professionals where id = appt.professional_id;

  perform public.notificar(
    atrib.referrer_client_id,
    'afiliado_cashback',
    'Cashback na conta 💰',
    format('%s atendeu pelo app e você recebeu %s.',
           coalesce(nome_prof, 'Sua indicada'),
           to_char(comissao / 100.0, 'FM999G990D00')),
    '/indique',
    jsonb_build_object('transaction_id', trans_id),
    null
  );

  return trans_id;
end;
$$;

grant execute on function public.registrar_transacao(uuid, integer) to authenticated;

-- 10. Resumo da afiliada --------------------------------------------------
create or replace function public.meu_resumo_afiliada()
returns table (
  profissionais_ativas integer,
  cashback_total_cents integer,
  cashback_mes_cents integer,
  share_bps integer,
  platform_fee_bps integer,
  teto_mensal_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    (select count(*)::integer from public.affiliate_attributions
      where referrer_client_id = auth.uid() and status = 'ativa'),
    (select coalesce(sum(amount_cents), 0)::integer from public.affiliate_commissions
      where affiliate_client_id = auth.uid() and status = 'creditada'),
    (select coalesce(sum(amount_cents), 0)::integer from public.affiliate_commissions
      where affiliate_client_id = auth.uid() and status = 'creditada'
        and created_at >= date_trunc('month', now())),
    s.affiliate_share_bps,
    s.platform_fee_bps,
    s.teto_mensal_cents
  from public.affiliate_settings s where s.id;
$$;

grant execute on function public.meu_resumo_afiliada() to authenticated;

-- quem eu trouxe
create or replace function public.minhas_profissionais_indicadas()
returns table (
  attribution_id uuid,
  nome text,
  slug text,
  tipo text,
  desde timestamptz,
  primeira_atividade timestamptz,
  cashback_cents integer
)
language sql
stable
security definer set search_path = public
as $$
  select
    a.id,
    coalesce(p.name, s.name),
    coalesce(p.slug, s.slug),
    a.kind,
    a.created_at,
    a.first_activity_at,
    (select coalesce(sum(c.amount_cents), 0)::integer
     from public.affiliate_commissions c
     where c.attribution_id = a.id and c.status = 'creditada')
  from public.affiliate_attributions a
  left join public.professionals p on p.id = a.professional_id
  left join public.salons s on s.id = a.salon_id
  where a.referrer_client_id = auth.uid()
    and a.status in ('ativa', 'encerrada')
  order by a.created_at desc;
$$;

grant execute on function public.minhas_profissionais_indicadas() to authenticated;

-- 11. Abrir salão já registrando quem trouxe -----------------------------
create or replace function public.abrir_salao(
  nome text,
  endereco_slug text,
  cidade text default null,
  telefone text default null,
  codigo_indicacao text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
  slug_limpo text;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para abrir um salão';
  end if;

  slug_limpo := lower(regexp_replace(coalesce(endereco_slug, nome), '[^a-zA-Z0-9]+', '-', 'g'));
  slug_limpo := trim(both '-' from slug_limpo);
  if slug_limpo = '' then
    raise exception 'Escolha um endereço com letras ou números';
  end if;

  insert into public.salons (name, slug, owner_id, city, phone)
  values (nome, slug_limpo, auth.uid(), cidade, telefone)
  returning id into novo_id;

  insert into public.salon_members (salon_id, user_id, papel)
  values (novo_id, auth.uid(), 'admin');

  insert into public.business_hours (salon_id, weekday, open)
  select novo_id, d, d between 1 and 5
  from generate_series(0, 6) as d
  on conflict do nothing;

  update public.profiles set role = 'admin' where id = auth.uid() and role = 'cliente';

  if coalesce(trim(codigo_indicacao), '') <> '' then
    perform public.registrar_indicacao_profissional(codigo_indicacao, novo_id, null);
  end if;

  return novo_id;
end;
$$;

grant execute on function public.abrir_salao(text, text, text, text, text) to authenticated;

-- a versão antiga de abrir_salao sai de cena para não ficar ambígua
drop function if exists public.abrir_salao(text, text, text, text);
