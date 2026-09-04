-- =============================================================
-- MIMO — povoar: gente de mentira para ver as coisas funcionando
--
-- Cole no SQL Editor do Supabase e rode. NÃO faz parte das migrações:
-- é opcional, e existe para o app não parecer vazio enquanto você
-- testa. Tudo que cria é claramente fictício (@exemplo.com) e sai
-- inteiro com o bloco DESPOVOAR no fim.
--
-- O que nasce (todas as senhas: agendamel123):
--
--   cliente01@exemplo.com … cliente05@exemplo.com   cinco clientes
--   bruna@exemplo.com   Bruna Castro     cabelo (corte, escova, cor)
--   carla@exemplo.com   Carla Nunes      cílios e sobrancelhas
--   dani@exemplo.com    Daniela Reis     unhas (gel, nail art)
--   fer@exemplo.com     Fernanda Souza   estética (pele, massagem)
--
--   + serviços novos no Espaço Mel, ligados a quem faz cada um
--   + ~30 atendimentos concluídos por profissional nos últimos 90 dias
--     (a Ana Paula e a Mel, que já existiam, ganham histórico também)
--   + avaliações em boa parte deles, com nota e comentário
--   + alguns horários confirmados nos próximos dias
--   + favoritas para as clientes
--
-- Rodar de novo é seguro: quem já existe não é duplicado.
-- =============================================================

set search_path = public, extensions;
create extension if not exists pgcrypto with schema extensions;

-- foto de mentira: um SVG com gradiente e as iniciais, guardado inline.
-- Não depende de site nenhum e aparece em qualquer lugar.
create or replace function pg_temp.foto_de_mentira(nome text, cor1 text, cor2 text)
returns text
language sql
immutable
as $$
  select 'data:image/svg+xml;base64,' || replace(encode(convert_to(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">'
    || '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    || '<stop offset="0" stop-color="' || cor1 || '"/><stop offset="1" stop-color="' || cor2 || '"/>'
    || '</linearGradient></defs><rect width="400" height="400" fill="url(#g)"/>'
    || '<circle cx="200" cy="150" r="70" fill="rgba(255,255,255,.85)"/>'
    || '<path d="M70 390c10-95 60-135 130-135s120 40 130 135z" fill="rgba(255,255,255,.85)"/>'
    || '<text x="200" y="372" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="700" fill="' || cor2 || '">'
    || upper(left(split_part(nome, ' ', 1), 1) || left(split_part(nome, ' ', 2), 1))
    || '</text></svg>', 'UTF8'), 'base64'), E'\n', '');
$$;

-- cria (ou acha) uma conta com senha, perfil e papel
create or replace function pg_temp.conta(email_ text, nome text, fone text, papel text)
returns uuid
language plpgsql
as $$
declare
  uid uuid;
  tem_provider_id boolean;
begin
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
      'authenticated', email_, crypt('agendamel123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', nome, 'phone', fone),
      now(), now(), '', '', '', ''
    );
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) into tem_provider_id;

  if not exists (select 1 from auth.identities i where i.user_id = uid and i.provider = 'email') then
    if tem_provider_id then
      insert into auth.identities (id, user_id, identity_data, provider, provider_id,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', email_),
              'email', email_, now(), now(), now());
    else
      insert into auth.identities (id, user_id, identity_data, provider,
                                   last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, jsonb_build_object('sub', uid::text, 'email', email_),
              'email', now(), now(), now());
    end if;
  end if;

  insert into public.profiles (id, full_name, phone, referral_code)
  select uid, nome, fone, public.gerar_codigo_indicacao(nome)
  where not exists (select 1 from public.profiles where id = uid);

  update public.profiles set role = papel, full_name = nome, phone = fone where id = uid;
  return uid;
end;
$$;

-- cria (ou acha) um serviço do salão
create or replace function pg_temp.servico(salao uuid, nome text, descricao text, minutos integer, preco numeric)
returns uuid
language plpgsql
as $$
declare
  sid uuid;
