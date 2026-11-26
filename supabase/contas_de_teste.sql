-- =============================================================
-- MIMO — contas de teste: um salão pronto e as três pontas, para testar agendamento e avisos
--
-- NÃO é migração. Cole no SQL Editor do Supabase e rode. Rodar de novo é seguro: o que já existe não duplica
-- (e a senha das três contas volta a ser a que estiver na linha abaixo).
--
-- ANTES DE RODAR: na linha do set_config, logo abaixo deste cabeçalho, troque o marcador pela senha das contas
-- (8 caracteres ou mais). Pode usar "substituir tudo". Ela fica só no SQL Editor; não está escrita neste arquivo.
--
-- O que nasce:
--   teste.dona@mimo.com.vc           dona do "Salão de Teste MIMO" (cadastro concluído, teste grátis ativo)
--   teste.profissional@mimo.com.vc   Bia Teste, profissional da equipe, com conta
--   teste.cliente@mimo.com.vc        Carol Teste, cliente, já seguindo o salão
--   + Paula Sem Conta, profissional da equipe SEM conta (para testar o pedido que vai para o salão)
--   + três serviços (Corte, Escova, Manicure), feitos pelas duas profissionais
--   + salão aberto de segunda a sábado, das 09h às 18h, no modo "cada profissional decide"
--
-- As contas nascem sem telefone e sem e-mail de aviso: nada sai por WhatsApp nem por e-mail para elas; os avisos
-- ficam no app e no push, que é o que se quer testar. E-mail confirmado e primeiro acesso já feito: é entrar e usar.
--
-- Para apagar tudo, rode o bloco DESFAZER no fim do arquivo.
-- =============================================================

set search_path = public, extensions;
create extension if not exists pgcrypto with schema extensions;
select set_config('mimo.senha_teste', 'COLOQUE_A_SENHA_AQUI', false);

-- cria (ou acha) uma conta com e-mail confirmado, senha, perfil e primeiro acesso feito
create or replace function pg_temp.conta_teste(email_ text, nome text)
returns uuid
language plpgsql
as $$
declare
  uid uuid;
  senha text := current_setting('mimo.senha_teste', true);
  tem_provider_id boolean;
begin
  -- (a conferência não repete o texto do marcador: quem troca com "substituir tudo" não pode cair aqui)
  if coalesce(senha, '') = '' or senha like 'COLOQUE\_A\_SENHA%' or length(senha) < 8 then
    raise exception 'Falta a senha das contas de teste: troque o marcador da linha do set_config, lá em cima, por uma senha de 8 caracteres ou mais.';
  end if;
  select id into uid from auth.users where email = email_;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated',
      'authenticated', email_, crypt(senha, gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', nome),
      now(), now(), '', '', '', ''
    );
  else
    update auth.users set encrypted_password = crypt(senha, gen_salt('bf')),
                          email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = uid;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into tem_provider_id;
  if not exists (select 1 from auth.identities i where i.user_id = uid and i.provider = 'email') then
    if tem_provider_id then
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', email_, 'email_verified', true),
              'email', uid::text, now(), now(), now());
    else
      insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', email_), 'email', now(), now(), now());
    end if;
  end if;

  insert into public.profiles (id, full_name, referral_code)
  select uid, nome, public.gerar_codigo_indicacao(nome)
  where not exists (select 1 from public.profiles where id = uid);
  -- sem telefone e sem e-mail de aviso: nada sai para fora; primeiro acesso e termos já dados
  update public.profiles
     set full_name = nome, aceita_email = false,
         primeiro_acesso_em = coalesce(primeiro_acesso_em, now()),
         aceitou_termos_em = coalesce(aceitou_termos_em, now())
   where id = uid;
  return uid;
end;
$$;

do $$
declare
  dona uuid; pro uuid; cli uuid;
  salao uuid; ficha uuid; ficha2 uuid; serv uuid;
  r jsonb; cod text; n integer; s record;
