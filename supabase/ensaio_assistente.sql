-- Ensaio da 235 (3.95): a assistente do WhatsApp do salão. Desfaz no fim.
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
  r := public.assistente_salvar(salao, '{"nome": "  Bia  ", "tom": "profissional", "emojis": "nenhum", "pode_cancelar": false, "recado": "Atraso de 15 min perde o horário.", "ligada": true}');
  if r -> 'config' ->> 'nome' <> 'Bia' or r -> 'config' ->> 'emojis' <> 'nenhum' or (r -> 'config' ->> 'pode_cancelar')::boolean
     or r ->> 'recado' <> 'Atraso de 15 min perde o horário.' or not (r ->> 'ligada')::boolean then raise exception 'A2: %', r; end if;
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

  -- B. o contexto no número da casa: a Mel, sem espera, com o horário do salão
  ctx := public.bot_contexto(salao, fone);
  if (ctx ->> 'permitido') <> 'true' or (ctx ->> 'numero_proprio')::boolean or ctx -> 'assistente' ->> 'tom' <> 'profissional'
     or ctx ->> 'provedor' <> 'claude' or ctx ->> 'modelo_claude' <> 'claude-haiku-5-5' or ctx ->> 'orientacao_salao' is null then raise exception 'B: %', ctx; end if;
  if ctx -> 'salao' ->> 'horario' is null then raise exception 'B2: sem horário %', ctx -> 'salao'; end if;
  raise notice 'B número da casa: % · %', ctx -> 'salao' ->> 'horario', ctx ->> 'provedor';

  -- C. o número próprio e "quando responde"
  perform public.assistente_numero_conectado(salao, inst, '+55 (13) 99999-0000');
  if not (select numero_proprio and identificador = inst and canal = 'evolution' from public.whatsapp_channels where salon_id = salao) then raise exception 'C'; end if;
  ctx := public.bot_contexto(salao, fone, inst);
  if not (ctx ->> 'numero_proprio')::boolean then raise exception 'C2: %', ctx; end if;
  ctx := public.bot_contexto(salao, fone, 'mimo');
  if (ctx ->> 'numero_proprio')::boolean then raise exception 'C3: por outra instância não é o número próprio'; end if;
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

  -- H. salão novo nasce no número da casa
  insert into public.salons (name, slug, tipo) values ('Salão do Ensaio 235', 'salao-do-ensaio-235', 'salao') returning id into novo;
  if not exists (select 1 from public.whatsapp_channels where salon_id = novo and canal = 'evolution' and identificador = 'mimo' and not numero_proprio) then
    raise exception 'H: %', (select to_jsonb(c) from public.whatsapp_channels c where c.salon_id = novo);
  end if;
  raise notice 'H salão novo no número da casa (%)', public.instancia_da_casa();

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

  -- J. desconectar volta para o número da casa
  perform public.assistente_numero_conectado(salao, inst, null);
  perform public.assistente_esperar(salao, fone, inst, 'oi', now() + interval '10 minutes');
  perform public.assistente_numero_desligado(salao);
  if not (select not numero_proprio and identificador = 'mimo' and canal = 'evolution' from public.whatsapp_channels where salon_id = salao)
     or exists (select 1 from public.assistente_esperas where salon_id = salao) then raise exception 'J'; end if;
  raise notice 'J desconectado: de volta ao número da casa';

  -- K. o agente desligado na Plataforma
  update public.config_publica set valor = 'desligado' where chave = 'ia_agente';
  if not found then insert into public.config_publica (chave, valor) values ('ia_agente', 'desligado'); end if;
  ctx := public.bot_contexto(salao, fone);
  if ctx ->> 'motivo' <> 'agente_desligado' then raise exception 'K: %', ctx; end if;
  raise notice 'K agente desligado na Plataforma: nada responde';

  raise notice 'ensaio_assistente: tudo certo';
end $$;
rollback;
