-- 090 · Pagamento pelo app (Asaas BaaS): PIX na hora de marcar
--
-- A cliente paga o serviço (ou um sinal) dentro do MIMO. Quem recebe é
-- o salão ou a autônoma, numa subconta Asaas criada pelo próprio app
-- (BaaS: ela nunca vê o Asaas). O MIMO fica com a parte dele pelo
-- split. Quem cuida do dinheiro de verdade é a Edge Function; aqui
-- ficam as regras, os estados e o que a cliente e a profissional veem.
--
--   salons.pagamento_modo        nao | opcional | obrigatorio
--   salons.sinal_pct             30, 50 ou 100 (% do valor cobrado na hora)
--   salons.estorno_horas         cancelou com essa antecedência, devolve tudo
--   profiles.cpf                 pedido uma vez, o provedor exige do pagador
--   contas_de_recebimento        a subconta de cada salão/autônoma e a aprovação
--   pagadores                    a cliente dentro da subconta (customer do Asaas)
--   pagamentos                   cada cobrança: valor, QR, estado, estorno
--   appointments 'aguardando_pagamento'   segura a vaga por 15 min sem avisar ninguém
--   marcar_servicos(..., pagar)  nasce aguardando quando o salão exige ou a cliente quer
--   confirmar_pagamento()        o webhook confirmou: vira pedido normal, avisa
--   expirar_reservas_nao_pagas() 15 min sem pagar, libera a vaga
--   agenda_estorno_ao_cancelar() cancelou: devolve ou retém, conforme o prazo
--   chutar_pagamentos()          acorda a Edge Function para estornar/baixar
--   guardar_segredo/ler_segredo  a chave da subconta fica no Vault, nunca em tabela

-- 1. Configuração de quem recebe -------------------------------------------------
alter table public.salons add column if not exists pagamento_modo text not null default 'nao';
alter table public.salons drop constraint if exists salons_pagamento_modo_check;
alter table public.salons add constraint salons_pagamento_modo_check check (pagamento_modo in ('nao', 'opcional', 'obrigatorio'));
alter table public.salons add column if not exists sinal_pct smallint not null default 50;
alter table public.salons drop constraint if exists salons_sinal_pct_check;
alter table public.salons add constraint salons_sinal_pct_check check (sinal_pct in (30, 50, 100));
alter table public.salons add column if not exists estorno_horas smallint not null default 24;
alter table public.salons drop constraint if exists salons_estorno_horas_check;
alter table public.salons add constraint salons_estorno_horas_check check (estorno_horas between 0 and 168);
grant update (pagamento_modo, sinal_pct, estorno_horas) on public.salons to authenticated;

-- a cliente: CPF pedido uma vez, no primeiro pagamento
alter table public.profiles add column if not exists cpf text;
alter table public.profiles drop constraint if exists profiles_cpf_check;
alter table public.profiles add constraint profiles_cpf_check check (cpf is null or cpf ~ '^[0-9]{11}$');
grant update (cpf) on public.profiles to authenticated;

