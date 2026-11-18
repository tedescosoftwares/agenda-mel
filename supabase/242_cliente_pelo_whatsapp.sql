-- 242 · A cliente se cadastra pelo WhatsApp; limites por cliente e o primeiro horário de cliente nova (3.98)
--
-- 1. As regras do salão para a cliente que marca sozinha (pelo app ou pela assistente; o que o salão lança não conta):
--      cliente_nova    'igual' (padrão: segue a regra de quem confirma), 'casa_confirma' (o primeiro horário vira pedido)
--                      ou 'so_equipe' (a assistente não marca o primeiro; pelo app, vira pedido)
--      limite_futuros  horários futuros por cliente (1 a 5, começa em 2): passou disso, ela não marca sozinha
--      limite_faltas   faltas (12 meses) até a casa assumir (1 a 5, começa em 2): depois disso, os horários viram pedido
--    regras_da_cliente (ler) e salao_regras_cliente (mudar), só para quem administra o salão.
-- 2. O gatilho limites_da_cliente barra o horário além do limite (código MI001) e, pela assistente, o primeiro horário
--    quando só a equipe marca (MI002). O aceite (avisa_profissional_do_agendamento) abre o pedido nos outros casos.
--    bot_marcar marca com a origem 'assistente' e devolve esses casos como "chame a equipe"; bot_marcar_simular (o teste
--    da dona) responde como para uma cliente nova.
-- 3. O cadastro pelo WhatsApp é uma conta de verdade, sem senha até o primeiro acesso ao app: a função assistente cria a
--    conta (nome, telefone confirmado pelo próprio WhatsApp, entrada <número>@whatsapp.mimo.com.vc sem caixa de correio)
--    e cliente_do_whatsapp marca o telefone como confirmado. O link de criar senha (links_de_acesso: só o hash do token,
--    vale uma vez, 7 dias) e as tentativas (acesso_tentativas: limite de pedidos de link e de entradas por número) são
--    usados só pelas funções do servidor. conta_para_entrar acha a conta pelo telefone (só telefone confirmado e de uma
--    conta só). enfileirar_email não manda nada para o endereço de entrada de quem veio pelo WhatsApp.

