-- Ensaio do pagamento pelo app (090). Roda no banco de teste e desfaz.
-- Não fala com o Asaas: cobre as regras do banco (estados, prazos, avisos).
begin;
do $$
declare
  prof record; svc record; sal uuid; cli uuid; r jsonb; a1 uuid; a2 uuid; a3 uuid; pg jsonb; ap public.appointments%rowtype; p public.pagamentos%rowtype;
  dia date := public.agora_local()::date + 3;
begin
  select pf.* into prof from public.professionals pf where pf.active and pf.user_id is not null and pf.salon_id is not null limit 1;
  select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id where ps.professional_id = prof.id and s.active and s.price > 0 limit 1;
  sal := prof.salon_id;
  cli := gen_random_uuid();
  perform public.silenciar_gatilho();
  insert into auth.users (id, email) values (cli, 'paga-' || cli::text || '@ensaio.local');
  insert into public.profiles (id, full_name, role, phone, cpf) values (cli, 'Cliente Que Paga', 'cliente', '13999990000', '12345678909')
  on conflict (id) do update set role = 'cliente', full_name = 'Cliente Que Paga', phone = '13999990000', cpf = '12345678909';

  -- 0. sem conta de recebimento, o salão não cobra mesmo em modo obrigatório
  update public.salons set pagamento_modo = 'obrigatorio', sinal_pct = 50 where id = sal;
  pg := public.pagamento_do_salao(sal);
  if pg ->> 'modo' <> 'nao' then raise exception 'sem subconta devia ser nao: %', pg; end if;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '10:00', null);
  if not (r ->> 'ok')::boolean or (r ->> 'pagar')::boolean then raise exception 'sem subconta devia marcar sem pagar: %', r; end if;
  update public.appointments set status = 'cancelado' where id = (r ->> 'appointment_id')::uuid;
  raise notice '0 sem subconta não cobra (ok)';

  -- 1. com a subconta, modo obrigatório: nasce aguardando e ninguém é avisado
  insert into public.contas_de_recebimento (salon_id, conta_id, wallet_id, status) values (sal, 'acc_teste', 'wal_teste', 'aprovada');
  pg := public.pagamento_do_salao(sal);
  if pg ->> 'modo' <> 'obrigatorio' or (pg ->> 'sinal_pct')::int <> 50 then raise exception 'pagamento_do_salao errado: %', pg; end if;
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '10:00', null);
  a1 := (r ->> 'appointment_id')::uuid;
  if not (r ->> 'pagar')::boolean then raise exception 'devia pedir pagamento: %', r; end if;
  select * into ap from public.appointments where id = a1;
  if ap.status <> 'aguardando_pagamento' then raise exception 'status %', ap.status; end if;
  if exists (select 1 from public.notifications where user_id = prof.user_id and (data ->> 'appointment_id')::uuid = a1) then raise exception 'avisou a profissional antes de pagar'; end if;
  raise notice '1 nasce aguardando, sem aviso (ok)';

  -- 2. a vaga está segura: outra cliente não marca em cima
  perform set_config('request.jwt.claim.sub', (select id from public.profiles where role = 'cliente' and id <> cli limit 1)::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '10:00', null);
  if (r ->> 'ok')::boolean then raise exception 'marcou em cima da reserva'; end if;
  raise notice '2 vaga segura (ok)';

  -- 3. preparar a cobrança: sinal de 50%, mínimo R$ 1
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a1, cli);
  if not (pg ->> 'ok')::boolean then raise exception 'preparar falhou: %', pg; end if;
  if (pg ->> 'valor_cents')::int <> greatest(100, round(ap.price_cents * 0.5)) then raise exception 'sinal errado: % de %', pg ->> 'valor_cents', ap.price_cents; end if;
  if (pg ->> 'sinal_pct')::int <> 50 then raise exception 'pct errado'; end if;
  raise notice '3 preparado: % (valor % de %)', pg ->> 'descricao', pg ->> 'valor_cents', pg ->> 'total_cents';
  -- preparar de novo devolve o mesmo
  r := public.pagamento_preparar(a1, cli);
  if r ->> 'pagamento_id' <> pg ->> 'pagamento_id' or not (r ->> 'existente')::boolean then raise exception 'abriu segundo pagamento'; end if;

  -- 4. o webhook confirma: vira pendente, a profissional é avisada, a cliente também
  r := public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_teste', 1700);
  if not (r ->> 'ok')::boolean then raise exception 'confirmar falhou: %', r; end if;
  select * into ap from public.appointments where id = a1;
  if ap.status <> 'confirmado' then raise exception 'pago devia entrar confirmado (095): %', ap.status; end if;
  if not exists (select 1 from public.notifications where user_id = prof.user_id and kind = 'agendamento_pago' and (data ->> 'appointment_id')::uuid = a1) then raise exception 'profissional não soube que entrou pago e confirmado'; end if;
  if ap.pago_cents <> (pg ->> 'valor_cents')::int then raise exception 'pago_cents %', ap.pago_cents; end if;
  if not exists (select 1 from public.notifications where user_id = prof.user_id and (data ->> 'appointment_id')::uuid = a1) then raise exception 'profissional não foi avisada depois do pagamento'; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'pagamento_confirmado') then raise exception 'cliente sem aviso de pagamento'; end if;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'pago' or p.cobranca_id <> 'pay_teste' then raise exception 'pagamento não ficou pago'; end if;
  r := public.confirmar_pagamento(p.id, 'pay_teste', 1700);
  if not (r ->> 'repetido')::boolean then raise exception 'webhook repetido não foi ignorado'; end if;
  raise notice '4 pago → pedido, avisos ok, repetição ignorada (ok)';

  -- 5. cancelou com antecedência (3 dias): estorno pendente (do líquido, 093) e aviso
  perform set_config('request.jwt.claim.sub', cli::text, false);
  update public.appointments set status = 'cancelado' where id = a1;
  select * into p from public.pagamentos where id = p.id;
  if p.status <> 'estorno_pendente' or p.estorno_cents <> p.liquido_cents then raise exception 'devia estornar o líquido: % % (líquido %)', p.status, p.estorno_cents, p.liquido_cents; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'estorno_a_caminho') then raise exception 'sem aviso de estorno'; end if;
  if not exists (select 1 from public.pagamentos_para_cuidar(10) x where x.id = p.id) then raise exception 'não entrou na fila de cuidar'; end if;
  perform public.pagamento_cuidado(p.id, 'estornado');
  select * into p from public.pagamentos where id = p.id;
  if p.status <> 'estornado' or p.estornado_em is null then raise exception 'não marcou estornado'; end if;
  raise notice '5 estorno com antecedência (ok)';

  -- 6. cancelou em cima da hora (pagou há 2 h, atendimento em 3 h): o sinal vira crédito por 30 dias
  update public.salons set politica_cancelamento = 'moderada' where id = sal;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], (public.agora_local() + interval '3 hours')::date, (public.agora_local() + interval '3 hours')::time, null);
  a2 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2', null);
  update public.pagamentos set pago_em = now() - interval '2 hours' where id = (pg ->> 'pagamento_id')::uuid;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.regras_do_agendamento(a2);
  if (r ->> 'dentro_do_prazo')::boolean then raise exception 'devia estar fora do prazo: %', r; end if;
  update public.appointments set status = 'cancelado' where id = a2;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'credito' or p.credito_ate <> public.agora_local()::date + 30 then raise exception 'em cima da hora devia virar crédito: % %', p.status, p.credito_ate; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'sinal_em_credito') then raise exception 'sem aviso de crédito'; end if;
  r := public.meu_credito(sal);
  if (r ->> 'valor_cents')::int <> p.valor_cents then raise exception 'meu_credito errado: %', r; end if;
  raise notice '6 sinal virou crédito (ok)';

  -- 6b. marca de novo com a mesma casa: o crédito entra como sinal, sem pagar
  update public.salons set pagamento_modo = 'obrigatorio' where id = sal;
  r := public.marcar_servicos(prof.id, array[svc.id], dia + 2, '11:00', null);
  if (r ->> 'pagar')::boolean or (r ->> 'credito_usado')::int <> p.valor_cents then raise exception 'crédito não foi usado: %', r; end if;
  select * into ap from public.appointments where id = (r ->> 'appointment_id')::uuid;
  if ap.status <> 'confirmado' or ap.pago_cents <> p.valor_cents then raise exception 'horário com crédito devia entrar confirmado: % %', ap.status, ap.pago_cents; end if;
  update public.pagamentos set liquido_cents = valor_cents - 199 where id = p.id;
  select * into p from public.pagamentos where id = p.id;
  if p.status <> 'pago' or p.appointment_id <> ap.id or p.remarcado_de <> a2 then raise exception 'pagamento não mudou de horário: % %', p.status, p.appointment_id; end if;
  if public.meu_credito(sal) is not null then raise exception 'crédito continuou disponível'; end if;
  -- e a casa cancela esse novo horário: devolve tudo
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  update public.appointments set status = 'cancelado' where id = ap.id;
  select * into p from public.pagamentos where id = p.id;
  if p.status <> 'estorno_pendente' or p.estorno_cents <> p.valor_cents - 199 then raise exception 'casa cancelou devia devolver o líquido (095): % %', p.status, p.estorno_cents; end if;
  perform public.pagamento_cuidado(p.id, 'estornado');
  raise notice '6b crédito usado como sinal (ok)';

  -- 6c. crédito que passou dos 30 dias fica com a casa
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], (public.agora_local() + interval '3 hours')::date, (public.agora_local() + interval '4 hours')::time, null);
  a2 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2c', null);
  update public.pagamentos set pago_em = now() - interval '2 hours' where id = (pg ->> 'pagamento_id')::uuid;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  update public.appointments set status = 'cancelado' where id = a2;
  update public.pagamentos set credito_ate = public.agora_local()::date - 1 where id = (pg ->> 'pagamento_id')::uuid;
  if public.expirar_creditos() <> 1 then raise exception 'não venceu o crédito'; end if;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'retido' then raise exception 'crédito vencido devia ficar retido: %', p.status; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'credito_vencido') then raise exception 'sem aviso de crédito vencido'; end if;
  raise notice '6c crédito venceu (ok)';

  -- 6d. carência: pagou já dentro do prazo e desistiu em menos de 1 h: devolve
  r := public.marcar_servicos(prof.id, array[svc.id], (public.agora_local() + interval '3 hours')::date, (public.agora_local() + interval '5 hours')::time, null);
  a2 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2d', null);
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.regras_do_agendamento(a2);
  if not (r ->> 'dentro_do_prazo')::boolean then raise exception 'carência devia valer: %', r; end if;
  update public.appointments set status = 'cancelado' where id = a2;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'estorno_pendente' then raise exception 'na carência devia devolver: %', p.status; end if;
  perform public.pagamento_cuidado(p.id, 'estornado');
  raise notice '6d carência de 1 h (ok)';

  -- 6e. a casa remarca um horário pago: o sinal vai junto, sem devolver
  r := public.marcar_servicos(prof.id, array[svc.id], dia + 5, '10:00', null);
  a2 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2e', null);
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  r := public.remarcar_por_fora(a2, dia + 5, '15:00');
  if not (r ->> 'ok')::boolean then raise exception 'remarcar_por_fora falhou: %', r; end if;
  select * into ap from public.appointments where id = (r ->> 'appointment_id')::uuid;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if ap.pago_cents <> p.valor_cents or p.appointment_id <> ap.id or p.status <> 'pago' or p.remarcado_de <> a2 then raise exception 'sinal não acompanhou a troca: % % %', ap.pago_cents, p.appointment_id, p.status; end if;
  if exists (select 1 from public.notifications where user_id = cli and kind in ('estorno_a_caminho') and (data ->> 'appointment_id')::uuid = a2) then raise exception 'troca gerou devolução'; end if;
  raise notice '6e troca leva o sinal junto (ok)';

  -- 6g. a profissional pede aceite: pago entra confirmado mesmo assim; pagar depois fecha o pedido aberto
  update public.professionals set aceite_manual = true where id = prof.id;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia + 6, '10:00', null, true);
  a2 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2g', null);
  select * into ap from public.appointments where id = a2;
  if ap.status <> 'confirmado' then raise exception 'com aceite manual, pago devia confirmar direto: %', ap.status; end if;
  update public.salons set pagamento_modo = 'opcional' where id = sal;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia + 6, '14:00', null, false);
  a2 := (r ->> 'appointment_id')::uuid;
  select * into ap from public.appointments where id = a2;
  raise notice '   (sem pagar, com aceite manual: %)', ap.status;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a2, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_2h', null);
  select * into ap from public.appointments where id = a2;
  if ap.status <> 'confirmado' then raise exception 'pagou depois: devia confirmar: %', ap.status; end if;
  if exists (select 1 from public.aceites where appointment_id = a2 and resultado is null) then raise exception 'aceite ficou aberto depois do pagamento'; end if;
  update public.professionals set aceite_manual = false where id = prof.id;
  update public.salons set pagamento_modo = 'obrigatorio' where id = sal;
  perform set_config('request.jwt.claim.sub', prof.user_id::text, false);
  raise notice '6g pago não espera aceite (ok)';

  -- 6f. o financeiro do mês, visto pela casa
  insert into public.salon_members (salon_id, user_id, papel) values (sal, prof.user_id, 'admin') on conflict (salon_id, user_id) do update set papel = 'admin';
  r := public.financeiro_do_salao(sal, to_char(public.agora_local(), 'YYYY-MM'));
  if (r ->> 'recebido_cents')::int <= 0 or (r ->> 'pagamentos')::int < 3 then raise exception 'financeiro vazio: %', r; end if;
  if jsonb_array_length(r -> 'por_profissional') < 1 or jsonb_array_length(r -> 'movimentos') < 3 then raise exception 'financeiro sem listas: %', r; end if;
  raise notice '6f financeiro: recebido % em % pagamentos, devolvido %, retido % (ok)', r ->> 'recebido_cents', r ->> 'pagamentos', r ->> 'devolvido_cents', r ->> 'retido_cents';
  perform set_config('request.jwt.claim.sub', cli::text, false);
  update public.salons set pagamento_modo = 'obrigatorio', sinal_pct = 50 where id = sal;

  -- 7. reserva que ninguém pagou expira em 15 min, sem avisar a profissional
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '14:00', null);
  a3 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a3, cli);
  update public.pagamentos set cobranca_id = 'pay_3' where id = (pg ->> 'pagamento_id')::uuid;
  if public.expirar_reservas_nao_pagas() <> 0 then raise exception 'expirou antes da hora'; end if;
  update public.appointments set created_at = now() - interval '16 minutes' where id = a3;
  if public.expirar_reservas_nao_pagas() <> 1 then raise exception 'não expirou'; end if;
  select * into ap from public.appointments where id = a3;
  if ap.status <> 'cancelado' or ap.cancelado_por <> 'sistema' then raise exception 'reserva não caiu: % %', ap.status, ap.cancelado_por; end if;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'expirado' then raise exception 'pagamento devia expirar: %', p.status; end if;
  if not exists (select 1 from public.pagamentos_para_cuidar(10) x where x.id = p.id) then raise exception 'cobrança expirada não entrou na fila para baixar'; end if;
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'reserva_expirada') then raise exception 'cliente sem aviso de reserva expirada'; end if;
  if exists (select 1 from public.notifications where user_id = prof.user_id and (data ->> 'appointment_id')::uuid = a3) then raise exception 'profissional foi avisada de reserva que caiu'; end if;
  -- a vaga voltou
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '14:00', null);
  if not (r ->> 'ok')::boolean then raise exception 'vaga não voltou: %', r; end if;
  raise notice '7 reserva expira e libera (ok)';

  -- 8. modo opcional: sem pedir, nasce pendente; pedindo, aguarda
  update public.salons set pagamento_modo = 'opcional' where id = sal;
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '16:00', null, false);
  if (r ->> 'pagar')::boolean then raise exception 'opcional sem pedir devia ser pendente'; end if;
  r := public.marcar_servicos(prof.id, array[svc.id], dia, '17:00', null, true);
  if not (r ->> 'pagar')::boolean then raise exception 'opcional pedindo devia aguardar'; end if;
  raise notice '8 modo opcional (ok)';

  -- 9. a cliente vê só os próprios pagamentos; a dona vê os do salão
  set role authenticated;
  if (select count(*) from public.pagamentos) <> (select count(*) from public.pagamentos where client_id = cli) then raise exception 'cliente viu pagamento alheio'; end if;
  reset role;
  raise notice '9 RLS (ok)';

  -- 11. cliente cancelou com antecedência: devolve o líquido (093); a casa cancelou: devolve tudo
  perform set_config('request.jwt.claim.sub', cli::text, false);
  r := public.marcar_servicos(prof.id, array[svc.id], dia + 1, '10:00', null);
  a3 := (r ->> 'appointment_id')::uuid;
  perform set_config('request.jwt.claim.sub', '', false);
  pg := public.pagamento_preparar(a3, cli);
  perform public.confirmar_pagamento((pg ->> 'pagamento_id')::uuid, 'pay_11', (pg ->> 'valor_cents')::int - 199);
  perform set_config('request.jwt.claim.sub', cli::text, false);
  update public.appointments set status = 'cancelado' where id = a3;
  select * into p from public.pagamentos where id = (pg ->> 'pagamento_id')::uuid;
  if p.status <> 'estorno_pendente' or p.estorno_cents <> p.valor_cents - 199 then raise exception 'devia devolver o líquido: % de %', p.estorno_cents, p.valor_cents; end if;
  raise notice '11 cliente cancelou: volta % de % (ok)', p.estorno_cents, p.valor_cents;

  -- 12. a fila falha por falta de saldo: espaça, avisa a profissional na 2ª, a cliente na 3ª, e some da fila até a hora
  perform set_config('request.jwt.claim.sub', '', false);
  perform public.pagamento_cuidado(p.id, 'erro', 'Saldo insuficiente para estorno');
  select * into p from public.pagamentos where id = p.id;
  if p.tentativas_estorno <> 1 or p.proxima_tentativa_em is null then raise exception 'não espaçou'; end if;
  if exists (select 1 from public.pagamentos_para_cuidar(50) x where x.id = p.id) then raise exception 'voltou para a fila antes da hora'; end if;
  perform public.pagamento_cuidado(p.id, 'erro', 'Saldo insuficiente para estorno');
  if not exists (select 1 from public.notifications where user_id = prof.user_id and kind = 'estorno_sem_saldo') then raise exception 'profissional não foi avisada do saldo'; end if;
  perform public.pagamento_cuidado(p.id, 'erro', 'Saldo insuficiente para estorno');
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'estorno_atrasado') then raise exception 'cliente não foi avisada do atraso'; end if;
  if (select count(*) from public.notifications where user_id = prof.user_id and kind = 'estorno_sem_saldo') <> 1 then raise exception 'avisou a profissional mais de uma vez em 24 h'; end if;
  update public.pagamentos set proxima_tentativa_em = now() - interval '1 minute' where id = p.id;
  if not exists (select 1 from public.pagamentos_para_cuidar(50) x where x.id = p.id) then raise exception 'não voltou para a fila na hora'; end if;
  perform public.pagamento_cuidado(p.id, 'estornado');
  if not exists (select 1 from public.notifications where user_id = cli and kind = 'estorno_a_caminho' and title = 'Devolução feita') then raise exception 'cliente não soube que saiu'; end if;
  raise notice '12 fila com falta de saldo: espaça, avisa, some e volta (ok)';

  -- 10. a rotina geral devolve as contagens
  r := public.rodar_rotinas();
  if not (r ? 'reservas_expiradas') or not (r ? 'pagamentos') or not (r ? 'creditos_vencidos') then raise exception 'rodar_rotinas sem os campos: %', r; end if;
  raise notice '10 rodar_rotinas ok';
end $$;
rollback;