-- 2. A subconta de cada salão ------------------------------------------------------
create table if not exists public.contas_de_recebimento (
  salon_id uuid primary key references public.salons (id) on delete cascade,
  provedor text not null default 'asaas',
  conta_id text,
  wallet_id text,
  tipo_pessoa text check (tipo_pessoa in ('fisica', 'juridica')),
  documento text,
  nome text,
  email text,
  celular text,
  dados jsonb not null default '{}'::jsonb,          -- o que foi enviado (sem segredos)
  status text not null default 'pendente' check (status in ('pendente', 'aguardando', 'aprovada', 'recusada', 'erro')),
  situacao jsonb not null default '{}'::jsonb,       -- general / documentation / bankAccountInfo / commercialInfo
  documentos jsonb not null default '[]'::jsonb,     -- pendentes, com o link de envio
  erro text,
  criado_por uuid references public.profiles (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
alter table public.contas_de_recebimento enable row level security;
drop policy if exists "dona ve a conta" on public.contas_de_recebimento;
create policy "dona ve a conta" on public.contas_de_recebimento for select to authenticated using (public.is_admin_do_salao(salon_id));
grant select on public.contas_de_recebimento to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.contas_de_recebimento from anon, authenticated;

-- a chave de API da subconta vai para o Vault (só a Edge Function, com a
-- chave de serviço, lê e escreve)
create or replace function public.guardar_segredo(nome text, valor text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare existente uuid;
begin
  execute $q$ select id from vault.secrets where name = $1 $q$ into existente using nome;
  if existente is null then
    execute $q$ select vault.create_secret($1, $2) $q$ using valor, nome;
  else
    execute $q$ select vault.update_secret($1, $2) $q$ using existente, valor;
  end if;
end;
$$;
revoke execute on function public.guardar_segredo(text, text) from public, anon, authenticated;

create or replace function public.ler_segredo(nome text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare v text;
begin
  execute $q$ select decrypted_secret from vault.decrypted_secrets where name = $1 $q$ into v using nome;
  return v;
end;
$$;
revoke execute on function public.ler_segredo(text) from public, anon, authenticated;

-- a cliente dentro da subconta (o "customer" do Asaas), uma por salão
create table if not exists public.pagadores (
  client_id uuid not null references public.profiles (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  customer_id text not null,
  criado_em timestamptz not null default now(),
  primary key (client_id, salon_id)
);
alter table public.pagadores enable row level security;
revoke all on public.pagadores from anon, authenticated;

-- 3. Os pagamentos -----------------------------------------------------------------
create table if not exists public.pagamentos (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  salon_id uuid not null references public.salons (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  valor_cents integer not null check (valor_cents > 0),   -- o que é cobrado agora (sinal ou tudo)
  total_cents integer not null,                            -- o valor do horário
  sinal_pct smallint not null,
  metodo text not null default 'pix' check (metodo in ('pix')),
  status text not null default 'aguardando'
    check (status in ('aguardando', 'pago', 'expirado', 'cancelado', 'estorno_pendente', 'estornado', 'retido', 'falhou')),
  provedor text not null default 'asaas',
  cobranca_id text,
  customer_id text,
  copia_cola text,
  link_url text,
  expira_em timestamptz,
  pago_em timestamptz,
  liquido_cents integer,
  mimo_cents integer,
  estorno_cents integer,
  estornado_em timestamptz,
  motivo_estorno text,
  baixa_no_provedor_em timestamptz,     -- cobrança apagada/estornada lá no Asaas
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz
);
create index if not exists pagamentos_appt_idx on public.pagamentos (appointment_id);
create index if not exists pagamentos_salao_idx on public.pagamentos (salon_id, criado_em desc);
create index if not exists pagamentos_cobranca_idx on public.pagamentos (cobranca_id);
alter table public.pagamentos enable row level security;
drop policy if exists "cliente ve o proprio pagamento" on public.pagamentos;
create policy "cliente ve o proprio pagamento" on public.pagamentos for select to authenticated using (client_id = auth.uid());
drop policy if exists "casa ve os pagamentos" on public.pagamentos;
create policy "casa ve os pagamentos" on public.pagamentos for select to authenticated
  using (public.is_admin_do_salao(salon_id)
         or exists (select 1 from public.appointments a where a.id = appointment_id and public.is_professional(a.professional_id)));
grant select on public.pagamentos to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.pagamentos from anon, authenticated;

-- 4. O horário que espera o pagamento -----------------------------------------------
alter table public.appointments add column if not exists pago_cents integer not null default 0;
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pendente', 'confirmado', 'cancelado', 'concluido', 'faltou', 'aguardando_pagamento'));

-- a profissional só fica sabendo quando o PIX cai: o gatilho do insert
-- pula o que está aguardando, e roda de novo quando o horário vira pendente
drop trigger if exists tg_avisa_profissional_novo on public.appointments;
create trigger tg_avisa_profissional_novo
  after insert on public.appointments
  for each row when (new.status <> 'aguardando_pagamento')
  execute function public.avisa_profissional_do_agendamento();
drop trigger if exists tg_avisa_profissional_pago on public.appointments;
create trigger tg_avisa_profissional_pago
  after update of status on public.appointments
  for each row when (old.status = 'aguardando_pagamento' and new.status = 'pendente')
  execute function public.avisa_profissional_do_agendamento();

-- a cliente pode desistir enquanto espera o pagamento
create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if public.is_admin() or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = public.meu_id() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado', 'aguardando_pagamento') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;

-- o que a cliente precisa saber antes de marcar
create or replace function public.pagamento_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'modo', case when c.conta_id is not null then s.pagamento_modo else 'nao' end,
    'sinal_pct', s.sinal_pct,
    'estorno_horas', s.estorno_horas)
  from public.salons s
  left join public.contas_de_recebimento c on c.salon_id = s.id
  where s.id = salao;
$$;
grant execute on function public.pagamento_do_salao(uuid) to anon, authenticated;

-- os cards da home: vários salões de uma vez
create or replace function public.pagamento_dos_saloes(ids uuid[])
returns table (salon_id uuid, modo text, sinal_pct smallint)
language sql
stable
security definer set search_path = public
as $$
  select s.id, case when c.conta_id is not null then s.pagamento_modo else 'nao' end, s.sinal_pct
  from public.salons s
  left join public.contas_de_recebimento c on c.salon_id = s.id
  where s.id = any(ids);
$$;
grant execute on function public.pagamento_dos_saloes(uuid[]) to anon, authenticated;

-- marcar: nasce aguardando quando o salão exige, ou quando ele aceita e a cliente quer
drop function if exists public.marcar_servicos(uuid, uuid[], date, time, text);
create or replace function public.marcar_servicos(prof uuid, servicos uuid[], dia date, hora time, obs text default null, pagar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  itens record;
  total_min integer := 0;
  total_cents integer := 0;
  total_desconto integer := 0;
  nomes text := '';
  novo uuid;
  n integer := 0;
  sal uuid;
  pg jsonb;
  st text := 'pendente';
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if servicos is null or array_length(servicos, 1) is null then raise exception 'Escolha pelo menos um serviço.'; end if;
  if array_length(servicos, 1) > 6 then raise exception 'No máximo 6 serviços por horário.'; end if;
  select p.salon_id into sal from public.professionals p where p.id = prof and p.active;
  if sal is null and not exists (select 1 from public.professionals p where p.id = prof and p.active) then raise exception 'Profissional não encontrada.'; end if;

  create temp table if not exists itens_do_pedido (
    ord integer, service_id uuid, name text, cents integer, cheio integer, promocao_id uuid, duration_minutes integer
  ) on commit drop;
  delete from itens_do_pedido;
  insert into itens_do_pedido (ord, service_id, name, cents, cheio, promocao_id, duration_minutes)
  select x.ord, s.id, s.name,
         coalesce(d.preco_com_desconto_cents, round(s.price * 100)::integer),
         round(s.price * 100)::integer,
         d.promocao_id,
         s.duration_minutes
  from unnest(servicos) with ordinality as x(id, ord)
  join public.services s on s.id = x.id and s.active
  join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof
  left join public.descontos_para_mim(servicos) d on d.service_id = s.id;

  for itens in select * from itens_do_pedido order by ord loop
    n := n + 1;
    total_min := total_min + coalesce(itens.duration_minutes, 0);
    total_cents := total_cents + coalesce(itens.cents, 0);
    total_desconto := total_desconto + (coalesce(itens.cheio, 0) - coalesce(itens.cents, 0));
    nomes := nomes || case when nomes = '' then '' else ' + ' end || itens.name;
  end loop;
  if n <> array_length(servicos, 1) then raise exception 'Algum serviço não está disponível com essa profissional.'; end if;
  if total_min <= 0 then raise exception 'Serviço sem duração.'; end if;

  -- pagamento pelo app: só fora de visita e com valor para cobrar
  if sal is not null and total_cents > 0 and coalesce(current_setting('agenda_mel.em_visita', true), '') <> '1' then
    pg := public.pagamento_do_salao(sal);
    if pg ->> 'modo' = 'obrigatorio' or (pg ->> 'modo' = 'opcional' and coalesce(pagar, false)) then
      st := 'aguardando_pagamento';
    end if;
  end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, desconto_cents, date, start_time, end_time, notes, status)
    values
      (eu, prof, servicos[1], nomes, total_cents, total_desconto, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), st)
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
  select novo, i.service_id, i.name, i.cents, i.cheio, i.promocao_id, i.duration_minutes, i.ord
  from itens_do_pedido i order by i.ord;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents, 'desconto_cents', total_desconto,
                            'pagar', st = 'aguardando_pagamento');
end;
$$;
grant execute on function public.marcar_servicos(uuid, uuid[], date, time, text, boolean) to authenticated;

-- 5. O que a Edge Function chama (chave de serviço) ----------------------------------

-- prepara a cobrança: valida o horário, calcula o sinal, abre a linha
create or replace function public.pagamento_preparar(appt uuid, cliente uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  s public.salons%rowtype;
  c public.contas_de_recebimento%rowtype;
  p public.pagamentos%rowtype;
  cli public.profiles%rowtype;
  prof_nome text;
  valor integer;
  pct smallint;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null or a.client_id is distinct from cliente then return jsonb_build_object('ok', false, 'motivo', 'Horário não encontrado.'); end if;
  if a.status not in ('aguardando_pagamento', 'pendente', 'confirmado') then return jsonb_build_object('ok', false, 'motivo', 'Este horário não aceita pagamento.'); end if;
  if (a.date + a.start_time) < public.agora_local() then return jsonb_build_object('ok', false, 'motivo', 'Este horário já passou.'); end if;
  if a.pago_cents > 0 then return jsonb_build_object('ok', false, 'motivo', 'Este horário já está pago.'); end if;
  select * into s from public.salons where id = a.salon_id;
  select * into c from public.contas_de_recebimento where salon_id = a.salon_id;
  if c.conta_id is null or s.pagamento_modo = 'nao' then return jsonb_build_object('ok', false, 'motivo', 'Esta profissional não recebe pelo app.'); end if;
  select * into cli from public.profiles where id = cliente;
  if cli.cpf is null then return jsonb_build_object('ok', false, 'motivo', 'sem_cpf'); end if;

  -- um pagamento aguardando já existe? devolve ele
  select * into p from public.pagamentos where appointment_id = appt and status = 'aguardando' order by criado_em desc limit 1;
  if p.id is not null then
    return jsonb_build_object('ok', true, 'pagamento_id', p.id, 'existente', true, 'cobranca_id', p.cobranca_id, 'copia_cola', p.copia_cola, 'valor_cents', p.valor_cents, 'expira_em', p.expira_em, 'sinal_pct', p.sinal_pct);
  end if;

  pct := case when a.status = 'aguardando_pagamento' then s.sinal_pct else 100 end;
  valor := greatest(100, round(a.price_cents * pct / 100.0)::integer);
  if valor > a.price_cents then valor := a.price_cents; end if;
  select p2.name into prof_nome from public.professionals p2 where p2.id = a.professional_id;

  insert into public.pagamentos (appointment_id, salon_id, client_id, valor_cents, total_cents, sinal_pct, expira_em)
  values (appt, a.salon_id, cliente, valor, a.price_cents, pct,
          case when a.status = 'aguardando_pagamento' then a.created_at + interval '15 minutes'
               else (a.date + a.start_time) at time zone 'America/Sao_Paulo' end)
  returning * into p;

  return jsonb_build_object(
    'ok', true, 'pagamento_id', p.id, 'existente', false,
    'valor_cents', valor, 'total_cents', a.price_cents, 'sinal_pct', pct, 'expira_em', p.expira_em,
    'salon_id', a.salon_id, 'conta_id', c.conta_id, 'wallet_id', c.wallet_id,
    'descricao', coalesce(a.service_name, 'Atendimento') || ' com ' || coalesce(prof_nome, 'a profissional') || ' · ' || to_char(a.date, 'DD/MM') || ' ' || to_char(a.start_time, 'HH24:MI')
                 || case when pct < 100 then ' (sinal de ' || pct || '%)' else '' end,
    'cliente', jsonb_build_object('nome', cli.full_name, 'cpf', cli.cpf, 'telefone', cli.phone),
    'customer_id', (select customer_id from public.pagadores where client_id = cliente and salon_id = a.salon_id));
end;
$$;
revoke execute on function public.pagamento_preparar(uuid, uuid) from public, anon, authenticated;

-- o webhook confirmou: vira pedido normal e avisa a cliente
create or replace function public.confirmar_pagamento(pagamento uuid, cobranca text, liquido integer default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  a public.appointments%rowtype;
  res record;
begin
  select * into p from public.pagamentos where id = pagamento;
  if p.id is null then return jsonb_build_object('ok', false, 'motivo', 'pagamento não encontrado'); end if;
  if p.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;

  update public.pagamentos
  set status = 'pago', pago_em = quando, cobranca_id = coalesce(cobranca, cobranca_id),
      liquido_cents = coalesce(liquido, pagamentos.liquido_cents), atualizado_em = now()
  where id = pagamento;

  update public.appointments set pago_cents = pago_cents + p.valor_cents where id = p.appointment_id returning * into a;

  if a.status = 'aguardando_pagamento' then
    -- vira pedido: o gatilho tg_avisa_profissional_pago avisa a profissional
    -- (ou abre o aceite) como se tivesse acabado de ser marcado
    update public.appointments set status = 'pendente' where id = a.id returning * into a;
  end if;

  if a.status = 'cancelado' then
    -- pagou depois de a reserva cair: devolve
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = valor_cents, motivo_estorno = 'reserva expirou antes do pagamento', atualizado_em = now() where id = pagamento;
    return jsonb_build_object('ok', true, 'estornar', true);
  end if;

  select * into res from public.resumo_do_agendamento(a.id);
  perform public.notificar(p.client_id, 'pagamento_confirmado', 'Pagamento confirmado ✅',
    'R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || case when p.sinal_pct < 100 then ' de sinal' else '' end
      || ' para ' || res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.'
      || case when a.status = 'pendente' then ' Agora é só esperar a confirmação da profissional.' else '' end,
    '/cliente/agendamento/' || a.id, jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status);
end;
$$;
revoke execute on function public.confirmar_pagamento(uuid, text, integer, timestamptz) from public, anon, authenticated;

-- 15 minutos sem pagar: a vaga volta, sem alarde
create or replace function public.expirar_reservas_nao_pagas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; res record;
begin
  perform public.silenciar_gatilho();
  for r in
    select a.* from public.appointments a
    where a.status = 'aguardando_pagamento' and a.created_at < now() - interval '15 minutes'
    order by a.created_at limit 100
  loop
    update public.appointments set status = 'cancelado', cancelado_por = 'sistema', cancelado_em = now(), motivo_cancelamento = 'reserva não paga' where id = r.id;
    update public.pagamentos set status = 'expirado', atualizado_em = now() where appointment_id = r.id and status = 'aguardando';
    if r.client_id is not null then
      select * into res from public.resumo_do_agendamento(r.id);
      perform public.notificar(r.client_id, 'reserva_expirada', 'A reserva venceu',
        'O PIX de ' || res.servico || ' com ' || res.profissional || ' não chegou em 15 minutos e o horário voltou a ficar livre. Se ainda quiser, marque de novo.',
        '/cliente/profissional/' || r.professional_id, jsonb_build_object('professional_id', r.professional_id));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expirar_reservas_nao_pagas() from public, anon, authenticated;

-- cancelou um horário pago: devolve tudo se foi com antecedência ou se
-- foi a casa que cancelou; senão o sinal fica com a profissional
create or replace function public.agenda_estorno_ao_cancelar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  horas smallint;
  devolve boolean;
  res record;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' or coalesce(new.pago_cents, 0) <= 0 then return new; end if;
  select * into p from public.pagamentos where appointment_id = new.id and status = 'pago' order by pago_em desc limit 1;
  if p.id is null then return new; end if;
  select estorno_horas into horas from public.salons where id = new.salon_id;
  devolve := coalesce(new.cancelado_por, 'sistema') <> 'cliente'
             or (coalesce(new.cancelado_em, now()) at time zone 'America/Sao_Paulo') <= (new.date + new.start_time) - make_interval(hours => coalesce(horas, 24));
  if devolve then
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = valor_cents,
      motivo_estorno = case when coalesce(new.cancelado_por, 'sistema') <> 'cliente' then 'cancelado pela casa' else 'cancelado com antecedência' end,
      atualizado_em = now() where id = p.id;
  else
    update public.pagamentos set status = 'retido', motivo_estorno = 'cancelado em cima da hora', atualizado_em = now() where id = p.id;
  end if;
  if new.client_id is not null then
    select * into res from public.resumo_do_agendamento(new.id);
    if devolve then
      perform public.notificar(new.client_id, 'estorno_a_caminho', 'Seu dinheiro está voltando',
        'R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' volta para a sua conta em até 1 dia útil.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    else
      perform public.notificar(new.client_id, 'sinal_retido', 'Sinal não devolvido',
        'Como o cancelamento foi com menos de ' || coalesce(horas, 24) || ' h de antecedência, o sinal de R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' fica com a profissional.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_zz_estorno_ao_cancelar on public.appointments;
create trigger tg_zz_estorno_ao_cancelar
  after update of status on public.appointments
  for each row execute function public.agenda_estorno_ao_cancelar();

-- a Edge Function pega o que precisa ser feito lá no provedor
create or replace function public.pagamentos_para_cuidar(quantos integer default 20)
returns setof public.pagamentos
language sql
security definer set search_path = public
as $$
  select * from public.pagamentos
  where (status = 'estorno_pendente')
     or (status in ('expirado', 'cancelado') and cobranca_id is not null and baixa_no_provedor_em is null)
  order by atualizado_em nulls first, criado_em
  limit quantos;
$$;
revoke execute on function public.pagamentos_para_cuidar(integer) from public, anon, authenticated;

create or replace function public.pagamento_cuidado(pagamento uuid, resultado text, detalhe text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if resultado = 'estornado' then
    update public.pagamentos set status = 'estornado', estornado_em = now(), baixa_no_provedor_em = now(), erro = null, atualizado_em = now() where id = pagamento;
  elsif resultado = 'baixado' then
    update public.pagamentos set baixa_no_provedor_em = now(), erro = null, atualizado_em = now() where id = pagamento;
  else
    update public.pagamentos set erro = left(coalesce(detalhe, resultado), 300), atualizado_em = now() where id = pagamento;
  end if;
end;
$$;
revoke execute on function public.pagamento_cuidado(uuid, text, text) from public, anon, authenticated;

-- acorda a função quando há o que fazer (mesmo mecanismo do push)
create or replace function public.chutar_pagamentos()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare url text; chave text; pedido bigint;
begin
  if not exists (select 1 from public.pagamentos_para_cuidar(1)) then
    return jsonb_build_object('ok', true, 'vazio', true);
  end if;
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;
  if url is null or chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem credenciais — rode select public.ligar_relogio(url, chave)');
  end if;
  begin
    execute format(
      $q$ select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000) $q$,
      rtrim(url, '/') || '/functions/v1/pagamento-cuidar',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;
revoke execute on function public.chutar_pagamentos() from public, anon, authenticated;

-- 6. Entra no relógio -----------------------------------------------------------------
create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  perguntas integer := 0;
  fechamentos integer := 0;
  concluidos integer := 0;
  avaliacoes integer := 0;
  reservas integer := 0;
  pagamentos jsonb := '{}'::jsonb;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    perguntas := coalesce(public.perguntar_se_veio(), 0);
  exception when others then perguntas := -1;
  end;
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  begin
    avaliacoes := coalesce(public.convidar_avaliacoes(), 0);
  exception when others then avaliacoes := -1;
  end;
  begin
    reservas := coalesce(public.expirar_reservas_nao_pagas(), 0);
  exception when others then reservas := -1;
  end;
  begin
    pagamentos := public.chutar_pagamentos();
  exception when others then pagamentos := jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'avaliacoes', avaliacoes,
    'reservas_expiradas', reservas,
    'pagamentos', pagamentos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;

-- 7. A página do salão diz se recebe pelo app --------------------------------------------
create or replace function public.pagina_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', (select jsonb_build_object(
        'id', s.id, 'nome', s.name, 'tipo', s.tipo, 'descricao', s.descricao, 'fotos', to_jsonb(s.fotos), 'logo_url', s.logo_url,
        'endereco', s.address, 'cidade', s.city, 'telefone', s.phone, 'whatsapp', coalesce(s.whatsapp, s.phone), 'instagram', s.instagram,
        'pagamento', public.pagamento_do_salao(s.id))
      from public.salons s where s.id = salao and s.active),
    'horarios', (select coalesce(jsonb_agg(jsonb_build_object('weekday', h.weekday, 'open', h.open, 'start_time', h.start_time, 'end_time', h.end_time) order by h.weekday), '[]'::jsonb)
      from public.business_hours h where h.salon_id = salao),
    'nota', (select jsonb_build_object('media', round(avg(r.nota)::numeric, 1), 'quantas', count(*))
      from public.reviews r join public.professionals p on p.id = r.professional_id where p.salon_id = salao),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'nome', p.name, 'foto', p.photo_url, 'bio', p.bio,
        'faz', (select coalesce(jsonb_agg(sv.name order by sv.name), '[]'::jsonb) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
        'nota', (select round(avg(r.nota)::numeric, 1) from public.reviews r where r.professional_id = p.id)
      ) order by p.name), '[]'::jsonb)
      from public.professionals p where p.salon_id = salao and p.active),
    'servicos', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', sv.id, 'name', sv.name, 'price', sv.price, 'duration_minutes', sv.duration_minutes, 'images', to_jsonb(sv.images),
        'description', sv.description, 'is_combo', sv.is_combo, 'categoria_id', sv.categoria_id, 'destaque', sv.destaque,
        'quem', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.name, 'foto', p.photo_url) order by p.name), '[]'::jsonb)
                 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
      ) order by sv.name), '[]'::jsonb)
      from public.services sv where sv.salon_id = salao and sv.active),
    'capas', (select coalesce(jsonb_object_agg(k.categoria_id, to_jsonb(k.imagens)), '{}'::jsonb) from public.capas_do_salao(salao) k),
    'preferida', (select professional_id from public.profissional_preferida where client_id = auth.uid() and salon_id = salao),
    'promocoes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'titulo', pr.titulo, 'texto', pr.texto, 'imagem_url', pr.imagem_url, 'service_id', pr.service_id,
        'professional_id', pr.professional_id, 'desconto_pct', pr.desconto_pct, 'fim', pr.fim) order by pr.created_at desc), '[]'::jsonb)
      from public.promocoes_visiveis_para(auth.uid()) pr where pr.salon_id = salao)
  );
