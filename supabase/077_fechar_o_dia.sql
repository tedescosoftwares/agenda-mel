-- 077 · Fechar o dia, de verdade
--
-- O que muda em relação à 075/076:
--
--   1. "Juliana veio?"  Cinco minutos depois de cada horário terminar, a
--      profissional recebe a pergunta (push + tela Fechar o dia), com
--      Veio / Não veio / Remarcamos. Profissional sem login: a dona do
--      salão recebe. Entre 22h e 7h a pergunta espera a manhã.
--   2. Conclui sozinho só DEPOIS de perguntar: 3 h sem resposta e sem
--      pergunta aberta (troca pendente, aceite sem resposta) → concluído,
--      baixa_por = 'sistema'. O que sobrou para o automático foi escolha
--      dela. Correção por 72 h: "Não veio" num concluído sozinho.
--   3. Troca não respondida até o período original acabar VENCE: nunca
--      confirma; cancela os dois (motivo 'troca_sem_resposta'), sem falta
--      para a cliente, e conta como pedido sem resposta da profissional.
--      Pedido comum que vence com o horário já passado também cancela.
--   4. Ficha em duas camadas na hora do pedido: "com você" em números,
--      "com outras profissionais" só em porcentagem, anonimizado, com
--      pelo menos 3 horários. A cliente nunca vê.
--   5. Ajuste da profissional, ligado por padrão: pedido de quem já
--      faltou ou cancelou com ela passa pela confirmação dela, mesmo com
--      aceite automático.
--   6. Ciência para a cliente: falta ou cancelamento em cima da hora abre
--      uma página que só sai com "Li e concordo"; "Eu compareci" contesta
--      a falta (a profissional é avisada, a plataforma vê).
--   7. O crédito de indicação passa a valer também quando o sistema
--      conclui (antes só creditava com alguém logado).
--   8. "Remarcamos" pela profissional: um horário novo ligado ao antigo,
--      sem contar duas vezes (cancelado_por = 'remarcacao').

-- ---- 1. colunas ---------------------------------------------------------
alter table public.appointments add column if not exists perguntado_em timestamptz;
alter table public.appointments add column if not exists baixa_por text;
alter table public.appointments add column if not exists motivo_cancelamento text;
alter table public.professionals add column if not exists confirmar_historico_ruim boolean not null default true;
grant update (confirmar_historico_ruim) on public.professionals to authenticated;

-- remarcação pela casa não é cancelamento de ninguém
create or replace function public.marca_quem_cancelou()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    new.cancelado_por := coalesce(new.cancelado_por,
      case when new.remarcado_para is not null then 'remarcacao' else public.quem_age_e(new) end);
    new.cancelado_em := coalesce(new.cancelado_em, now());
  end if;
  if new.status = 'faltou' and old.status is distinct from 'faltou' then
    new.faltou_em := now();
  end if;
  if new.status not in ('faltou') and old.status = 'faltou' then
    new.faltou_em := null;
  end if;
  if new.status in ('concluido', 'faltou') and old.status is distinct from new.status and new.baixa_por is null then
    new.baixa_por := case public.quem_age_e(new) when 'sistema' then 'sistema' when 'salao' then 'salao' else 'profissional' end;
  end if;
  return new;
end;
$$;

-- ---- 2. ciência da cliente ----------------------------------------------
create table if not exists public.ciencias (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,
  motivo text not null check (motivo in ('falta', 'cancelamento_tardio')),
  criada_em timestamptz not null default now(),
  aceita_em timestamptz,
  contestada_em timestamptz,
  contestacao text,
  anulada_em timestamptz
);
create index if not exists ciencias_cliente_idx on public.ciencias (client_id) where aceita_em is null and contestada_em is null and anulada_em is null;
alter table public.ciencias enable row level security;
revoke all on public.ciencias from anon, authenticated;

create or replace function public.abre_ciencia()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.client_id is null then return new; end if;
  if new.status = 'faltou' and old.status is distinct from 'faltou' then
    insert into public.ciencias (client_id, appointment_id, motivo) values (new.client_id, new.id, 'falta');
  elsif new.status = 'cancelado' and old.status is distinct from 'cancelado'
        and new.cancelado_por = 'cliente' and public.cancelou_tarde(new) then
    insert into public.ciencias (client_id, appointment_id, motivo) values (new.client_id, new.id, 'cancelamento_tardio');
  elsif old.status = 'faltou' and new.status <> 'faltou' then
    update public.ciencias set anulada_em = now()
    where appointment_id = new.id and motivo = 'falta' and anulada_em is null;
  end if;
  return new;
