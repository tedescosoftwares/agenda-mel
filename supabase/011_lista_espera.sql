-- =============================================================
-- Agenda Mel — 011: lista de espera e falta da cliente
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 010).
--
-- Quem não achou o horário que queria entra na fila daquela faixa.
-- Quando uma vaga abre (cancelamento, falta ou remanejamento), a
-- primeira da fila é avisada e tem um tempo para responder antes de
-- a vaga passar para a próxima.
-- =============================================================

-- 1. Regras de tempo, ajustáveis por profissional -----------------------
alter table public.professionals
  add column if not exists waitlist_min_notice_minutes integer not null default 45
    check (waitlist_min_notice_minutes between 0 and 1440);

alter table public.professionals
  add column if not exists waitlist_hold_minutes integer not null default 15
    check (waitlist_hold_minutes between 5 and 240);

alter table public.professionals
  add column if not exists no_show_tolerance_minutes integer not null default 15
    check (no_show_tolerance_minutes between 0 and 240);

-- 2. Falta vira um status próprio ---------------------------------------
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pendente', 'confirmado', 'cancelado', 'concluido', 'faltou'));

-- a vaga de quem faltou também volta a ficar livre
drop index if exists appointments_prof_slot_unique;
create unique index if not exists appointments_prof_slot_unique
  on public.appointments (professional_id, date, start_time)
  where status not in ('cancelado', 'faltou');

-- 3. A fila ---------------------------------------------------------------
create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  -- faixa de dias que serve para ela
  date_from date not null,
  date_to date not null,
  -- faixa de horário que serve para ela
  window_start time not null default '00:00',
  window_end time not null default '23:59',
  status text not null default 'aguardando'
    check (status in ('aguardando', 'convertida', 'cancelada', 'expirada')),
  created_at timestamptz not null default now(),
  check (date_to >= date_from),
  check (window_end > window_start)
);

create index if not exists waitlist_fila_idx
  on public.waitlist_entries (professional_id, status, created_at);

-- a mesma cliente não entra duas vezes na mesma fila
create unique index if not exists waitlist_sem_duplicata
  on public.waitlist_entries (client_id, professional_id, service_id, date_from, date_to, window_start, window_end)
  where status = 'aguardando';

-- 4. A vaga oferecida a quem está na fila ---------------------------------
create table if not exists public.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.waitlist_entries (id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'aceita', 'recusada', 'expirada')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_offers_abertas_idx
  on public.waitlist_offers (status, expires_at);

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_offers enable row level security;

drop policy if exists "ver minha fila" on public.waitlist_entries;
create policy "ver minha fila"
  on public.waitlist_entries for select
  to authenticated
  using (
    client_id = auth.uid()
    or public.is_admin()
    or public.is_professional(professional_id)
  );

drop policy if exists "ver ofertas de vaga" on public.waitlist_offers;
create policy "ver ofertas de vaga"
  on public.waitlist_offers for select
  to authenticated
  using (
    exists (
      select 1 from public.waitlist_entries e
      where e.id = waitlist_offers.entry_id
        and (
          e.client_id = auth.uid()
          or public.is_admin()
          or public.is_professional(e.professional_id)
        )
    )
  );

revoke insert, update, delete on public.waitlist_entries from authenticated, anon;
revoke insert, update, delete on public.waitlist_offers from authenticated, anon;

