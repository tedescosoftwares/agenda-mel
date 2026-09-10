-- Ensaio dos recados (061). Roda no banco de teste e desfaz tudo.
begin;
do $$
declare
  ana uuid; ana_conta uuid; salao uuid; dona uuid; cli uuid; r jsonb; n integer;
begin
  select id, user_id, salon_id into ana, ana_conta, salao from public.professionals where slug = 'ana-paula';
  select owner_id into dona from public.salons where id = salao;
  select id into cli from public.profiles where role = 'cliente' limit 1;
  insert into public.vinculos (client_id, salon_id, trazida_por, como) values (cli, salao, ana, 'qr') on conflict do nothing;

  -- 1. a profissional fala com as clientes dela
  perform set_config('request.jwt.claim.sub', ana_conta::text, false);
  r := public.contar_publico('minhas_clientes');
  raise notice '1 prévia da Ana: %', r;
  if (r ->> 'pessoas')::int < 1 then raise exception 'Ana deveria ter ao menos 1 cliente'; end if;
  r := public.enviar_recado('minhas_clientes', 'Promoção de gel', 'Essa semana com 20% off, chama no app', '/cliente/home');
  raise notice '1 enviado: %', r;
  select count(*) into n from public.notifications where kind = 'recado' and user_id = cli and title = 'Promoção de gel';
  if n <> 1 then raise exception 'a cliente deveria ter 1 notificação, tem %', n; end if;
  select count(*) into n from public.message_outbox where kind = 'recado';
  if n <> 0 then raise exception 'recado não vai por WhatsApp'; end if;
  select count(*) into n from public.email_outbox where kind = 'recado';
  if n <> 0 then raise exception 'recado não vai por e-mail'; end if;

  -- 2. repetido na mesma hora, barra
  begin
    perform public.enviar_recado('minhas_clientes', 'Promoção de gel', 'Essa semana com 20% off, chama no app', '/cliente/home');
    raise exception 'deveria ter barrado o repetido';
  exception when others then
    if sqlerrm !~ 'menos de uma hora' then raise; end if;
    raise notice '2 repetido barrado: %', sqlerrm;
  end;

  -- 3. a profissional NÃO fala com a carteira do salão
  begin
    perform public.enviar_recado('clientes', 'Oi', 'x', null, salao);
    raise exception 'profissional não pode falar com a carteira do salão';
  exception when others then
    if sqlerrm !~ 'não pode' then raise; end if;
    raise notice '3 barrado certo: %', sqlerrm;
  end;

  -- 4. a dona fala com a carteira e com a equipe
  perform set_config('request.jwt.claim.sub', dona::text, false);
  r := public.contar_publico('clientes', salao);
  raise notice '4 carteira: %', r;
  r := public.enviar_recado('equipe', 'Reunião amanhã', 'Às 9h, café por conta da casa', null, salao);
  raise notice '4 equipe: %', r;
  if (r ->> 'destinatarios')::int < 1 then raise exception 'equipe vazia'; end if;
  select count(*) into n from public.meus_recados(salao);
  if n <> 1 then raise exception 'histórico do salão deveria ter 1, tem %', n; end if;

  -- 5. a dona NÃO fala com todo mundo
  begin
    perform public.enviar_recado('todos', 'Oi', 'x');
    raise exception 'dona não é plataforma';
  exception when others then
    if sqlerrm !~ 'não pode' then raise; end if;
    raise notice '5 barrado certo';
  end;

  -- 6. plataforma fala com todo mundo e com um salão
  update public.profiles set role = 'plataforma' where id = dona;
  r := public.contar_publico('todos');
  raise notice '6 todos: %', r;
  r := public.enviar_recado('salao', 'Novidade no app', 'Agora tem avisos no celular', '/cliente/perfil', null, jsonb_build_object('salao', salao));
  raise notice '6 salão inteiro: %', r;
  if (r ->> 'destinatarios')::int < 2 then raise exception 'salão deveria ter cliente + equipe'; end if;
  select count(*) into n from public.meus_recados();
  if n <> 1 then raise exception 'histórico da plataforma deveria ter 1, tem %', n; end if;

  -- 7. validação
  begin
    perform public.enviar_recado('todos', 'Olha isso', 'x', 'https://golpe.com');
    raise exception 'link externo deveria barrar';
  exception when others then
    if sqlerrm !~ 'tela do app' then raise; end if;
    raise notice '7 link externo barrado';
  end;
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