end;
$$;
drop trigger if exists tg_zz_abre_ciencia on public.appointments;
create trigger tg_zz_abre_ciencia
  after update of status on public.appointments
  for each row execute function public.abre_ciencia();

create or replace function public.minhas_ciencias()
returns table (id uuid, motivo text, criada_em timestamptz, servico text, profissional text, quando text, appointment_id uuid)
language sql
stable
security definer set search_path = public
as $$
  select c.id, c.motivo, c.criada_em,
         coalesce(a.service_name, s.name, 'atendimento'), coalesce(p.name, 'sua profissional'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         a.id
  from public.ciencias c
  left join public.appointments a on a.id = c.appointment_id
  left join public.services s on s.id = a.service_id
  left join public.professionals p on p.id = a.professional_id
  where c.client_id = auth.uid()
    and c.aceita_em is null and c.contestada_em is null and c.anulada_em is null
  order by c.criada_em;
$$;
revoke execute on function public.minhas_ciencias() from public, anon;
grant execute on function public.minhas_ciencias() to authenticated;

create or replace function public.aceitar_ciencia(ciencia uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.ciencias set aceita_em = now()
  where id = ciencia and client_id = auth.uid() and aceita_em is null;
$$;
revoke execute on function public.aceitar_ciencia(uuid) from public, anon;
grant execute on function public.aceitar_ciencia(uuid) to authenticated;

create or replace function public.contestar_falta(ciencia uuid, texto text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare c record; a record; conta uuid; nome text;
begin
  select * into c from public.ciencias where id = ciencia and client_id = auth.uid() and motivo = 'falta' and contestada_em is null;
  if not found then raise exception 'Nada para contestar.'; end if;
  update public.ciencias set contestada_em = now(), contestacao = nullif(btrim(coalesce(texto, '')), '') where id = ciencia;
  select ap.*, p.user_id as conta_prof, p.salon_id as sal into a
    from public.appointments ap join public.professionals p on p.id = ap.professional_id where ap.id = c.appointment_id;
  select nullif(btrim(full_name), '') into nome from public.profiles where id = auth.uid();
  conta := a.conta_prof;
  if conta is null then select owner_id into conta from public.salons where id = a.sal; end if;
  if conta is not null then
    perform public.notificar(conta, 'contestacao', coalesce(nome, 'Uma cliente') || ' diz que compareceu',
      'Falta marcada em ' || public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI')
        || '. Se ela veio, use "Perdoar falta" na agenda.' || coalesce(E'\n"' || nullif(btrim(coalesce(texto, '')), '') || '"', ''),
      '/pro/agenda?dia=' || a.date::text, jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));
  end if;
end;
$$;
revoke execute on function public.contestar_falta(uuid, text) from public, anon;
grant execute on function public.contestar_falta(uuid, text) to authenticated;

-- ---- 3. a ficha em duas camadas -------------------------------------------
create or replace function public.ficha_para_profissional(cliente uuid, prof uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare sal uuid; comigo jsonb; outras jsonb; h integer; c integer; f integer; ca integer; r integer;
begin
  select salon_id into sal from public.professionals where id = prof;
  if not (public.eh_plataforma() or public.is_professional(prof) or (sal is not null and public.is_admin_do_salao(sal))) then
    return null;
  end if;
  select jsonb_build_object(
    'concluidos', count(*) filter (where a.status = 'concluido'),
    'faltas', count(*) filter (where a.status = 'faltou'),
    'cancelamentos', count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente'),
    'cancelamentos_tardios', count(*) filter (where public.cancelou_tarde(a)),
    'remarcacoes', count(*) filter (where a.remarca_de is not null),
    'ultima_visita', max(a.date) filter (where a.status = 'concluido'))
  into comigo
  from public.appointments a where a.client_id = cliente and a.professional_id = prof;

  select count(*) filter (where a.status in ('concluido', 'faltou', 'cancelado')),
         count(*) filter (where a.status = 'concluido'),
         count(*) filter (where a.status = 'faltou'),
         count(*) filter (where a.status = 'cancelado' and a.cancelado_por = 'cliente'),
         count(*) filter (where a.remarca_de is not null)
  into h, c, f, ca, r
  from public.appointments a where a.client_id = cliente and a.professional_id <> prof;

  if coalesce(h, 0) >= 3 then
    outras := jsonb_build_object(
      'horarios', h,
      'faltas_pct', case when c + f > 0 then round(100.0 * f / (c + f)) else 0 end,
      'cancelamentos_pct', round(100.0 * ca / h),
      'remarcacoes_pct', round(100.0 * r / h));
  else
    outras := null;
  end if;
  return jsonb_build_object('comigo', comigo, 'outras', outras);
end;
$$;
revoke execute on function public.ficha_para_profissional(uuid, uuid) from public, anon;
grant execute on function public.ficha_para_profissional(uuid, uuid) to authenticated;

-- já faltou ou cancelou com esta profissional (último ano)
create or replace function public.historico_ruim_comigo(cliente uuid, prof uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.client_id = cliente and a.professional_id = prof
      and a.date >= current_date - 365
      and (a.status = 'faltou' or (a.status = 'cancelado' and a.cancelado_por = 'cliente')));
$$;
revoke execute on function public.historico_ruim_comigo(uuid, uuid) from public, anon, authenticated;

drop function if exists public.meus_pedidos();
create function public.meus_pedidos()
returns table (
  appointment_id uuid, cliente text, servico text, quando text, faltam_min integer,
  remarcacao boolean, antes text,
  atendimentos integer, faltas integer, cancelamentos integer, remarcacoes integer,
  ficha jsonb, por_historico boolean
)
language sql
stable
security definer set search_path = public
as $$
  select ac.appointment_id,
         coalesce(nullif(btrim(pf.full_name), ''), 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI'),
         greatest(0, extract(epoch from (ac.expira_em - now()))/60)::integer,
         a.remarca_de is not null,
         case when o.id is not null
              then public.dia_por_extenso(o.date) || ' às ' || to_char(o.start_time, 'HH24:MI') end,
         f.concluidos, f.faltas, f.cancelamentos, f.remarcacoes,
         public.ficha_para_profissional(a.client_id, ac.professional_id),
         (not coalesce(p.aceite_manual, false)) and public.historico_ruim_comigo(a.client_id, ac.professional_id)
  from public.aceites ac
  join public.appointments a on a.id = ac.appointment_id
  join public.professionals p on p.id = ac.professional_id
  left join public.appointments o on o.id = a.remarca_de
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  cross join lateral (
    select count(*) filter (where h.status = 'concluido')::integer as concluidos,
           count(*) filter (where h.status = 'faltou')::integer as faltas,
           count(*) filter (where h.status = 'cancelado' and h.cancelado_por = 'cliente')::integer as cancelamentos,
           count(*) filter (where h.remarca_de is not null and h.id <> a.id)::integer as remarcacoes
    from public.appointments h where h.client_id = a.client_id and h.salon_id = ac.salon_id
  ) f
  where ac.resultado is null
    and (public.is_professional(ac.professional_id)
         or public.is_admin_do_salao(ac.salon_id))
  order by ac.expira_em;
$$;
revoke execute on function public.meus_pedidos() from public, anon;
grant execute on function public.meus_pedidos() to authenticated;

-- ---- 4. o pedido de aceite sem depender de telefone, e forçado por histórico ----
drop function if exists public.pedir_aceite(uuid);
drop function if exists public.pedir_aceite(uuid, boolean);
create function public.pedir_aceite(appt uuid, forcar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  p public.professionals%rowtype;
  tel_prof text;
  tel_cli text;
  nome_cli text;
  quando text;
  prazo timestamptz;
  aviso uuid;
  na_fila record;
begin
  select * into a from public.appointments where id = appt;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem agendamento'); end if;

  select * into p from public.professionals where id = a.professional_id;
  if not found or (not p.aceite_manual and not forcar) then
    return jsonb_build_object('ok', false, 'motivo', 'aceite desligado');
  end if;
  if p.user_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'profissional sem conta');
  end if;

  select public.telefone_e164(pf.phone) into tel_prof
  from public.profiles pf where pf.id = p.user_id;

  select public.telefone_e164(pf.phone), nullif(btrim(pf.full_name), '')
    into tel_cli, nome_cli
  from public.profiles pf where pf.id = a.client_id;

  prazo := now() + make_interval(mins => coalesce(p.minutos_para_aceitar, 120));
  quando := public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI');

  -- sem telefone o pedido vai pelo app e pelo push; o WhatsApp fica de fora
  insert into public.aceites
    (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em)
  values (appt, p.id, a.salon_id, coalesce(tel_prof, ''), coalesce(tel_cli, ''), prazo)
  on conflict (appointment_id) do nothing;

  aviso := public.notificar(
    p.user_id, 'pedido_de_aceite', 'Pedido de horário',
    coalesce(nome_cli, 'Uma cliente') || ' quer ' ||
      coalesce(a.service_name, 'um atendimento') || ' ' || quando
      || case when forcar then '. Passou por você porque ela já faltou ou cancelou com você.' else '' end,
    '/pro/pedidos',
    jsonb_build_object('appointment_id', appt, 'professional_id', p.id, 'por_historico', forcar));

  select o.id, o.telefone, o.corpo into na_fila
  from public.message_outbox o
  where o.notification_id = aviso and o.status = 'na_fila'
  limit 1;

  return jsonb_build_object('ok', true, 'expira_em', prazo,
    'minutos', p.minutos_para_aceitar,
    'avisar', case when na_fila.id is not null then
      jsonb_build_object('fila_id', na_fila.id,
                         'telefone', na_fila.telefone,
                         'corpo', na_fila.corpo)
    end);
end;
$$;
revoke execute on function public.pedir_aceite(uuid, boolean) from public, anon, authenticated;

create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  por_historico boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  pagina text;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual, coalesce(p.confirmar_historico_ruim, true) into conta, manual, por_historico
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;
  end if;

  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);
  -- histórico ruim com ELA: o pedido passa pela mão dela mesmo no automático
  por_historico := por_historico and not coalesce(manual, false)
                   and new.client_id is not null and public.historico_ruim_comigo(new.client_id, new.professional_id);

  if (coalesce(manual, false) or por_historico) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id, por_historico);
    if coalesce((r ->> 'ok')::boolean, false) then
      pediu := true;
    else
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
  elsif new.status = 'pendente' then
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));

  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
    select * into res from public.resumo_do_agendamento(new.id);
    pagina := '/cliente/agendamento/' || new.id::text;
    if pediu then
      perform public.notificar(new.client_id, 'pedido_enviado', 'Pedido enviado! ⏳',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. Aguardando a confirmação da profissional.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    else
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$$;

-- ---- 5. aceite vencido: nunca confirma horário que já passou -------------------
-- troca: cancela o original e o pedido; comum: cancela. Sem falta para a
-- cliente; conta como pedido sem resposta da profissional (resultado 'vencido').
create or replace function public.vencer_aceite(appt uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; o public.appointments%rowtype; res record;
begin
  select * into a from public.appointments where id = appt;
  if not found then return; end if;
  update public.aceites set resultado = 'vencido', resolvido_em = now() where appointment_id = appt and resultado is null;
  perform public.silenciar_gatilho();
  if a.remarca_de is not null then
    select * into o from public.appointments where id = a.remarca_de;
    update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'troca_sem_resposta'
      where id = a.remarca_de and status not in ('cancelado', 'concluido', 'faltou');
    update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'troca_sem_resposta'
      where id = appt and status = 'pendente';
    if a.client_id is not null and o.id is not null then
      select * into res from public.resumo_do_agendamento(o.id);
      perform public.notificar(a.client_id, 'troca_vencida', 'Horário cancelado',
        'Seu pedido de troca de ' || res.servico || ' com ' || res.profissional || ' (' || res.quando_longo || ') não foi respondido a tempo, então o horário foi cancelado. Marque um novo quando quiser.',
        '/cliente/home', jsonb_build_object('appointment_id', o.id, 'professional_id', o.professional_id));
    end if;
  else
    update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'sem_resposta'
      where id = appt and status = 'pendente';
    if a.client_id is not null then
      select * into res from public.resumo_do_agendamento(appt);
      perform public.notificar(a.client_id, 'pedido_recusado', 'Horário não confirmado',
        res.profissional || ' não respondeu a tempo sobre ' || res.quando_longo || '. Escolha outro horário.',
        '/cliente/home', jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  end if;
end;
$$;
revoke execute on function public.vencer_aceite(uuid) from public, anon, authenticated;

create or replace function public.resolver_aceites_vencidos()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  ac record;
  quantos integer := 0;
  agora timestamp := public.agora_local();
  passou boolean;
begin
  for ac in
    select a.appointment_id, p.ao_expirar, ap.remarca_de, ap.date, ap.end_time,
           o.date as o_date, o.end_time as o_end
    from public.aceites a
    join public.professionals p on p.id = a.professional_id
    join public.appointments ap on ap.id = a.appointment_id
    left join public.appointments o on o.id = ap.remarca_de
    where a.resultado is null and a.expira_em < now()
  loop
    passou := case when ac.remarca_de is not null and ac.o_date is not null
                   then (ac.o_date + ac.o_end) < agora
                   else (ac.date + ac.end_time) < agora end;
    if passou then
      perform public.vencer_aceite(ac.appointment_id);
    else
      perform public.resolver_aceite(ac.appointment_id, ac.ao_expirar = 'confirma');
      update public.aceites set resultado = 'expirou'
      where appointment_id = ac.appointment_id and resultado is null;
    end if;
    quantos := quantos + 1;
  end loop;
  return quantos;
end;
$$;
revoke execute on function public.resolver_aceites_vencidos() from public, anon, authenticated;

-- ---- 6. "Juliana veio?" ------------------------------------------------------------
-- quem responde por uma profissional: ela, ou a dona/admins do salão dela
create or replace function public.quem_responde_por(prof uuid)
returns table (user_id uuid, papel text)
language sql
stable
security definer set search_path = public
as $$
  select p.user_id, 'profissional' from public.professionals p where p.id = prof and p.user_id is not null
  union
  select s.owner_id, 'salao' from public.professionals p join public.salons s on s.id = p.salon_id
   where p.id = prof and p.user_id is null and s.owner_id is not null
  union
  select m.user_id, 'salao' from public.professionals p join public.salon_members m on m.salon_id = p.salon_id
   where p.id = prof and p.user_id is null and m.papel = 'admin';
$$;
revoke execute on function public.quem_responde_por(uuid) from public, anon, authenticated;

create or replace function public.perguntar_se_veio()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; q record; n integer := 0; agora timestamp := public.agora_local(); nome text; servico text;
begin
  if extract(hour from agora) < 7 or extract(hour from agora) >= 22 then return 0; end if;
  for r in
    select a.*, pr.name as prof_nome
    from public.appointments a
    join public.professionals pr on pr.id = a.professional_id
    where a.status = 'confirmado' and a.perguntado_em is null
      and (a.date + a.end_time) + interval '5 minutes' < agora
      and (a.date + a.end_time) > agora - interval '3 days'
      and not exists (select 1 from public.appointments t where t.remarca_de = a.id and t.status = 'pendente')
      and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id and ac.resultado is null)
    order by a.date, a.start_time
    limit 100
  loop
    update public.appointments set perguntado_em = now() where id = r.id;
    select coalesce(nullif(btrim(pf.full_name), ''), r.guest_name, 'A cliente') into nome from public.profiles pf where pf.id = r.client_id;
    nome := coalesce(nome, r.guest_name, 'A cliente');
    select coalesce(r.service_name, s.name, 'atendimento') into servico from public.services s where s.id = r.service_id;
    servico := coalesce(servico, r.service_name, 'atendimento');
    for q in select * from public.quem_responde_por(r.professional_id) loop
      perform public.notificar(q.user_id, 'veio', split_part(nome, ' ', 1) || ' veio?',
        servico || ' às ' || to_char(r.start_time, 'HH24:MI')
          || case when q.papel = 'salao' then ' com ' || r.prof_nome else '' end
          || '. Toque para dar baixa: Veio, Não veio ou Remarcamos. Sem resposta em 3 h, conclui sozinho.',
        case when q.papel = 'salao' then '/admin/fechar-dia' else '/pro/fechar-dia' end,
        jsonb_build_object('appointment_id', r.id, 'professional_id', r.professional_id));
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.perguntar_se_veio() from public, anon, authenticated;

-- conclui sozinho só depois de perguntar e esperar 3 h (ou 24 h sem ninguém para perguntar)
create or replace function public.concluir_atendimentos_passados()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare n integer; agora timestamp := public.agora_local();
begin
  with prontos as (
    select a.id
    from public.appointments a
    where a.status = 'confirmado'
      and ((a.perguntado_em is not null and a.perguntado_em + interval '3 hours' < now())
           or (a.perguntado_em is null and (a.date + a.end_time) + interval '24 hours' < agora))
      and not exists (select 1 from public.appointments t where t.remarca_de = a.id and t.status = 'pendente')
      and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id and ac.resultado is null)
    order by a.date, a.start_time
    limit 200
  )
  update public.appointments a set status = 'concluido', baixa_por = 'sistema'
  from prontos p where a.id = p.id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.concluir_atendimentos_passados() from public, anon, authenticated;

-- o lembrete do fim do dia aponta para a tela certa
create or replace function public.lembrar_fechar_dia()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; agora timestamp := public.agora_local(); hoje date := public.agora_local()::date;
begin
  for r in
    select p.id as professional_id, p.user_id, count(*) as quantos, max(a.end_time) as ultimo
    from public.appointments a
    join public.professionals p on p.id = a.professional_id
    where a.date = hoje and a.status = 'confirmado' and p.user_id is not null
      and not exists (select 1 from public.fechamentos_lembrados f where f.professional_id = p.id and f.dia = hoje)
    group by p.id, p.user_id
    having (hoje + max(a.end_time)) + interval '30 minutes' < agora
  loop
    insert into public.fechamentos_lembrados (professional_id, dia) values (r.professional_id, hoje) on conflict do nothing;
    perform public.notificar(r.user_id, 'fechar_dia', 'Como foi hoje?',
      r.quantos || case when r.quantos = 1 then ' atendimento' else ' atendimentos' end
        || ' esperando sua baixa. Quem você não responder conclui sozinho em 3 horas.',
      '/pro/fechar-dia', jsonb_build_object('dia', hoje, 'quantos', r.quantos));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.lembrar_fechar_dia() from public, anon, authenticated;

-- ---- 7. a tela Fechar o dia ---------------------------------------------------------
-- o que espera baixa (e o que concluiu sozinho nas últimas 72 h, para corrigir)
create or replace function public.pendencias_de_baixa()
returns table (
  appointment_id uuid, professional_id uuid, profissional text, client_id uuid, cliente text,
  servico text, dia date, inicio time, fim time, situacao text, perguntado_em timestamptz,
  conclui_em timestamptz, troca jsonb, ficha jsonb, pode_corrigir boolean
)
language sql
stable
security definer set search_path = public
as $$
  select a.id, a.professional_id, p.name, a.client_id,
         coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         a.date, a.start_time, a.end_time,
         case when a.status = 'confirmado' then 'esperando' else 'concluido_sozinho' end,
         a.perguntado_em,
         case when a.status = 'confirmado' and a.perguntado_em is not null then a.perguntado_em + interval '3 hours' end,
         (select jsonb_build_object('id', t.id, 'quando', public.dia_por_extenso(t.date) || ' às ' || to_char(t.start_time, 'HH24:MI'), 'expira_em', ac.expira_em)
            from public.appointments t left join public.aceites ac on ac.appointment_id = t.id
           where t.remarca_de = a.id and t.status = 'pendente' limit 1),
         case when a.client_id is not null then public.ficha_para_profissional(a.client_id, a.professional_id) end,
         a.status = 'concluido' and a.baixa_por = 'sistema' and (a.date + a.end_time) > public.agora_local() - interval '72 hours'
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  where (a.date + a.end_time) < public.agora_local()
    and (a.date + a.end_time) > public.agora_local() - interval '72 hours'
    and ((a.status = 'confirmado') or (a.status = 'concluido' and a.baixa_por = 'sistema'))
    and (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id))
  order by a.status desc, a.date desc, a.start_time desc;
