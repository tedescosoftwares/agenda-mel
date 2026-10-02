-- 140: o motor da Mel, lado do banco (2.88)
--
-- A Mel comenta o dia do salão. A decisão (qual momento, qual frase) é da
-- Edge Function `mel`; o banco entrega os FATOS num JSON só (mel_contexto),
-- executa as ações que ela oferece (pedir confirmação, ofertar vaga),
-- registra clique e dispensa (mel_marcar) e confirma "concluída" pela
-- operação real que aconteceu, não pelo clique (mel_conciliar, a cada 5
-- min). Entram também o que faltava de calendário: feriados nacionais
-- calculados, feriados da cidade e as datas fortes do setor.
--
-- O ramo do salão (barbearia, unhas, estética…) vem de uma coluna nova em
-- salons, derivada das categorias quando a dona ainda não escolheu.

-- ---------------------------------------------------------------- ramo
alter table public.salons add column if not exists ramo text;
do $$ begin
  alter table public.salons add constraint salons_ramo_conhecido check (ramo is null or ramo in ('beleza', 'barbearia', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem'));
exception when duplicate_object then null; end $$;

-- o ramo escolhido, ou deduzido das categorias globais marcadas e dos
-- serviços cadastrados: só Barba e Cabelo é barbearia, só Unhas é unhas…
create or replace function public.ramo_do_salao(salao uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  nomes text[];
  tem_barba boolean; tem_cabelo boolean; tem_unha boolean; tem_estetica boolean; tem_sobr boolean; tem_dep boolean; tem_maq boolean;
begin
  select * into s from public.salons where id = salao;
  if not found then return 'beleza'; end if;
  if s.ramo is not null then return s.ramo; end if;
  -- as categorias do salão (globais escolhidas + próprias) e os nomes dos serviços
  select coalesce(array_agg(lower(x)), '{}') into nomes from (
    select c.nome as x from public.categorias_de_servico c where c.id = any (s.categorias_escolhidas) or c.salon_id = salao
    union all
    select sv.name from public.services sv where sv.salon_id = salao and sv.active
  ) t;
  tem_barba := exists (select 1 from unnest(nomes) n where n like '%barba%');
  tem_cabelo := exists (select 1 from unnest(nomes) n where n like '%cabelo%' or n like '%corte%' or n like '%escova%' or n like '%progressiva%' or n like '%colora%' or n like '%mecha%');
  tem_unha := exists (select 1 from unnest(nomes) n where n like '%unha%' or n like '%manicure%' or n like '%pedicure%' or n like '%esmalt%');
  tem_estetica := exists (select 1 from unnest(nomes) n where n like '%rosto%' or n like '%corpo%' or n like '%estética%' or n like '%estetica%' or n like '%limpeza de pele%' or n like '%massagem%' or n like '%drenagem%');
  tem_sobr := exists (select 1 from unnest(nomes) n where n like '%sobrancelha%' or n like '%cílio%' or n like '%cilio%');
  tem_dep := exists (select 1 from unnest(nomes) n where n like '%depila%');
  tem_maq := exists (select 1 from unnest(nomes) n where n like '%maquiagem%' or n like '%make%');
  if cardinality(nomes) = 0 then return 'beleza'; end if;
  if tem_barba and not tem_unha and not tem_estetica and not tem_sobr and not tem_dep and not tem_maq then return 'barbearia'; end if;
  if tem_unha and not tem_cabelo and not tem_barba and not tem_estetica and not tem_dep and not tem_maq then return 'unhas'; end if;
  if tem_sobr and not tem_cabelo and not tem_barba and not tem_unha and not tem_estetica and not tem_dep then return 'sobrancelhas_cilios'; end if;
  if tem_dep and not tem_cabelo and not tem_barba and not tem_unha and not tem_sobr and not tem_maq then return 'depilacao'; end if;
  if tem_maq and not tem_cabelo and not tem_barba and not tem_unha and not tem_estetica and not tem_dep then return 'maquiagem'; end if;
  if tem_estetica and not tem_cabelo and not tem_barba and not tem_unha then return 'estetica'; end if;
  if tem_cabelo and not tem_unha and not tem_estetica and not tem_sobr and not tem_dep and not tem_maq then return 'cabelo'; end if;
  return 'beleza';
end;
$$;
revoke execute on function public.ramo_do_salao(uuid) from public, anon;
grant execute on function public.ramo_do_salao(uuid) to authenticated;

-- a dona escolhe (ou limpa, para voltar a deduzir)
create or replace function public.salao_definir_ramo(salao uuid, novo text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona define o ramo.'; end if;
  update public.salons set ramo = nullif(novo, '') where id = salao;
  return jsonb_build_object('ramo', public.ramo_do_salao(salao), 'escolhido', nullif(novo, '') is not null);
end;
$$;
revoke execute on function public.salao_definir_ramo(uuid, text) from public, anon;
grant execute on function public.salao_definir_ramo(uuid, text) to authenticated;

-- ---------------------------------------------------------------- feriados
-- A Páscoa (Meeus/Jones/Butcher): dela saem Carnaval, Sexta-feira Santa e
-- Corpus Christi.
create or replace function public.pascoa(ano integer)
returns date
language plpgsql
immutable
as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := ano % 19; b := ano / 100; c := ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31; dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(ano, mes, dia);
end;
$$;

-- os feriados nacionais de um ano: fixos + os que dependem da Páscoa
create or replace function public.feriados_nacionais(ano integer)
returns table (data date, nome text, ponto_facultativo boolean)
language sql
immutable
as $$
  select * from (values
    (make_date(ano, 1, 1), 'Ano Novo', false),
    (public.pascoa(ano) - 48, 'Carnaval', true),
    (public.pascoa(ano) - 47, 'Carnaval', true),
    (public.pascoa(ano) - 46, 'Quarta-feira de Cinzas', true),
    (public.pascoa(ano) - 2, 'Sexta-feira Santa', false),
    (make_date(ano, 4, 21), 'Tiradentes', false),
    (make_date(ano, 5, 1), 'Dia do Trabalho', false),
    (public.pascoa(ano) + 60, 'Corpus Christi', true),
    (make_date(ano, 9, 7), 'Independência', false),
    (make_date(ano, 10, 12), 'Nossa Senhora Aparecida', false),
    (make_date(ano, 11, 2), 'Finados', false),
    (make_date(ano, 11, 15), 'Proclamação da República', false),
    (make_date(ano, 11, 20), 'Consciência Negra', false),
    (make_date(ano, 12, 25), 'Natal', false)
  ) f(data, nome, ponto_facultativo);
$$;

-- feriados estaduais e municipais: a plataforma cadastra; o salão também
-- pode cadastrar os da própria cidade (ficam só para ele)
create table if not exists public.feriados_locais (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  nome text not null,
  uf text,                          -- estadual quando cidade é null
  cidade text,                      -- municipal (comparado sem acento e caixa)
  salon_id uuid references public.salons (id) on delete cascade,   -- cadastrado pelo salão: só ele vê
  todo_ano boolean not null default true,   -- repete na mesma data todo ano
  created_at timestamptz not null default now()
);
create index if not exists feriados_locais_por_data on public.feriados_locais (data);
alter table public.feriados_locais enable row level security;
revoke all on public.feriados_locais from anon, authenticated;
grant select, insert, update, delete on public.feriados_locais to authenticated;
drop policy if exists "feriados: plataforma administra" on public.feriados_locais;
create policy "feriados: plataforma administra" on public.feriados_locais for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
drop policy if exists "feriados: salao cuida dos seus" on public.feriados_locais;
create policy "feriados: salao cuida dos seus" on public.feriados_locais for all to authenticated using (salon_id is not null and public.is_admin_do_salao(salon_id)) with check (salon_id is not null and public.is_admin_do_salao(salon_id));

create or replace function public.sem_acento(t text)
returns text
language sql
immutable
as $$
  select lower(translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
$$;

-- o feriado de um dia para um salão (nacional, do estado, da cidade ou o
-- que o próprio salão cadastrou), ou null
create or replace function public.feriado_em(dia date, salao uuid default null)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare s public.salons%rowtype; achado text;
begin
  select * into s from public.salons where id = salao;
  select f.nome into achado from public.feriados_nacionais(extract(year from dia)::integer) f where f.data = dia limit 1;
  if achado is not null then return achado; end if;
  select l.nome into achado from public.feriados_locais l
  where (l.data = dia or (l.todo_ano and extract(month from l.data) = extract(month from dia) and extract(day from l.data) = extract(day from dia)))
    and (
      (l.salon_id is not null and l.salon_id = salao)
      or (l.salon_id is null and l.uf is not null and s.uf is not null and upper(l.uf) = upper(s.uf)
          and (l.cidade is null or (s.city is not null and public.sem_acento(l.cidade) = public.sem_acento(s.city))))
    )
  order by l.salon_id nulls last, l.cidade nulls last limit 1;
  return achado;
end;
$$;
revoke execute on function public.feriado_em(date, uuid) from public, anon;
grant execute on function public.feriado_em(date, uuid) to authenticated;

-- ---------------------------------------------------------------- datas fortes do setor
create or replace function public.datas_comerciais(ano integer)
returns table (data date, nome text)
language sql
immutable
as $$
  with mes as (
    -- segundo domingo de maio e de agosto
    select make_date(ano, 5, 1) + ((7 - extract(dow from make_date(ano, 5, 1))::integer) % 7) + 7 as maes,
           make_date(ano, 8, 1) + ((7 - extract(dow from make_date(ano, 8, 1))::integer) % 7) + 7 as pais,
           -- última sexta de novembro
           make_date(ano, 11, 30) - ((extract(dow from make_date(ano, 11, 30))::integer - 5 + 7) % 7) as sexta_preta
  )
  select * from (
    select make_date(ano, 3, 8), 'Dia da Mulher' union all
    select maes, 'Dia das Mães' from mes union all
    select make_date(ano, 6, 12), 'Dia dos Namorados' union all
    select pais, 'Dia dos Pais' from mes union all
    select public.pascoa(ano) - 47, 'Carnaval' union all
    select sexta_preta, 'Black Friday' from mes union all
    select make_date(ano, 12, 25), 'Natal' union all
    select make_date(ano, 12, 31), 'Réveillon'
  ) d(data, nome)
  order by data;
$$;

-- a próxima data forte a partir de hoje: {nome, data, dias}
create or replace function public.proxima_data_comercial(hoje date default null)
returns jsonb
language sql
stable
as $$
  with h as (select coalesce(hoje, public.agora_local()::date) as d)
  select jsonb_build_object('nome', x.nome, 'data', x.data, 'dias', x.data - h.d)
  from h, lateral (
    select * from public.datas_comerciais(extract(year from h.d)::integer)
    union all
    select * from public.datas_comerciais(extract(year from h.d)::integer + 1)
  ) x
  where x.data >= h.d
  order by x.data limit 1;
$$;

-- ---------------------------------------------------------------- os fatos
-- um atendimento, do jeito que a Mel precisa
create or replace function public.mel_atendimento(ap public.appointments)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', ap.id,
    'hora', to_char(ap.start_time, 'HH24:MI'),
    'hora_fim', to_char(ap.end_time, 'HH24:MI'),
    'cliente', coalesce(split_part(btrim(coalesce(pr.full_name, ap.guest_name, '')), ' ', 1), ''),
    'cliente_id', ap.client_id,
    'servico', coalesce(ap.service_name, sv.name, ''),
    'professional_id', ap.professional_id,
    'profissional', coalesce(split_part(btrim(coalesce(p.name, '')), ' ', 1), ''),
    'status', ap.status,
    'minutos', greatest(0, extract(epoch from (ap.end_time - ap.start_time)) / 60)::integer,
    'preco_cents', coalesce(ap.price_cents, 0),
    'lembrete_enviado', ap.reminder_sent_at is not null,
    'nova', ap.client_id is not null and not exists (
      select 1 from public.appointments x where x.client_id = ap.client_id and x.salon_id = ap.salon_id and x.status = 'concluido' and x.id <> ap.id)
  )
  from (select 1) um
  left join public.profiles pr on pr.id = ap.client_id
  left join public.services sv on sv.id = ap.service_id
  left join public.professionals p on p.id = ap.professional_id;
$$;

-- minutos de expediente num dia (horário de cada profissional, ou o do
-- salão quando ela não tem o próprio)
create or replace function public.mel_minutos_abertos(salao uuid, dia date, filtro uuid default null)
returns integer
language sql
stable
as $$
  select coalesce(sum(
    case when ph.professional_id is not null then (case when ph.open then extract(epoch from (ph.end_time - ph.start_time)) / 60 else 0 end)
         when bh.salon_id is not null then (case when bh.open then extract(epoch from (bh.end_time - bh.start_time)) / 60 else 0 end)
         else 0 end), 0)::integer
  from public.professionals p
  left join public.professional_hours ph on ph.professional_id = p.id and ph.weekday = extract(dow from dia)::integer
  left join public.business_hours bh on bh.salon_id = salao and bh.weekday = extract(dow from dia)::integer
  where p.salon_id = salao and p.active and (filtro is null or p.id = filtro);
$$;

-- os buracos de pelo menos uma hora num dia, por profissional
create or replace function public.mel_vagas(salao uuid, dia date, filtro uuid default null)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  with h as (
    select p.id as prof, split_part(p.name, ' ', 1) as nome, hl.hora
    from public.professionals p
    cross join lateral public.horarios_livres(p.id, dia, 60) hl
    where p.salon_id = salao and p.active and (filtro is null or p.id = filtro)
  ),
  g as (
    select *, hora - (row_number() over (partition by prof order by hora)) * interval '30 minutes' as grupo from h
  ),
  blocos as (
    select prof, nome, min(hora) as inicio, (max(hora) + interval '60 minutes')::time as fim
    from g group by prof, nome, grupo
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'professional_id', prof, 'profissional', nome,
    'inicio', to_char(inicio, 'HH24:MI'), 'fim', to_char(fim, 'HH24:MI'),
    'minutos', (extract(epoch from (fim - inicio)) / 60)::integer
  ) order by inicio), '[]'::jsonb)
  from blocos
  where (dia + inicio) > public.agora_local() + interval '60 minutes';
$$;

-- o JSON de fatos que o motor lê. Dona vê o salão; profissional da
-- equipe vê só a agenda dela.
create or replace function public.mel_contexto(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  dona boolean; minha uuid; filtro uuid;
  agora timestamp := public.agora_local();
  hoje date; amanha date; hora time;
  hoje_j jsonb; amanha_j jsonb; semana_j jsonb; oper_j jsonb; clima_j jsonb; hist_j jsonb; pessoa_j jsonb; salao_j jsonb;
  abertos_hoje integer; abertos_amanha integer; marcados_semana integer := 0; abertos_semana integer := 0; d date; seg date;
  canal_auto boolean; nome_pessoa text;
begin
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() and p.active limit 1;
  if not dona and minha is null then raise exception 'Sem acesso a este salão.'; end if;
  filtro := case when dona then null else minha end;
  hoje := agora::date; amanha := hoje + 1; hora := agora::time;

  -- hoje
  abertos_hoje := public.mel_minutos_abertos(salao, hoje, filtro);
  select jsonb_build_object(
    'total', count(*) filter (where status <> 'cancelado'),
    'confirmados', count(*) filter (where status = 'confirmado'),
    'pendentes', count(*) filter (where status = 'pendente'),
    'concluidos', count(*) filter (where status = 'concluido'),
    'faltas', count(*) filter (where status = 'faltou'),
    'restantes', count(*) filter (where status = 'confirmado' and end_time > hora),
    'em_andamento', count(*) filter (where status = 'confirmado' and start_time <= hora and end_time > hora),
    'faturamento_cents', coalesce(sum(price_cents) filter (where status = 'concluido'), 0),
    'previsto_cents', coalesce(sum(price_cents) filter (where status in ('confirmado', 'concluido')), 0),
    'minutos_marcados', coalesce(sum(greatest(0, extract(epoch from (end_time - start_time)) / 60)) filter (where status in ('confirmado', 'pendente', 'concluido')), 0)::integer,
    'minutos_abertos', abertos_hoje,
    'ocupacao_pct', case when abertos_hoje > 0 then least(100, round(100.0 * coalesce(sum(greatest(0, extract(epoch from (end_time - start_time)) / 60)) filter (where status in ('confirmado', 'pendente', 'concluido')), 0) / abertos_hoje)) else null end,
    'sem_lembrete', count(*) filter (where status = 'confirmado' and start_time > hora and reminder_sent_at is null and client_id is not null)
  ) into hoje_j
  from public.appointments ap where ap.salon_id = salao and ap.date = hoje and (filtro is null or ap.professional_id = filtro);

  hoje_j := hoje_j || jsonb_build_object(
    'primeira', (select public.mel_atendimento(ap) from public.appointments ap where ap.salon_id = salao and ap.date = hoje and ap.status = 'confirmado' and (filtro is null or ap.professional_id = filtro) order by ap.start_time limit 1),
    'proxima', (select public.mel_atendimento(ap) || jsonb_build_object('minutos_ate', (extract(epoch from (ap.start_time - hora)) / 60)::integer) from public.appointments ap where ap.salon_id = salao and ap.date = hoje and ap.status = 'confirmado' and ap.start_time > hora and (filtro is null or ap.professional_id = filtro) order by ap.start_time limit 1),
    'ultima', (select public.mel_atendimento(ap) from public.appointments ap where ap.salon_id = salao and ap.date = hoje and ap.status = 'confirmado' and (filtro is null or ap.professional_id = filtro) order by ap.start_time desc limit 1),
    'novas', (select coalesce(jsonb_agg(public.mel_atendimento(ap) order by ap.start_time), '[]'::jsonb) from public.appointments ap where ap.salon_id = salao and ap.date = hoje and ap.status = 'confirmado' and ap.start_time > hora and (filtro is null or ap.professional_id = filtro)
              and ap.client_id is not null and not exists (select 1 from public.appointments x where x.client_id = ap.client_id and x.salon_id = salao and x.status = 'concluido' and x.id <> ap.id)),
    'pendentes_lista', (select coalesce(jsonb_agg(public.mel_atendimento(ap) || jsonb_build_object('data', ap.date, 'esperando_min', (extract(epoch from (now() - ap.created_at)) / 60)::integer) order by ap.created_at), '[]'::jsonb)
                        from (select * from public.appointments ap where ap.salon_id = salao and ap.status = 'pendente' and ap.date >= hoje and (filtro is null or ap.professional_id = filtro) order by ap.created_at limit 5) ap),
    'cancelados_recentes', (select coalesce(jsonb_agg(public.mel_atendimento(ap) || jsonb_build_object('data', ap.date, 'ha_min', (extract(epoch from (now() - ap.cancelado_em)) / 60)::integer, 'pela_casa', ap.cancelado_por is not null and ap.cancelado_por <> coalesce(ap.client_id::text, '')) order by ap.cancelado_em desc), '[]'::jsonb)
                            from public.appointments ap where ap.salon_id = salao and ap.status = 'cancelado' and ap.cancelado_em > now() - interval '90 minutes' and ap.date in (hoje, amanha) and (ap.date + ap.start_time) > agora and (filtro is null or ap.professional_id = filtro)),
    'vagas', public.mel_vagas(salao, hoje, filtro),
    'abre', abertos_hoje > 0,
    'abertura', (select to_char(min(coalesce(ph.start_time, bh.start_time)), 'HH24:MI') from public.professionals p left join public.professional_hours ph on ph.professional_id = p.id and ph.weekday = extract(dow from hoje)::integer and ph.open left join public.business_hours bh on bh.salon_id = salao and bh.weekday = extract(dow from hoje)::integer and bh.open where p.salon_id = salao and p.active and (filtro is null or p.id = filtro)),
    'fechamento', (select to_char(max(coalesce(ph.end_time, bh.end_time)), 'HH24:MI') from public.professionals p left join public.professional_hours ph on ph.professional_id = p.id and ph.weekday = extract(dow from hoje)::integer and ph.open left join public.business_hours bh on bh.salon_id = salao and bh.weekday = extract(dow from hoje)::integer and bh.open where p.salon_id = salao and p.active and (filtro is null or p.id = filtro))
  );

  -- amanhã
  abertos_amanha := public.mel_minutos_abertos(salao, amanha, filtro);
  select jsonb_build_object(
    'data', amanha,
    'dia_semana', extract(dow from amanha)::integer,
    'total', count(*) filter (where status in ('confirmado', 'pendente')),
    'confirmados', count(*) filter (where status = 'confirmado'),
    'sem_lembrete', count(*) filter (where status = 'confirmado' and reminder_sent_at is null and client_id is not null),
    'minutos_abertos', abertos_amanha,
    'abre', abertos_amanha > 0,
    'ocupacao_pct', case when abertos_amanha > 0 then least(100, round(100.0 * coalesce(sum(greatest(0, extract(epoch from (end_time - start_time)) / 60)) filter (where status in ('confirmado', 'pendente')), 0) / abertos_amanha)) else null end,
    'feriado', public.feriado_em(amanha, salao)
  ) into amanha_j
  from public.appointments ap where ap.salon_id = salao and ap.date = amanha and (filtro is null or ap.professional_id = filtro);

  -- a semana que vem (segunda a domingo)
  seg := hoje + (8 - extract(isodow from hoje)::integer);
  for d in select generate_series(seg, seg + 6, interval '1 day')::date loop
    abertos_semana := abertos_semana + public.mel_minutos_abertos(salao, d, filtro);
  end loop;
  select coalesce(sum(greatest(0, extract(epoch from (end_time - start_time)) / 60)), 0)::integer into marcados_semana
  from public.appointments ap where ap.salon_id = salao and ap.date between seg and seg + 6 and ap.status in ('confirmado', 'pendente') and (filtro is null or ap.professional_id = filtro);
  semana_j := jsonb_build_object('inicio', seg, 'minutos_abertos', abertos_semana, 'minutos_marcados', marcados_semana,
    'ocupacao_pct', case when abertos_semana > 0 then least(100, round(100.0 * marcados_semana / abertos_semana)) else null end);

  -- operacional
  canal_auto := exists (select 1 from public.whatsapp_channels c where c.salon_id = salao and c.ativo and c.canal in ('evolution', 'cloud'));
  oper_j := jsonb_build_object(
    'espera', (select count(*) from public.waitlist_entries w join public.professionals p on p.id = w.professional_id where p.salon_id = salao and w.status = 'aguardando' and (filtro is null or p.id = filtro) and (w.date_from is null or w.date_from <= amanha) and (w.date_to is null or w.date_to >= hoje)),
    'fila_whatsapp', (select count(*) from public.message_outbox o where o.salon_id = salao and o.canal = 'manual' and o.status = 'na_fila' and o.liberado_em <= now() and (filtro is null or o.professional_id = filtro)),
    'fila_whatsapp_desde_min', (select (extract(epoch from (now() - min(o.liberado_em))) / 60)::integer from public.message_outbox o where o.salon_id = salao and o.canal = 'manual' and o.status = 'na_fila' and o.liberado_em <= now() and (filtro is null or o.professional_id = filtro)),
    'whatsapp_automatico', canal_auto,
    'baixas_pendentes', (select count(*) from public.appointments ap where ap.salon_id = salao and ap.status = 'confirmado' and (ap.date + ap.end_time) < agora - interval '60 minutes' and (filtro is null or ap.professional_id = filtro)),
    'baixas_de_ontem', (select count(*) from public.appointments ap where ap.salon_id = salao and ap.status = 'confirmado' and ap.date < hoje and (filtro is null or ap.professional_id = filtro)),
    'baixas_valor_cents', (select coalesce(sum(ap.price_cents), 0) from public.appointments ap where ap.salon_id = salao and ap.status = 'confirmado' and (ap.date + ap.end_time) < agora - interval '60 minutes' and (filtro is null or ap.professional_id = filtro)),
    'conversas_humano', (select coalesce(jsonb_agg(jsonb_build_object('cliente', split_part(n.title, ' ', 1), 'minutos', (extract(epoch from (now() - n.created_at)) / 60)::integer) order by n.created_at), '[]'::jsonb)
                         from public.notifications n where n.user_id = auth.uid() and n.kind = 'atendimento_humano' and n.read_at is null and n.created_at > now() - interval '3 hours'),
    'promocao_ativa', exists (select 1 from public.promocoes pm where pm.salon_id = salao and pm.ativa and (pm.fim is null or pm.fim >= hoje))
  );

  -- clima: o que já está no cache da célula do salão (a função clima enche)
  select c.dados || jsonb_build_object('atualizado_em', c.atualizado_em, 'cidade', s.city) into clima_j
  from public.clima_cache c
  where s.lat is not null and s.lng is not null
    and c.celula = to_char(round(s.lat::numeric / 0.05) * 0.05, 'FM999990.00') || ',' || to_char(round(s.lng::numeric / 0.05) * 0.05, 'FM999990.00')
    and c.atualizado_em > now() - interval '2 hours';

  -- o histórico desta pessoa neste salão (cooldown e repetição)
  select jsonb_build_object(
    'primeira_vez', not exists (select 1 from public.mel_exibicoes e where e.user_id = auth.uid()),
    'recentes', coalesce((select jsonb_agg(jsonb_build_object('chave', e.chave, 'identidade', e.identidade, 'superficie', e.superficie, 'frase_id', e.frase_id, 'mostrada_em', e.mostrada_em, 'dispensada_em', e.dispensada_em, 'clicada_em', e.clicada_em, 'concluida_em', e.concluida_em) order by e.mostrada_em desc)
                          from (select * from public.mel_exibicoes e where e.salon_id = salao and e.user_id = auth.uid() and e.mostrada_em > now() - interval '2 days' order by e.mostrada_em desc limit 60) e), '[]'::jsonb)
  ) into hist_j;

  select split_part(btrim(coalesce(pr.full_name, '')), ' ', 1) into nome_pessoa from public.profiles pr where pr.id = auth.uid();
  pessoa_j := jsonb_build_object('user_id', auth.uid(), 'nome', nome_pessoa, 'dona', dona, 'professional_id', minha);
  salao_j := jsonb_build_object('id', s.id, 'nome', s.name, 'tipo', s.tipo, 'ramo', public.ramo_do_salao(salao), 'cidade', s.city, 'uf', s.uf,
    'aceite_automatico', s.aceite_modo = 'automatico', 'dias_desde_criacao', hoje - s.created_at::date,
    'onboarding_concluido', s.onboarding_concluido_em is not null, 'tem_link', s.subdominio is not null or s.slug is not null,
    'equipe', (select count(*) from public.professionals p where p.salon_id = salao and p.active));

  return jsonb_build_object(
    'agora', jsonb_build_object('data', hoje, 'hora', to_char(hora, 'HH24:MI'), 'minutos_do_dia', (extract(epoch from hora) / 60)::integer,
      'dia_semana', extract(dow from hoje)::integer,
      'dia_semana_nome', (array['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'])[extract(dow from hoje)::integer + 1],
      'periodo', case when hora < '12:00' then 'manha' when hora < '18:00' then 'tarde' else 'noite' end),
    'salao', salao_j,
    'pessoa', pessoa_j,
    'hoje', hoje_j,
    'amanha', amanha_j,
    'semana_que_vem', semana_j,
    'operacional', oper_j,
    'calendario', jsonb_build_object('feriado_hoje', public.feriado_em(hoje, salao), 'feriado_amanha', public.feriado_em(amanha, salao), 'data_comercial', public.proxima_data_comercial(hoje)),
    'clima', clima_j,
    'historico', hist_j
  );
end;
$$;
revoke execute on function public.mel_contexto(uuid) from public, anon;
grant execute on function public.mel_contexto(uuid) to authenticated;

-- ---------------------------------------------------------------- telemetria
-- clique, dispensa ou conclusão de uma exibição (da própria pessoa)
create or replace function public.mel_marcar(exibicao uuid, evento text, por text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare e public.mel_exibicoes%rowtype;
begin
  select * into e from public.mel_exibicoes where id = exibicao;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'não existe'); end if;
  if e.user_id <> auth.uid() and not public.is_admin_do_salao(e.salon_id) then raise exception 'Não é sua.'; end if;
  if evento = 'clicada' then update public.mel_exibicoes set clicada_em = coalesce(clicada_em, now()) where id = exibicao;
  elsif evento = 'dispensada' then update public.mel_exibicoes set dispensada_em = coalesce(dispensada_em, now()) where id = exibicao;
  elsif evento = 'concluida' then update public.mel_exibicoes set concluida_em = coalesce(concluida_em, now()), concluida_por = coalesce(concluida_por, por, 'app') where id = exibicao;
  else raise exception 'Evento desconhecido: %', evento;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.mel_marcar(uuid, text, text) from public, anon;
grant execute on function public.mel_marcar(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- ações
-- "Eu confirmaria as próximas": manda agora o lembrete (que já pede "1
-- para confirmar") para os horários do dia que ainda não receberam.
drop function if exists public.mel_pedir_confirmacao(uuid, date, time, uuid);
create or replace function public.mel_pedir_confirmacao(salao uuid, dia date, desde time default null, exibicao uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  dona boolean; minha uuid; a record; n integer := 0; quando text;
begin
  dona := public.is_admin_do_salao(salao) or public.eh_plataforma();
  select p.id into minha from public.professionals p where p.salon_id = salao and p.user_id = auth.uid() and p.active limit 1;
  if not dona and minha is null then raise exception 'Sem acesso a este salão.'; end if;
  quando := case when dia = public.agora_local()::date then 'Hoje' when dia = public.agora_local()::date + 1 then 'Amanhã' else 'Dia ' || to_char(dia, 'DD/MM') end;
  for a in
    select ap.id, ap.client_id, ap.date, ap.start_time, ap.professional_id,
           coalesce(ap.service_name, sv.name, 'Seu atendimento') as servico, p.name as profissional
    from public.appointments ap
    join public.professionals p on p.id = ap.professional_id
    left join public.services sv on sv.id = ap.service_id
    join public.profiles c on c.id = ap.client_id
    where ap.salon_id = salao and ap.date = dia and ap.status = 'confirmado'
      and ap.reminder_sent_at is null and ap.client_id is not null and c.accepts_reminders
      and (desde is null or ap.start_time >= desde)
      and (dona or ap.professional_id = minha)
      and (ap.date + ap.start_time) > public.agora_local()
    order by ap.start_time
  loop
    perform public.notificar(
      a.client_id, 'lembrete_agendamento', quando || ' tem horário marcado',
      a.servico || ' com ' || a.profissional || ' dia ' || to_char(a.date, 'DD/MM') || ' às ' || to_char(a.start_time, 'HH24:MI') || '.',
      '/', jsonb_build_object('appointment_id', a.id),
      (a.date + a.start_time) at time zone 'America/Sao_Paulo');
    update public.appointments set reminder_sent_at = now() where id = a.id;
    insert into public.client_nudges (professional_id, client_id, kind, appointment_id) values (a.professional_id, a.client_id, 'lembrete', a.id);
    n := n + 1;
  end loop;
  if exibicao is not null then
    update public.mel_exibicoes set clicada_em = coalesce(clicada_em, now()), concluida_em = coalesce(concluida_em, now()), concluida_por = coalesce(concluida_por, 'pedir_confirmacao')
    where id = exibicao and (user_id = auth.uid() or dona);
  end if;
  return jsonb_build_object('enviadas', n);
end;
$$;
revoke execute on function public.mel_pedir_confirmacao(uuid, date, time, uuid) from public, anon;
grant execute on function public.mel_pedir_confirmacao(uuid, date, time, uuid) to authenticated;

-- "Quer que eu ofereça?": oferta a vaga para a lista de espera (ofertar_vaga
-- já escolhe quem recebe) e marca a exibição como concluída pela operação.
create or replace function public.mel_ofertar_vaga(prof uuid, dia date, inicio time, fim time, exibicao uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; oferta uuid;
begin
  select * into p from public.professionals where id = prof;
  if not found then raise exception 'Profissional não encontrada.'; end if;
  if not (public.is_professional(prof) or public.is_admin_do_salao(p.salon_id) or public.eh_plataforma()) then raise exception 'Sem acesso.'; end if;
  oferta := public.ofertar_vaga(prof, dia, inicio, fim);
  if oferta is not null and exibicao is not null then
    update public.mel_exibicoes set clicada_em = coalesce(clicada_em, now()), concluida_em = coalesce(concluida_em, now()), concluida_por = coalesce(concluida_por, 'ofertar_vaga')
    where id = exibicao and salon_id = p.salon_id;
  end if;
  return jsonb_build_object('ok', oferta is not null, 'oferta', oferta);
end;
$$;
revoke execute on function public.mel_ofertar_vaga(uuid, date, time, time, uuid) from public, anon;
grant execute on function public.mel_ofertar_vaga(uuid, date, time, time, uuid) to authenticated;

-- ---------------------------------------------------------------- conciliação
-- "concluída" pela operação que de fato aconteceu depois do clique: a vaga
-- foi preenchida ou ofertada, o pedido respondido, a fila esvaziou, o dia
-- fechou, a promoção existe. Roda a cada 5 min (cron) e olha as últimas 3h.
create or replace function public.mel_conciliar()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare e record; feito text; n integer := 0; agora timestamp := public.agora_local();
begin
  for e in
    select * from public.mel_exibicoes x
    where x.clicada_em is not null and x.concluida_em is null and x.clicada_em > now() - interval '3 hours' and x.acao is not null
  loop
    feito := null;
    case e.acao ->> 'type'
      when 'VER_PEDIDOS' then
        if not exists (select 1 from public.appointments a where a.salon_id = e.salon_id and a.status = 'pendente' and a.id::text in (select jsonb_array_elements_text(coalesce(e.acao -> 'payload' -> 'ids', '[]'::jsonb)))) then feito := 'pedidos_respondidos'; end if;
      when 'DIVULGAR_VAGA', 'OFERTAR_VAGA_LISTA' then
        if exists (select 1 from public.appointments a where a.salon_id = e.salon_id and a.created_at > e.clicada_em and a.status <> 'cancelado'
                   and a.date = coalesce((e.acao -> 'payload' ->> 'dia')::date, a.date)
                   and ((e.acao -> 'payload' ->> 'hora') is null or a.start_time between (e.acao -> 'payload' ->> 'hora')::time - interval '30 minutes' and (e.acao -> 'payload' ->> 'hora')::time + interval '90 minutes')) then feito := 'vaga_preenchida';
        elsif exists (select 1 from public.waitlist_offers o join public.waitlist_entries w on w.id = o.entry_id join public.professionals p on p.id = w.professional_id
                      where p.salon_id = e.salon_id and o.created_at > e.clicada_em) then feito := 'oferta_enviada';
        end if;
      when 'FECHAR_DIA' then
        if exists (select 1 from public.comandas c where c.salon_id = e.salon_id and c.fechada_em > e.clicada_em)
           or exists (select 1 from public.appointments a where a.salon_id = e.salon_id and a.faltou_em > e.clicada_em)
           or not exists (select 1 from public.appointments a where a.salon_id = e.salon_id and a.status = 'confirmado' and (a.date + a.end_time) < agora - interval '60 minutes') then feito := 'dia_fechado'; end if;
      when 'VER_FILA_WHATSAPP' then
        if not exists (select 1 from public.message_outbox o where o.salon_id = e.salon_id and o.canal = 'manual' and o.status = 'na_fila' and o.liberado_em <= now()) then feito := 'fila_enviada'; end if;
      when 'CRIAR_PROMOCAO' then
        if exists (select 1 from public.promocoes pm where pm.salon_id = e.salon_id and pm.created_at > e.clicada_em) then feito := 'promocao_criada'; end if;
      else feito := null;
    end case;
    if feito is not null then
      update public.mel_exibicoes set concluida_em = now(), concluida_por = feito where id = e.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.mel_conciliar() from public, anon, authenticated;

-- no relógio da casa, junto das outras rotinas (só onde o pg_cron existe)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('mimo-mel');
    exception when others then null;
    end;
    perform cron.schedule('mimo-mel', '*/5 * * * *', 'select public.mel_conciliar()');
  end if;
end $$;
