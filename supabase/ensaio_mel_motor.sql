-- Ensaio da 140: os fatos da Mel, ações e conciliação. Desfaz no fim.
begin;
do $$
declare
  sid uuid; dona uuid; prof uuid; prof2 uuid; cli uuid; cli2 uuid; serv uuid;
  hoje date := public.agora_local()::date; agora time := public.agora_local()::time;
  c jsonb; r jsonb; n integer; ex uuid; ap1 uuid; ap2 uuid; ap3 uuid; t text;
  h time;
begin
  -- um salão com dona, duas profissionais, serviço e clientes
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  select p.id into prof from public.professionals p where p.salon_id = sid and p.active order by p.created_at limit 1;
  select p.id into prof2 from public.professionals p where p.salon_id = sid and p.active and p.id <> prof order by p.created_at limit 1;
  select sv.id into serv from public.services sv where sv.salon_id = sid limit 1;
  select pr.id into cli from public.profiles pr where pr.role = 'cliente' order by pr.created_at limit 1;
  select pr.id into cli2 from public.profiles pr where pr.role = 'cliente' and pr.id <> cli order by pr.created_at limit 1;
  if sid is null or prof is null or cli is null then raise exception 'base de teste sem salão/profissional/cliente'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  delete from public.mel_exibicoes where salon_id = sid;
  delete from public.appointments where salon_id = sid and date in (hoje, hoje + 1);
  update public.profiles set accepts_reminders = true where id in (cli, cli2);

  -- expediente das 8h às 22h hoje e amanhã (para o ensaio não depender da hora)
  delete from public.professional_hours where professional_id in (prof, prof2);
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time)
  select p, w, true, '08:00', '22:00' from unnest(array[prof, prof2]) p, generate_series(0, 6) w where p is not null;
  update public.salons set lat = -23.96, lng = -46.33, city = 'Santos', uf = 'SP', ramo = null, aceite_modo = 'casa' where id = sid;

  -- 1. ramo deduzido e escolhido
  t := public.ramo_do_salao(sid);
  if t is null then raise exception '1: ramo nulo'; end if;
  r := public.salao_definir_ramo(sid, 'barbearia');
  if r ->> 'ramo' <> 'barbearia' then raise exception '1b: %', r; end if;
  perform public.salao_definir_ramo(sid, null);
  raise notice '1 ramo: deduzido=% / escolhido ok', t;

  -- 2. calendário
  if public.feriado_em('2026-04-21'::date, sid) <> 'Tiradentes' then raise exception '2: tiradentes'; end if;
  if public.feriado_em('2026-04-03'::date, sid) <> 'Sexta-feira Santa' then raise exception '2b: sexta santa'; end if;
  if public.feriado_em('2026-04-22'::date, sid) is not null then raise exception '2c: dia comum'; end if;
  insert into public.feriados_locais (data, nome, uf, cidade) values ('2026-01-26', 'Aniversário de Santos', 'SP', 'santos');
  if public.feriado_em('2026-01-26'::date, sid) <> 'Aniversário de Santos' then raise exception '2d: municipal'; end if;
  update public.salons set city = 'São Vicente' where id = sid;
  if public.feriado_em('2026-01-26'::date, sid) is not null then raise exception '2e: cidade errada pegou feriado'; end if;
  update public.salons set city = 'Santos' where id = sid;
  if (public.proxima_data_comercial('2026-05-01'::date) ->> 'nome') <> 'Dia das Mães' then raise exception '2f: %', public.proxima_data_comercial('2026-05-01'::date); end if;
  raise notice '2 calendário: nacional, municipal e datas comerciais';

  -- 3. agenda de hoje: uma concluída, uma em 30 min, uma às 20h, uma pendente, uma cancelada agora
  insert into public.appointments (salon_id, professional_id, client_id, service_id, date, start_time, end_time, status, price_cents)
  values (sid, prof, cli, serv, hoje, '08:00', '09:00', 'concluido', 8000) returning id into ap1;
  h := (agora + interval '30 minutes')::time;
  if h > '20:30' then h := '08:30'; end if;
  insert into public.appointments (salon_id, professional_id, client_id, service_id, date, start_time, end_time, status, price_cents)
  values (sid, prof, cli2, serv, hoje, h, (h + interval '60 minutes')::time, 'confirmado', 9000) returning id into ap2;
  insert into public.appointments (salon_id, professional_id, client_id, service_id, date, start_time, end_time, status, price_cents)
  values (sid, prof, cli, serv, hoje, '21:00', '22:00', 'confirmado', 7000) returning id into ap3;
  -- o pedido pendente é da cliente (a casa marcando já entra confirmado)
  perform set_config('request.jwt.claim.sub', cli2::text, true);
  insert into public.appointments (salon_id, professional_id, client_id, service_id, date, start_time, end_time, status, price_cents)
  values (sid, prof, cli2, serv, hoje + 1, '10:00', '11:00', 'pendente', 5000);
  perform set_config('request.jwt.claim.sub', dona::text, true);
  insert into public.appointments (salon_id, professional_id, client_id, service_id, date, start_time, end_time, status, price_cents, cancelado_em, cancelado_por)
  values (sid, prof, cli, serv, hoje + 1, '15:00', '16:00', 'cancelado', 5000, now() - interval '10 minutes', cli::text);

  c := public.mel_contexto(sid);
  if (c -> 'pessoa' ->> 'dona')::boolean is not true then raise exception '3: dona'; end if;
  if (c -> 'hoje' ->> 'total')::int <> 3 then raise exception '3b: total %', c -> 'hoje'; end if;
  if (c -> 'hoje' ->> 'concluidos')::int <> 1 or (c -> 'hoje' ->> 'faturamento_cents')::int <= 0 then raise exception '3c: %', c -> 'hoje'; end if;
  if c -> 'hoje' -> 'primeira' ->> 'hora' is null then raise exception '3d: primeira'; end if;
  if c -> 'hoje' -> 'ultima' ->> 'hora' <> '21:00' then raise exception '3e: ultima %', c -> 'hoje' -> 'ultima'; end if;
  if (c -> 'hoje' ->> 'ocupacao_pct') is null then raise exception '3f: ocupação'; end if;
  if (c -> 'hoje' ->> 'abre')::boolean is not true or c -> 'hoje' ->> 'abertura' <> '08:00' then raise exception '3g: expediente %', c -> 'hoje'; end if;
  if jsonb_array_length(c -> 'hoje' -> 'pendentes_lista') <> 1 then raise exception '3h: pendentes %', c -> 'hoje' -> 'pendentes_lista'; end if;
  if jsonb_array_length(c -> 'hoje' -> 'cancelados_recentes') <> 1 or (c -> 'hoje' -> 'cancelados_recentes' -> 0 ->> 'pela_casa')::boolean then raise exception '3i: cancelados %', c -> 'hoje' -> 'cancelados_recentes'; end if;
  if (c -> 'amanha' ->> 'total')::int <> 1 or (c -> 'amanha' ->> 'abre')::boolean is not true then raise exception '3j: amanhã %', c -> 'amanha'; end if;
  if c -> 'calendario' -> 'data_comercial' ->> 'nome' is null then raise exception '3k: data comercial'; end if;
  if (c -> 'historico' ->> 'primeira_vez')::boolean is not true then raise exception '3l: primeira vez'; end if;
  if c -> 'salao' ->> 'ramo' is null or c -> 'agora' ->> 'periodo' is null then raise exception '3m: salão/agora'; end if;
  raise notice '3 contexto: % hoje (próxima % em % min), % vagas, ocupação %%%', c -> 'hoje' ->> 'total', c -> 'hoje' -> 'proxima' ->> 'hora', c -> 'hoje' -> 'proxima' ->> 'minutos_ate', jsonb_array_length(c -> 'hoje' -> 'vagas'), c -> 'hoje' ->> 'ocupacao_pct';

  -- 4. vagas: com expediente até 22h e poucos horários, tem buraco de 1h+
  if jsonb_array_length(public.mel_vagas(sid, hoje + 2, null)) = 0 then raise exception '4: sem vaga depois de amanhã'; end if;
  if (public.mel_vagas(sid, hoje + 2, null) -> 0 ->> 'minutos')::int < 60 then raise exception '4b: bloco curto'; end if;
  raise notice '4 vagas: % blocos depois de amanhã, primeiro %', jsonb_array_length(public.mel_vagas(sid, hoje + 2, null)), public.mel_vagas(sid, hoje + 2, null) -> 0;

  -- 5. perspectiva: a profissional 2 (sem user) não entra; quem não é da casa não lê
  perform set_config('request.jwt.claim.sub', cli::text, true);
  begin
    c := public.mel_contexto(sid); raise exception '5: cliente leu o contexto';
  exception when raise_exception then if sqlerrm like '%5:%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  raise notice '5 perspectiva: cliente não lê';

  -- 6. exibição + marcar + pedir confirmação
  insert into public.mel_exibicoes (salon_id, user_id, chave, identidade, superficie, texto_template_snapshot, acao)
  values (sid, dona, 'chuva_antes_dos_horarios', hoje || '18', 'mel_bubble', 'Chuva às {hora_chuva}.', jsonb_build_object('type', 'PEDIR_CONFIRMACAO', 'payload', jsonb_build_object('dia', hoje))) returning id into ex;
  r := public.mel_marcar(ex, 'clicada');
  if (r ->> 'ok')::boolean is not true then raise exception '6: %', r; end if;
  r := public.mel_pedir_confirmacao(sid, hoje, null, ex);
  if (r ->> 'enviadas')::int <> 2 then raise exception '6b: %', r; end if;
  if (select count(*) from public.appointments where id in (ap2, ap3) and reminder_sent_at is not null) <> 2 then raise exception '6c: lembrete não marcado'; end if;
  if (select concluida_por from public.mel_exibicoes where id = ex) <> 'pedir_confirmacao' then raise exception '6d: não concluiu'; end if;
  r := public.mel_pedir_confirmacao(sid, hoje, null, null);
  if (r ->> 'enviadas')::int <> 0 then raise exception '6e: mandou de novo'; end if;
  c := public.mel_contexto(sid);
  if (c -> 'hoje' ->> 'sem_lembrete')::int <> 0 then raise exception '6f: sem_lembrete %', c -> 'hoje' ->> 'sem_lembrete'; end if;
  if (c -> 'historico' ->> 'primeira_vez')::boolean then raise exception '6g: ainda primeira vez'; end if;
  if jsonb_array_length(c -> 'historico' -> 'recentes') <> 1 then raise exception '6h: recentes'; end if;
  raise notice '6 ação: pediu confirmação de 2 e concluiu pela operação';

  -- 7. conciliação: VER_PEDIDOS concluída quando o pedido some; CRIAR_PROMOCAO quando a promoção nasce
  insert into public.mel_exibicoes (salon_id, user_id, chave, identidade, superficie, acao, clicada_em)
  values (sid, dona, 'pedido_esperando_aceite', 'x', 'mel_bubble', jsonb_build_object('type', 'VER_PEDIDOS', 'payload', jsonb_build_object('ids', (select jsonb_agg(id) from public.appointments where salon_id = sid and status = 'pendente'))), now() - interval '5 minutes') returning id into ex;
  n := public.mel_conciliar();
  if (select concluida_em from public.mel_exibicoes where id = ex) is not null then raise exception '7: concluiu cedo'; end if;
  update public.appointments set status = 'confirmado' where salon_id = sid and status = 'pendente';
  n := public.mel_conciliar();
  if (select concluida_por from public.mel_exibicoes where id = ex) <> 'pedidos_respondidos' then raise exception '7b: não conciliou'; end if;
  insert into public.mel_exibicoes (salon_id, user_id, chave, identidade, superficie, acao, clicada_em)
  values (sid, dona, 'semana_fraca', 'x', 'mel_bubble', jsonb_build_object('type', 'CRIAR_PROMOCAO', 'payload', '{}'::jsonb), now() - interval '5 minutes') returning id into ex;
  insert into public.promocoes (salon_id, titulo, texto, imagem_url, inicio, ativa) values (sid, 'Semana da escova', 'x', 'https://x/y.png', hoje, true);
  n := public.mel_conciliar();
  if (select concluida_por from public.mel_exibicoes where id = ex) <> 'promocao_criada' then raise exception '7c: promoção'; end if;
  raise notice '7 conciliação: pedidos respondidos e promoção criada';

  -- 8. ofertar vaga pela Mel: sem lista de espera devolve ok=false e não conclui
  insert into public.mel_exibicoes (salon_id, user_id, chave, identidade, superficie, acao)
  values (sid, dona, 'vaga_hoje', 'x', 'mel_bubble', jsonb_build_object('type', 'OFERTAR_VAGA_LISTA', 'payload', '{}'::jsonb)) returning id into ex;
  delete from public.waitlist_entries where professional_id = prof;
  r := public.mel_ofertar_vaga(prof, hoje + 2, '10:00', '11:00', ex);
  if (r ->> 'ok')::boolean then raise exception '8: ofertou sem ninguém na espera'; end if;
  if (select concluida_em from public.mel_exibicoes where id = ex) is not null then raise exception '8b: concluiu sem oferta'; end if;
  raise notice '8 ofertar vaga: sem lista, não conclui';

  raise notice 'ensaio da 140 ok';
end $$;
rollback;