-- 1. As regras -----------------------------------------------------------------------------------------------------------
alter table public.salons add column if not exists cliente_nova text not null default 'igual';
alter table public.salons add column if not exists limite_futuros smallint not null default 2;
alter table public.salons add column if not exists limite_faltas smallint not null default 2;
do $$ begin
  alter table public.salons add constraint salons_cliente_nova_check check (cliente_nova in ('igual', 'casa_confirma', 'so_equipe'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_limite_futuros_check check (limite_futuros between 1 and 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_limite_faltas_check check (limite_faltas between 1 and 5);
exception when duplicate_object then null; end $$;

create or replace function public.regras_da_cliente(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só quem administra o salão vê as regras';
  end if;
  return (select jsonb_build_object('cliente_nova', s.cliente_nova, 'limite_futuros', s.limite_futuros, 'limite_faltas', s.limite_faltas)
          from public.salons s where s.id = salao);
end;
$$;
revoke execute on function public.regras_da_cliente(uuid) from public, anon;
grant execute on function public.regras_da_cliente(uuid) to authenticated;

create or replace function public.salao_regras_cliente(salao uuid, cliente_nova_ text default null, limite_futuros_ integer default null, limite_faltas_ integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'Só quem administra o salão muda as regras';
  end if;
  if cliente_nova_ is not null and cliente_nova_ not in ('igual', 'casa_confirma', 'so_equipe') then
    raise exception 'Regra de cliente nova inválida';
  end if;
  if limite_futuros_ is not null and limite_futuros_ not between 1 and 5 then raise exception 'Horários futuros: de 1 a 5'; end if;
  if limite_faltas_ is not null and limite_faltas_ not between 1 and 5 then raise exception 'Faltas: de 1 a 5'; end if;
  update public.salons s set
    cliente_nova = coalesce(cliente_nova_, s.cliente_nova),
    limite_futuros = coalesce(limite_futuros_, s.limite_futuros),
    limite_faltas = coalesce(limite_faltas_, s.limite_faltas)
  where s.id = salao;
  return public.regras_da_cliente(salao);
end;
$$;
revoke execute on function public.salao_regras_cliente(uuid, text, integer, integer) from public, anon;
grant execute on function public.salao_regras_cliente(uuid, text, integer, integer) to authenticated;

-- a situação da cliente no salão: nova (sem horário que não foi cancelado), horários futuros (a visita conta uma vez) e
-- faltas nos últimos 12 meses. ignorar: o horário que acabou de entrar (e as outras partes da mesma visita)
create or replace function public.situacao_da_cliente(salao uuid, cliente uuid, ignorar uuid default null)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with v as (select a.visita_id from public.appointments a where a.id = ignorar),
  dela as (
    select a.* from public.appointments a
    where a.client_id = cliente and a.salon_id = salao
      and a.id is distinct from ignorar
      and (a.visita_id is null or a.visita_id is distinct from (select visita_id from v))
  )
  select jsonb_build_object(
    'nova', not exists (select 1 from dela where dela.status <> 'cancelado'),
    'futuros', (select count(distinct coalesce(dela.visita_id, dela.id)) from dela
                where dela.status in ('pendente', 'confirmado', 'aguardando_pagamento')
                  and (dela.date + dela.start_time) > public.agora_local()),
    'faltas', (select count(*) from dela where dela.status = 'faltou' and dela.date >= public.agora_local()::date - 365),
    'cliente_nova', s.cliente_nova, 'limite_futuros', s.limite_futuros, 'limite_faltas', s.limite_faltas)
  from public.salons s where s.id = salao;
$$;
revoke execute on function public.situacao_da_cliente(uuid, uuid, uuid) from public, anon, authenticated;

-- 2. O gatilho dos limites -----------------------------------------------------------------------------------------------
-- só o que a própria cliente marca (no app, ou a assistente agindo em nome dela); remarcação e a segunda parte de uma
-- visita não contam de novo
create or replace function public.limites_da_cliente()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare sit jsonb; n integer;
begin
  if new.client_id is null or new.client_id is distinct from auth.uid() or new.remarca_de is not null
     or new.status = 'cancelado' or new.salon_id is null then
    return new;
  end if;
  if new.visita_id is not null and exists (select 1 from public.appointments a where a.visita_id = new.visita_id) then
    return new;
  end if;
  sit := public.situacao_da_cliente(new.salon_id, new.client_id);
  if sit is null then return new; end if;
  n := (sit ->> 'futuros')::integer;
  if n >= (sit ->> 'limite_futuros')::integer then
    raise exception using errcode = 'MI001',
      message = format('Você já tem %s %s neste salão. Para marcar mais, fale com o salão.', n, case when n = 1 then 'horário marcado' else 'horários marcados' end);
  end if;
  if (sit ->> 'nova')::boolean and sit ->> 'cliente_nova' = 'so_equipe' and coalesce(current_setting('mimo.origem', true), '') = 'assistente' then
    raise exception using errcode = 'MI002', message = 'O primeiro horário de cliente nova é marcado pela equipe do salão.';
  end if;
  return new;
end;
$$;
drop trigger if exists tg_limites_da_cliente on public.appointments;
create trigger tg_limites_da_cliente before insert on public.appointments
  for each row execute function public.limites_da_cliente();

-- 3. O cadastro pelo WhatsApp e o acesso ao app ---------------------------------------------------------------------------
create table if not exists public.links_de_acesso (
  id uuid primary key default gen_random_uuid(),
  conta uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  origem text not null default 'app' check (origem in ('assistente', 'app')),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '7 days',
  usado_em timestamptz
);
create index if not exists links_de_acesso_conta on public.links_de_acesso (conta);
alter table public.links_de_acesso enable row level security;   -- sem política: só as funções do servidor

create table if not exists public.acesso_tentativas (
  chave text not null,
  quando timestamptz not null default now()
);
create index if not exists acesso_tentativas_chave on public.acesso_tentativas (chave, quando);
alter table public.acesso_tentativas enable row level security;

-- a conta que veio pelo WhatsApp: telefone confirmado (a mensagem saiu dele), lembretes ligados, sem e-mail
create or replace function public.cliente_do_whatsapp(conta uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles p
  set phone_verificado_em = coalesce(p.phone_verificado_em, now()), accepts_reminders = true, aceita_email = false
  where p.id = conta;
$$;
revoke execute on function public.cliente_do_whatsapp(uuid) from public, anon, authenticated;

-- um link novo derruba os que ela ainda não usou; os velhos (30 dias) saem
create or replace function public.link_de_acesso_guardar(conta uuid, hash text, origem_ text default 'app')
returns void
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
begin
  delete from public.links_de_acesso l where l.criado_em < now() - interval '30 days';
  update public.links_de_acesso l set expira_em = least(l.expira_em, now()) where l.conta = conta and l.usado_em is null;
  insert into public.links_de_acesso (conta, token_hash, origem) values (conta, hash, coalesce(origem_, 'app'));
end;
$$;
revoke execute on function public.link_de_acesso_guardar(uuid, text, text) from public, anon, authenticated;

create or replace function public.link_de_acesso_ver(hash text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case
    when l.id is null then jsonb_build_object('ok', false, 'motivo', 'nao_existe')
    when l.usado_em is not null then jsonb_build_object('ok', false, 'motivo', 'usado')
    when l.expira_em <= now() then jsonb_build_object('ok', false, 'motivo', 'expirado')
    else jsonb_build_object('ok', true, 'conta', l.conta, 'nome', p.full_name, 'telefone', p.phone)
  end
  from (select 1) x
  left join public.links_de_acesso l on l.token_hash = hash
  left join public.profiles p on p.id = l.conta;
$$;
revoke execute on function public.link_de_acesso_ver(text) from public, anon, authenticated;

create or replace function public.link_de_acesso_usar(hash text)
returns uuid
language sql
security definer set search_path = public
as $$
  update public.links_de_acesso l set usado_em = now()
  where l.token_hash = hash and l.usado_em is null and l.expira_em > now()
  returning l.conta;
$$;
revoke execute on function public.link_de_acesso_usar(text) from public, anon, authenticated;

-- conta as tentativas por chave (ex.: 'link:5513999991234') numa janela; devolve false quando passou do máximo
create or replace function public.acesso_tentativa(chave_ text, maximo integer, minutos integer)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.acesso_tentativas t where t.quando < now() - interval '1 day';
  if (select count(*) from public.acesso_tentativas t where t.chave = chave_ and t.quando > now() - make_interval(mins => minutos)) >= maximo then
    return false;
  end if;
  insert into public.acesso_tentativas (chave) values (chave_);
  return true;
end;
$$;
revoke execute on function public.acesso_tentativa(text, integer, integer) from public, anon, authenticated;

-- a conta para entrar pelo número: telefone confirmado e de uma conta só (dois cadastros com o mesmo número: use o e-mail)
create or replace function public.conta_para_entrar(tel text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select case when count(*) = 1 then (array_agg(p.id))[1] end
  from public.profiles p
  where public.telefone_chave(p.phone) = public.telefone_chave(tel) and p.phone_verificado_em is not null;
$$;
revoke execute on function public.conta_para_entrar(text) from public, anon, authenticated;

-- 4. As funções que mudam (definição inteira, com a mudança marcada "3.98 (242)") ------------------------------------------
CREATE OR REPLACE FUNCTION public.avisa_profissional_do_agendamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  conta uuid;
  manual boolean;
  por_historico boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  pagina text;
  pago boolean;
  sit jsonb;
  forcado boolean := false;
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

  -- pago pelo app (ou troca de um horário pago): entra confirmado, sem aceite
  pago := coalesce(new.pago_cents, 0) > 0
          or (new.remarca_de is not null and exists (select 1 from public.appointments o where o.id = new.remarca_de and coalesce(o.pago_cents, 0) > 0));
  if pago then
    if new.status = 'pendente' then
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
    perform public.avisar_horario_pago(new.id, new.remarca_de is not null);
    if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
      select * into res from public.resumo_do_agendamento(new.id);
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. Seu crédito entrou como sinal.',
        '/cliente/agendamento/' || new.id::text, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);
  -- histórico ruim com ELA: o pedido passa pela mão dela mesmo no automático
  por_historico := por_historico and not coalesce(manual, false)
                   and new.client_id is not null and public.historico_ruim_comigo(new.client_id, new.professional_id);

  -- 3.98 (242): as regras do salão para a cliente que marca sozinha (app ou assistente): o primeiro horário de cliente
  -- nova (a casa confirma / só a equipe) e as faltas além do limite viram pedido para a casa confirmar
  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null and new.status = 'pendente' then
    sit := public.situacao_da_cliente(new.salon_id, new.client_id, new.id);
    forcado := coalesce(((sit ->> 'nova')::boolean and sit ->> 'cliente_nova' in ('casa_confirma', 'so_equipe'))
                        or (sit ->> 'faltas')::integer >= (sit ->> 'limite_faltas')::integer, false);
  end if;

  if (coalesce(manual, false) or por_historico or forcado) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id, por_historico or forcado);
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
$function$;

CREATE OR REPLACE FUNCTION public.bot_marcar(salao uuid, cliente uuid, profissional_id uuid, servico_id uuid, dia date, hora time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare dur integer; manual boolean; novo uuid; virou text; nome_s text; nome_p text; sit jsonb; forcado boolean;
begin
  if cliente is null then return jsonb_build_object('erro', 'cliente sem cadastro: peça para ela entrar pelo app'); end if;
  select s.duration_minutes, s.name into dur, nome_s from public.services s where s.id = servico_id and s.salon_id = salao and s.active;
  if dur is null then return jsonb_build_object('erro', 'serviço não encontrado neste salão'); end if;
  select p.aceite_manual, p.name into manual, nome_p from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active;
  if nome_p is null then return jsonb_build_object('erro', 'profissional não encontrada'); end if;
  if not exists (select 1 from public.professional_services ps where ps.professional_id = profissional_id and ps.service_id = servico_id) then
    return jsonb_build_object('erro', nome_p || ' não faz ' || nome_s);
  end if;
  if not exists (select 1 from public.horarios_livres(profissional_id, dia, dur) h where h.hora = hora) then
    return jsonb_build_object('erro', 'esse horário não está mais livre', 'sugestao', public.bot_horarios(salao, profissional_id, dia, servico_id));
  end if;
  -- 3.98 (242): cliente nova (a casa confirma / só a equipe) e faltas além do limite: entra como pedido; o gatilho de
  -- aceite (avisa_profissional_do_agendamento) abre o pedido para a casa
  sit := public.situacao_da_cliente(salao, cliente);
  forcado := coalesce(((sit ->> 'nova')::boolean and sit ->> 'cliente_nova' in ('casa_confirma', 'so_equipe'))
                      or (sit ->> 'faltas')::integer >= (sit ->> 'limite_faltas')::integer, false)
             -- sem conta da profissional não há quem receba o pedido (o aceite não abre): entra confirmado, como antes
             and exists (select 1 from public.professionals p where p.id = profissional_id and p.user_id is not null);
  -- age em nome da cliente: os gatilhos (aceite, vínculo, avisos, limites) veem o uid dela; a origem diz que foi pelo WhatsApp
  perform set_config('request.jwt.claim.sub', cliente::text, true);
  perform set_config('mimo.origem', 'assistente', true);
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (cliente, profissional_id, salao, servico_id, dia, hora, (hora + make_interval(mins => dur))::time,
          case when coalesce(manual, false) or forcado then 'pendente' else 'confirmado' end)
  returning id into novo;
  perform set_config('mimo.origem', '', true);
  select status into virou from public.appointments where id = novo;
  return jsonb_build_object('ok', true, 'appointment_id', novo, 'status', virou, 'servico', nome_s, 'profissional', nome_p,
    'dia', to_char(dia, 'DD/MM'), 'hora', to_char(hora, 'HH24:MI'),
    'aviso', case when virou = 'pendente' and forcado then 'o salão confirma o horário; a cliente recebe a resposta por aqui'
                 when virou = 'pendente' then 'a profissional precisa aceitar; a cliente recebe a resposta por aqui' else 'já está confirmado' end);
exception
  when unique_violation or exclusion_violation then
    return jsonb_build_object('erro', 'esse horário acabou de ser reservado por outra pessoa');
  -- 3.98 (242): os limites da cliente (gatilho limites_da_cliente): ela não marca sozinha; a assistente chama a equipe
  when sqlstate 'MI001' then
    return jsonb_build_object('erro', sqlerrm, 'limite', true, 'chamar_equipe', true);
  when sqlstate 'MI002' then
    return jsonb_build_object('erro', sqlerrm, 'chamar_equipe', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.bot_marcar_simular(salao uuid, profissional_id uuid, servico_id uuid, dia date, hora time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_variable
declare dur integer; manual boolean; nome_s text; nome_p text; virou text; regra text;
begin
  select s.duration_minutes, s.name into dur, nome_s from public.services s where s.id = servico_id and s.salon_id = salao and s.active;
  if dur is null then return jsonb_build_object('erro', 'serviço não encontrado neste salão'); end if;
  select p.aceite_manual, p.name into manual, nome_p from public.professionals p where p.id = profissional_id and p.salon_id = salao and p.active;
  if nome_p is null then return jsonb_build_object('erro', 'profissional não encontrada'); end if;
  if not exists (select 1 from public.professional_services ps where ps.professional_id = profissional_id and ps.service_id = servico_id) then
    return jsonb_build_object('erro', nome_p || ' não faz ' || nome_s);
  end if;
  if not exists (select 1 from public.horarios_livres(profissional_id, dia, dur) h where h.hora = hora) then
    return jsonb_build_object('erro', 'esse horário não está mais livre', 'sugestao', public.bot_horarios(salao, profissional_id, dia, servico_id));
  end if;
  -- 3.98 (242): no teste quem escreve é uma cliente nova: vale a regra do salão para o primeiro horário
  select s.cliente_nova into regra from public.salons s where s.id = salao;
  if regra = 'so_equipe' then
    return jsonb_build_object('erro', 'O primeiro horário de cliente nova é marcado pela equipe do salão.', 'chamar_equipe', true);
  end if;
  virou := case when coalesce(manual, false) or regra = 'casa_confirma' then 'pendente' else 'confirmado' end;
  return jsonb_build_object('ok', true, 'status', virou, 'servico', nome_s, 'profissional', nome_p,
    'dia', to_char(dia, 'DD/MM'), 'hora', to_char(hora, 'HH24:MI'),
    'aviso', case when virou = 'pendente' and regra = 'casa_confirma' and not coalesce(manual, false) then 'o salão confirma o horário; a cliente recebe a resposta por aqui'
                 when virou = 'pendente' then 'a profissional precisa aceitar; a cliente recebe a resposta por aqui' else 'já está confirmado' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.enfileirar_email(para text, assunto text, html text, kind text DEFAULT 'aviso'::text, texto text DEFAULT NULL::text, nome text DEFAULT NULL::text, conta uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  novo uuid;
begin
  if para is null or para !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return null;
  end if;
  -- 3.98 (242): quem se cadastrou pelo WhatsApp tem um endereço só de entrada (sem caixa de correio)
  if lower(btrim(para)) like '%@whatsapp.mimo.com.vc' then
    return null;
  end if;
  insert into public.email_outbox (para, nome, assunto, html, texto, kind, user_id)
  values (lower(btrim(para)), nome, assunto, html, texto, kind, conta)
  returning id into novo;
  return novo;
end;
$function$;
