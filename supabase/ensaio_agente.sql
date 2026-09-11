begin;
do $$
declare salao uuid; prof uuid; serv uuid; cli uuid; fone text; ctx jsonb; r jsonb; dia date; hora time; appt uuid;
begin
  select p.salon_id, p.id into salao, prof from public.professionals p where p.slug = 'ana-paula';
  select ps.service_id into serv from public.professional_services ps where ps.professional_id = prof limit 1;
  select p.id, p.phone into cli, fone from public.profiles p where p.role = 'cliente' and p.phone is not null limit 1;
  insert into public.whatsapp_channels (salon_id, canal, identificador, ativo, usa_ia, usa_bot) values (salao, 'evolution', 'mimo', true, true, true)
  on conflict (salon_id) do update set canal = 'evolution', identificador = 'mimo', ativo = true, usa_ia = true;

  ctx := public.bot_contexto(salao, fone);
  raise notice '1 contexto: permitido=% modelo=% cliente=% agora=%', ctx ->> 'permitido', ctx ->> 'modelo', ctx -> 'cliente' ->> 'primeiro_nome', ctx -> 'agora' ->> 'texto';
  if (ctx ->> 'permitido') <> 'true' then raise exception 'contexto negado: %', ctx ->> 'motivo'; end if;
  if length(ctx ->> 'orientacao') < 200 then raise exception 'orientação vazia'; end if;

  r := public.bot_servicos(salao);
  raise notice '2 serviços: % (primeiro: %)', jsonb_array_length(r), r -> 0 ->> 'nome';
  raise notice '3 profissionais: %', jsonb_array_length(public.bot_profissionais(salao));

  dia := (now() at time zone 'America/Sao_Paulo')::date + 1;
  for i in 0..6 loop
    r := public.bot_horarios(salao, prof, dia + i, serv);
    exit when jsonb_array_length(r -> 'horarios') > 0;
  end loop;
  raise notice '4 horários em %: %', r ->> 'dia', r -> 'horarios';
  if jsonb_array_length(r -> 'horarios') = 0 then raise exception 'sem horário livre em 7 dias'; end if;
  dia := (r ->> 'dia')::date; hora := (r -> 'horarios' ->> 0)::time;

  r := public.bot_marcar(salao, cli, prof, serv, dia, hora);
  raise notice '5 marcar: %', r;
  if (r ->> 'ok') is distinct from 'true' then raise exception 'marcar falhou'; end if;
  appt := (r ->> 'appointment_id')::uuid;

  r := public.bot_marcar(salao, cli, prof, serv, dia, hora);
  raise notice '6 marcar de novo no mesmo horário: %', r ->> 'erro';
  if (r ->> 'erro') is null then raise exception 'deveria recusar horário ocupado'; end if;

  ctx := public.bot_contexto(salao, fone);
  raise notice '7 próximos no contexto: %', jsonb_array_length(ctx -> 'proximos');

  r := public.bot_cancelar(salao, cli, appt);
  raise notice '8 cancelar: %', r;
  if (r ->> 'ok') is distinct from 'true' then raise exception 'cancelar falhou'; end if;

  r := public.bot_chamar_humano(salao, fone, 'quer falar sobre alergia a esmalte');
  raise notice '9 humano: %', r;
  ctx := public.bot_contexto(salao, fone);
  if (ctx ->> 'motivo') is distinct from 'pausado_para_humano' then raise exception 'deveria estar pausado, veio %', ctx; end if;
  raise notice '10 pausado (ok)';

  perform public.bot_registrar_resposta(salao, fone, 'Oi! Sou o teste.', 'prov-x', 'evolution');
  delete from public.bot_pausas where telefone = public.telefone_e164(fone);
  ctx := public.bot_contexto(salao, fone);
  raise notice '11 histórico: % itens; último: %', jsonb_array_length(ctx -> 'historico'), ctx -> 'historico' -> -1 ->> 'texto';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
