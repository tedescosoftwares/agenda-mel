-- Ensaio dos modelos de mensagem (068). Roda no banco de teste e desfaz.
begin;
do $$
declare
  appt uuid; prof uuid; cli uuid; salao uuid; antes text; depois text; r jsonb; fone text; plat uuid;
begin
  select a.id, a.professional_id, a.client_id into appt, prof, cli
    from public.appointments a where a.status in ('pendente','confirmado') order by a.date desc limit 1;
  select p.salon_id into salao from public.professionals p where p.id = prof;
  if appt is null then raise exception 'sem agendamento de teste'; end if;

  -- 1. sem edição, sai o padrão de sempre
  antes := public.montar_texto_whatsapp('lembrete_agendamento', null, null, appt, prof, cli);
  if antes = public.montar_texto_padrao('lembrete_agendamento', null, null, appt, prof, cli) then
    raise notice '1 sem edição = padrão do código (ok)';
  else raise exception 'sem edição deveria ser o padrão'; end if;

  -- 2. plataforma edita o lembrete
  select id into plat from public.profiles where role = 'cliente' limit 1;
  update public.profiles set role = 'plataforma' where id = plat;
  perform set_config('request.jwt.claim.sub', plat::text, false);
  perform public.plataforma_salvar_modelo('lembrete_agendamento', E'Oi, {nome}! Amanhã: {servico} com {profissional}, {quando}.\nLink: {link}\nResponda 1 ou 2.');
  depois := public.montar_texto_whatsapp('lembrete_agendamento', null, null, appt, prof, cli);
  raise notice '2 editado: %', replace(depois, E'\n', ' | ');
  if depois like '%{%' then raise exception 'sobrou variável sem trocar'; end if;

  -- 3. restaurar
  perform public.plataforma_salvar_modelo('lembrete_agendamento', null);
  if public.montar_texto_whatsapp('lembrete_agendamento', null, null, appt, prof, cli) <> antes then raise exception 'restaurar falhou'; end if;
  raise notice '3 restaurado (ok)';

  -- 4. igual ao padrão volta a null
  perform public.plataforma_salvar_modelo('resposta.sair', (select padrao from public.modelos_de_mensagem where chave = 'resposta.sair'));
  if (select texto from public.modelos_de_mensagem where chave = 'resposta.sair') is not null then raise exception 'igual ao padrão deveria virar null'; end if;
  raise notice '4 igual ao padrão = null (ok)';

  -- 5. resposta do bot editada
  perform public.plataforma_salvar_modelo('resposta.confirmado', 'Show, {quando}! Até lá 💛');
  if public.texto_resposta('confirmado', '12/09 às 14:00', 'Ana') <> 'Show, 12/09 às 14:00! Até lá 💛' then raise exception 'resposta editada não saiu'; end if;
  raise notice '5 resposta editada (ok)';

  -- 6. linha com variável vazia some
  depois := public.renderizar_modelo(E'Oi, {nome}!\n🔗 {link}\nTchau', jsonb_build_object('nome', 'Ju'));
  if depois <> E'Oi, Ju!\nTchau' then raise exception 'linha vazia deveria sumir: %', depois; end if;
  depois := public.renderizar_modelo('Oi, {nome}! Beleza?', '{}'::jsonb);
  if depois <> 'Oi! Beleza?' then raise exception 'nome vazio deveria sumir de leve: %', depois; end if;
  raise notice '6 render (ok)';

  -- 7. palavra nova do bot
  perform public.plataforma_salvar_palavras('confirma', array['1','sim','pode ser','fechou']);
  if public.interpretar_resposta('Pode ser!') <> 'confirma' then raise exception 'palavra nova não pegou'; end if;
  if public.interpretar_resposta('2') <> 'cancela' then raise exception 'padrão do cancela sumiu'; end if;
  raise notice '7 palavras (ok)';

  -- 8. o silêncio vira resposta
  select public.telefone_e164(p.phone) into fone from public.profiles p where p.id = cli;
  r := public.receber_mensagem(fone, 'blablabla ' || clock_timestamp()::text, 'prov-' || gen_random_uuid()::text, null, null, salao);
  raise notice '8a sem modelo: acao=% responder=%', r ->> 'acao', r ->> 'responder';
  perform public.plataforma_salvar_modelo('bot.nao_entendi', 'Oi, {nome}! Pra marcar é pelo app: {link_app}');
  r := public.receber_mensagem(fone, 'blablabla2 ' || clock_timestamp()::text, 'prov-' || gen_random_uuid()::text, null, null, salao);
  raise notice '8b com modelo: acao=% responder=%', r ->> 'acao', r ->> 'responder';
  if (r ->> 'acao') in ('nada', 'sem_cadastro') and (r ->> 'responder') is null then raise exception 'silêncio deveria virar resposta'; end if;

  -- 9. prévia
  raise notice '9 prévia: %', replace(public.plataforma_previa((select padrao from public.modelos_de_mensagem where chave = 'vaga_disponivel')), E'\n', ' | ');
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