$$;
revoke execute on function public.pendencias_de_baixa() from public, anon;
grant execute on function public.pendencias_de_baixa() to authenticated;

create or replace function public.dar_baixa(appt uuid, resultado text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; troca public.appointments%rowtype; quem text;
begin
  if resultado not in ('veio', 'nao_veio') then raise exception 'Resultado desconhecido.'; end if;
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)) then raise exception 'Sem permissão.'; end if;
  quem := case when public.is_professional(a.professional_id) then 'profissional' else 'salao' end;
  select * into troca from public.appointments t where t.remarca_de = appt and t.status = 'pendente' limit 1;

  if a.status = 'confirmado' then
    if resultado = 'veio' then
      if troca.id is not null then
        -- ela veio: a troca perdeu o sentido
        update public.aceites set resultado = 'recusado', resolvido_em = now() where appointment_id = troca.id and resultado is null;
        perform public.silenciar_gatilho();
        update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'veio_no_horario_original' where id = troca.id;
      end if;
      update public.appointments set status = 'concluido', baixa_por = quem where id = appt;
      return jsonb_build_object('ok', true, 'status', 'concluido');
    else
      if troca.id is not null then
        -- ela tinha pedido para trocar e ninguém respondeu: não é falta dela
        perform public.vencer_aceite(troca.id);
        return jsonb_build_object('ok', true, 'status', 'cancelado', 'motivo', 'troca_sem_resposta');
      end if;
      update public.appointments set status = 'faltou', baixa_por = quem where id = appt;
      return jsonb_build_object('ok', true, 'status', 'faltou');
    end if;
  end if;

  if a.status = 'concluido' and resultado = 'nao_veio' then
    if a.baixa_por is distinct from 'sistema' then raise exception 'Este atendimento foi concluído por você. Para desfazer, fale com a plataforma.'; end if;
    if (a.date + a.end_time) < public.agora_local() - interval '72 hours' then raise exception 'Passaram mais de 3 dias. Fale com a plataforma.'; end if;
    if exists (select 1 from public.reviews r where r.appointment_id = appt) then raise exception 'A cliente já avaliou este atendimento.'; end if;
    if exists (select 1 from public.referrals r where r.appointment_id = appt and r.status = 'creditada') then
      raise exception 'Este atendimento creditou uma indicação. Fale com a plataforma para reverter.';
    end if;
    update public.appointments set status = 'faltou', baixa_por = quem where id = appt;
    return jsonb_build_object('ok', true, 'status', 'faltou');
  end if;

  raise exception 'Este atendimento não está esperando baixa.';
