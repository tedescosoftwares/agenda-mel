-- Ensaio da 129: o acesso da profissional vai por e-mail e o link ativa sem conferir telefone. Desfaz no fim.
begin;
do $$
declare sid uuid; dona uuid; pid uuid; r jsonb; t text; conta uuid; n integer;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  insert into public.professionals (salon_id, name, slug, phone, situacao) values (sid, 'Carla Teste', 'carla-teste-129', '(13) 99171-3123', 'configurada') returning id into pid;

  -- 1. sem e-mail não manda
  begin
    perform public.acesso_enviar(pid);
    raise exception '1: mandou sem e-mail';
  exception when others then if sqlerrm not like '%Cadastre o e-mail%' then raise; end if;
  end;
  -- 2. com e-mail: fila de e-mail, token, link no domínio certo, texto do WhatsApp
  r := public.acesso_enviar(pid, 'Carla@Exemplo.com', 'http://localhost:5173');
  t := r ->> 'token';
  if r ->> 'email' <> 'carla@exemplo.com' or r ->> 'link' <> 'http://localhost:5173/ativar/' || t or r ->> 'whats' not like '%carla@exemplo.com%' then raise exception '2: %', r; end if;
  select count(*) into n from public.email_outbox where para = 'carla@exemplo.com' and kind = 'acesso_equipe';
  if n <> 1 then raise exception '2b: % e-mails', n; end if;
  if (select enviado_em from public.acessos_equipe where token = t) is null then raise exception '2c'; end if;
  r := public.acesso_enviar(pid, null, 'https://malicioso.com');
  if r ->> 'link' not like 'https://pro.mimo.com.vc/ativar/%' then raise exception '2d: %', r ->> 'link'; end if;
  raise notice '2 e-mail enfileirado, link %', r ->> 'link';

  -- 3. o link diz o e-mail; ativar não pede telefone e usa o da conta
  r := public.acesso_por_token(t);
  if r -> 'profissional' ->> 'email' <> 'carla@exemplo.com' then raise exception '3: %', r; end if;
  select p.id into conta from public.profiles p where p.role = 'cliente' and p.id not in (select owner_id from public.salons where owner_id is not null) and p.id not in (select user_id from public.professionals where user_id is not null) limit 1;
  update public.profiles set phone = '(11) 90000-0001' where id = conta;
  perform set_config('request.jwt.claim.sub', conta::text, true);
  r := public.ativar_acesso(t);
  if not (r ->> 'ok')::boolean or r ->> 'situacao' <> 'ativa' then raise exception '3b: %', r; end if;
  if (select phone from public.professionals where id = pid) <> '(11) 90000-0001' then raise exception '3c: telefone da conta não valeu'; end if;
  if (select user_id from public.professionals where id = pid) <> conta then raise exception '3d'; end if;
  raise notice '3 ativou pelo link, sem telefone';

  -- 4. o link não vale duas vezes
  perform set_config('request.jwt.claim.sub', dona::text, true);
  begin
    perform public.ativar_acesso(t);
    raise exception '4: ativou de novo';
  exception when others then if sqlerrm not like '%já foi usado%' and sqlerrm not like '%dona de um negócio%' then raise; end if;
  end;
  raise notice '4 link usado uma vez só';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