$$;
grant execute on function public.pagina_do_salao(uuid) to anon, authenticated;

-- 8. Avisos e modelos de push --------------------------------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.pagamento_confirmado', 'push', 'Pagamento confirmado', 'O PIX da cliente caiu.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 760,
  '{"titulo":"Pagamento confirmado ✅","texto":"R$ 17,50 de sinal para Manicure com Ana, sexta 20/09 às 14:00."}'),
('push.reserva_expirada', 'push', 'Reserva venceu', 'Quinze minutos sem pagar: a vaga voltou.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 761,
  '{"titulo":"A reserva venceu","texto":"O PIX de Manicure com Ana não chegou em 15 minutos e o horário voltou a ficar livre."}'),
('push.estorno_a_caminho', 'push', 'Estorno a caminho', 'Cancelou com antecedência, ou a casa cancelou.', '{titulo,texto,nome,servico}', E'{titulo}\n{texto}', 762,
  '{"titulo":"Seu dinheiro está voltando","texto":"R$ 17,50 de Manicure volta para a sua conta em até 1 dia útil."}'),
('push.sinal_retido', 'push', 'Sinal retido', 'Cancelou em cima da hora: o sinal fica com a profissional.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 763,
  '{"titulo":"Sinal não devolvido","texto":"Como o cancelamento foi com menos de 24 h de antecedência, o sinal de R$ 17,50 fica com a profissional."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('pagamento_confirmado', true), ('reserva_expirada', true), ('estorno_a_caminho', true), ('sinal_retido', true) on conflict (kind) do nothing;
