-- 139: a personalidade da Mel (2.87)
--
-- A Mel vai comentar o dia do salão (o motor de contexto vem depois). O
-- que ela FALA mora aqui, administrado pela Plataforma sem deploy; QUANDO
-- ela fala continua em código. Três tabelas, cada uma com um papel só:
--
--   mel_momentos   o catálogo: descrição de cada "momento" que o motor
--                  sabe detectar (chave, placeholders, superfícies). É
--                  semeado por migração e ninguém escreve pela API: a
--                  condição real de cada momento (temperatura >= 33,
--                  cliente em 20 min…) é lógica do sistema, não editorial.
--   mel_frases     a biblioteca editorial: o texto, para qual momento e
--                  superfície, filtros opcionais (ramo, tipo, clima,
--                  período), tom, peso, ativa. A Plataforma administra.
--   mel_exibicoes  histórico e telemetria: cada vez que a Mel apareceu,
--                  com o template usado naquele instante (mesmo que a
--                  frase seja editada depois), clique, dispensa, conclusão.
--
-- Validação única no banco (mel_frase_validar), usada pelo trigger e pela
-- importação em massa (mel_frases_importar), para que a tela e qualquer
-- import por fora sigam a mesma regra.

-- ---------------------------------------------------------------- catálogo
create table if not exists public.mel_momentos (
  chave        text primary key,
  categoria    text not null check (categoria in ('agenda', 'oportunidade', 'marco', 'clima', 'calendario', 'operacional', 'geral')),
  rotulo       text not null,
  descricao    text not null default '',
  superficies  text[] not null default '{mel_bubble}' check (superficies <@ array['mel_bubble', 'weather_card']::text[] and cardinality(superficies) > 0),
  placeholders text[] not null default '{}',
  exemplo      jsonb not null default '{}'::jsonb,       -- valores fictícios para a prévia
  ordem        integer not null default 0
);
alter table public.mel_momentos enable row level security;
revoke all on public.mel_momentos from anon, authenticated;
grant select on public.mel_momentos to authenticated;      -- a política abaixo deixa só a plataforma
drop policy if exists "mel_momentos: plataforma le" on public.mel_momentos;
create policy "mel_momentos: plataforma le" on public.mel_momentos for select to authenticated using (public.eh_plataforma());