begin
  select id into sid from public.services where salon_id = salao and name = nome;
  if sid is null then
    insert into public.services (salon_id, name, description, duration_minutes, price)
    values (salao, nome, descricao, minutos, preco) returning id into sid;
  end if;
  return sid;
end;
$$;

do $$
declare
  salao uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;

  cli uuid[] := '{}';
  nomes_cli text[] := array['Juliana Martins', 'Patrícia Lima', 'Renata Alves', 'Camila Duarte', 'Larissa Moraes'];
  fones_cli text[] := array['(13) 99811-0101', '(13) 99811-0202', '(13) 99811-0303', '(13) 99811-0404', '(13) 99811-0505'];

  -- as profissionais novas: email, nome, slug, especialidade, instagram, bio, cores da foto
  profs text[][] := array[
    ['bruna@exemplo.com', 'Bruna Castro',   'bruna-castro',   'Cabeleireira · cortes e coloração',    'bruna.castro.hair',
     'Quinze anos de tesoura na mão. Corte que cresce bonito, cor que não desbota em duas semanas e escova que aguenta o dia inteiro. Atendo com hora marcada e sem pressa.', '#ff7baa', '#aa4cff'],
    ['carla@exemplo.com', 'Carla Nunes',    'carla-nunes',    'Lash designer · cílios e sobrancelhas', 'carlanunes.lash',
     'Extensão de cílios fio a fio e design de sobrancelhas com mapeamento. Especialista em deixar natural — ninguém percebe que você fez, todo mundo percebe que você está diferente.', '#ffb86b', '#ff2d7a'],
    ['dani@exemplo.com',  'Daniela Reis',   'daniela-reis',   'Nail designer · gel e nail art',        'dani.reis.nails',
     'Unhas em gel, alongamento e nail art. Esterilização de tudo, sempre. Se você tem unha fraca ou roída, eu tenho paciência: a gente recupera juntas.', '#b8a7f7', '#3d0c4e'],
    ['fer@exemplo.com',   'Fernanda Souza', 'fernanda-souza', 'Esteticista · pele e massagem',        'fer.souza.estetica',
     'Limpeza de pele, peeling e massagem relaxante. Formada em estética há 8 anos, atendo num ambiente silencioso com aromaterapia. Vem descansar.', '#ffd166', '#ff7baa']
  ];
  pid uuid[] := '{}';
  ana uuid;

  s_corte uuid; s_escova uuid; s_cor uuid; s_hidra uuid;
  s_cilios uuid; s_manut uuid; s_sobr uuid; s_lamin uuid;
  s_gel uuid; s_alonga uuid; s_mani uuid; s_pedi uuid;
  s_limpeza uuid; s_peeling uuid; s_massagem uuid;

  -- por profissional: quais serviços ela faz
  servs uuid[][];
  uid uuid; p uuid; sv uuid; s_rec record;
  i integer; j integer; n integer;
  dia date; hora time; dur integer;
  appt uuid;
  quantos_hist integer := 0; quantos_rev integer := 0; quantos_fut integer := 0;

  comentarios text[] := array[
    'Atendimento impecável, saí renovada!',
    'Super atenciosa e caprichosa. Já marquei o próximo.',
    'Ficou lindo, exatamente como eu pedi.',
    'Ambiente gostoso, pontual e delicada. Recomendo demais.',
    'Ficou ótimo, só atrasou um pouquinho.',
    'Melhor profissional que já fui. Não troco.',
    'Amei o resultado, durou muito mais do que eu esperava.',
    'Cuidadosa com tudo, explica cada passo. Adorei.',
    'Bom, mas achei um pouco caro pelo tempo.',
    'Perfeito. Minha mãe já quer marcar também.',
    null, null, null
  ];