end;
$$;
revoke execute on function public.dar_baixa(uuid, text) from public, anon;
grant execute on function public.dar_baixa(uuid, text) to authenticated;

-- "Remarcamos": um horário novo ligado ao antigo; o antigo sai sem contar como cancelamento
create or replace function public.remarcar_por_fora(appt uuid, nova_data date, nova_hora time)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; novo uuid; dur interval; fim time; res record;
begin
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)) then raise exception 'Sem permissão.'; end if;
  if a.status not in ('confirmado', 'pendente') then raise exception 'Este horário não pode mais ser remarcado.'; end if;
  if (nova_data + nova_hora) < public.agora_local() then raise exception 'O novo horário precisa estar no futuro.'; end if;
  dur := a.end_time - a.start_time;
  fim := nova_hora + dur;
  if exists (select 1 from public.appointments x
             where x.professional_id = a.professional_id and x.date = nova_data and x.id <> appt
               and x.status not in ('cancelado', 'faltou')
               and nova_hora < x.end_time and fim > x.start_time) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  perform public.silenciar_gatilho();
  -- um pedido de troca pendente da cliente perde o sentido
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';

  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de)
  values (a.client_id, a.professional_id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt)
  returning id into novo;
  perform public.efetivar_remarcacao(novo);

  if a.client_id is not null then
    select * into res from public.resumo_do_agendamento(novo);
    perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
      res.servico || ' com ' || res.profissional || ' agora é ' || res.quando_longo || '.',
      '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.remarcar_por_fora(uuid, date, time) from public, anon;
