\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare
  cli uuid; prof_conta uuid; prof uuid; salao uuid; outra uuid;
  serv uuid;
  dia date; dia2 date;
  antigo uuid; novo uuid; r jsonb; st text; txt text; n int;
begin
  select id into cli from public.profiles where full_name = 'Juliana Prado';
  select id into outra from public.profiles where full_name = 'Bruna Alves';
  select id, user_id, salon_id into prof, prof_conta, salao from public.professionals where name = 'Ana Paula';
  select id into serv from public.services order by name limit 1;
  -- um dia aberto da semana que vem, e outro depois
  select d into dia from generate_series(current_date + 3, current_date + 12, '1 day') d
   join public.professional_hours h on h.professional_id = prof and h.weekday = extract(dow from d) and h.open
   order by d limit 1;
  select d into dia2 from generate_series(dia + 1, dia + 10, '1 day') d
   join public.professional_hours h on h.professional_id = prof and h.weekday = extract(dow from d) and h.open
   order by d limit 1;
  raise notice 'dias: % e %', dia, dia2;

  perform set_config('request.jwt.claim.sub', cli::text, false);

  -- ===== cenário 1: aceite ligado, profissional aceita a troca =====
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (cli, prof, salao, serv, dia, '10:00', '11:00', 'confirmado') returning id into antigo;

  -- mesmo horário: recusa
  r := public.pedir_remarcacao(antigo, dia, '10:00');
  assert (r->>'ok')::boolean = false, 'mesmo horário devia recusar: ' || r::text;
  -- meia hora depois no mesmo dia cruza com o atual: mensagem própria
  r := public.pedir_remarcacao(antigo, dia, '10:30');
  assert (r->>'ok')::boolean = false and r->>'motivo' like '%cruza%', 'cruzando: ' || r::text;
  r := public.pedir_remarcacao(antigo, dia2, '14:00');
  assert (r->>'ok')::boolean, 'remarcar para outro dia: ' || r::text;
  assert (r->>'pendente')::boolean, 'devia ficar pendente: ' || r::text;
  novo := (r->>'appointment_id')::uuid;

  select status into st from public.appointments where id = antigo;
  assert st = 'confirmado', 'antigo tinha que continuar confirmado, está ' || st;
  select count(*) into n from public.aceites where appointment_id = novo and resultado is null;
  assert n = 1, 'aceite aberto para o novo';
  select corpo into txt from public.message_outbox where appointment_id = novo and kind = 'pedido_de_aceite';
  assert txt like '%Pedido de remarcação%' and txt like '%era:%', 'texto do pedido: ' || coalesce(txt, '(nulo)');
  raise notice E'--- pedido para a profissional:\n%', txt;

  -- segundo pedido enquanto o primeiro está aberto: recusa
  r := public.pedir_remarcacao(antigo, dia2, '16:00');
  assert (r->>'ok')::boolean = false, 'segundo pedido devia recusar: ' || r::text;

  -- meus_pedidos mostra que é troca
  perform set_config('request.jwt.claim.sub', prof_conta::text, false);
  select count(*) into n from public.meus_pedidos() where appointment_id = novo and remarcacao and antes is not null;
  assert n = 1, 'meus_pedidos devia marcar remarcacao';

  -- profissional aceita
  r := public.responder_pedido(novo, true);
  assert (r->>'ok')::boolean and (r->>'remarcacao')::boolean, 'aceitar: ' || r::text;
  select status into st from public.appointments where id = novo;
  assert st = 'confirmado', 'novo devia confirmar';
  select status into st from public.appointments where id = antigo;
  assert st = 'cancelado', 'antigo devia cancelar';
  assert (select remarcado_para from public.appointments where id = antigo) = novo, 'remarcado_para';
  select corpo into txt from public.message_outbox where appointment_id = novo and kind = 'remarcacao_aceita';
  assert txt like '%Remarcado%', 'texto aceita: ' || coalesce(txt, '(nulo)');
  raise notice E'--- aviso para a cliente:\n%', txt;
  select count(*) into n from public.message_outbox where appointment_id = antigo and kind in ('cancelou_comigo', 'profissional_cancelou', 'agendamento_cancelado');
  assert n = 0, 'cancelamento do antigo tinha que ser silencioso, mandou ' || n;
  raise notice 'cenário 1 ok';

  perform set_config('agenda_mel.ja_avisei', '', true);  -- cada cenário é uma 'requisição'
  -- ===== cenário 2: recusa =====
  perform set_config('request.jwt.claim.sub', cli::text, false);
  antigo := novo;  -- o confirmado de agora (dia2, 14:00)
  r := public.pedir_remarcacao(antigo, dia, '10:00');
  assert (r->>'ok')::boolean, 'pedir cenário 2: ' || r::text;
  novo := (r->>'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', prof_conta::text, false);
  r := public.responder_pedido(novo, false);
  assert (r->>'ok')::boolean, 'recusar: ' || r::text;
  select status into st from public.appointments where id = novo;
  assert st = 'cancelado', 'novo devia cancelar';
  select status into st from public.appointments where id = antigo;
  assert st = 'confirmado', 'antigo devia continuar';
  select corpo into txt from public.message_outbox where appointment_id = novo and kind = 'remarcacao_recusada';
  assert txt like '%continua guardado%', 'texto recusa: ' || coalesce(txt, '(nulo)');
  raise notice E'--- aviso para a cliente:\n%', txt;
  raise notice 'cenário 2 ok';

  perform set_config('agenda_mel.ja_avisei', '', true);  -- cada cenário é uma 'requisição'
  -- ===== cenário 3: cliente desiste do pedido =====
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.pedir_remarcacao(antigo, dia, '11:00');
  assert (r->>'ok')::boolean, 'pedir cenário 3: ' || r::text;
  novo := (r->>'appointment_id')::uuid;
  set role authenticated;
  update public.appointments set status = 'cancelado' where id = novo;
  reset role;
  select resultado into st from public.aceites where appointment_id = novo;
  assert st = 'desistiu', 'aceite devia fechar como desistiu, está ' || coalesce(st, '(aberto)');
  select corpo into txt from public.message_outbox where appointment_id = novo and kind = 'cancelou_comigo';
  assert txt like '%Desistiu da remarcação%', 'texto desistiu: ' || coalesce(txt, '(nulo)');
  raise notice E'--- aviso para a profissional:\n%', txt;
  -- e a profissional respondendo 1 atrasada não confirma nada
  perform set_config('request.jwt.claim.sub', prof_conta::text, false);
  r := public.responder_pedido(novo, true);
  assert (r->>'ok')::boolean = false, 'responder depois de desistir: ' || r::text;
  select status into st from public.appointments where id = antigo;
  assert st = 'confirmado', 'antigo intacto';
  raise notice 'cenário 3 ok';

  perform set_config('agenda_mel.ja_avisei', '', true);  -- cada cenário é uma 'requisição'
  -- ===== cenário 4: cancela o de origem com pedido aberto =====
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.pedir_remarcacao(antigo, dia, '10:00');
  assert (r->>'ok')::boolean, 'pedir cenário 4: ' || r::text;
  novo := (r->>'appointment_id')::uuid;
  set role authenticated;
  update public.appointments set status = 'cancelado' where id = antigo;
  reset role;
  select status into st from public.appointments where id = novo;
  assert st = 'cancelado', 'pedido devia cair junto, está ' || st;
  select resultado into st from public.aceites where appointment_id = novo;
  assert st = 'desistiu', 'aceite do pedido fechado';
  raise notice 'cenário 4 ok';

  perform set_config('agenda_mel.ja_avisei', '', true);  -- cada cenário é uma 'requisição'
  -- ===== cenário 5: aceite desligado, troca imediata =====
  update public.professionals set aceite_manual = false where id = prof;
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (cli, prof, salao, serv, dia, '09:00', '10:00', 'confirmado') returning id into antigo;
  r := public.pedir_remarcacao(antigo, dia, '11:00');
  assert (r->>'ok')::boolean and not (r->>'pendente')::boolean, 'imediato: ' || r::text;
  novo := (r->>'appointment_id')::uuid;
  select status into st from public.appointments where id = novo;
  assert st = 'confirmado', 'novo confirmado';
  select status into st from public.appointments where id = antigo;
  assert st = 'cancelado', 'antigo cancelado';
  select corpo into txt from public.message_outbox where appointment_id = novo and kind = 'novo_agendamento';
  assert txt like '%Cliente remarcou%', 'texto novo_agendamento: ' || coalesce(txt, '(nulo)');
  raise notice E'--- aviso para a profissional:\n%', txt;
  select count(*) into n from public.message_outbox where appointment_id = novo and kind = 'remarcacao_aceita';
  assert n = 1, 'cliente avisada da troca imediata';
  update public.professionals set aceite_manual = true where id = prof;
  raise notice 'cenário 5 ok';

  -- ===== outra cliente não mexe =====
  perform set_config('request.jwt.claim.sub', outra::text, false);
  begin
    r := public.pedir_remarcacao(novo, dia, '12:00');
    raise exception 'devia ter barrado outra cliente';
  exception when others then
    if sqlerrm not like '%não é seu%' then raise; end if;
  end;
  raise notice 'dono ok';

  raise exception 'TUDO OK (rollback proposital)';
end $$;
