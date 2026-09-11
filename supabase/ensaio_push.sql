-- Ensaio dos modelos de push (072). Roda no banco de teste e desfaz.
begin;
do $$
declare plat uuid; cli uuid; appt uuid; prof uuid; nid uuid; n record; r jsonb; previa text;
begin
  select a.id, a.client_id, a.professional_id into appt, cli, prof
    from public.appointments a where a.status in ('pendente','confirmado') order by a.date desc limit 1;
  if appt is null then raise exception 'sem agendamento de teste'; end if;
  select id into plat from public.profiles where role = 'cliente' and id <> cli limit 1;
  update public.profiles set role = 'plataforma' where id = plat;
  perform set_config('request.jwt.claim.sub', plat::text, false);

  -- 1. sem edição, o aviso sai como o código escreveu
  nid := public.notificar(cli, 'agendamento_confirmado', 'Horário confirmado', 'Manicure com Ana dia 12/09 às 14:00.', '/', jsonb_build_object('appointment_id', appt, 'professional_id', prof));
  select * into n from public.notifications where id = nid;
  if n.title <> 'Horário confirmado' or n.push_em is not null then raise exception 'sem edição devia ficar igual: % %', n.title, n.push_em; end if;
  raise notice '1 sem edição (ok)';

  -- 2. plataforma reescreve o push com variáveis do horário e o nome
  perform public.plataforma_salvar_modelo('push.agendamento_confirmado', E'Tudo certo, {nome}! ✅\n{servico} com {profissional}, {quando}.');
  nid := public.notificar(cli, 'agendamento_confirmado', 'Horário confirmado', 'x', '/', jsonb_build_object('appointment_id', appt, 'professional_id', prof));
  select * into n from public.notifications where id = nid;
  raise notice '2 editado: [%] [%]', n.title, n.body;
  if n.title not like 'Tudo certo%' or n.body not like '% com %, %' then raise exception 'modelo não aplicou'; end if;
  if n.body like '%{%' then raise exception 'sobrou variável'; end if;

  -- 3. modelo só com título (sem segunda linha) -> body nulo
  perform public.plataforma_salvar_modelo('push.pedido_aceito', 'Confirmado, {nome}!');
  nid := public.notificar(cli, 'pedido_aceito', 'Horário confirmado', null, '/', '{}');
  select * into n from public.notifications where id = nid;
  if n.body is not null then raise exception 'body devia ser nulo: %', n.body; end if;
  raise notice '3 só título: [%] (ok)', n.title;

  -- 4. regra desligada: o aviso fica no app, o push não sai
  perform public.plataforma_regra_push('lembrete_agendamento', false);
  nid := public.notificar(cli, 'lembrete_agendamento', 'Amanhã tem horário marcado', 'Manicure amanhã.', '/', '{}');
  select * into n from public.notifications where id = nid;
  if n.push_em is null or n.push_resultado not like 'desligado%' then raise exception 'regra não desligou o push'; end if;
  if not exists (select 1 from public.plataforma_modelos() m where m.chave = 'push.lembrete_agendamento' and m.envia = false) then raise exception 'plataforma_modelos não mostra a regra'; end if;
  perform public.plataforma_regra_push('lembrete_agendamento', true);
  raise notice '4 regra (ok)';

  -- 5. prévia usa o exemplo do tipo
  previa := public.plataforma_previa(E'{titulo}\n{texto}', 'push.vaga_disponivel');
  if previa not like 'Abriu uma vaga%' then raise exception 'prévia sem exemplo: %', previa; end if;
  previa := public.plataforma_previa('Oi, {nome}! {servico} {quando}');
  if previa <> 'Oi, Juliana! Manicure 12/09 às 14:00' then raise exception 'prévia de sempre mudou: %', previa; end if;
  raise notice '5 prévia (ok)';

  -- 6. teste: sem aparelho reclama; com aparelho manda para mim
  begin
    perform public.plataforma_testar_push('push.vaga_disponivel', E'{titulo}\n{texto}');
    raise exception 'devia reclamar de aparelho';
  exception when others then
    if sqlerrm not like 'Nenhum aparelho%' then raise; end if;
  end;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (plat, 'https://push.exemplo/' || gen_random_uuid(), 'k', 'a');
  r := public.plataforma_testar_push('push.vaga_disponivel', E'{titulo}\n{texto}');
  if (r ->> 'celulares')::int <> 1 or (r ->> 'titulo') not like 'Abriu uma vaga%' then raise exception 'teste errado: %', r; end if;
  if not exists (select 1 from public.notifications where user_id = plat and kind = 'teste_push' and push_em is null) then raise exception 'teste não entrou na fila de push'; end if;
  if exists (select 1 from public.message_outbox where kind = 'teste_push') then raise exception 'teste de push foi parar no WhatsApp'; end if;
  raise notice '6 teste: % (ok)', r;

  -- 7. quem não é plataforma não mexe
  update public.profiles set role = 'cliente' where id = plat;
  begin
    perform public.plataforma_regra_push('lembrete_agendamento', false);
    raise exception 'cliente mudou regra';
  exception when others then
    if sqlerrm <> 'Só a plataforma.' then raise; end if;
  end;
  raise notice '7 só a plataforma (ok)';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
