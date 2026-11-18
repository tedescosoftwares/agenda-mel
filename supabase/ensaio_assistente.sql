-- Ensaio da 235 (3.95), 236 (3.95.1), 237 (3.95.2), 238 (3.95.3), 239 (3.95.4) e 240 (3.96): a assistente do WhatsApp do salão; o número da MIMO só como reserva;
-- a chave desligada desliga tudo. Desfaz no fim.
begin;
do $$
declare
  salao uuid; outro uuid; dona uuid; cli uuid; fone text; e164 text; ctx jsonb; r jsonb; n integer; t timestamptz; t2 timestamptz;
  inst text := 'salao-teste-235';
  novo uuid;
begin
  select p.salon_id into salao from public.professionals p where p.slug = 'ana-paula';
  select s.owner_id into dona from public.salons s where s.id = salao;
  select s.id into outro from public.salons s where s.id <> salao limit 1;
  select p.id, p.phone into cli, fone from public.profiles p where p.role = 'cliente' and p.phone is not null limit 1;
  e164 := public.telefone_e164(fone);
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, usa_bot) values (salao, 'evolution', 'mimo', true, false, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'mimo', ativo = true, usa_ia = false, numero_proprio = false;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia) values (outro, 'evolution', 'mimo', true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'mimo', ativo = true, numero_proprio = false;
  delete from public.assistentes where salon_id = salao;
  delete from public.bot_pausas where telefone = e164;

  -- A. os padrões, e a dona salvando
  r := public.assistente_config(salao);
  if r ->> 'nome' <> 'Mel' or r ->> 'tom' <> 'acolhedora' or (r ->> 'pode_marcar')::boolean is not true or r ->> 'quando' <> 'sempre' then raise exception 'A: %', r; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.assistente_salvar(salao, '{"nome": "  Bia  ", "tom": "profissional", "emojis": "nenhum", "pode_cancelar": false, "recado": "Atraso de 15 min perde o horário."}');
  if r -> 'config' ->> 'nome' <> 'Bia' or r -> 'config' ->> 'emojis' <> 'nenhum' or (r -> 'config' ->> 'pode_cancelar')::boolean
     or r ->> 'recado' <> 'Atraso de 15 min perde o horário.' or (r ->> 'ligada')::boolean then raise exception 'A2: %', r; end if;
  -- 236: ligar sem o WhatsApp do salão é recusado
  begin
    perform public.assistente_salvar(salao, '{"ligada": true}');
    raise exception 'A6: ligou sem número próprio';
  exception when raise_exception then
    if sqlerrm not like 'conecte o WhatsApp do salão%' then raise; end if;
  end;
  r := public.assistente_salvar(salao, '{"nome": ""}');
  if r -> 'config' ->> 'nome' <> 'Mel' or r -> 'config' ->> 'tom' <> 'profissional' then raise exception 'A3 (nome vazio volta para Mel, o resto fica): %', r; end if;
  begin
    perform public.assistente_salvar(salao, '{"tom": "grossa"}');
    raise exception 'A4: aceitou tom inválido';
  exception when check_violation then null;
  end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
  begin
    perform public.assistente_do_salao(salao);
    raise exception 'A5: outra pessoa viu a assistente';
  exception when raise_exception then
    if sqlerrm not like 'só quem administra%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'A personalidade: padrões, salvar, nome vazio, tom inválido, só a dona';

  -- B. sem o WhatsApp do salão a assistente não atende (236), mesmo ligada
  update public.whatsapp_channels set usa_ia = true where salon_id = salao;
  ctx := public.bot_contexto(salao, fone);
  if ctx ->> 'motivo' <> 'sem_numero_proprio' then raise exception 'B: %', ctx; end if;
  raise notice 'B sem número próprio: não atende';

  -- C. o número próprio e "quando responde"
  perform public.assistente_numero_conectado(salao, inst, '+55 (13) 99999-0000');
  if not (select numero_proprio and identificador = inst and canal = 'evolution' from public.whatsapp_channels where salon_id = salao) then raise exception 'C'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.assistente_salvar(salao, '{"ligada": true}');
  perform set_config('request.jwt.claim.sub', '', true);
  if not (r ->> 'ligada')::boolean then raise exception 'C1: %', r; end if;
  ctx := public.bot_contexto(salao, fone, inst);
  if (ctx ->> 'permitido') <> 'true' or not (ctx ->> 'numero_proprio')::boolean or ctx -> 'assistente' ->> 'tom' <> 'profissional'
     or ctx ->> 'provedor' <> 'claude' or ctx ->> 'modelo_claude' <> 'claude-haiku-5-5' or ctx ->> 'orientacao_salao' is null
     or ctx -> 'salao' ->> 'horario' is null then raise exception 'C2: %', ctx; end if;
  -- a cliente respondeu um aviso que saiu pela reserva (o número da MIMO): atende, como a Mel da MIMO
  ctx := public.bot_contexto(salao, fone, 'mimo');
  if (ctx ->> 'permitido') <> 'true' or (ctx ->> 'numero_proprio')::boolean then raise exception 'C3: %', ctx; end if;
  -- o salão aberto agora, para valer a espera
  delete from public.business_hours where salon_id = salao;
  insert into public.business_hours (salon_id, weekday, open, start_time, end_time)
  select salao, d, true, '00:00', '23:59' from generate_series(0, 6) d;
  update public.assistentes set quando = 'sem_resposta', espera_min = 15 where salon_id = salao;
  ctx := public.bot_contexto(salao, fone, inst);
  if ctx ->> 'motivo' <> 'esperar' or (ctx ->> 'responder_em')::timestamptz < now() + interval '14 minutes' then raise exception 'C4: %', ctx; end if;
  ctx := public.bot_contexto(salao, fone, inst, true);
  if (ctx ->> 'permitido') <> 'true' then raise exception 'C5 (a que já esperou responde): %', ctx; end if;
  update public.assistentes set quando = 'fora_do_horario' where salon_id = salao;
  ctx := public.bot_contexto(salao, fone, inst);
  if ctx ->> 'motivo' <> 'em_expediente' then raise exception 'C6: %', ctx; end if;
  -- fechado: responde na hora
  update public.business_hours set open = false where salon_id = salao;
  ctx := public.bot_contexto(salao, fone, inst);
  if (ctx ->> 'permitido') <> 'true' then raise exception 'C7: %', ctx; end if;
  update public.assistentes set quando = 'sem_resposta' where salon_id = salao;
  ctx := public.bot_contexto(salao, fone, inst);
  if (ctx ->> 'permitido') <> 'true' then raise exception 'C8 (sem_resposta com o salão fechado responde na hora): %', ctx; end if;
  update public.business_hours set open = true where salon_id = salao;
  raise notice 'C número próprio: espera no horário, responde fora dele, a que já esperou passa';

  -- D. o teste da dona: com a IA desligada, com o rascunho por cima, com teto
  update public.whatsapp_channels set usa_ia = false where salon_id = salao;
  ctx := public.bot_contexto(salao, 'ensaio', null, false, '{"assistente": {"nome": "Lu", "tom": "descontraida", "quando": "sem_resposta", "x": 1}, "recado": "rascunho", "cliente_nome": "Carla Dias"}');
  if (ctx ->> 'permitido') <> 'true' or ctx -> 'assistente' ->> 'nome' <> 'Lu' or ctx -> 'assistente' ->> 'tom' <> 'descontraida' or ctx -> 'assistente' ? 'x'
     or ctx ->> 'orientacao_salao' <> 'rascunho' or not (ctx ->> 'ensaio')::boolean or not (ctx ->> 'numero_proprio')::boolean
     or ctx -> 'cliente' ->> 'primeiro_nome' <> 'Carla' or jsonb_array_length(ctx -> 'historico') <> 0 then raise exception 'D: %', ctx; end if;
  ctx := public.bot_contexto(salao, 'ensaio', null, false, '{"assistente": "não é objeto"}');
  if (ctx ->> 'permitido') <> 'true' then raise exception 'D2: %', ctx; end if;
  insert into public.ia_chamadas (salon_id, telefone, modelo, ensaio) select salao, 'ensaio', 'claude-haiku-5-5', true from generate_series(1, 40);
  ctx := public.bot_contexto(salao, 'ensaio', null, false, '{}');
  if ctx ->> 'motivo' <> 'teto_do_teste' then raise exception 'D3: %', ctx; end if;
  if public.ia_gastas_hoje(salao) <> (select count(*) from public.ia_chamadas where salon_id = salao and erro is null and not ensaio and criado_em >= date_trunc('day', public.agora_local()) at time zone 'America/Sao_Paulo') then raise exception 'D4'; end if;
  update public.whatsapp_channels set usa_ia = true where salon_id = salao;
  raise notice 'D teste da dona: rascunho por cima, sem gastar o teto do salão, com teto próprio';

  -- E. a espera: o relógio não recomeça; a vencida sai uma vez só
  t := public.assistente_esperar(salao, fone, inst, 'oi, tem horário?', now() + interval '10 minutes');
  t2 := public.assistente_esperar(salao, fone, inst, 'alguém?', now() + interval '25 minutes');
  if t <> t2 or (select texto from public.assistente_esperas where salon_id = salao and telefone = e164) <> 'alguém?' then raise exception 'E'; end if;
  if exists (select 1 from public.assistente_esperas_vencidas(10)) then raise exception 'E2: venceu antes da hora'; end if;
  update public.assistente_esperas set responder_em = now() - interval '1 minute' where salon_id = salao;
  select count(*) into n from public.assistente_esperas_vencidas(10) v where v.salon_id = salao and v.texto = 'alguém?' and v.instancia = inst;
  if n <> 1 or exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'E3: %', n; end if;
  raise notice 'E espera: conta da primeira mensagem, sai uma vez';

  -- F. o eco do número próprio e a equipe pelo celular
  perform public.assistente_esperar(salao, fone, inst, 'oi', now() + interval '10 minutes');
  perform public.whatsapp_saiu('wamid-1', fone, 'Oi! Aqui é a Bia.', null);
  r := public.assistente_fromme(inst, fone, 'qualquer coisa', 'wamid-1');
  if not (r ->> 'eco')::boolean then raise exception 'F (eco pelo id): %', r; end if;
  r := public.assistente_fromme(inst, fone, '  Oi! Aqui é a Bia. ', 'outro-id');
  if not (r ->> 'eco')::boolean then raise exception 'F2 (eco pelo texto): %', r; end if;
  r := public.assistente_fromme(inst, fone, 'Oi Juliana, é a Carla! Tenho às 15h', 'wamid-2', false);
  if (r ->> 'eco')::boolean or r ? 'intervencao' or exists (select 1 from public.bot_pausas where telefone = e164 and salon_id = salao) then raise exception 'F3 (só conferir não registra): %', r; end if;
  r := public.assistente_fromme(inst, fone, 'Oi Juliana, é a Carla! Tenho às 15h', 'wamid-2', true);
  if not (r ->> 'intervencao')::boolean or not exists (select 1 from public.bot_pausas where telefone = e164 and salon_id = salao and ate > now() + interval '110 minutes')
     or exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'F4: %', r; end if;
  ctx := public.bot_contexto(salao, fone, inst);
  if ctx ->> 'motivo' <> 'pausado_para_humano' then raise exception 'F5: %', ctx; end if;
  r := public.assistente_fromme('mimo', fone, 'oi', null);
  if (r ->> 'proprio')::boolean then raise exception 'F6: o número da casa não é próprio'; end if;
  -- a resposta que sai derruba a espera
  delete from public.bot_pausas where telefone = e164;
  perform public.assistente_esperar(salao, fone, inst, 'oi', now() + interval '10 minutes');
  perform public.whatsapp_saiu('wamid-3', fone, 'Oi!', salao);
  if exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'F7'; end if;
  raise notice 'F eco reconhecido (id e texto); equipe pelo celular pausa 2 h e derruba a espera';

  -- G. de que salão é a conversa
  if public.salao_da_conversa(fone, inst) <> salao then raise exception 'G: o número próprio é do salão'; end if;
  delete from public.message_outbox where telefone = e164;
  update public.whatsapp_channels set numero_proprio = false, identificador = 'mimo' where salon_id = salao;
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, status, enviado_em) values (outro, e164, 'agente', 'oi', 'evolution', 'enviado', now() - interval '1 day');
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, status, enviado_em) values (salao, e164, 'agente', 'oi', 'evolution', 'enviado', now());
  if public.salao_da_conversa(fone, 'mimo') <> salao then raise exception 'G2: quem falou por último'; end if;
  update public.message_outbox set enviado_em = now() - interval '2 days' where salon_id = salao and telefone = e164;
  if public.salao_da_conversa(fone, 'mimo') <> outro then raise exception 'G3'; end if;
  if public.salao_da_conversa('+5511900000099', 'mimo') is not null then raise exception 'G4: desconhecida no número compartilhado não é de ninguém'; end if;
  r := public.ia_permitida(fone, 'quero marcar uma escova', 'mimo');
  if (r ->> 'salon_id')::uuid <> outro then raise exception 'G5: %', r; end if;
  raise notice 'G número compartilhado: o salão de quem falou com ela por último';

  -- H. salão novo nasce no canal manual (236): o número da MIMO não é de ninguém
  insert into public.salons (name, slug, tipo) values ('Salão do Ensaio 235', 'salao-do-ensaio-235', 'salao') returning id into novo;
  if not exists (select 1 from public.whatsapp_channels where salon_id = novo and canal = 'manual' and identificador is null and not numero_proprio) then
    raise exception 'H: %', (select to_jsonb(c) from public.whatsapp_channels c where c.salon_id = novo);
  end if;
  raise notice 'H salão novo no canal manual';

  -- I. o registro e os números
  delete from public.ia_chamadas where salon_id = salao;
  perform public.registrar_chamada_ia(salao, fone, 'claude-haiku-5-5', 300, 40, 900, null, null, 'claude', 1200, 0, 0.000172, array['listar_servicos', 'marcar'], '{"marcou": 1, "remarcou": 0, "cancelou": 0, "chamou": 0}', true, false);
  perform public.registrar_chamada_ia(salao, '+5511900000001', 'claude-haiku-5-5', 200, 20, 700, null, null, 'claude', 0, 900, 0.000141, array['chamar_humano'], '{"marcou": 0, "remarcou": 0, "cancelou": 0, "chamou": 1}', true, false);
  perform public.registrar_chamada_ia(salao, 'ensaio', 'claude-haiku-5-5', 200, 20, 700, null, null, 'claude', 0, 0, 0.0001, null, '{"marcou": 5}', true, true);
  perform public.registrar_chamada_ia(salao, fone, null, null, null, 10, 'Claude 529: overloaded', null, 'claude');
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.assistente_numeros(salao, 30);
  if (r ->> 'conversas')::int <> 2 or (r ->> 'marcou')::int <> 1 or (r ->> 'chamou')::int <> 1 or (r ->> 'falhas')::int <> 1
     or (r ->> 'custo_usd')::numeric <> 0.000313 or jsonb_array_length(r -> 'por_dia') <> 1 then raise exception 'I: %', r; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'I números (sem o teste da dona): %', r - 'por_dia';

  -- L. a fila (236): quem tem número próprio leva a reserva (a instância da MIMO); quem não tem, não sai sozinho
  insert into public.config_publica (chave, valor) values ('whatsapp_instancia_casa', 'mimo') on conflict (chave) do update set valor = excluded.valor;
  perform public.assistente_numero_conectado(salao, inst, null);
  update public.message_outbox set status = 'cancelado' where status = 'na_fila';
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, status, liberado_em) values (salao, e164, 'lembrete_agendamento', 'Seu horário é amanhã', 'evolution', 'na_fila', now() - interval '1 minute');
  update public.whatsapp_channels set canal = 'manual', identificador = null, numero_proprio = false where salon_id = outro;
  insert into public.message_outbox (salon_id, telefone, kind, corpo, canal, status, liberado_em) values (outro, e164, 'lembrete_agendamento', 'Seu horário é amanhã', 'manual', 'na_fila', now() - interval '1 minute');
  select count(*) into n from public.puxar_da_fila(10) f where f.salon_id = salao and f.identificador = inst and f.reserva = 'mimo';
  if n <> 1 then raise exception 'L: %', n; end if;
  if exists (select 1 from public.message_outbox where salon_id = outro and status = 'enviando') then raise exception 'L2: o manual saiu sozinho'; end if;
  raise notice 'L fila: o do salão com a reserva da MIMO; o manual fica';

  -- J. desconectar volta para o manual e desliga a assistente
  perform public.assistente_esperar(salao, fone, inst, 'oi', now() + interval '10 minutes');
  perform public.assistente_numero_desligado(salao);
  if not (select not numero_proprio and identificador is null and canal = 'manual' and not usa_ia from public.whatsapp_channels where salon_id = salao)
     or exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'J'; end if;
  raise notice 'J desconectado: canal manual, assistente desligada';

  -- K. o agente desligado na Plataforma
  perform public.assistente_numero_conectado(salao, inst, null);
  update public.whatsapp_channels set usa_ia = true where salon_id = salao;
  update public.config_publica set valor = 'desligado' where chave = 'ia_agente';
  if not found then insert into public.config_publica (chave, valor) values ('ia_agente', 'desligado'); end if;
  ctx := public.bot_contexto(salao, fone);
  if ctx ->> 'motivo' <> 'agente_desligado' then raise exception 'K: %', ctx; end if;
  raise notice 'K agente desligado na Plataforma: nada responde';

  -- M. a chave desligada desliga tudo (237): conversa solta não recebe nada; o SAIR e o 1/2 do lembrete continuam
  update public.config_publica set valor = 'ligado' where chave = 'ia_agente';
  update public.whatsapp_channels set usa_ia = false, usa_bot = true where salon_id = salao;
  r := public.receber_mensagem(fone, 'oi, tem horário amanhã?', 'ens-m1', null, null, salao);
  if r ->> 'acao' <> 'assistente_desligada' or r ? 'responder' then raise exception 'M: %', r; end if;
  if (select acao from public.whatsapp_inbox where provider_id = 'ens-m1') <> 'assistente_desligada' then raise exception 'M2: não registrou'; end if;
  r := public.receber_mensagem(fone, 'quero marcar', 'ens-m2', null, 'quer_agendar', salao);
  if r ->> 'acao' <> 'assistente_desligada' then raise exception 'M3 (menu de marcar com a chave desligada): %', r; end if;
  r := public.receber_mensagem(fone, '1', 'ens-m3', null, null, salao);
  if r ? 'responder' and r ->> 'acao' not in ('confirmado', 'cancelado', 'remarcado') then raise exception 'M4 (1 sem lembrete respondeu): %', r; end if;
  r := public.receber_mensagem(fone, 'sair', 'ens-m4', null, null, salao);
  if r ->> 'acao' <> 'sair' or not (r ? 'responder') then raise exception 'M5 (SAIR vale sempre): %', r; end if;
  -- ligada: a conversa solta volta a seguir o caminho de sempre
  update public.whatsapp_channels set usa_ia = true where salon_id = salao;
  update public.profiles set accepts_reminders = true where id = cli;
  r := public.receber_mensagem(fone, 'oi, tem horário amanhã?', 'ens-m5', null, null, salao);
  if r ->> 'acao' = 'assistente_desligada' then raise exception 'M6: %', r; end if;
  -- sem o WhatsApp do salão conectado conta como desligada
  update public.whatsapp_channels set numero_proprio = false where salon_id = salao;
  r := public.receber_mensagem(fone, 'oi de novo', 'ens-m6', null, null, salao);
  if r ->> 'acao' <> 'assistente_desligada' then raise exception 'M7: %', r; end if;
  raise notice 'M chave desligada: conversa solta só registrada; SAIR e 1/2 do lembrete continuam';

  -- N. o teste marca como marcaria de verdade (238): pedido pendente ou confirmado pela regra, sem gravar nada
  declare prof uuid; serv uuid; d date; h time; livres jsonb; antes integer;
  begin
    select p.id into prof from public.professionals p where p.slug = 'ana-paula';
    select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
    d := (now() at time zone 'America/Sao_Paulo')::date + 1;
    for i in 0..6 loop
      livres := public.bot_horarios(salao, prof, d + i, serv);
      exit when jsonb_array_length(livres -> 'horarios') > 0;
    end loop;
    d := (livres ->> 'dia')::date; h := (livres -> 'horarios' ->> 0)::time;
    select count(*) into antes from public.appointments;
    update public.professionals set aceite_manual = true where id = prof;
    r := public.bot_marcar_simular(salao, prof, serv, d, h);
    if r ->> 'status' <> 'pendente' or not (r ->> 'ok')::boolean then raise exception 'N: %', r; end if;
    update public.professionals set aceite_manual = false where id = prof;
    r := public.bot_marcar_simular(salao, prof, serv, d, h);
    if r ->> 'status' <> 'confirmado' or r ->> 'aviso' <> 'já está confirmado' then raise exception 'N2: %', r; end if;
    if (select count(*) from public.appointments) <> antes then raise exception 'N3: o teste gravou um horário'; end if;
    r := public.bot_marcar_simular(salao, prof, serv, d, '03:17');
    if r ->> 'erro' is null then raise exception 'N4: horário fora aceito %', r; end if;
    perform set_config('request.jwt.claim.sub', dona::text, true);
    r := public.assistente_do_salao(salao);
    perform set_config('request.jwt.claim.sub', '', true);
    if r -> 'aceite' ->> 'modo' is null then raise exception 'N5: %', r -> 'aceite'; end if;
    raise notice 'N teste: pendente/confirmado como de verdade, sem gravar; regra do salão na tela (%)', r -> 'aceite' ->> 'modo';
  end;

  -- O. encerrar a conversa (239): pausa de 6 h (fora do assunto) ou 24 h (ofensiva); nada responde, nada gasta
  perform public.assistente_numero_conectado(salao, inst, null);
  update public.whatsapp_channels set usa_ia = true where salon_id = salao;
  delete from public.bot_pausas where telefone = e164;
  perform public.assistente_esperar(salao, fone, inst, 'oi', now() + interval '10 minutes');
  r := public.bot_encerrar(salao, fone, 'fora_do_assunto');
  if not (r ->> 'ok')::boolean or (r ->> 'ate')::timestamptz > now() + interval '6 hours 1 minute' or (r ->> 'ate')::timestamptz < now() + interval '5 hours 59 minutes'
     or exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'O: %', r; end if;
  r := public.bot_encerrar(salao, fone, 'ofensiva');
  if (r ->> 'ate')::timestamptz < now() + interval '23 hours 59 minutes' then raise exception 'O2: %', r; end if;
  r := public.bot_encerrar(salao, fone, 'fora_do_assunto');   -- não encurta a pausa que já existe
  if (select ate from public.bot_pausas where telefone = e164 and salon_id = salao) < now() + interval '23 hours' then raise exception 'O3'; end if;
  ctx := public.bot_contexto(salao, fone, inst);
  if ctx ->> 'motivo' <> 'pausado_para_humano' then raise exception 'O4: %', ctx; end if;
  r := public.receber_mensagem(fone, 'responde aí sua inútil', 'ens-o1', null, null, salao);
  if r ->> 'acao' <> 'conversa_encerrada' or r ? 'responder' then raise exception 'O5: %', r; end if;
  r := public.receber_mensagem(fone, 'sair', 'ens-o2', null, null, salao);
  if r ->> 'acao' <> 'sair' then raise exception 'O6 (SAIR vale mesmo encerrada): %', r; end if;
  -- a pausa do "chamar alguém" (2 h) não é encerramento: as regras seguem
  update public.profiles set accepts_reminders = true where id = cli;
  update public.bot_pausas set motivo = 'quer falar com uma pessoa' where telefone = e164;
  r := public.receber_mensagem(fone, 'oi de novo', 'ens-o3', null, null, salao);
  if r ->> 'acao' = 'conversa_encerrada' then raise exception 'O7: %', r; end if;
  delete from public.ia_chamadas where salon_id = salao;
  perform public.registrar_chamada_ia(salao, fone, 'claude-haiku-5-5', 100, 10, 500, null, null, 'claude', 0, 0, 0.0001, array['encerrar_conversa'], '{"encerrou": 1}', true, false);
  perform set_config('request.jwt.claim.sub', dona::text, true);
  r := public.assistente_numeros(salao, 30);
  perform set_config('request.jwt.claim.sub', '', true);
  if (r ->> 'encerrou')::int <> 1 then raise exception 'O8: %', r; end if;
  raise notice 'O encerrar: pausa 6 h/24 h, silêncio sem gastar, SAIR vale, conta nos números';

  -- P. o diagnóstico técnico (240): a dona e a Plataforma veem; outra pessoa não
  declare plat uuid; n_dona integer; n_plat integer; n_outro integer;
  begin
    select id into plat from public.profiles where role = 'plataforma' limit 1;
    if plat is null then
      insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a0', 'plat-ensaio@exemplo.com') on conflict do nothing;
      insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000a0', 'Plataforma Ensaio', 'plataforma')
      on conflict (id) do update set role = 'plataforma';
      plat := '00000000-0000-0000-0000-0000000000a0';
    end if;
    perform set_config('request.jwt.claim.sub', dona::text, true);
    select count(*) into n_dona from public.diagnostico_whatsapp(salao);
    perform set_config('request.jwt.claim.sub', plat::text, true);
    select count(*) into n_plat from public.diagnostico_whatsapp(salao);
    perform count(*) from public.fila_do_salao(salao, 5);
    perform count(*) from public.leituras_recentes(salao, 5);
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
    select count(*) into n_outro from public.diagnostico_whatsapp(salao);
    perform set_config('request.jwt.claim.sub', '', true);
    if n_dona = 0 or n_plat <> n_dona or n_outro <> 0 then raise exception 'P: dona %, plataforma %, outro %', n_dona, n_plat, n_outro; end if;
    raise notice 'P diagnóstico: a dona e a Plataforma veem (% itens), outra pessoa não', n_plat;
  end;

  -- Q. os horários do dia inteiro (241): das 8h às 18h, um serviço de 90 minutos vai até 16h30 (antes parava em 14h30)
  declare prof uuid; serv uuid; d date; livres jsonb;
  begin
    select p.id into prof from public.professionals p where p.slug = 'ana-paula';
    select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
    d := (now() at time zone 'America/Sao_Paulo')::date + 40;
    delete from public.professional_hours where professional_id = prof and weekday = extract(dow from d);
    insert into public.professional_hours (professional_id, weekday, start_time, end_time, open) values (prof, extract(dow from d), '08:00', '18:00', true);
    update public.services set duration_minutes = 90 where id = serv;
    delete from public.appointments where professional_id = prof and date = d;
    livres := public.bot_horarios(salao, prof, d, serv);
    if (livres ->> 'total')::integer <> 18 or livres ->> 'primeiro' <> '08:00' or livres ->> 'ultimo' <> '16:30'
       or jsonb_array_length(livres -> 'horarios') <> 18 or livres -> 'horarios' ->> 17 <> '16:30' then
      raise exception 'Q: %', livres;
    end if;
    raise notice 'Q horários: % livres, das % às % (serviço de 90 min, 8h às 18h)', livres ->> 'total', livres ->> 'primeiro', livres ->> 'ultimo';
  end;

  raise notice 'ensaio_assistente: tudo certo';
end $$;
rollback;
