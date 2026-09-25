-- Ensaio da 120: documentos versionados e aceites por documento. Desfaz no fim.
\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;
do $$
declare conta uuid := gen_random_uuid(); plat uuid; r jsonb; n integer; deu boolean; d uuid; p record;
begin
  perform public.silenciar_gatilho();
  -- 1. os quatro vigentes existem
  r := public.documentos_vigentes();
  if not (r ? 'cliente' and r ? 'profissional' and r ? 'salao' and r ? 'privacidade') then raise exception '1: vigentes: %', jsonb_object_keys(r); end if;
  if r -> 'salao' ->> 'versao' <> '2026-09-24' or length(r -> 'salao' ->> 'conteudo') < 5000 then raise exception '1: salão errado'; end if;
  raise notice '1 vigentes ok';

  -- 2. o cadastro grava os aceites por documento e o resumo no perfil
  insert into auth.users (id, email, raw_user_meta_data) values (conta, 'legal.ensaio@mimo.test', jsonb_build_object('full_name', 'Ana Legal', 'phone', '(11) 90000-0120', 'termos', '2026-09-24', 'aceites', jsonb_build_object('cliente', '2026-09-24', 'privacidade', '2026-09-24')));
  select count(*) into n from public.aceites_de_termos where user_id = conta and contexto = 'cadastro'; if n <> 2 then raise exception '2: aceites do cadastro: %', n; end if;
  select * into p from public.profiles where id = conta; if p.termos_versao <> '2026-09-24' or p.aceitou_termos_em is null then raise exception '2: perfil'; end if;
  raise notice '2 aceites no cadastro ok';

  -- 3. anon não escreve nem lê rascunho; plataforma publica; publicado é imutável
  set role anon;
  deu := false; begin insert into public.documentos_legais (tipo, versao, titulo, conteudo) values ('cliente', '2030-01-01', 'x', 'x'); exception when others then deu := true; end;
  reset role;
  if not deu then raise exception '3: anon inseriu'; end if;
  select id into plat from public.profiles where role = 'plataforma' limit 1;
  if plat is null then update public.profiles set role = 'plataforma' where id = conta; plat := conta; end if;
  perform set_config('request.jwt.claim.sub', plat::text, false);
  set role authenticated;
  insert into public.documentos_legais (tipo, versao, titulo, conteudo, resumo) values ('cliente', '2026-10-01', 'Termos de Uso para Clientes', '## 1. Novo\n\nTexto novo.', 'mudou') returning id into d;
  r := public.documentos_vigentes();
  if r -> 'cliente' ->> 'versao' <> '2026-09-24' then raise exception '3: rascunho virou vigente'; end if;
  update public.documentos_legais set status = 'publicado' where id = d;
  r := public.documentos_vigentes();
  if r -> 'cliente' ->> 'versao' <> '2026-10-01' or r -> 'cliente' ->> 'conteudo' not like '## 1. Novo%' then raise exception '3: publicação não virou vigente: %', r -> 'cliente' ->> 'versao'; end if;
  deu := false; begin update public.documentos_legais set conteudo = 'mexeu' where id = d; exception when others then deu := true; end;
  if not deu then raise exception '3: publicado foi editado'; end if;
  reset role;
  raise notice '3 rascunho → publicado, imutável, só plataforma ok';

  -- 4. quem aceitou a antiga aceita a nova; meus_aceites mostra
  perform set_config('request.jwt.claim.sub', conta::text, false);
  set role authenticated;
  r := public.aceitar_documentos(jsonb_build_object('cliente', '2026-10-01', 'privacidade', '2026-09-24'), 'nova_versao');
  r := public.meus_aceites();
  reset role;
  if r -> 'cliente' ->> 'versao' <> '2026-10-01' or r -> 'privacidade' ->> 'versao' <> '2026-09-24' then raise exception '4: meus_aceites: %', r; end if;
  select termos_versao into p from public.profiles where id = conta; if p.termos_versao <> '2026-10-01' then raise exception '4: perfil não subiu: %', p.termos_versao; end if;
  select count(*) into n from public.aceites_de_termos where user_id = conta; if n <> 4 then raise exception '4: histórico: %', n; end if;
  raise notice '4 aceite da versão nova ok';

  -- 5. aceite inválido não grava
  perform set_config('request.jwt.claim.sub', conta::text, false);
  set role authenticated;
  r := public.aceitar_documentos(jsonb_build_object('qualquer', '2026-10-01', 'cliente', 'ontem'), 'x');
  reset role;
  select count(*) into n from public.aceites_de_termos where user_id = conta; if n <> 4 then raise exception '5: gravou lixo'; end if;
  raise notice '5 lixo recusado ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