grant execute on function public.remarcar_por_fora(uuid, date, time) to authenticated;

-- ---- 8. crédito de indicação vale para a conclusão pelo sistema ------------------
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
  paga_indicador boolean := true;
begin
  if new.status <> 'concluido' or old.status = 'concluido' then
    return new;
  end if;
  if new.client_id is null then
    return new;
  end if;
  -- quem conclui: a profissional, o salão, ou o sistema (rotina, sem sessão)
  if auth.uid() is not null and not (public.is_admin_do_salao(new.salon_id)
          or public.is_professional(new.professional_id)) then
    return new;
  end if;

  select * into cfg from public.referral_settings where id;
  if not cfg.ativo then
    return new;
  end if;

  update public.referrals
  set status = 'creditada', credited_at = now(), appointment_id = new.id
  where referred_id = new.client_id and status = 'pendente'
  returning * into ind;

  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.appointments
    where client_id = new.client_id and status = 'concluido' and id <> new.id
  ) then
    update public.referrals
    set status = 'bloqueada', credited_at = null, appointment_id = null,
        motivo_bloqueio = 'nao era o primeiro atendimento'
    where id = ind.id;
    return new;
  end if;

  select count(*) into premiados_no_mes
  from public.referrals
  where referrer_id = ind.referrer_id
    and status = 'creditada'
    and id <> ind.id
    and (credited_at at time zone 'America/Sao_Paulo')
        >= date_trunc('month', public.agora_local());

  if premiados_no_mes >= cfg.max_premios_por_mes then
    paga_indicador := false;
  end if;

  select full_name into nome_indicada from public.profiles where id = ind.referred_id;
  select full_name into nome_indicou from public.profiles where id = ind.referrer_id;
  validade := now() + make_interval(days => cfg.validade_dias);

  if paga_indicador and cfg.premio_indicou_cents > 0 then
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

  if not paga_indicador then
    update public.referrals set motivo_bloqueio = 'teto mensal de quem indicou'
    where id = ind.id;
  end if;

  return new;