-- ---------------------------------------------------------------- frases
create table if not exists public.mel_frases (
  id              uuid primary key default gen_random_uuid(),
  chave           text not null references public.mel_momentos (chave),
  superficie      text not null check (superficie in ('mel_bubble', 'weather_card')),
  texto           text not null check (length(btrim(texto)) > 0),
  ramos           text[] check (ramos is null or ramos <@ array['beleza', 'barbearia', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem']::text[]),
  tipos           text[] check (tipos is null or tipos <@ array['salao', 'autonoma']::text[]),
  contextos_clima text[] check (contextos_clima is null or contextos_clima <@ array['ensolarado', 'nublado', 'chuva', 'trovoada', 'frio', 'calor']::text[]),
  periodos        text[] check (periodos is null or periodos <@ array['manha', 'tarde', 'noite']::text[]),
  tom             text not null default 'neutra' check (tom in ('feliz', 'atenta', 'alerta', 'comemorando', 'cansada', 'neutra')),
  peso            smallint not null default 1 check (peso between 1 and 10),
  ativa           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists mel_frases_sem_repetida on public.mel_frases (chave, superficie, lower(btrim(texto)));
create index if not exists mel_frases_por_momento on public.mel_frases (chave, superficie) where ativa;
alter table public.mel_frases enable row level security;
revoke all on public.mel_frases from anon, authenticated;
grant select, insert, update, delete on public.mel_frases to authenticated;
drop policy if exists "mel_frases: plataforma administra" on public.mel_frases;
create policy "mel_frases: plataforma administra" on public.mel_frases for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());

-- ---------------------------------------------------------------- exibições
create table if not exists public.mel_exibicoes (
  id                      uuid primary key default gen_random_uuid(),
  salon_id                uuid references public.salons (id) on delete cascade,
  user_id                 uuid,
  chave                   text not null references public.mel_momentos (chave),
  identidade              text,
  superficie              text not null check (superficie in ('mel_bubble', 'weather_card')),
  frase_id                uuid references public.mel_frases (id) on delete restrict,
  texto_template_snapshot text,                 -- o template como estava ao exibir; nunca o texto interpolado
  avatar_key              text,
  acao                    jsonb,                -- {type, payload} oferecida, se houve
  mostrada_em             timestamptz not null default now(),
  clicada_em              timestamptz,
  dispensada_em           timestamptz,
  concluida_em            timestamptz,
  concluida_por           text                  -- qual operação confirmou (ex.: 'ofertar_vaga', 'fechar_dia')
);
create index if not exists mel_exibicoes_por_frase on public.mel_exibicoes (frase_id);
create index if not exists mel_exibicoes_por_salao on public.mel_exibicoes (salon_id, chave, mostrada_em desc);
alter table public.mel_exibicoes enable row level security;
revoke all on public.mel_exibicoes from anon, authenticated;   -- só o motor (service role) e RPCs definidas depois

-- ---------------------------------------------------------------- validação
-- os placeholders de um texto: '{cliente} às {hora}' -> {cliente, hora}
create or replace function public.mel_placeholders_de(texto text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(m[1] order by m[1]), '{}'::text[])
  from regexp_matches(coalesce(texto, ''), '\{([^{}]*)\}', 'g') m;
$$;

-- devolve null quando a frase está certa, ou a mensagem do problema.
-- Recebe o JSON no mesmo formato da importação/exportação.
create or replace function public.mel_frase_validar(item jsonb)
returns text
language plpgsql
stable
as $$
declare
  m public.mel_momentos%rowtype;
  chave_ text := item ->> 'chave';
  sup text := item ->> 'superficie';
  txt text := item ->> 'texto';
  ph text; lista text[]; v text;
  sobra text;
begin
  if item is null or jsonb_typeof(item) <> 'object' then return 'não é um objeto'; end if;
  if coalesce(chave_, '') = '' then return 'falta o moment (chave)'; end if;
  select * into m from public.mel_momentos where chave = chave_;
  if not found then return format('moment "%s" não existe', chave_); end if;
  if coalesce(sup, '') = '' then return 'falta a superfície'; end if;
  if sup not in ('mel_bubble', 'weather_card') then return format('superfície "%s" inválida', sup); end if;
  if not (sup = any (m.superficies)) then return format('o moment %s não usa a superfície %s', chave_, sup); end if;
  if length(btrim(coalesce(txt, ''))) = 0 then return 'texto vazio'; end if;

  -- placeholders: só os que o moment declara; chave aberta sem fechar também é erro
  foreach ph in array public.mel_placeholders_de(txt) loop
    if ph = '' then return 'placeholder vazio {}'; end if;
    if not (ph = any (m.placeholders)) then return format('placeholder {%s} não permitido em %s', ph, chave_); end if;
  end loop;
  sobra := regexp_replace(txt, '\{[^{}]*\}', '', 'g');
  if position('{' in sobra) > 0 or position('}' in sobra) > 0 then return 'chave { } sem fechar'; end if;

  -- listas opcionais: cada valor precisa ser conhecido
  if item ? 'ramos' and jsonb_typeof(item -> 'ramos') not in ('null', 'array') then return 'ramos precisa ser lista ou null'; end if;
  if item ? 'tipos' and jsonb_typeof(item -> 'tipos') not in ('null', 'array') then return 'tipos precisa ser lista ou null'; end if;
  if item ? 'contextos_clima' and jsonb_typeof(item -> 'contextos_clima') not in ('null', 'array') then return 'contextos_clima precisa ser lista ou null'; end if;
  if item ? 'periodos' and jsonb_typeof(item -> 'periodos') not in ('null', 'array') then return 'periodos precisa ser lista ou null'; end if;
  if jsonb_typeof(item -> 'ramos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'ramos') loop
      if v not in ('beleza', 'barbearia', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem') then return format('ramo "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'tipos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'tipos') loop
      if v not in ('salao', 'autonoma') then return format('tipo "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'contextos_clima') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'contextos_clima') loop
      if v not in ('ensolarado', 'nublado', 'chuva', 'trovoada', 'frio', 'calor') then return format('contexto de clima "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'periodos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'periodos') loop
      if v not in ('manha', 'tarde', 'noite') then return format('período "%s" desconhecido', v); end if;
    end loop;
  end if;
  if item ? 'tom' and jsonb_typeof(item -> 'tom') <> 'null' and (item ->> 'tom') not in ('feliz', 'atenta', 'alerta', 'comemorando', 'cansada', 'neutra') then
    return format('tom "%s" desconhecido', item ->> 'tom');
  end if;
  if item ? 'peso' and jsonb_typeof(item -> 'peso') <> 'null' then
    if jsonb_typeof(item -> 'peso') <> 'number' or (item ->> 'peso')::numeric <> floor((item ->> 'peso')::numeric) or (item ->> 'peso')::numeric not between 1 and 10 then
      return 'peso precisa ser inteiro de 1 a 10';
    end if;
  end if;
  if item ? 'ativa' and jsonb_typeof(item -> 'ativa') not in ('null', 'boolean') then return 'ativa precisa ser true ou false'; end if;
  return null;
end;
$$;

-- o trigger: a mesma validação, para quem grava direto pela tabela
create or replace function public.mel_frases_checar()
returns trigger
language plpgsql
as $$
declare erro text;
begin
  erro := public.mel_frase_validar(jsonb_build_object(
    'chave', new.chave, 'superficie', new.superficie, 'texto', new.texto,
    'ramos', to_jsonb(new.ramos), 'tipos', to_jsonb(new.tipos),
    'contextos_clima', to_jsonb(new.contextos_clima), 'periodos', to_jsonb(new.periodos),
    'tom', new.tom, 'peso', new.peso, 'ativa', new.ativa));
  if erro is not null then raise exception 'Frase inválida: %', erro using errcode = 'check_violation'; end if;
  new.texto := btrim(new.texto);
  -- lista vazia vale como "qualquer": guarda null para a seleção ser simples
  if new.ramos is not null and cardinality(new.ramos) = 0 then new.ramos := null; end if;
  if new.tipos is not null and cardinality(new.tipos) = 0 then new.tipos := null; end if;
  if new.contextos_clima is not null and cardinality(new.contextos_clima) = 0 then new.contextos_clima := null; end if;
  if new.periodos is not null and cardinality(new.periodos) = 0 then new.periodos := null; end if;
  if tg_op = 'UPDATE' then new.updated_at := clock_timestamp(); end if;
  return new;
end;
$$;
drop trigger if exists mel_frases_checar on public.mel_frases;
create trigger mel_frases_checar before insert or update on public.mel_frases for each row execute function public.mel_frases_checar();

-- frase que já apareceu para alguém não some: desativa
create or replace function public.mel_frases_proteger()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.mel_exibicoes e where e.frase_id = old.id) then
    raise exception 'Esta frase já apareceu para alguém e faz parte do histórico. Desative em vez de excluir.' using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;
drop trigger if exists mel_frases_proteger on public.mel_frases;
create trigger mel_frases_proteger before delete on public.mel_frases for each row execute function public.mel_frases_proteger();

-- ---------------------------------------------------------------- importação em massa
-- itens = o JSON colado na Plataforma (lista de objetos). Com aplicar =
-- false só valida e devolve o relatório; com true grava as válidas uma a
-- uma (id existente atualiza, sem id insere) e pula as inválidas: uma
-- frase ruim nunca derruba o lote.
create or replace function public.mel_frases_importar(itens jsonb, aplicar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  item jsonb; i integer := 0;
  erro text; fid uuid;
  problemas jsonb := '[]'::jsonb;
  inseridas integer := 0; atualizadas integer := 0; validas integer := 0;
  campos jsonb;
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma importa frases da Mel.'; end if;
  if itens is null or jsonb_typeof(itens) <> 'array' then raise exception 'O JSON precisa ser uma lista de frases.'; end if;

  for item in select * from jsonb_array_elements(itens) loop
    i := i + 1;
    erro := public.mel_frase_validar(item);
    fid := null;
    if erro is null and item ? 'id' and jsonb_typeof(item -> 'id') <> 'null' then
      begin
        fid := (item ->> 'id')::uuid;
      exception when others then erro := format('id "%s" inválido', item ->> 'id');
      end;
      if erro is null and not exists (select 1 from public.mel_frases f where f.id = fid) then erro := format('id %s não existe', fid); end if;
    end if;
    if erro is null and fid is null and exists (
      select 1 from public.mel_frases f
      where f.chave = item ->> 'chave' and f.superficie = item ->> 'superficie' and lower(btrim(f.texto)) = lower(btrim(item ->> 'texto'))
    ) then erro := 'já existe'; end if;
    if erro is null and fid is not null and exists (
      select 1 from public.mel_frases f
      where f.id <> fid and f.chave = item ->> 'chave' and f.superficie = item ->> 'superficie' and lower(btrim(f.texto)) = lower(btrim(item ->> 'texto'))
    ) then erro := 'já existe em outra frase'; end if;

    if erro is not null then
      problemas := problemas || jsonb_build_object('indice', i, 'erro', erro, 'texto', left(coalesce(item ->> 'texto', ''), 80));
      continue;
    end if;
    validas := validas + 1;
    if not aplicar then continue; end if;

    begin
      if fid is null then
        insert into public.mel_frases (chave, superficie, texto, ramos, tipos, contextos_clima, periodos, tom, peso, ativa)
        values (
          item ->> 'chave', item ->> 'superficie', item ->> 'texto',
          case when jsonb_typeof(item -> 'ramos') = 'array' then array(select jsonb_array_elements_text(item -> 'ramos')) end,
          case when jsonb_typeof(item -> 'tipos') = 'array' then array(select jsonb_array_elements_text(item -> 'tipos')) end,
          case when jsonb_typeof(item -> 'contextos_clima') = 'array' then array(select jsonb_array_elements_text(item -> 'contextos_clima')) end,
          case when jsonb_typeof(item -> 'periodos') = 'array' then array(select jsonb_array_elements_text(item -> 'periodos')) end,
          coalesce(item ->> 'tom', 'neutra'),
          coalesce((item ->> 'peso')::smallint, 1),
          coalesce((item ->> 'ativa')::boolean, true));
        inseridas := inseridas + 1;
      else
        -- só o que veio no JSON muda; o resto fica como está
        update public.mel_frases f set
          chave = item ->> 'chave', superficie = item ->> 'superficie', texto = item ->> 'texto',
          ramos = case when item ? 'ramos' then (case when jsonb_typeof(item -> 'ramos') = 'array' then array(select jsonb_array_elements_text(item -> 'ramos')) end) else f.ramos end,
          tipos = case when item ? 'tipos' then (case when jsonb_typeof(item -> 'tipos') = 'array' then array(select jsonb_array_elements_text(item -> 'tipos')) end) else f.tipos end,
          contextos_clima = case when item ? 'contextos_clima' then (case when jsonb_typeof(item -> 'contextos_clima') = 'array' then array(select jsonb_array_elements_text(item -> 'contextos_clima')) end) else f.contextos_clima end,
          periodos = case when item ? 'periodos' then (case when jsonb_typeof(item -> 'periodos') = 'array' then array(select jsonb_array_elements_text(item -> 'periodos')) end) else f.periodos end,
          tom = coalesce(item ->> 'tom', f.tom),
          peso = coalesce((item ->> 'peso')::smallint, f.peso),
          ativa = coalesce((item ->> 'ativa')::boolean, f.ativa)
        where f.id = fid;
        atualizadas := atualizadas + 1;
      end if;
    exception
      when unique_violation then
        validas := validas - 1;
        problemas := problemas || jsonb_build_object('indice', i, 'erro', 'já existe (repetida no lote)', 'texto', left(coalesce(item ->> 'texto', ''), 80));
      when others then
        validas := validas - 1;
        problemas := problemas || jsonb_build_object('indice', i, 'erro', sqlerrm, 'texto', left(coalesce(item ->> 'texto', ''), 80));
    end;
  end loop;
  campos := jsonb_build_object('total', i, 'validas', validas, 'invalidas', jsonb_array_length(problemas), 'problemas', problemas, 'aplicado', aplicar);
  if aplicar then campos := campos || jsonb_build_object('inseridas', inseridas, 'atualizadas', atualizadas); end if;
  return campos;
end;
$$;
revoke execute on function public.mel_frases_importar(jsonb, boolean) from public, anon;
grant execute on function public.mel_frases_importar(jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- estatísticas
-- por frase: quantas vezes apareceu, cliques, dispensas, ações concluídas.
-- Hoje devolve zeros; o motor vai preencher mel_exibicoes.
create or replace function public.mel_frases_estatisticas()
returns table (frase_id uuid, exibicoes bigint, cliques bigint, dispensas bigint, concluidas bigint)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma vê as estatísticas da Mel.'; end if;
  return query
    select f.id,
           count(e.id), count(e.clicada_em), count(e.dispensada_em), count(e.concluida_em)
    from public.mel_frases f
    left join public.mel_exibicoes e on e.frase_id = f.id
    group by f.id;
end;
$$;
revoke execute on function public.mel_frases_estatisticas() from public, anon;
grant execute on function public.mel_frases_estatisticas() to authenticated;

-- ---------------------------------------------------------------- a semente do catálogo
-- Descrição de cada momento, os placeholders que ele oferece e um exemplo
-- fictício para a prévia. A regra de disparo não está aqui: é código.
insert into public.mel_momentos (chave, categoria, rotulo, descricao, superficies, placeholders, exemplo, ordem) values
  ('pedido_esperando_aceite', 'operacional', 'Pedido esperando aceite', 'Há pedido de horário aguardando a casa aceitar. Reforço do alerta da agenda; nunca o único aviso.', '{mel_bubble}', '{n,cliente,hora}', '{"n":"2","cliente":"Bia","hora":"16h"}', 10),
  ('proxima_cliente_em_breve', 'agenda', 'Próxima cliente em breve', 'Próximo atendimento confirmado começa em 10 a 45 minutos.', '{mel_bubble}', '{cliente,hora,servico,minutos,profissional}', '{"cliente":"Carla","hora":"14h30","servico":"escova","minutos":"20","profissional":"Ana"}', 20),
  ('primeira_do_dia', 'agenda', 'Primeira do dia', 'Antes de abrir: quem é a primeira cliente confirmada e quantas vêm hoje.', '{mel_bubble,weather_card}', '{cliente,hora,servico,n}', '{"cliente":"Ju","hora":"9h","servico":"corte","n":"6"}', 30),
  ('dia_cheio', 'agenda', 'Dia cheio', 'Ocupação de hoje acima de 85%, com pelo menos 4 atendimentos.', '{mel_bubble,weather_card}', '{n,temperatura}', '{"n":"8","temperatura":"31"}', 40),
  ('dia_vazio', 'agenda', 'Dia vazio', 'Dia de expediente sem nenhum atendimento, antes das 14h.', '{mel_bubble}', '{dia_semana}', '{"dia_semana":"terça"}', 50),
  ('amanha_vazio', 'agenda', 'Amanhã vazio', 'Amanhã abre e ainda não tem ninguém marcado (a partir das 15h de hoje).', '{mel_bubble}', '{dia_semana}', '{"dia_semana":"sábado"}', 60),
  ('amanha_cheio', 'agenda', 'Amanhã cheio', 'Amanhã já está lotado; pode haver horários sem resposta de presença.', '{mel_bubble}', '{n,sem_confirmar}', '{"n":"9","sem_confirmar":"3"}', 70),
  ('vaga_hoje', 'oportunidade', 'Vaga hoje', 'Buraco de pelo menos uma hora entre atendimentos de hoje, ainda por vir.', '{mel_bubble}', '{hora,hora_fim,minutos,profissional,n_espera}', '{"hora":"15h30","hora_fim":"16h30","minutos":"60","profissional":"Ana","n_espera":"2"}', 80),
  ('cancelamento_recente', 'oportunidade', 'Cancelamento recente', 'Alguém cancelou há pouco um horário de hoje ou amanhã que ainda não passou.', '{mel_bubble}', '{cliente,hora,servico,n_espera}', '{"cliente":"Bia","hora":"16h","servico":"progressiva","n_espera":"2"}', 90),
  ('semana_fraca', 'oportunidade', 'Semana fraca', 'Quinta ou sexta: a próxima semana está com ocupação baixa.', '{mel_bubble}', '{ocupacao_pct}', '{"ocupacao_pct":"28"}', 100),
  ('cliente_nova_hoje', 'oportunidade', 'Cliente nova hoje', 'Hoje chega alguém pela primeira vez.', '{mel_bubble}', '{cliente,hora,servico,n}', '{"cliente":"Lu","hora":"11h","servico":"manicure","n":"1"}', 110),
  ('abertura_do_dia', 'marco', 'Abertura do dia', 'Primeira abertura do painel no dia, antes das 11h, com atendimentos marcados.', '{mel_bubble,weather_card}', '{n,primeira_hora,ultima_hora,cliente,temperatura}', '{"n":"6","primeira_hora":"9h","ultima_hora":"18h","cliente":"Ju","temperatura":"24"}', 120),
  ('metade_do_dia', 'marco', 'Metade do dia', 'Metade dos atendimentos de hoje já concluída; ainda faltam pelo menos 2.', '{mel_bubble}', '{feitos,faltam}', '{"feitos":"4","faltam":"3"}', 130),
  ('ultima_do_dia', 'marco', 'Última do dia', 'Só falta um atendimento, começando em menos de uma hora ou em andamento.', '{mel_bubble}', '{cliente,hora,servico,dia_semana}', '{"cliente":"Rê","hora":"18h","servico":"unha","dia_semana":"sexta"}', 140),
  ('dia_fechado', 'marco', 'Dia fechado', 'Todos os atendimentos de hoje concluídos.', '{mel_bubble,weather_card}', '{n,faltas,faturamento}', '{"n":"7","faltas":"0","faturamento":"R$ 640"}', 150),
  ('chuva_antes_dos_horarios', 'clima', 'Chuva antes dos horários', 'Chuva prevista nas próximas horas e há atendimentos depois dela.', '{mel_bubble,weather_card}', '{hora_chuva,chuva_pct,n_depois,sem_confirmar}', '{"hora_chuva":"18h","chuva_pct":"80","n_depois":"2","sem_confirmar":"1"}', 160),
  ('trovoada_agora', 'clima', 'Trovoada agora', 'Trovoada na cidade do salão neste momento.', '{mel_bubble,weather_card}', '{cliente,hora}', '{"cliente":"Carla","hora":"15h"}', 170),
  ('calor_extremo', 'clima', 'Calor extremo', 'Temperatura de 33° ou mais (ou sensação de 36°), entre 10h e 18h.', '{mel_bubble,weather_card}', '{temperatura,sensacao,n}', '{"temperatura":"35","sensacao":"38","n":"4"}', 180),
  ('frio_forte', 'clima', 'Frio forte', 'Temperatura de 13° ou menos durante o expediente.', '{mel_bubble,weather_card}', '{temperatura,minima}', '{"temperatura":"12","minima":"9"}', 190),
  ('contexto_comum', 'clima', 'Contexto comum', 'O dia a dia, quando nada mais se destacou: clima de sempre, período e dia da semana. Use os filtros de clima e período para a frase combinar.', '{mel_bubble,weather_card}', '{temperatura,cidade,dia_semana,periodo}', '{"temperatura":"26","cidade":"Santos","dia_semana":"quarta","periodo":"tarde"}', 200),
  ('vespera_feriado', 'calendario', 'Véspera de feriado', 'Amanhã é feriado nacional, estadual ou da cidade do salão.', '{mel_bubble,weather_card}', '{feriado,n}', '{"feriado":"Tiradentes","n":"3"}', 210),
  ('feriado_hoje', 'calendario', 'Feriado hoje', 'Hoje é feriado.', '{mel_bubble,weather_card}', '{feriado,n}', '{"feriado":"Dia do Trabalho","n":"2"}', 220),
  ('data_comercial_proxima', 'calendario', 'Data comercial próxima', 'Faltam de 3 a 12 dias para uma data forte do setor (Mães, Namorados, Natal…).', '{mel_bubble,weather_card}', '{data,dias}', '{"data":"Dia das Mães","dias":"8"}', 230),
  ('baixas_pendentes', 'operacional', 'Baixas pendentes', 'Atendimentos passados sem baixa ou comanda aberta. Reforço do alerta de fechar o dia.', '{mel_bubble}', '{n,valor}', '{"n":"3","valor":"R$ 310"}', 240),
  ('mensagens_na_fila', 'operacional', 'Mensagens na fila', 'Mensagens manuais de WhatsApp esperando envio há mais de 30 minutos.', '{mel_bubble}', '{n}', '{"n":"4"}', 250),
  ('conversa_esperando_humano', 'operacional', 'Conversa esperando humano', 'O bot passou uma conversa do WhatsApp para atendimento humano e ninguém respondeu em 30 minutos.', '{mel_bubble}', '{cliente,minutos}', '{"cliente":"Mari","minutos":"40"}', 260),
  ('primeiro_contato', 'geral', 'Primeiro contato', 'Uma única vez por pessoa, na primeira vez que a Mel aparece para ela.', '{mel_bubble}', '{nome}', '{"nome":"Carla"}', 270)
on conflict (chave) do update set
  categoria = excluded.categoria, rotulo = excluded.rotulo, descricao = excluded.descricao,
  superficies = excluded.superficies, placeholders = excluded.placeholders, exemplo = excluded.exemplo, ordem = excluded.ordem;
