-- Ensaio da 115: a conta nova com dados do salão nos metadados já nasce no passo 3. Desfaz no fim.
begin;
do $$
declare uid uuid := gen_random_uuid(); s record;
begin
  perform public.silenciar_gatilho();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ensaio-' || left(uid::text, 8) || '@mimo.test', 'x', now(),
          jsonb_build_object('full_name', 'Dona do Ensaio', 'phone', '(13) 98888-' || right(uid::text, 4), 'papel_desejado', 'salao', 'nome_negocio', 'Espaço Ensaio', 'cidade', 'Itanhaém',
                             'salao', jsonb_build_object('cnpj', '11.222.333/0001-44', 'email', 'oi@ensaio.com', 'whatsapp', '(13) 98888-0000', 'address', 'Av. Beira Mar, 10', 'bairro', 'Centro', 'uf', 'sp', 'cep', '11740-000')),
          '{}'::jsonb, now(), now());
  select * into s from public.salons where owner_id = uid;
  if s.id is null then raise exception '1: salão não nasceu'; end if;
  if s.name <> 'Espaço Ensaio' or s.cnpj <> '11.222.333/0001-44' or s.email <> 'oi@ensaio.com' or s.uf <> 'SP' or s.bairro <> 'Centro' or s.onboarding_passo <> 3 or s.onboarding_concluido_em is not null then
    raise exception '1: dados do onboarding não gravados: % % % % passo %', s.name, s.cnpj, s.email, s.uf, s.onboarding_passo; end if;
  raise notice '1 conta nasce no passo 3 com os dados ok';
  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