end;
$$;

-- ---- 9. plataforma: sem resposta, contestações, profissionais fora da curva ----
create or replace function public.plataforma_confiabilidade(dias integer default 30)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with base as (
    select a.* from public.appointments a
    where a.date >= current_date - greatest(1, coalesce(dias, 30)) and a.date <= current_date
  ),
  geral as (
    select count(*) filter (where status = 'faltou')::numeric as faltas,
           count(*) filter (where status in ('concluido', 'faltou'))::numeric as base_faltas from base
  )
  select case when public.eh_plataforma() then jsonb_build_object(
    'dias', greatest(1, coalesce(dias, 30)),
    'concluidos', (select count(*) from base where status = 'concluido'),
    'concluidos_sozinhos', (select count(*) from base where status = 'concluido' and baixa_por = 'sistema'),
    'faltas', (select count(*) from base where status = 'faltou'),
    'cancelamentos', (select count(*) from base where status = 'cancelado' and cancelado_por = 'cliente'),
    'cancelamentos_tardios', (select count(*) from base b where public.cancelou_tarde(b)),
    'cancelamentos_da_casa', (select count(*) from base where status = 'cancelado' and cancelado_por in ('profissional', 'salao')),
    'remarcacoes', (select count(*) from base where remarca_de is not null),
    'sem_resposta', (select count(*) from public.aceites ac where ac.resultado = 'vencido'
                       and ac.resolvido_em >= now() - make_interval(days => greatest(1, coalesce(dias, 30)))),
    'contestacoes', (select count(*) from public.ciencias c where c.contestada_em is not null
                       and c.contestada_em >= now() - make_interval(days => greatest(1, coalesce(dias, 30)))),
    'faltosas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.client_id, 'nome', x.nome, 'faltas', x.faltas, 'salao', x.salao) order by x.faltas desc), '[]'::jsonb)
                 from (select b.client_id, coalesce(p.full_name, 'Sem nome') as nome, count(*) as faltas,
                              (select s.name from public.salons s where s.id = max(b.salon_id::text)::uuid) as salao
                       from base b join public.profiles p on p.id = b.client_id
                       where b.status = 'faltou' group by b.client_id, p.full_name
                       order by count(*) desc limit 8) x),
    'profissionais_atencao', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'nome', y.nome, 'faltas', y.faltas, 'taxa', y.taxa, 'sem_resposta', y.sem_resposta) order by y.taxa desc), '[]'::jsonb)
                 from (select p.id, p.name as nome,
                              count(*) filter (where b.status = 'faltou') as faltas,
                              round(100.0 * count(*) filter (where b.status = 'faltou') / nullif(count(*) filter (where b.status in ('concluido', 'faltou')), 0)) as taxa,
                              (select count(*) from public.aceites ac where ac.professional_id = p.id and ac.resultado = 'vencido'
                                  and ac.resolvido_em >= now() - make_interval(days => greatest(1, coalesce(dias, 30)))) as sem_resposta
                       from base b join public.professionals p on p.id = b.professional_id
                       group by p.id, p.name
                       having count(*) filter (where b.status in ('concluido', 'faltou')) >= 10
                          and (100.0 * count(*) filter (where b.status = 'faltou') / nullif(count(*) filter (where b.status in ('concluido', 'faltou')), 0))
                              >= 2 * greatest(1, (select 100.0 * faltas / nullif(base_faltas, 0) from geral))
                       order by taxa desc limit 8) y))
  end;
