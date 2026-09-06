\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare
  ana uuid; ana_conta uuid; salao uuid; cod_ana text; cod_salao text;
  cli uuid; outra uuid; r jsonb; n int; alvo jsonb; novo uuid;
begin
  select id, user_id, salon_id, codigo into ana, ana_conta, salao, cod_ana from public.professionals where slug = 'ana-paula';
  select codigo into cod_salao from public.salons where id = salao;
  assert cod_ana ~ '^[A-Z2-9]{6}$', 'código da ana: ' || coalesce(cod_ana, 'nulo');
  assert cod_salao ~ '^[A-Z2-9]{6}$', 'código do salão';
  raise notice 'códigos: ana=% salão=%', cod_ana, cod_salao;

  -- código resolve para os dois tipos (anon)
  set role anon;
  alvo := public.resolver_codigo(lower(cod_ana));
  assert alvo ->> 'tipo' = 'profissional' and alvo ->> 'nome' = 'Ana Paula', 'resolver ana: ' || alvo::text;
  alvo := public.resolver_codigo(cod_salao);
  assert alvo ->> 'tipo' = 'salao', 'resolver salão: ' || alvo::text;
  assert public.resolver_codigo('ZZZZZZ') is null, 'código inexistente';
  reset role;

  -- 1. cliente nova sem vínculo: não vê profissional nenhuma
  select id into cli from public.profiles where full_name = 'Sofia Ramos';
  delete from public.vinculos where client_id = cli;
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  select count(*) into n from public.professionals;
  assert n = 0, 'sem vínculo devia ver 0 profissionais, viu ' || n;
  -- vincula pelo código da ana
  r := public.vincular(cod_ana, 'qr');
  assert (r->>'ok')::boolean and (r->>'novo')::boolean and r->>'trazida_por' = 'Ana Paula', 'vincular: ' || r::text;
  select count(*) into n from public.professionals;
  assert n >= 2, 'com vínculo devia ver as do salão, viu ' || n;
  -- de novo: não duplica
  r := public.vincular(cod_ana, 'link');
  assert (r->>'novo')::boolean = false, 'repetido devia dizer novo=false';
  -- minhas agendas
  r := public.minhas_agendas();
  assert jsonb_array_length(r) = 1 and r->0->'trazida_por'->>'nome' = 'Ana Paula', 'minhas_agendas: ' || r::text;
  -- sai
  perform public.sair_da_agenda(salao);
  select count(*) into n from public.professionals;
  assert n = 0, 'depois de sair devia ver 0';
  -- volta pelo código do salão: reabre, atribuição original fica
  r := public.vincular(cod_salao, 'codigo');
  assert (r->>'novo')::boolean and r->>'trazida_por' = 'Ana Paula', 'reabrir mantém quem trouxe: ' || r::text;
  reset role;
  raise notice 'cenário 1 ok';

  -- 2. equipe não pode se vincular como cliente
  perform set_config('request.jwt.claim.sub', ana_conta::text, false);
  set role authenticated;
  begin
    r := public.vincular(cod_salao);
    raise exception 'equipe devia ser barrada';
  exception when others then
    if sqlerrm not like '%equipe%' then raise; end if;
  end;
  reset role;
  raise notice 'cenário 2 ok';

  -- 3. cadastro com código nos metadados cria o vínculo
  novo := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', novo, 'authenticated', 'authenticated', 'nova@exemplo.com', 'x', now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Nova Cliente', 'phone', '(13) 99700-9999', 'codigo_convite', lower(cod_ana)),
    now(), now(), '', '', '', '');
  select count(*) into n from public.vinculos where client_id = novo and salon_id = salao and trazida_por = ana and como = 'cadastro';
  assert n = 1, 'vínculo pelo cadastro';
  raise notice 'cenário 3 ok';

  -- 4. encaixe pelo telefone: ao cadastrar com o mesmo número, os horários viram dela e o salão vira vínculo
  insert into public.appointments (professional_id, salon_id, service_id, date, start_time, end_time, status, guest_name, guest_phone)
  values (ana, salao, (select id from public.services limit 1), current_date + 30, '10:00', '11:00', 'confirmado', 'Encaixada', '(13) 99700-8888');
  novo := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', novo, 'authenticated', 'authenticated', 'encaixada@exemplo.com', 'x', now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Encaixada Silva', 'phone', '13997008888'),
    now(), now(), '', '', '', '');
  select count(*) into n from public.appointments where client_id = novo;
  assert n = 1, 'encaixe devia virar dela';
  select count(*) into n from public.vinculos where client_id = novo and salon_id = salao and como = 'encaixe';
  assert n = 1, 'vínculo por encaixe';
  raise notice 'cenário 4 ok';

  -- 5. agendar cria vínculo (cliente sem vínculo marcando pela vitrine)
  select id into outra from public.profiles where full_name = 'Bruna Alves';
  delete from public.vinculos where client_id = outra;
  insert into public.appointments (client_id, professional_id, salon_id, service_id, date, start_time, end_time, status)
  values (outra, ana, salao, (select id from public.services limit 1), current_date + 31, '10:00', '11:00', 'pendente');
  select count(*) into n from public.vinculos where client_id = outra and salon_id = salao and como = 'agendamento' and trazida_por = ana;
  assert n = 1, 'vínculo ao agendar';
  raise notice 'cenário 5 ok';

  -- 6. cadastro "sou autônoma" abre salão de uma
  novo := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', novo, 'authenticated', 'authenticated', 'solo@exemplo.com', 'x', now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Léa Solo', 'phone', '(13) 99700-7777', 'papel_desejado', 'autonoma', 'cidade', 'Santos'),
    now(), now(), '', '', '', '');
  select count(*) into n from public.salons s join public.professionals p on p.salon_id = s.id where s.owner_id = novo and s.tipo = 'autonoma' and p.user_id = novo;
  assert n = 1, 'autônoma devia ter salão de uma + ficha';
  assert (select role from public.profiles where id = novo) = 'profissional', 'papel profissional';
  assert (select slug from public.professionals where user_id = novo) = 'lea-solo', 'slug: ' || (select slug from public.professionals where user_id = novo);
  -- e o salão dela tem código próprio
  assert (select codigo from public.salons where owner_id = novo) is not null, 'código do salão da autônoma';
  raise notice 'cenário 6 ok';

  -- 7. o salão vê a lista com quem trouxe
  perform set_config('request.jwt.claim.sub', (select owner_id from public.salons where id = salao)::text, false);
  set role authenticated;
  select count(*) into n from public.clientes_do_salao(salao) c where c.trazida_por = 'Ana Paula';
  assert n >= 3, 'clientes_do_salao com trazida por ana: ' || n;
  reset role;
  -- e a ana vê quem ela trouxe
  perform set_config('request.jwt.claim.sub', ana_conta::text, false);
  set role authenticated;
  select count(*) into n from public.minhas_trazidas();
  assert n >= 3, 'minhas_trazidas: ' || n;
  reset role;
  raise notice 'cenário 7 ok';

  raise exception 'TUDO OK (rollback proposital)';
end $$;
