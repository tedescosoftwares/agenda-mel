-- =============================================================
-- Agenda Mel — 041: o aceite vale para quem marca pelo app também
--
-- Duas coisas.
--
-- 1. O pedido de aceite só nascia pela conversa. Quem marcava pelo app
--    entrava direto na agenda da profissional sem ela dizer nada — o
--    contrário do que a gente combinou. Agora quem decide é UM lugar só:
--    o gatilho do insert. Não importa por onde veio o agendamento.
--
-- 2. Antes, quem criava o pedido era a conversa; agora é o gatilho. Se
--    os dois criassem, a profissional receberia o pedido duas vezes.
--
-- A regra fica assim: cliente marca, seja onde for → se a profissional
-- pede confirmação, vira pedido. A profissional ou a dona marcando pela
-- agenda → vale direto, porque quem decide já está decidindo.
-- =============================================================

create or replace function public.avisa_profissional_do_agendamento()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  conta uuid;
  manual boolean;
  eh_dona boolean;
  r jsonb;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual into conta, manual
  from public.professionals p where p.id = new.professional_id;

  if conta is null then
    return new;                      -- profissional sem conta de login
  end if;

  -- ela marcando para si mesma, ou ela mesma marcando pela agenda:
  -- está vendo a tela, não precisa de aviso nem de pedir permissão
  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);

  -- Pedido de aceite: só quando quem marcou foi a CLIENTE. A dona do
  -- salão encaixando alguém pela agenda está decidindo pela casa — pedir
  -- confirmação nesse caso seria a casa pedindo licença a si mesma.
  if coalesce(manual, false) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id);
    if coalesce((r ->> 'ok')::boolean, false) then
      return new;                    -- o pedido foi aberto; ela decide
    end if;
    -- não deu para perguntar (sem telefone): confirma e avisa, porque
    -- deixar pendente para sempre é pior do que decidir
    update public.appointments set status = 'confirmado' where id = new.id;

  elsif not coalesce(manual, false) and new.status = 'pendente' then
    -- Ela desligou o "pedir minha confirmação". Deixar em 'pendente'
    -- faria a palavra significar duas coisas: às vezes "esperando ela
    -- responder o pedido", às vezes "esperando ela tocar na agenda".
    -- Estado que significa duas coisas é estado que ninguém confia.
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  perform public.notificar(
    conta, 'novo_agendamento', 'Horário novo na sua agenda', null, '/pro',
    jsonb_build_object('appointment_id', new.id,
                       'professional_id', new.professional_id));
  return new;
end;
$$;

-- 2. A conversa para de abrir o pedido: agora é o gatilho ----------------
create or replace function public.fechar_pela_conversa(
  cliente uuid, prof uuid, salao uuid, serv uuid,
  dia date, hora time, dur integer
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  manual boolean;
  novo uuid;
  virou text;
  na_fila record;
begin
  select aceite_manual into manual from public.professionals where id = prof;

  -- nasce pendente quando ela pede confirmação; o gatilho do insert vê
  -- isso e abre o pedido
  insert into public.appointments
    (client_id, professional_id, salon_id, service_id,
     date, start_time, end_time, status)
  values
    (cliente, prof, salao, serv, dia, hora,
     (hora + make_interval(mins => dur))::time,
     case when coalesce(manual, false) then 'pendente' else 'confirmado' end)
  returning id into novo;

  -- o gatilho já rodou: lê o que ele decidiu, em vez de decidir de novo
  select status into virou from public.appointments where id = novo;

  if virou <> 'pendente' then
    return jsonb_build_object('appointment_id', novo, 'pendente', false);
  end if;

  select o.id, o.telefone, o.corpo into na_fila
  from public.message_outbox o
  where o.appointment_id = novo and o.kind = 'pedido_de_aceite'
    and o.status = 'na_fila'
  order by o.criado_em desc
  limit 1;

  return jsonb_build_object('appointment_id', novo, 'pendente', true,
    'minutos', (select minutos_para_aceitar from public.professionals where id = prof),
    'avisar', case when na_fila.id is not null then
      jsonb_build_object('fila_id', na_fila.id,
                         'telefone', na_fila.telefone,
                         'corpo', na_fila.corpo)
    end);
end;
$$;

revoke execute on function
  public.fechar_pela_conversa(uuid, uuid, uuid, uuid, date, time, integer)
  from public, anon, authenticated;

-- 3. O app precisa saber que virou pedido, não agendamento ---------------
-- Sem isto a tela diz "marcado!" e a cliente descobre depois que era só
-- um pedido. Devolve o estado real de um agendamento recém-criado.
drop function if exists public.como_ficou(uuid);
create or replace function public.como_ficou(appt uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', a.status,
    'pendente', a.status = 'pendente',
    'profissional', p.name,
    'minutos', p.minutos_para_aceitar)
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  where a.id = appt
    and (a.client_id = auth.uid()
         or public.is_professional(a.professional_id)
         or public.is_admin_do_salao(a.salon_id));
$$;

revoke execute on function public.como_ficou(uuid) from public, anon;
grant execute on function public.como_ficou(uuid) to authenticated;