begin
  select id into salao from public.salons where slug = 'espaco-mel';
  if salao is null then
    raise exception 'Rode primeiro o setup (o salão espaco-mel do 018 não existe).';
  end if;

  -- 1. As clientes ---------------------------------------------------------
  for i in 1..5 loop
    uid := pg_temp.conta('cliente0' || i || '@exemplo.com', nomes_cli[i], fones_cli[i], 'cliente');
    cli := cli || uid;
  end loop;

  -- 2. Os serviços ---------------------------------------------------------
  s_corte    := pg_temp.servico(salao, 'Corte feminino', 'Lavagem, corte e finalização.', 60, 90);
  s_escova   := pg_temp.servico(salao, 'Escova', 'Lavagem e escova modelada.', 45, 60);
  s_cor      := pg_temp.servico(salao, 'Coloração', 'Cor completa com tratamento pós-química.', 120, 220);
  s_hidra    := pg_temp.servico(salao, 'Hidratação profunda', 'Máscara de reconstrução e escova.', 60, 110);
  s_cilios   := pg_temp.servico(salao, 'Extensão de cílios', 'Fio a fio, efeito natural ou volume.', 120, 180);
  s_manut    := pg_temp.servico(salao, 'Manutenção de cílios', 'Reposição dos fios até 3 semanas.', 60, 100);
  s_sobr     := pg_temp.servico(salao, 'Design de sobrancelhas', 'Mapeamento facial, pinça e finalização.', 45, 60);
  s_lamin    := pg_temp.servico(salao, 'Brow lamination', 'Alinhamento dos fios com efeito penteado.', 60, 140);
  s_gel      := pg_temp.servico(salao, 'Esmaltação em gel', 'Dura até 3 semanas sem lascar.', 60, 75);
  s_alonga   := pg_temp.servico(salao, 'Alongamento em gel', 'Alongamento com molde e esmaltação.', 120, 160);
  s_mani     := pg_temp.servico(salao, 'Manicure', 'Cutilagem, lixamento e esmaltação.', 45, 35);
  s_pedi     := pg_temp.servico(salao, 'Pedicure', 'Cutilagem, lixamento e esmaltação.', 45, 40);
  s_limpeza  := pg_temp.servico(salao, 'Limpeza de pele', 'Higienização profunda com extração e máscara calmante.', 60, 120);
  s_peeling  := pg_temp.servico(salao, 'Peeling de diamante', 'Esfoliação profunda com ponteira de diamante.', 45, 150);
  s_massagem := pg_temp.servico(salao, 'Massagem relaxante', 'Corpo inteiro, com óleo morno.', 60, 130);

  servs := array[
    array[s_corte, s_escova, s_cor, s_hidra],
    array[s_cilios, s_manut, s_sobr, s_lamin],
    array[s_gel, s_alonga, s_mani, s_pedi],
    array[s_limpeza, s_peeling, s_massagem, s_sobr]
  ];

  -- 3. As profissionais ----------------------------------------------------
  for i in 1..4 loop
    uid := pg_temp.conta(profs[i][1], profs[i][2], '(13) 9987' || i || '-1' || i || '0' || i, 'profissional');
    select id into p from public.professionals where slug = profs[i][3];
    if p is null then
      insert into public.professionals
        (salon_id, user_id, name, slug, bio, phone, buffer_minutes, aceite_manual,
         especialidade, instagram, whatsapp_publico, photo_url)
      values (salao, uid, profs[i][2], profs[i][3], profs[i][6],
              '(13) 9987' || i || '-1' || i || '0' || i, 10, i <> 4,
              profs[i][4], profs[i][5], '5513987' || i || '1' || i || '0' || i,
              pg_temp.foto_de_mentira(profs[i][2], profs[i][7], profs[i][8]))
      returning id into p;
    else
      update public.professionals
      set especialidade = coalesce(especialidade, profs[i][4]),
          instagram = coalesce(instagram, profs[i][5]),
          photo_url = coalesce(photo_url, pg_temp.foto_de_mentira(profs[i][2], profs[i][7], profs[i][8]))
      where id = p;
    end if;
    pid := pid || p;

    insert into public.salon_members (salon_id, user_id, papel)
    values (salao, uid, 'profissional') on conflict do nothing;

    for j in 1..4 loop
      insert into public.professional_services (professional_id, service_id)
      values (p, servs[i][j]) on conflict do nothing;
    end loop;

    -- terça a sábado, com almoço
    update public.professional_hours
    set open = (weekday between 2 and 6),
        start_time = case when weekday = 6 then '08:00'::time else '09:00'::time end,
        end_time = case when weekday = 6 then '15:00'::time else '19:00'::time end
    where professional_id = p;

    insert into public.professional_blocks
      (professional_id, kind, weekday, all_day, start_time, end_time, reason)
    select p, 'semanal', d, false, '12:00', '13:00', 'Almoço'
    from generate_series(2, 6) as d
    where not exists (select 1 from public.professional_blocks b
                      where b.professional_id = p and b.kind = 'semanal' and b.weekday = d and b.reason = 'Almoço');
  end loop;

  -- a Ana Paula (do 018) entra na brincadeira também
  select id into ana from public.professionals where slug = 'ana-paula';
  if ana is not null then
    pid := pid || ana;
    servs := servs || array[array[s_limpeza, s_sobr, s_massagem, s_sobr]];
    update public.professionals
    set especialidade = coalesce(especialidade, 'Esteticista · pele e sobrancelhas'),
        instagram = coalesce(instagram, 'anapaula.estetica'),
        photo_url = coalesce(photo_url, pg_temp.foto_de_mentira('Ana Paula', '#ff2d7a', '#3d0c4e'))
    where id = ana;
  end if;

  -- e a Mel, dona da casa (do 032), também: ela é quem mais testa
  select id into ana from public.professionals where slug = 'mel';
  if ana is not null then
    pid := pid || ana;
    servs := servs || array[array[s_limpeza, s_sobr, s_massagem, s_gel]];
    for j in 1..4 loop
      insert into public.professional_services (professional_id, service_id)
      values (ana, servs[array_length(pid, 1)][j]) on conflict do nothing;
    end loop;
    update public.professionals
    set especialidade = coalesce(especialidade, 'Dona do Espaço Mel · pele, sobrancelhas e unhas'),
        instagram = coalesce(instagram, 'espacomel.santos'),
        bio = coalesce(bio, 'Abri o Espaço Mel para atender do jeito que eu sempre quis ser atendida: com hora marcada, sem correria e com produto bom. Faço pele, sobrancelhas e unhas em gel.'),
        photo_url = coalesce(photo_url, pg_temp.foto_de_mentira('Mel Tedesco', '#aa4cff', '#ff2d7a'))
    where id = ana;
  end if;

  -- 4. Histórico -----------------------------------------------------------
  -- O gatilho de "horário novo na sua agenda" mandaria um WhatsApp para
  -- cada linha. Histórico não é novidade: fica mudo enquanto povoa.
  alter table public.appointments disable trigger tg_avisa_profissional_novo;

  for i in 1..array_length(pid, 1) loop
    p := pid[i];
    if exists (select 1 from public.appointments a
               where a.professional_id = p and a.status = 'concluido'
                 and a.notes = 'povoar') then
      continue;   -- já povoada
    end if;

    -- ~30 atendimentos espalhados nos últimos 90 dias, sem se sobrepor:
    -- um por dia, em dia que ela abre, hora variando
    n := 0;
    for j in 1..90 loop
      dia := hoje - j;
      if extract(dow from dia) not between 2 and 6 then continue; end if;
      if (j + i) % 3 = 0 then continue; end if;       -- nem todo dia
      sv := servs[i][1 + ((j + i) % 4)];
      select duration_minutes, name, price into s_rec from public.services where id = sv;
      hora := ('09:00'::time + make_interval(mins => 90 * ((j * 7 + i) % 5)));
      if hora + make_interval(mins => s_rec.duration_minutes) > '19:00'::time then hora := '09:00'; end if;

      begin
        insert into public.appointments
          (client_id, professional_id, salon_id, service_id, service_name, price_cents,
           date, start_time, end_time, status, notes, created_at)
        values
          (cli[1 + ((j * 3 + i) % 5)], p, salao, sv, s_rec.name, round(s_rec.price * 100)::integer,
           dia, hora, hora + make_interval(mins => s_rec.duration_minutes),
           case when (j + i) % 17 = 0 then 'faltou' else 'concluido' end,
           'povoar', (dia - 3)::timestamptz)
        returning id into appt;
      exception when unique_violation or exclusion_violation then
        continue;   -- a Ana Paula já tinha agenda de verdade nesse horário
      end;
      n := n + 1;
      quantos_hist := quantos_hist + 1;

      -- avaliação em boa parte dos concluídos (notas boas, com umas 4)
      if (j + i) % 17 <> 0 and (j * 7 + i) % 4 <> 0 then
        insert into public.reviews (appointment_id, client_id, professional_id, nota, comentario, created_at)
        values (appt, cli[1 + ((j * 3 + i) % 5)], p,
                case when (j * 3 + i) % 7 = 0 then 4 else 5 end,
                comentarios[1 + ((j * 11 + i) % array_length(comentarios, 1))],
                (dia + 1)::timestamptz + interval '20 hours')
        on conflict (appointment_id) do nothing;
        quantos_rev := quantos_rev + 1;
      end if;
    end loop;

    -- 5. Os próximos dias: alguns horários confirmados ------------------
    for j in 1..12 loop
      dia := hoje + j;
      if extract(dow from dia) not between 2 and 6 then continue; end if;
      if (j + i) % 2 = 0 then continue; end if;
      sv := servs[i][1 + ((j + i) % 4)];
      select duration_minutes, name, price into s_rec from public.services where id = sv;
      hora := ('09:00'::time + make_interval(mins => 90 * ((j * 3 + i) % 5)));
      if hora + make_interval(mins => s_rec.duration_minutes) > '19:00'::time then hora := '09:00'; end if;
      begin
        insert into public.appointments
          (client_id, professional_id, salon_id, service_id, service_name, price_cents,
           date, start_time, end_time, status, notes)
        values
          (cli[1 + ((j + i) % 5)], p, salao, sv, s_rec.name, round(s_rec.price * 100)::integer,
           dia, hora, hora + make_interval(mins => s_rec.duration_minutes), 'confirmado', 'povoar');
        quantos_fut := quantos_fut + 1;
      exception when unique_violation or exclusion_violation then
        null;   -- já tinha alguém ali (a Ana Paula tem agenda de verdade)
      end;
    end loop;
  end loop;

  alter table public.appointments enable trigger tg_avisa_profissional_novo;

  -- 6. Favoritas -------------------------------------------------------------
  for i in 1..5 loop
    for j in 1..array_length(pid, 1) loop
      if (i + j) % 2 = 0 then
        insert into public.client_favorites (client_id, professional_id)
        values (cli[i], pid[j]) on conflict do nothing;
      end if;
    end loop;
  end loop;

  raise notice 'Pronto: 5 clientes, % profissionais com vitrine, % atendimentos passados, % avaliações, % horários futuros.',
    array_length(pid, 1), quantos_hist, quantos_rev, quantos_fut;
end;
$$;

-- conferência
select p.name, p.slug,
       (select count(*) from public.appointments a where a.professional_id = p.id and a.status = 'concluido') as concluidos,
       (select round(avg(nota), 1) from public.reviews r where r.professional_id = p.id) as nota,
       (select count(*) from public.reviews r where r.professional_id = p.id) as avaliacoes
from public.professionals p
order by p.name;

-- =============================================================
-- DESPOVOAR — apaga tudo que este arquivo criou. Descomente e rode.
--
-- delete from public.appointments where notes = 'povoar';
-- delete from auth.users where email in
--   ('cliente01@exemplo.com','cliente02@exemplo.com','cliente03@exemplo.com',
--    'cliente04@exemplo.com','cliente05@exemplo.com',
--    'bruna@exemplo.com','carla@exemplo.com','dani@exemplo.com','fer@exemplo.com');
-- delete from public.professionals where slug in
--   ('bruna-castro','carla-nunes','daniela-reis','fernanda-souza');
-- =============================================================