-- 5. Entrar e sair da fila ------------------------------------------------
create or replace function public.entrar_lista_espera(
  prof uuid,
  servico uuid,
  dia_de date,
  dia_ate date,
  hora_de time default '00:00',
  hora_ate time default '23:59'
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para avisarmos quando abrir vaga';
  end if;
  if dia_ate < dia_de then
    raise exception 'O último dia não pode ser antes do primeiro';
  end if;
  if dia_ate < public.agora_local()::date then
    raise exception 'Escolha dias que ainda estão por vir';
  end if;
  if hora_ate <= hora_de then
    raise exception 'A faixa de horário está invertida';
  end if;

  insert into public.waitlist_entries
    (client_id, professional_id, service_id, date_from, date_to, window_start, window_end)
  values (auth.uid(), prof, servico, dia_de, dia_ate, hora_de, hora_ate)
  on conflict do nothing
  returning id into novo_id;

  if novo_id is null then
    select id into novo_id from public.waitlist_entries
    where client_id = auth.uid() and professional_id = prof and service_id = servico
      and date_from = dia_de and date_to = dia_ate
      and window_start = hora_de and window_end = hora_ate
      and status = 'aguardando';
  end if;

  return novo_id;
end;
$$;

create or replace function public.sair_lista_espera(entrada_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.waitlist_entries
  set status = 'cancelada'
  where id = entrada_id and client_id = auth.uid() and status = 'aguardando';

  update public.waitlist_offers
  set status = 'recusada'
  where entry_id = entrada_id and status = 'pendente';
end;
$$;

-- 6. Oferecer uma vaga que abriu -----------------------------------------
-- Chama a próxima da fila que ainda não recebeu esta vaga.
create or replace function public.ofertar_vaga(
  prof uuid,
  dia date,
  inicio time,
  fim time
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  entrada public.waitlist_entries%rowtype;
  cfg public.professionals%rowtype;
  duracao_servico integer;
  agora timestamp := public.agora_local();
  oferta_id uuid;
  serv_nome text;
begin
  select * into cfg from public.professionals where id = prof;
  if not found then
    return null;
  end if;

  -- vaga em cima da hora demais: não vale avisar ninguém
  if (dia + inicio) < agora + make_interval(mins => cfg.waitlist_min_notice_minutes) then
    return null;
  end if;

  -- a vaga precisa continuar livre
  if exists (
    select 1 from public.appointments a
    where a.professional_id = prof and a.date = dia
      and a.status not in ('cancelado', 'faltou')
      and inicio < a.end_time and fim > a.start_time
  ) then
    return null;
  end if;

  -- primeira da fila cujo serviço cabe na vaga e cuja faixa bate
  select e.* into entrada
  from public.waitlist_entries e
  join public.services s on s.id = e.service_id
  where e.professional_id = prof
    and e.status = 'aguardando'
    and dia between e.date_from and e.date_to
    and inicio >= e.window_start
    and (inicio + make_interval(mins => s.duration_minutes)) <= e.window_end
    and (inicio + make_interval(mins => s.duration_minutes)) <= fim
    -- ninguém recebe a mesma vaga duas vezes
    and not exists (
      select 1 from public.waitlist_offers o
      where o.entry_id = e.id and o.date = dia and o.start_time = inicio
    )
    -- uma oferta aberta por vez para cada pessoa
    and not exists (
      select 1 from public.waitlist_offers o
      where o.entry_id = e.id and o.status = 'pendente' and o.expires_at > now()
    )
  order by e.created_at
  limit 1;

  if not found then
    return null;
  end if;

  select duration_minutes, name into duracao_servico, serv_nome
  from public.services where id = entrada.service_id;

  insert into public.waitlist_offers (entry_id, date, start_time, end_time, expires_at)
  values (
    entrada.id, dia, inicio,
    (inicio + make_interval(mins => duracao_servico))::time,
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  )
  returning id into oferta_id;

  perform public.notificar(
    entrada.client_id,
    'vaga_disponivel',
    'Abriu uma vaga! 🎉',
    format('%s tem %s livre dia %s às %s. A vaga fica guardada para você por %s minutos.',
           cfg.name, coalesce(serv_nome, 'o serviço'),
           to_char(dia, 'DD/MM'), to_char(inicio, 'HH24:MI'),
           cfg.waitlist_hold_minutes),
    '/',
    jsonb_build_object('offer_id', oferta_id, 'entry_id', entrada.id),
    now() + make_interval(mins => cfg.waitlist_hold_minutes)
  );

  return oferta_id;
end;
$$;

-- 7. A cliente responde à vaga -------------------------------------------
create or replace function public.responder_vaga(oferta_id uuid, aceitar boolean)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  oferta public.waitlist_offers%rowtype;
  entrada public.waitlist_entries%rowtype;
  prof_user uuid;
  cliente_nome text;
begin
  select * into oferta from public.waitlist_offers where id = oferta_id;
  if not found then
    raise exception 'Oferta não encontrada';
  end if;

  select * into entrada from public.waitlist_entries where id = oferta.entry_id;

  if entrada.client_id <> auth.uid() then
    raise exception 'Esta vaga não é sua';
  end if;

  if oferta.status <> 'pendente' then
    raise exception 'Esta vaga já foi respondida';
  end if;

  if oferta.expires_at <= now() then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, oferta.end_time);
    return 'expirada';
  end if;

  if not aceitar then
    update public.waitlist_offers set status = 'recusada' where id = oferta_id;
    -- passa para a próxima da fila
    perform public.ofertar_vaga(entrada.professional_id, oferta.date, oferta.start_time, oferta.end_time);
    return 'recusada';
  end if;

  if exists (
    select 1 from public.appointments a
    where a.professional_id = entrada.professional_id and a.date = oferta.date
      and a.status not in ('cancelado', 'faltou')
      and oferta.start_time < a.end_time and oferta.end_time > a.start_time
  ) then
    update public.waitlist_offers set status = 'expirada' where id = oferta_id;
    return 'conflito';
  end if;

  insert into public.appointments
    (client_id, professional_id, service_id, date, start_time, end_time, status)
  values
    (entrada.client_id, entrada.professional_id, entrada.service_id,
     oferta.date, oferta.start_time, oferta.end_time, 'confirmado');

  update public.waitlist_offers set status = 'aceita' where id = oferta_id;
  update public.waitlist_entries set status = 'convertida' where id = entrada.id;

  select user_id into prof_user from public.professionals where id = entrada.professional_id;
  select full_name into cliente_nome from public.profiles where id = entrada.client_id;

  if prof_user is not null then
    perform public.notificar(
      prof_user, 'novo_agendamento', 'Vaga preenchida pela lista de espera 🎉',
      format('%s pegou o horário de %s às %s.',
             coalesce(cliente_nome, 'Uma cliente'),
             to_char(oferta.date, 'DD/MM'), to_char(oferta.start_time, 'HH24:MI')),
      '/pro', jsonb_build_object('date', oferta.date), null
    );
  end if;

  return 'aceita';
end;
$$;

-- 8. Vaga não respondida passa para a próxima -----------------------------
create or replace function public.avancar_ofertas_expiradas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  o record;
  n integer := 0;
begin
  for o in
    select wo.id, wo.date, wo.start_time, wo.end_time, we.professional_id
    from public.waitlist_offers wo
    join public.waitlist_entries we on we.id = wo.entry_id
    where wo.status = 'pendente' and wo.expires_at <= now()
    limit 50
  loop
    update public.waitlist_offers set status = 'expirada' where id = o.id;
    perform public.ofertar_vaga(o.professional_id, o.date, o.start_time, o.end_time);
    n := n + 1;
  end loop;

  -- limpeza: filas cujo último dia já passou
  update public.waitlist_entries
  set status = 'expirada'
  where status = 'aguardando' and date_to < public.agora_local()::date;

  return n;
end;
$$;

-- 9. Quando uma vaga abre, a fila é acionada sozinha ----------------------
create or replace function public.ao_liberar_horario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- saiu da agenda (cancelou ou faltou): o horário antigo está livre
  if new.status in ('cancelado', 'faltou') and old.status not in ('cancelado', 'faltou') then
    perform public.ofertar_vaga(old.professional_id, old.date, old.start_time, old.end_time);

  -- foi remanejado: o horário anterior está livre
  elsif new.status not in ('cancelado', 'faltou')
    and (old.date, old.start_time) is distinct from (new.date, new.start_time) then
    perform public.ofertar_vaga(old.professional_id, old.date, old.start_time, old.end_time);
  end if;

  return new;
end;
$$;

drop trigger if exists on_horario_liberado on public.appointments;
create trigger on_horario_liberado
  after update on public.appointments
  for each row execute function public.ao_liberar_horario();

-- 10. Histórico de faltas da cliente --------------------------------------
create or replace function public.faltas_da_cliente(cliente uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.appointments
  where client_id = cliente
    and status = 'faltou'
    and date >= (public.agora_local()::date - interval '6 months');
$$;

grant execute on function public.entrar_lista_espera(uuid, uuid, date, date, time, time) to authenticated;
grant execute on function public.sair_lista_espera(uuid) to authenticated;
grant execute on function public.responder_vaga(uuid, boolean) to authenticated;
grant execute on function public.avancar_ofertas_expiradas() to authenticated;
grant execute on function public.faltas_da_cliente(uuid) to authenticated;

-- =============================================================
-- OPCIONAL: para a fila andar sozinha mesmo com o app fechado,
-- ative a extensão pg_cron (Database → Extensions) e rode:
--
-- select cron.schedule('agenda-mel-fila', '* * * * *',
--   $cron$ select public.avancar_ofertas_expiradas(); $cron$);
--
-- Sem isso, a fila avança quando alguém abre o app — o que já cobre
-- o caso normal, só com um pouco mais de atraso.
-- =============================================================