begin
  dona := pg_temp.conta_teste('teste.dona@mimo.com.vc', 'Dona Teste');
  pro  := pg_temp.conta_teste('teste.profissional@mimo.com.vc', 'Bia Teste');
  cli  := pg_temp.conta_teste('teste.cliente@mimo.com.vc', 'Carol Teste');

  -- o salão da dona
  select id into salao from public.salons where owner_id = dona order by created_at limit 1;
  if salao is null then
    r := public.abrir_negocio_interno(dona, 'salao', 'Salão de Teste MIMO', 'Santos');
    salao := (r ->> 'salao_id')::uuid;
  end if;
  update public.profiles set role = 'admin' where id = dona;

  -- tudo daqui para baixo é feito "como a dona": os gatilhos e as funções conferem quem está logada
  perform set_config('request.jwt.claim.sub', dona::text, true);

  insert into public.business_hours (salon_id, weekday, open, start_time, end_time)
  select salao, d, d between 1 and 6, time '09:00', time '18:00' from generate_series(0, 6) d
  on conflict do nothing;
  update public.business_hours set open = weekday between 1 and 6, start_time = '09:00', end_time = '18:00' where salon_id = salao;

  update public.salons set aceite_modo = 'profissional', cliente_nova = 'igual' where id = salao;
  perform public.onboarding_concluir(salao);
  -- teste grátis ligado, sem cobrança: o painel abre direto
  if (select ativado_em from public.salons where id = salao) is null then
    perform public.ativacao_inicial_teste(salao);
  end if;

  -- a profissional com conta
  select id into ficha from public.professionals where salon_id = salao and user_id = pro;
  if ficha is null then
    insert into public.professionals (salon_id, user_id, name, slug, situacao, usa_horario_salao, aceite_manual, active)
    values (salao, pro, 'Bia Teste', 'bia-teste-' || left(replace(salao::text, '-', ''), 6), 'ativa', true, true, true)
    returning id into ficha;
  end if;
  insert into public.salon_members (salon_id, user_id, papel) values (salao, pro, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = pro;

  -- a profissional sem conta
  select id into ficha2 from public.professionals where salon_id = salao and user_id is null and name = 'Paula Sem Conta';
  if ficha2 is null then
    insert into public.professionals (salon_id, name, slug, usa_horario_salao, aceite_manual, active)
    values (salao, 'Paula Sem Conta', 'paula-sem-conta-' || left(replace(salao::text, '-', ''), 6), true, true, true)
    returning id into ficha2;
  end if;

  -- os serviços, feitos pelas duas
  for s in select * from (values ('Corte de cabelo', 60, 80.00), ('Escova', 45, 60.00), ('Manicure', 30, 40.00)) v(nome, minutos, preco) loop
    select id into serv from public.services where salon_id = salao and name = s.nome;
    if serv is null then
      insert into public.services (salon_id, name, duration_minutes, price, active)
      values (salao, s.nome, s.minutos, s.preco, true) returning id into serv;
    end if;
    insert into public.professional_services (professional_id, service_id) values (ficha, serv), (ficha2, serv) on conflict do nothing;
  end loop;

  -- a cliente segue o salão
  update public.profiles set role = 'cliente' where id = cli;
  select codigo into cod from public.salons where id = salao;
  perform set_config('request.jwt.claim.sub', cli::text, true);
  r := public.vincular(cod, 'codigo');
  perform set_config('request.jwt.claim.sub', '', true);

  -- confere: tem horário livre para marcar?
  select count(*) into n from public.horarios_livres(ficha, (public.agora_local()::date + 1 + case when extract(dow from public.agora_local()::date + 1) = 0 then 1 else 0 end)::date, 60);
  raise notice 'Salão de Teste MIMO pronto: endereço "%", código "%". Horários livres no próximo dia útil com a Bia: %. Vínculo da cliente: %',
    (select slug from public.salons where id = salao), cod, n, r ->> 'ok';
  if n = 0 then raise warning 'Sem horário livre com a Bia: confira o expediente do salão em Ajustes.'; end if;
end $$;

-- =============================================================
-- DESFAZER: apaga as três contas e o salão de teste. Tire os dois traços do começo de cada linha e rode.
-- =============================================================
-- delete from public.appointments where salon_id in (select id from public.salons where owner_id = (select id from auth.users where email = 'teste.dona@mimo.com.vc'));
-- delete from public.salons where owner_id = (select id from auth.users where email = 'teste.dona@mimo.com.vc');
-- delete from auth.users where email in ('teste.dona@mimo.com.vc', 'teste.profissional@mimo.com.vc', 'teste.cliente@mimo.com.vc');
