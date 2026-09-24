-- Ensaio da 119: o salão configura a profissional, ela ativa o acesso e
-- encontra a agenda pronta. Cria as contas que precisa e desfaz no fim.
\set ON_ERROR_STOP on
set client_min_messages = notice;
begin;
do $$
declare
  dona uuid := gen_random_uuid(); carla_conta uuid := gen_random_uuid(); cli uuid := gen_random_uuid(); errada uuid := gen_random_uuid();
  sal uuid; s record; p record; pr public.professionals%rowtype; r jsonb; tok text; escova uuid; progressiva uuid; carla uuid; bia uuid; duda uuid; n integer; deu boolean; amanha date; ap record; h record;
begin
  perform public.silenciar_gatilho();
  amanha := public.agora_local()::date + 1;

  -- 0. a dona nasce pelo cadastro, com o salão nos metadados
  insert into auth.users (id, email, raw_user_meta_data) values (dona, 'dona.ensaio@mimo.test', jsonb_build_object('full_name', 'Juliana Ensaio', 'phone', '(13) 99999-1000', 'papel_desejado', 'salao', 'nome_negocio', 'Studio Ensaio 119', 'cidade', 'Santos'));
  select id into sal from public.salons where owner_id = dona;
  if sal is null then raise exception '0: salão não nasceu'; end if;
  insert into public.services (salon_id, name, duration_minutes, price, active) values (sal, 'Escova', 45, 80, true) returning id into escova;
  insert into public.services (salon_id, name, duration_minutes, price, active) values (sal, 'Progressiva', 180, 250, true) returning id into progressiva;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_horarios(sal, (select jsonb_agg(jsonb_build_object('weekday', d, 'open', d between 1 and 6, 'start_time', '09:00', 'end_time', case when d = 6 then '14:00' else '18:00' end)) from generate_series(0, 6) d));
  reset role;
  raise notice '0 salão, serviços e horários ok';

  -- 1. a dona adiciona a Carla inteira: vínculo, serviços (um com preço/duração dela), horário do salão, cota, permissões
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.equipe_salvar_profissional(sal, jsonb_build_object(
    'name', 'Carla Mendes', 'phone', '(11) 98765-4321', 'especialidade', 'Cabeleireira', 'vinculo', 'parceira',
    'servicos', jsonb_build_array(jsonb_build_object('service_id', escova), jsonb_build_object('service_id', progressiva, 'preco_cents', 30000, 'duracao_minutos', 120)),
    'usa_horario_salao', true, 'cota_pct', 30,
    'permissoes', jsonb_build_object('confirmar', true, 'bloquear', true, 'clientes', 'proprias', 'servicos', false, 'ver_repasse', true)));
  reset role;
  carla := (r ->> 'id')::uuid; tok := r ->> 'token';
  select * into p from public.professionals where id = carla;
  if p.situacao <> 'configurada' or not p.active or p.vinculo <> 'parceira' or p.cota_pct <> 30 or not p.usa_horario_salao or tok is null then raise exception '1: carla errada: % % % %', p.situacao, p.active, p.vinculo, tok; end if;
  select count(*) into n from public.professional_services where professional_id = carla; if n <> 2 then raise exception '1: serviços %', n; end if;
  select count(*) into n from public.professional_services where professional_id = carla and service_id = progressiva and preco_cents = 30000 and duracao_minutos = 120; if n <> 1 then raise exception '1: override não gravou'; end if;
  select count(*) into n from public.professional_hours ph join public.business_hours b on b.salon_id = sal and b.weekday = ph.weekday where ph.professional_id = carla and ph.open = b.open and ph.start_time = b.start_time and ph.end_time = b.end_time; if n <> 7 then raise exception '1: horário não herdou (%)', n; end if;
  raise notice '1 carla configurada ok (token %)', tok;

  -- 2. o mesmo WhatsApp não entra duas vezes
  perform set_config('request.jwt.claim.sub', dona::text, false);
  deu := false;
  begin set role authenticated; r := public.equipe_salvar_profissional(sal, jsonb_build_object('name', 'Outra', 'phone', '11987654321')); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '2: telefone repetido aceito'; end if;
  raise notice '2 telefone repetido recusado ok';

  -- 3. o link mostra o que ela vai encontrar, sem expor nada demais
  set role anon;
  r := public.acesso_por_token(tok);
  reset role;
  if r -> 'profissional' ->> 'nome' <> 'Carla Mendes' or (r -> 'profissional' ->> 'servicos')::int <> 2 or (r ->> 'tem_conta')::boolean or r -> 'profissional' ->> 'telefone_final' <> '4321' then raise exception '3: acesso_por_token errado: %', r; end if;
  deu := false;
  begin set role anon; perform 1 from public.acessos_equipe; reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '3: anon lê a tabela de tokens'; end if;
  raise notice '3 link de acesso ok';

  -- 4. o WhatsApp errado não ativa
  insert into auth.users (id, email, raw_user_meta_data) values (errada, 'errada.ensaio@mimo.test', jsonb_build_object('full_name', 'Pessoa Errada', 'phone', '(11) 90000-9999'));
  perform set_config('request.jwt.claim.sub', errada::text, false);
  deu := false;
  begin set role authenticated; r := public.ativar_acesso(tok, '(11) 90000-9999'); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '4: ativou com telefone errado'; end if;
  select situacao, user_id into p from public.professionals where id = carla;
  if p.situacao <> 'configurada' or p.user_id is not null then raise exception '4: mexeu na carla'; end if;
  raise notice '4 telefone errado recusado ok';

  -- 5. Carla cria a conta pelo link: já entra ativa, com a agenda pronta
  insert into auth.users (id, email, raw_user_meta_data) values (carla_conta, 'carla.ensaio@mimo.test', jsonb_build_object('full_name', 'Carla Mendes', 'phone', '(11) 98765-4321', 'ativar_token', tok));
  select * into p from public.professionals where id = carla;
  if p.user_id <> carla_conta or p.situacao <> 'ativa' or not p.active or p.ativada_em is null then raise exception '5: não ativou: % %', p.situacao, p.user_id; end if;
  select count(*) into n from public.salon_members where salon_id = sal and user_id = carla_conta and papel = 'profissional'; if n <> 1 then raise exception '5: sem vínculo de equipe'; end if;
  select role into s from public.profiles where id = carla_conta; if s.role <> 'profissional' then raise exception '5: papel %', s.role; end if;
  select count(*) into n from public.acessos_equipe where token = tok and usado_em is not null; if n <> 1 then raise exception '5: token não marcado como usado'; end if;
  perform set_config('request.jwt.claim.sub', carla_conta::text, false);
  set role authenticated;
  r := public.ativar_acesso(tok, null);   -- abrir o link de novo, já logada, não quebra
  reset role;
  if not (r ->> 'ja')::boolean then raise exception '5: segunda abertura errada: %', r; end if;
  raise notice '5 carla ativou pelo cadastro ok';

  -- 6. as permissões valem
  if public.pode(carla, 'servicos') or not public.pode(carla, 'bloquear') or public.pode(carla, 'clientes_do_salao') or not public.pode(carla, 'ver_repasse') then raise exception '6: pode() errado'; end if;
  perform set_config('request.jwt.claim.sub', carla_conta::text, false);
  deu := false;
  begin set role authenticated; insert into public.professional_services (professional_id, service_id) values (carla, escova) on conflict do nothing; delete from public.professional_services where professional_id = carla and service_id = escova; reset role; exception when others then deu := true; reset role; end;
  select count(*) into n from public.professional_services where professional_id = carla and service_id = escova;
  if n <> 1 then raise exception '6: carla mexeu nos próprios serviços sem permissão'; end if;
  raise notice '6 permissões ok';

  -- 7. a cliente marca com a Carla: vale o preço e a duração dela
  insert into auth.users (id, email, raw_user_meta_data) values (cli, 'cli.ensaio@mimo.test', jsonb_build_object('full_name', 'Cliente Ensaio', 'phone', '(11) 90000-0001'));
  perform set_config('request.jwt.claim.sub', cli::text, false);
  set role authenticated;
  r := public.marcar_servicos(carla, array[progressiva], amanha, time '10:00');
  reset role;
  if not (r ->> 'ok')::boolean then raise exception '7: não marcou: %', r; end if;
  select * into ap from public.appointments where id = (r ->> 'appointment_id')::uuid;
  if ap.price_cents <> 30000 or ap.end_time <> time '12:00' then raise exception '7: preço/duração da carla não valeram: % %', ap.price_cents, ap.end_time; end if;
  raise notice '7 preço e duração próprios ok';

  -- 8. o horário do salão muda: quem herda acompanha; quem mexeu no próprio, não
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_horarios(sal, jsonb_build_array(jsonb_build_object('weekday', 1, 'open', true, 'start_time', '10:00', 'end_time', '20:00')));
  reset role;
  select * into h from public.professional_hours where professional_id = carla and weekday = 1;
  if h.start_time <> time '10:00' or h.end_time <> time '20:00' then raise exception '8: não acompanhou o salão: % %', h.start_time, h.end_time; end if;
  perform set_config('request.jwt.claim.sub', carla_conta::text, false);
  set role authenticated;
  update public.professional_hours set start_time = time '11:00' where professional_id = carla and weekday = 1;
  reset role;
  select usa_horario_salao into p from public.professionals where id = carla;
  if p.usa_horario_salao then raise exception '8: devia ter virado horário próprio'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_horarios(sal, jsonb_build_array(jsonb_build_object('weekday', 1, 'open', true, 'start_time', '08:00', 'end_time', '18:00')));
  reset role;
  select * into h from public.professional_hours where professional_id = carla and weekday = 1;
  if h.start_time <> time '11:00' then raise exception '8: sobrescreveu o horário próprio'; end if;
  raise notice '8 herança de horário ok';

  -- 9. o link genérico só recolhe nome e WhatsApp: rascunho, invisível, sem agenda
  set role anon;
  select codigo_equipe into s from public.salons where id = sal;
  r := public.equipe_informar_dados(s.codigo_equipe, 'Duda Rascunho', '(11) 90000-0002');
  reset role;
  select id, situacao, active into p from public.professionals where salon_id = sal and name = 'Duda Rascunho';
  duda := p.id;
  if p.situacao <> 'rascunho' or p.active then raise exception '9: rascunho errado: % %', p.situacao, p.active; end if;
  select count(*) into n from public.acessos_equipe where professional_id = duda; if n <> 0 then raise exception '9: rascunho ganhou token'; end if;
  -- a dona configura: vira configurada, ganha token
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.equipe_salvar_profissional(sal, jsonb_build_object('id', duda, 'name', 'Duda Rascunho', 'phone', '(11) 90000-0002', 'vinculo', 'funcionaria', 'servicos', jsonb_build_array(jsonb_build_object('service_id', escova)), 'usa_horario_salao', true));
  reset role;
  select situacao, active into p from public.professionals where id = duda;
  if p.situacao <> 'configurada' or not p.active or r ->> 'token' is null then raise exception '9: não configurou: % %', p.situacao, r; end if;
  raise notice '9 rascunho pelo link → configurada ok';

  -- 10. desativar, reativar, remover (com história, fica inativa; sem, some)
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.equipe_situacao(carla, 'desativar');
  reset role;
  select situacao, active into p from public.professionals where id = carla;
  if p.situacao <> 'inativa' or p.active then raise exception '10: não desativou'; end if;
  set role authenticated; r := public.equipe_situacao(carla, 'reativar'); reset role;
  select situacao, active into p from public.professionals where id = carla;
  if p.situacao <> 'ativa' or not p.active then raise exception '10: não reativou: %', p.situacao; end if;
  set role authenticated; r := public.equipe_situacao(duda, 'remover'); reset role;
  select count(*) into n from public.professionals where id = duda; if n <> 0 then raise exception '10: duda sem história devia sumir'; end if;
  set role authenticated; r := public.equipe_situacao(carla, 'remover'); reset role;
  select situacao into p from public.professionals where id = carla;
  if p.situacao <> 'inativa' then raise exception '10: carla com história devia ficar inativa'; end if;
  select count(*) into n from public.salon_members where salon_id = sal and user_id = carla_conta; if n <> 0 then raise exception '10: carla ainda na equipe'; end if;
  select count(*) into n from public.appointments where professional_id = carla; if n <> 1 then raise exception '10: história da carla sumiu'; end if;
  raise notice '10 desativar/reativar/remover ok';

  -- 11. active por fora continua em par com a situação (o app antigo mexe em active)
  update public.professionals set active = true where id = carla;
  select situacao into p from public.professionals where id = carla; if p.situacao <> 'ativa' then raise exception '11: active=true devia dar ativa'; end if;
  update public.professionals set active = false where id = carla;
  select situacao into p from public.professionals where id = carla; if p.situacao <> 'inativa' then raise exception '11: active=false devia dar inativa'; end if;
  raise notice '11 active ↔ situação ok';

  -- 12. cota em cascata e primeiros passos
  select * into pr from public.professionals where id = carla;
  if public.cota_da_profissional(pr, escova) <> 30 then raise exception '12: cota da carla'; end if;
  update public.professionals set cota_excecoes = jsonb_build_array(jsonb_build_object('service_id', progressiva, 'cota_pct', 40)) where id = carla;
  select * into pr from public.professionals where id = carla;
  if public.cota_da_profissional(pr, progressiva) <> 40 or public.cota_da_profissional(pr, escova) <> 30 then raise exception '12: exceção por serviço'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.primeiros_passos(sal);
  perform public.primeiro_passo_feito(sal, 'qr_baixado');
  reset role;
  if (r ->> 'servicos')::int <> 2 or not (r ->> 'horarios')::boolean or (r ->> 'agendamentos')::int <> 1 then raise exception '12: primeiros passos: %', r; end if;
  select primeiros_passos into s from public.salons where id = sal;
  if s.primeiros_passos ->> 'qr_baixado' is null then raise exception '12: passo feito não gravou'; end if;
  raise notice '12 cota e primeiros passos ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