$$;
revoke execute on function public.plataforma_confiabilidade(integer) from public, anon;
grant execute on function public.plataforma_confiabilidade(integer) to authenticated;

-- ---- 10. modelos de push dos tipos novos ---------------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.veio', 'push', 'Ela veio?', 'Cinco minutos depois de cada horário terminar. Sem resposta em 3 h, conclui sozinho.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 828,
  '{"titulo":"Juliana veio?","texto":"Manicure às 14:00. Toque para dar baixa: Veio, Não veio ou Remarcamos. Sem resposta em 3 h, conclui sozinho."}'),
('push.contestacao', 'push', 'Cliente contesta a falta', 'A cliente diz que compareceu num horário marcado como falta.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 835,
  '{"titulo":"Juliana diz que compareceu","texto":"Falta marcada em sábado, 12/09 às 14:00. Se ela veio, use “Perdoar falta” na agenda."}'),
('push.troca_vencida', 'push', 'Troca não respondida', 'O pedido de troca não foi respondido até o horário passar: o horário foi cancelado.', '{titulo,texto,nome,servico,profissional,quando}', E'{titulo}\n{texto}', 728,
  '{"titulo":"Horário cancelado","texto":"Seu pedido de troca de Manicure com Ana Oliveira (sábado, 12/09 às 14:00) não foi respondido a tempo, então o horário foi cancelado. Marque um novo quando quiser."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, padrao = excluded.padrao, ordem = excluded.ordem, exemplo = excluded.exemplo;
update public.modelos_de_mensagem set exemplo = '{"titulo":"Como foi hoje?","texto":"3 atendimentos esperando sua baixa. Quem você não responder conclui sozinho em 3 horas."}' where chave = 'push.fechar_dia';
insert into public.push_regras (kind, envia) values ('veio', true), ('contestacao', true), ('troca_vencida', true) on conflict (kind) do nothing;
insert into public.email_regras (kind, envia, chamada) values ('troca_vencida', true, 'Marcar outro horário') on conflict (kind) do nothing;

-- ---- 11. as rotinas, na ordem --------------------------------------------------------
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
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;
