-- Ensaio da 114: onboarding do salão, convite de equipe, antecedência. Desfaz no fim.
begin;
do $$
declare dona uuid; outra uuid; terceira uuid; r jsonb; sal uuid; s record; prof uuid; deu boolean; n integer; hoje date; primeira time; agora timestamp; sv uuid;
begin
  perform public.silenciar_gatilho();
  -- três contas: a dona (sem negócio), uma cliente com telefone conhecido, outra sem
  select id into dona from public.profiles p where p.role = 'cliente' and not exists (select 1 from public.salon_members m where m.user_id = p.id) and not exists (select 1 from public.professionals x where x.user_id = p.id) and not exists (select 1 from public.salons x where x.owner_id = p.id) order by created_at limit 1;
  select id into outra from public.profiles p where p.role = 'cliente' and p.id <> dona and not exists (select 1 from public.salon_members m where m.user_id = p.id) and not exists (select 1 from public.professionals x where x.user_id = p.id) and not exists (select 1 from public.salons x where x.owner_id = p.id) order by created_at limit 1;
  select id into terceira from public.profiles p where p.role = 'cliente' and p.id not in (dona, outra) and not exists (select 1 from public.salon_members m where m.user_id = p.id) and not exists (select 1 from public.professionals x where x.user_id = p.id) and not exists (select 1 from public.salons x where x.owner_id = p.id) order by created_at limit 1;
  if dona is null or outra is null or terceira is null then raise exception 'ensaio precisa de 3 clientes livres'; end if;
  update public.profiles set phone = '(13) 99999-0001' where id = outra;

  -- 1. negócio novo nasce no passo 1, sem conclusão, com código de equipe
  r := public.abrir_negocio_interno(dona, 'salao', 'Salão do Ensaio', 'Santos');
  sal := (r ->> 'salao_id')::uuid;
  select * into s from public.salons where id = sal;
  if s.onboarding_concluido_em is not null or s.onboarding_passo <> 1 or s.codigo_equipe is null then raise exception '1: salão novo errado: % % %', s.onboarding_concluido_em, s.onboarding_passo, s.codigo_equipe; end if;
  raise notice '1 salao novo ok (%)', s.codigo_equipe;

  -- 2. salvar o passo 2 e 3
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_salvar(sal, jsonb_build_object('name', 'Studio Ensaio', 'cnpj', '12.345.678/0001-90', 'whatsapp', '(13) 91234-5678', 'email', 'Contato@Ensaio.com', 'responsavel_nome', 'Juliana', 'address', 'Rua das Flores, 123', 'bairro', 'Gonzaga', 'city', 'Santos', 'uf', 'sp', 'cep', '11060-300'), 2);
  r := public.onboarding_salvar(sal, jsonb_build_object('antecedencia_min_minutos', 180, 'politica_cancelamento', 'rigorosa', 'permite_remarcar', false, 'sinal_modo', 'fixo', 'sinal_fixo_cents', 5000, 'aceite_modo', 'casa', 'minutos_para_aceitar', 30), 3);
  reset role;
  select * into s from public.salons where id = sal;
  if s.name <> 'Studio Ensaio' or s.email <> 'contato@ensaio.com' or s.uf <> 'SP' or s.cep <> '11060300' or s.antecedencia_min_minutos <> 180 or s.permite_remarcar or s.sinal_modo <> 'fixo' or s.sinal_fixo_cents <> 5000 or s.aceite_modo <> 'casa' or s.onboarding_passo <> 3 then
    raise exception '2: salvar errado: % % % % % %', s.name, s.email, s.uf, s.antecedencia_min_minutos, s.sinal_modo, s.onboarding_passo; end if;
  raise notice '2 salvar passos ok';

  -- 2b. identificação fiscal (122): CNPJ só dígitos, endereço fiscal, contatos a mais; depois vira CPF
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_salvar(sal, jsonb_build_object('documento_tipo', 'cnpj', 'cnpj', '69.089.327/0001-88', 'razao_social', 'Mimo Ltda', 'nome_fantasia', 'MIMO', 'endereco_fiscal', jsonb_build_object('address', 'Rua Pais Leme, 215', 'city', 'São Paulo', 'uf', 'SP', 'cep', '05424150'), 'endereco_igual', false, 'contatos', jsonb_build_array(jsonb_build_object('tipo', 'telefone', 'valor', '1134567890'), jsonb_build_object('tipo', 'email', 'valor', 'financeiro@ensaio.com')), 'fotos', jsonb_build_array('https://x/a.jpg', 'https://x/b.jpg'), 'logo_url', 'https://x/logo.jpg'));
  reset role;
  select * into s from public.salons where id = sal;
  if s.documento_tipo <> 'cnpj' or s.cnpj <> '69089327000188' or s.razao_social <> 'Mimo Ltda' or s.nome_fantasia <> 'MIMO' or s.endereco_fiscal ->> 'city' <> 'São Paulo' or s.endereco_igual or jsonb_array_length(s.contatos) <> 2 or s.city <> 'Santos' or array_length(s.fotos, 1) <> 2 or s.fotos[1] <> 'https://x/a.jpg' or s.logo_url <> 'https://x/logo.jpg' then
    raise exception '2b: fiscal errado: % % % % %', s.documento_tipo, s.cnpj, s.endereco_fiscal, s.endereco_igual, s.contatos; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_salvar(sal, jsonb_build_object('documento_tipo', 'cpf', 'cnpj', '', 'responsavel_cpf', '123.456.789-09', 'responsavel_nome', 'Bia Informal', 'responsavel_nascimento', '1990-05-20', 'responsavel_rg', '12.345.678-9', 'razao_social', '', 'endereco_fiscal', null, 'endereco_igual', true));
  reset role;
  select * into s from public.salons where id = sal;
  if s.documento_tipo <> 'cpf' or s.cnpj is not null or s.responsavel_cpf <> '12345678909' or s.razao_social is not null or s.endereco_fiscal is not null or not s.endereco_igual or s.responsavel_nascimento <> date '1990-05-20' or s.responsavel_rg <> '12.345.678-9' then
    raise exception '2b: virar cpf errado: % % % %', s.documento_tipo, s.cnpj, s.responsavel_cpf, s.endereco_fiscal; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_salvar(sal, jsonb_build_object('documento_tipo', 'outro'));
  reset role;
  select * into s from public.salons where id = sal;
  if s.documento_tipo <> 'cpf' then raise exception '2b: tipo desconhecido passou'; end if;
  raise notice '2b identificacao fiscal ok';

  -- 2c. o "quero receber novidades": pelo cadastro (meta.marketing) e pela preferência depois
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.preferir_marketing(true);
  reset role;
  if not (select marketing_ok from public.profiles where id = dona) then raise exception '2c: preferir_marketing não gravou'; end if;
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.preferir_marketing(false);
  reset role;
  if (select marketing_ok from public.profiles where id = dona) then raise exception '2c: preferir_marketing não desligou'; end if;
  sv := gen_random_uuid();
  insert into auth.users (id, email, raw_user_meta_data) values (sv, 'mkt.ensaio@mimo.test', jsonb_build_object('full_name', 'Bia Novidades', 'phone', '(11) 90000-0122', 'termos', '2026-09-24', 'marketing', true));
  if not (select marketing_ok from public.profiles where id = sv) or (select marketing_em from public.profiles where id = sv) is null then raise exception '2c: marketing do cadastro não gravou'; end if;
  raise notice '2c marketing ok';

  -- 3. regras do salão contam reagendar e antecedência
  r := public.pagamento_do_salao(sal);
  if (r ->> 'permite_remarcar')::boolean or (r ->> 'antecedencia_min')::int <> 180 then raise exception '3: regras erradas: %', r; end if;
  raise notice '3 regras ok';

  -- 4. equipe: a dona cadastra uma profissional pelo telefone; a cliente com esse telefone entra pelo convite e vira essa profissional
  insert into public.professionals (salon_id, name, slug, phone, active) values (sal, 'Carla Ensaio', 'carla-ensaio-' || left(gen_random_uuid()::text, 6), '(13) 99999-0001', true) returning id into prof;
  perform set_config('request.jwt.claim.sub', outra::text, false);
  set role authenticated;
  r := public.entrar_na_equipe(s.codigo_equipe);
  reset role;
  if (r ->> 'professional_id')::uuid <> prof then raise exception '4: devia ter virado a Carla, virou %', r; end if;
  select count(*) into n from public.professionals where id = prof and user_id = outra;
  if n <> 1 then raise exception '4: user_id não amarrado'; end if;
  raise notice '4 entrou como a profissional cadastrada ok';

  -- 5. sem telefone conhecido: entra como profissional nova
  perform set_config('request.jwt.claim.sub', terceira::text, false);
  set role authenticated;
  r := public.entrar_na_equipe(s.codigo_equipe);
  reset role;
  select count(*) into n from public.professionals where salon_id = sal and user_id = terceira;
  if n <> 1 then raise exception '5: profissional nova não criada'; end if;
  select count(*) into n from public.salon_members where salon_id = sal and user_id = terceira and papel = 'profissional';
  if n <> 1 then raise exception '5: sem vínculo de equipe'; end if;
  raise notice '5 profissional nova pelo convite ok';

  -- 6. a dona de negócio não entra em equipe alheia; convite errado falha
  perform set_config('request.jwt.claim.sub', dona::text, false);
  deu := false;
  begin set role authenticated; r := public.entrar_na_equipe(s.codigo_equipe); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '6: a dona entrou na própria equipe como profissional'; end if;
  deu := false;
  begin set role authenticated; r := public.entrar_na_equipe('ZZZZZZ'); reset role; exception when others then deu := true; reset role; end;
  if not deu then raise exception '6: convite inexistente aceito'; end if;
  raise notice '6 recusas ok';

  -- 7. antecedência mínima: nenhuma vaga de hoje antes de agora + 3 h
  hoje := public.agora_local()::date; agora := public.agora_local();
  insert into public.professional_hours (professional_id, weekday, open, start_time, end_time) select prof, d, true, time '00:00', time '23:59' from generate_series(0, 6) d on conflict (professional_id, weekday) do update set open = true, start_time = '00:00', end_time = '23:59';
  select min(hora) into primeira from public.horarios_livres(prof, hoje, 30);
  if primeira is not null and (hoje + primeira) <= agora + interval '3 hours' then raise exception '7: vaga antes da antecedência: % (agora %)', primeira, agora; end if;
  raise notice '7 antecedencia ok (primeira vaga %)', primeira;

  -- 8. concluir
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  r := public.onboarding_concluir(sal);
  reset role;
  select * into s from public.salons where id = sal;
  if s.onboarding_concluido_em is null or s.onboarding_passo <> 7 then raise exception '8: não concluiu'; end if;
  raise notice '8 concluir ok';

  -- 9. trocar o tipo: salão vira autônoma (dona ganha a própria ficha) e volta
  perform set_config('request.jwt.claim.sub', dona::text, false);
  set role authenticated;
  deu := false;
  begin r := public.trocar_tipo_negocio(sal, 'autonoma'); exception when others then deu := true; end;
  reset role;
  if not deu then raise exception '9: com equipe, não devia virar autônoma'; end if;
  raise notice '9 troca de tipo com equipe recusada ok';

  raise notice 'FIM DO ENSAIO — tudo certo';
end $$;
rollback;
