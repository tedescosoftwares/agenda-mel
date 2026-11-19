-- 254 · O disparo (4.4): uma mensagem da Plataforma para quem já conversou com a Mel
--
-- Em Plataforma › Guia › WhatsApp › Disparo: a equipe escolhe por quais números sai (a Mel do guia e outros chips só
-- para disparo, alternando entre eles para nenhum mandar demais), escolhe quem recebe numa lista de todo mundo que
-- conversou com a Mel (o nome que deu, a cidade e o salão que procurou), escreve a mensagem (ou pede à IA), com
-- {nome}, {cidade}, {salao} e {link}, e dispara: sai uma de cada vez, no ritmo escolhido, enquanto a aba estiver aberta.
--
-- Cada pessoa recebe um link curto só dela (mimo.com.vc/c/<token>): o robô do WhatsApp vê a prévia da campanha (título,
-- texto e imagem, pela pagina-publica), e quem toca passa pelo site (o toque conta) e vai para o destino. O WhatsApp
-- avisa entregue e lida (whatsapp-webhook → disparo_evento), e quem responde fica marcado. Nada de SAIR: não há
-- atendente no chip de disparo, e na Mel a conversa segue como sempre.
--
-- Os dados das pessoas seguem o prazo da Mel (guia_whats_config.retencao_dias, 90): depois disso, o envio perde nome,
-- número e cidade e fica só a contagem do disparo; o nome do perfil do WhatsApp (guia_whats_perfis) também sai.

-- ---- as tabelas --------------------------------------------------------------------------------------------------------
create table if not exists public.disparo_numeros (
  instancia text primary key check (instancia ~ '^mimo-disparo(-[a-z0-9]{1,20})?$'),
  rotulo text not null default 'Chip' check (length(btrim(rotulo)) between 1 and 40),
  numero text check (numero is null or numero ~ '^[0-9]{10,15}$'),
  criado_em timestamptz not null default now()
);
alter table public.disparo_numeros enable row level security;

create table if not exists public.disparos (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Disparo' check (length(btrim(nome)) between 1 and 80),
  mensagem text not null default '' check (length(mensagem) <= 2000),
  destino text check (destino is null or (destino ~ '^https://[^[:space:]"<>]+$' and length(destino) <= 500)),
  previa_titulo text check (previa_titulo is null or length(previa_titulo) <= 120),
  previa_texto text check (previa_texto is null or length(previa_texto) <= 300),
  previa_imagem text check (previa_imagem is null or (previa_imagem ~ '^https://[^[:space:]"<>]+$' and length(previa_imagem) <= 500)),
  numeros text[] not null default '{}',
  alternar boolean not null default true,
  ritmo_s int not null default 40 check (ritmo_s between 15 and 600),
  status text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'pausado', 'concluido')),
  motivo_pausa text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
alter table public.disparos enable row level security;

create table if not exists public.disparo_envios (
  id bigserial primary key,
  disparo_id uuid not null references public.disparos(id) on delete cascade,
  chave text not null,
  telefone text not null,
  nome text,
  cidade text,
  salao text,
  token text not null unique check (token ~ '^[0-9a-f]{10}$'),
  teste boolean not null default false,
  instancia text,
  status text not null default 'fila' check (status in ('fila', 'enviando', 'enviado', 'falhou')),
  erro text,
  msg_id text,
  enviado_em timestamptz,
  entregue_em timestamptz,
  lida_em timestamptz,
  clicou_em timestamptz,
  cliques int not null default 0,
  respondeu_em timestamptz,
  apagado_em timestamptz
);
alter table public.disparo_envios enable row level security;
create unique index if not exists disparo_envios_uma_vez on public.disparo_envios (disparo_id, chave) where not teste;
create index if not exists disparo_envios_msg on public.disparo_envios (msg_id) where msg_id is not null;
create index if not exists disparo_envios_fila on public.disparo_envios (disparo_id, status, id);
create index if not exists disparo_envios_numero on public.disparo_envios (instancia, enviado_em desc) where instancia is not null;
create index if not exists disparo_envios_chave on public.disparo_envios (chave, enviado_em desc);

-- o nome do perfil do WhatsApp de quem escreveu para a Mel (ou para um chip de disparo): só para a lista do disparo
create table if not exists public.guia_whats_perfis (
  chave text primary key,
  telefone text not null,
  nome text,
  instancia text,
  em timestamptz not null default now()
);
alter table public.guia_whats_perfis enable row level security;

revoke all on public.disparo_numeros, public.disparos, public.disparo_envios, public.guia_whats_perfis from public, anon, authenticated;
revoke all on sequence public.disparo_envios_id_seq from public, anon, authenticated;

-- ---- quem pode receber -------------------------------------------------------------------------------------------------
-- todo mundo que conversou com a Mel (as conversas, os pedidos e os perfis do WhatsApp), com o nome que deu, a cidade e o
-- salão; fora: as conversas de teste, os números da própria MIMO e os salões e donas de salão
create or replace function public.disparo_pessoas(dias_ int default 90)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  desde timestamptz := case when dias_ is null or dias_ <= 0 then '-infinity'::timestamptz else now() - make_interval(days => least(dias_, 3650)) end;
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma vê a lista do disparo'; end if;
  with conv as (
    select c.chave,
           (array_agg(c.telefone order by c.atualizada_em desc))[1] as telefone,
           max(c.atualizada_em) as ultimo,
           (array_agg(nullif(btrim(c.dados ->> 'nome'), '') order by c.atualizada_em desc) filter (where nullif(btrim(c.dados ->> 'nome'), '') is not null))[1] as nome,
           (array_agg(c.lugar_id order by c.atualizada_em desc) filter (where c.lugar_id is not null))[1] as lugar_id,
           bool_or(c.teste or c.telefone like 'teste-%') as teste,
           bool_or(coalesce(c.dados ->> 'dona', '') = 'true') as dona
      from public.guia_whats_conversas c
     where c.atualizada_em >= desde and c.chave is not null
     group by c.chave),
  ped as (
    select l.cliente_chave as chave,
           (array_agg(l.cliente_tel order by l.criado_em desc))[1] as telefone,
           max(l.criado_em) as ultimo,
           (array_agg(nullif(btrim(l.cliente_nome), '') order by l.criado_em desc) filter (where nullif(btrim(l.cliente_nome), '') is not null))[1] as nome,
           (array_agg(l.cidade order by l.criado_em desc) filter (where l.cidade is not null))[1] as cidade,
           (array_agg(l.salao_nome order by l.criado_em desc) filter (where l.salao_nome is not null))[1] as salao
      from public.guia_whats_leads l
     where l.criado_em >= desde and l.cliente_chave is not null
     group by l.cliente_chave),
  perf as (select p.chave, p.telefone, p.nome, p.em from public.guia_whats_perfis p where p.em >= desde),
  todos as (select chave from conv union select chave from ped union select chave from perf),
  junto as (
    select t.chave,
           coalesce(ped.telefone, conv.telefone, perf.telefone) as telefone,
           coalesce(ped.nome, conv.nome) as nome,
           perf.nome as nome_whats,
           coalesce(ped.cidade, gl.cidade) as cidade,
           coalesce(ped.salao, gl.nome) as salao,
           greatest(ped.ultimo, conv.ultimo, perf.em) as ultimo,
           ped.chave is not null as pedido,
           coalesce(conv.teste, false) as teste,
           coalesce(conv.dona, false) as dona
      from todos t
      left join conv on conv.chave = t.chave
      left join ped on ped.chave = t.chave
      left join perf on perf.chave = t.chave
      left join public.guia_lugares gl on gl.id = conv.lugar_id),
  saloes as (
    select salao_chave as chave from public.guia_whats_leads where salao_chave is not null
    union select public.guia_whats_chave(whatsapp) from public.guia_lugares where coalesce(whatsapp, '') <> ''
    union select public.guia_whats_chave(telefone) from public.guia_lugares where coalesce(telefone, '') <> ''),
  nossos as (
    select public.guia_whats_chave(numero) as chave from public.guia_whats_config where coalesce(numero, '') <> ''
    union select public.guia_whats_chave(numero) from public.comercial_config where coalesce(numero, '') <> ''
    union select public.guia_whats_chave(numero) from public.disparo_numeros where coalesce(numero, '') <> ''),
  ja as (
    select e.chave, count(*) as n, max(e.enviado_em) as ultimo
      from public.disparo_envios e where not e.teste and e.status = 'enviado' group by e.chave),
  classe as (
    select j.*, case when j.teste or j.telefone like 'teste-%' then 'teste'
                     when j.chave in (select chave from nossos where chave is not null) then 'nossos'
                     when j.dona or j.chave in (select chave from saloes where chave is not null) then 'salao' end as fora
      from junto j)
  select jsonb_build_object(
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object('chave', c.chave, 'telefone', c.telefone, 'nome', c.nome, 'nome_whats', c.nome_whats,
               'cidade', c.cidade, 'salao', c.salao, 'ultimo', c.ultimo, 'pedido', c.pedido,
               'disparos', coalesce(ja.n, 0), 'ultimo_disparo', ja.ultimo) order by c.ultimo desc nulls last)
        from classe c left join ja on ja.chave = c.chave
       where c.fora is null and c.telefone is not null), '[]'::jsonb),
    'fora', jsonb_build_object('salao', (select count(*) from classe where fora = 'salao'),
                               'teste', (select count(*) from classe where fora = 'teste'),
                               'nossos', (select count(*) from classe where fora = 'nossos')),
    'dias', dias_)
  into r;
  return r;
end $$;
revoke execute on function public.disparo_pessoas(int) from public, anon;
grant execute on function public.disparo_pessoas(int) to authenticated;

-- ---- montar e salvar o disparo -----------------------------------------------------------------------------------------
create or replace function public.disparo_salvar(d jsonb)
returns uuid language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  id_ uuid := nullif(d ->> 'id', '')::uuid;
  atual public.disparos;
  nums text[];
  guia text;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma mexe no disparo'; end if;
  select instancia into guia from public.guia_whats_config where id = 1;
  -- só os números que existem: a Mel do guia e os chips de disparo
  select coalesce(array_agg(x order by o), '{}') into nums
    from jsonb_array_elements_text(case when jsonb_typeof(d -> 'numeros') = 'array' then d -> 'numeros' else '[]'::jsonb end) with ordinality as e(x, o)
   where x = guia or x in (select instancia from public.disparo_numeros);
  if id_ is not null then
    select * into atual from public.disparos where id = id_ for update;
    if not found then raise exception 'disparo não encontrado'; end if;
  end if;
  begin
    if atual.id is null then
      insert into public.disparos (nome, mensagem, destino, previa_titulo, previa_texto, previa_imagem, numeros, alternar, ritmo_s, criado_por)
      values (coalesce(nullif(btrim(d ->> 'nome'), ''), 'Disparo'), coalesce(d ->> 'mensagem', ''), nullif(btrim(d ->> 'destino'), ''),
              nullif(btrim(d ->> 'previa_titulo'), ''), nullif(btrim(d ->> 'previa_texto'), ''), nullif(btrim(d ->> 'previa_imagem'), ''),
              nums, coalesce((d ->> 'alternar')::boolean, true), coalesce((d ->> 'ritmo_s')::int, 40), auth.uid())
      returning id into id_;
    elsif atual.status = 'rascunho' then
      update public.disparos set
        nome = coalesce(nullif(btrim(d ->> 'nome'), ''), nome), mensagem = coalesce(d ->> 'mensagem', mensagem),
        destino = nullif(btrim(d ->> 'destino'), ''), previa_titulo = nullif(btrim(d ->> 'previa_titulo'), ''),
        previa_texto = nullif(btrim(d ->> 'previa_texto'), ''), previa_imagem = nullif(btrim(d ->> 'previa_imagem'), ''),
        numeros = nums, alternar = coalesce((d ->> 'alternar')::boolean, alternar), ritmo_s = coalesce((d ->> 'ritmo_s')::int, ritmo_s)
       where id = id_;
    else
      -- já saiu: o texto fica como foi; dá para trocar os números e o ritmo (um chip caiu no meio, por exemplo)
      update public.disparos set numeros = case when cardinality(nums) > 0 then nums else numeros end,
             alternar = coalesce((d ->> 'alternar')::boolean, alternar), ritmo_s = coalesce((d ->> 'ritmo_s')::int, ritmo_s)
       where id = id_;
    end if;
  exception when check_violation then
    raise exception '%', case
      when sqlerrm ~ 'disparos_destino_check' then 'o link precisa começar com https://'
      when sqlerrm ~ 'disparos_previa_imagem_check' then 'a imagem da prévia precisa ser um link https://'
      when sqlerrm ~ 'disparos_previa_titulo_check' then 'o título da prévia vai até 120 caracteres'
      when sqlerrm ~ 'disparos_previa_texto_check' then 'o texto da prévia vai até 300 caracteres'
      when sqlerrm ~ 'disparos_mensagem_check' then 'a mensagem vai até 2.000 caracteres'
      when sqlerrm ~ 'disparos_ritmo_s_check' then 'o ritmo vai de 15 segundos a 10 minutos'
      when sqlerrm ~ 'disparos_nome_check' then 'o nome do disparo vai até 80 caracteres'
      else sqlerrm end;
  end;
  return id_;
end $$;
revoke execute on function public.disparo_salvar(jsonb) from public, anon;
grant execute on function public.disparo_salvar(jsonb) to authenticated;

-- um token de 10 letras (hexadecimal): o link curto de cada pessoa
create or replace function public.disparo_token()
returns text language sql volatile set search_path = public as $$
  select substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 10)
$$;
revoke execute on function public.disparo_token() from public, anon, authenticated;

-- disparar: põe na fila quem foi marcado (com o nome, a cidade e o salão que o banco sabe; o que o navegador manda é só
-- a chave) e liga o envio. Dá para chamar de novo, no mesmo disparo, com mais gente: quem já estava não entra duas vezes.
create or replace function public.disparo_comecar(id_ uuid, chaves_ text[])
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  dsp public.disparos;
  n int;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma dispara'; end if;
  select * into dsp from public.disparos where id = id_ for update;
  if not found then raise exception 'disparo não encontrado'; end if;
  if dsp.status = 'concluido' and coalesce(cardinality(chaves_), 0) = 0 then raise exception 'esse disparo já terminou'; end if;
  if cardinality(dsp.numeros) = 0 then raise exception 'marque por qual número sai'; end if;
  if length(btrim(dsp.mensagem)) < 5 then raise exception 'escreva a mensagem antes de disparar'; end if;
  insert into public.disparo_envios (disparo_id, chave, telefone, nome, cidade, salao, token)
  select id_, p ->> 'chave', p ->> 'telefone', coalesce(p ->> 'nome', p ->> 'nome_whats'), p ->> 'cidade', p ->> 'salao', public.disparo_token()
    from jsonb_array_elements(public.disparo_pessoas(null) -> 'pessoas') p
   where p ->> 'chave' = any (coalesce(chaves_, '{}'))
  on conflict (disparo_id, chave) where not teste do nothing;
  get diagnostics n = row_count;
  update public.disparos set status = 'enviando', motivo_pausa = null, iniciado_em = coalesce(iniciado_em, now()), concluido_em = null where id = id_;
  return jsonb_build_object('ok', true, 'novos', n,
    'fila', (select count(*) from public.disparo_envios where disparo_id = id_ and status = 'fila' and not teste));
end $$;
revoke execute on function public.disparo_comecar(uuid, text[]) from public, anon;
grant execute on function public.disparo_comecar(uuid, text[]) to authenticated;

-- o teste para o número de quem está montando: entra no disparo marcado como teste (não conta nos números)
create or replace function public.disparo_teste(id_ uuid, telefone_ text, nome_ text, cidade_ text, salao_ text)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  chave_ text := public.guia_whats_chave(telefone_);
  e bigint;
  t text := public.disparo_token();
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma dispara'; end if;
  if chave_ is null or public.telefone_e164(telefone_) is null then raise exception 'número inválido para o teste'; end if;
  if not exists (select 1 from public.disparos where id = id_) then raise exception 'disparo não encontrado'; end if;
  insert into public.disparo_envios (disparo_id, chave, telefone, nome, cidade, salao, token, teste)
  values (id_, chave_, public.telefone_e164(telefone_), nullif(btrim(nome_), ''), nullif(btrim(cidade_), ''), nullif(btrim(salao_), ''), t, true)
  returning id into e;
  return jsonb_build_object('envio', e, 'token', t);
end $$;
revoke execute on function public.disparo_teste(uuid, text, text, text, text) from public, anon;
grant execute on function public.disparo_teste(uuid, text, text, text, text) to authenticated;

-- pausar e continuar
create or replace function public.disparo_pausar(id_ uuid, pausar_ boolean)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma dispara'; end if;
  update public.disparos set status = case when pausar_ then 'pausado' else 'enviando' end, motivo_pausa = null
   where id = id_ and status in ('enviando', 'pausado');
  return jsonb_build_object('ok', found);
end $$;
revoke execute on function public.disparo_pausar(uuid, boolean) from public, anon;
grant execute on function public.disparo_pausar(uuid, boolean) to authenticated;

-- ---- o envio (só o servidor: a função disparo) --------------------------------------------------------------------------
-- o próximo da fila e por qual número: entre os marcados (alternar: todos; senão, o primeiro), o que mandou há mais
-- tempo, em qualquer disparo; cada número espera pelo menos 80% do ritmo entre uma mensagem e outra
create or replace function public.disparo_pegar(id_ uuid, envio_ bigint default null)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  dsp public.disparos;
  e public.disparo_envios;
  escolhida text;
  ultimo timestamptz;
  folga interval;
  agora timestamptz := clock_timestamp();
begin
  select * into dsp from public.disparos where id = id_ for update;
  if not found then return jsonb_build_object('erro', 'disparo não encontrado'); end if;
  if cardinality(dsp.numeros) = 0 then return jsonb_build_object('erro', 'o disparo não tem número marcado'); end if;

  -- o teste: sai na hora, pelo primeiro número marcado
  if envio_ is not null then
    select * into e from public.disparo_envios where id = envio_ and disparo_id = id_ and teste and status = 'fila' for update;
    if not found then return jsonb_build_object('erro', 'teste não encontrado'); end if;
    update public.disparo_envios set status = 'enviando', instancia = dsp.numeros[1], enviado_em = agora where id = e.id;
    return jsonb_build_object('envio', jsonb_build_object('id', e.id, 'telefone', e.telefone, 'nome', e.nome, 'cidade', e.cidade, 'salao', e.salao, 'token', e.token),
      'instancia', dsp.numeros[1], 'mensagem', dsp.mensagem, 'destino', dsp.destino);
  end if;

  if dsp.status <> 'enviando' then return jsonb_build_object('parado', true, 'status', dsp.status, 'motivo', dsp.motivo_pausa); end if;

  -- o que ficou "enviando" há mais de 3 minutos (a aba fechou no meio): volta para a fila
  update public.disparo_envios set status = 'fila', instancia = null, enviado_em = null
   where disparo_id = id_ and status = 'enviando' and not teste and enviado_em < agora - interval '3 minutes';

  folga := make_interval(secs => dsp.ritmo_s * 0.8);
  select i, (select max(x.enviado_em) from public.disparo_envios x where x.instancia = i and x.status in ('enviando', 'enviado') and not x.teste)
    into escolhida, ultimo
    from unnest(case when dsp.alternar then dsp.numeros else dsp.numeros[1:1] end) i
   order by 2 nulls first, i
   limit 1;
  if ultimo is not null and ultimo > agora - folga then
    return jsonb_build_object('espera_s', greatest(1, ceil(extract(epoch from (ultimo + folga - agora)))::int));
  end if;

  select * into e from public.disparo_envios where disparo_id = id_ and status = 'fila' and not teste order by id limit 1 for update skip locked;
  if not found then
    if exists (select 1 from public.disparo_envios where disparo_id = id_ and status = 'enviando' and not teste) then
      return jsonb_build_object('espera_s', 10);
    end if;
    update public.disparos set status = 'concluido', concluido_em = agora where id = id_;
    return jsonb_build_object('fim', true);
  end if;
  update public.disparo_envios set status = 'enviando', instancia = escolhida, enviado_em = agora where id = e.id;
  return jsonb_build_object('envio', jsonb_build_object('id', e.id, 'telefone', e.telefone, 'nome', e.nome, 'cidade', e.cidade, 'salao', e.salao, 'token', e.token),
    'instancia', escolhida, 'mensagem', dsp.mensagem, 'destino', dsp.destino,
    'ritmo_s', dsp.ritmo_s, 'numeros', cardinality(case when dsp.alternar then dsp.numeros else dsp.numeros[1:1] end));
end $$;
revoke execute on function public.disparo_pegar(uuid, bigint) from public, anon, authenticated;
grant execute on function public.disparo_pegar(uuid, bigint) to service_role;

-- o resultado do envio. voltar_: o número caiu (a mensagem não saiu por culpa dele): a pessoa volta para a fila e o
-- disparo pausa com o motivo, para a equipe trocar o número e continuar
create or replace function public.disparo_resultado(envio_ bigint, ok_ boolean, msg_id_ text, erro_ text, voltar_ boolean default false)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare e public.disparo_envios;
begin
  select * into e from public.disparo_envios where id = envio_ for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if voltar_ and not e.teste then
    update public.disparo_envios set status = 'fila', instancia = null, enviado_em = null where id = envio_;
    update public.disparos set status = 'pausado', motivo_pausa = left(coalesce(erro_, 'o número não respondeu'), 300) where id = e.disparo_id and status = 'enviando';
    return jsonb_build_object('ok', true, 'pausado', true);
  end if;
  update public.disparo_envios set status = case when ok_ then 'enviado' else 'falhou' end,
         msg_id = case when ok_ then left(msg_id_, 120) end, erro = case when ok_ then null else left(erro_, 300) end,
         enviado_em = coalesce(enviado_em, now())
   where id = envio_;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.disparo_resultado(bigint, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.disparo_resultado(bigint, boolean, text, text, boolean) to service_role;

-- ---- o que o WhatsApp avisa (o whatsapp-webhook chama a cada evento da Mel e dos chips de disparo) ----------------------
-- status_: [{ id, status }] (entregue, lido); recebidas_: [{ telefone, nome }] (quem escreveu, com o nome do perfil).
-- Devolve { extra: true } quando a instância é um chip de disparo: lá não há atendente, o webhook para aqui.
create or replace function public.disparo_evento(instancia_ text, status_ jsonb, recebidas_ jsonb)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  guia text;
  extra boolean;
  r record;
begin
  select instancia into guia from public.guia_whats_config where id = 1;
  extra := exists (select 1 from public.disparo_numeros where instancia = instancia_);
  if instancia_ is distinct from guia and not extra then return '{}'::jsonb; end if;
  if jsonb_typeof(status_) = 'array' and jsonb_array_length(status_) > 0 then
    update public.disparo_envios e
       set entregue_em = coalesce(e.entregue_em, now()),
           lida_em = case when s.status = 'lido' then coalesce(e.lida_em, now()) else e.lida_em end
      from (select x ->> 'id' as id, x ->> 'status' as status from jsonb_array_elements(status_) x) s
     where e.msg_id = s.id and s.status in ('entregue', 'lido');
  end if;
  if jsonb_typeof(recebidas_) = 'array' then
    for r in select public.guia_whats_chave(x ->> 'telefone') as chave, left(x ->> 'telefone', 60) as tel, nullif(btrim(left(x ->> 'nome', 60)), '') as nome
               from jsonb_array_elements(recebidas_) x loop
      continue when r.chave is null;
      update public.disparo_envios set respondeu_em = now()
       where chave = r.chave and instancia = instancia_ and status = 'enviado' and respondeu_em is null and enviado_em > now() - interval '14 days';
      if r.nome is not null then
        insert into public.guia_whats_perfis (chave, telefone, nome, instancia, em) values (r.chave, r.tel, r.nome, instancia_, now())
        on conflict (chave) do update set telefone = excluded.telefone, nome = excluded.nome, instancia = excluded.instancia, em = excluded.em;
      end if;
    end loop;
  end if;
  return jsonb_build_object('extra', extra);
end $$;
revoke execute on function public.disparo_evento(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.disparo_evento(text, jsonb, jsonb) to service_role;

-- os nomes do WhatsApp do histórico da Evolution (a função disparo busca e manda aqui); não troca um nome mais novo
create or replace function public.disparo_perfis_gravar(itens_ jsonb)
returns int language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare n int;
begin
  insert into public.guia_whats_perfis as g (chave, telefone, nome, instancia, em)
  select distinct on (public.guia_whats_chave(x ->> 'telefone')) public.guia_whats_chave(x ->> 'telefone'), left(x ->> 'telefone', 60),
         nullif(btrim(left(x ->> 'nome', 60)), ''), left(x ->> 'instancia', 40), coalesce((x ->> 'em')::timestamptz, now())
    from jsonb_array_elements(case when jsonb_typeof(itens_) = 'array' then itens_ else '[]'::jsonb end) x
   where public.guia_whats_chave(x ->> 'telefone') is not null
     and coalesce((x ->> 'em')::timestamptz, now()) > now() - make_interval(days => coalesce((select retencao_dias from public.guia_whats_config where id = 1), 90))
   order by public.guia_whats_chave(x ->> 'telefone'), coalesce((x ->> 'em')::timestamptz, now()) desc
  on conflict (chave) do update set telefone = excluded.telefone, nome = coalesce(excluded.nome, g.nome), instancia = excluded.instancia, em = excluded.em
   where excluded.em > g.em;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.disparo_perfis_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.disparo_perfis_gravar(jsonb) to service_role;

-- ---- o link de cada pessoa ---------------------------------------------------------------------------------------------
-- quem toca no link (o site, com JavaScript): conta o toque e devolve o destino. Robô não roda JavaScript, então a
-- prévia do WhatsApp não conta como toque.
create or replace function public.disparo_link(token_ text)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  dsp uuid;
  destino_ text;
begin
  if coalesce(token_, '') !~ '^[0-9a-f]{10}$' then return jsonb_build_object('destino', null); end if;
  update public.disparo_envios set clicou_em = coalesce(clicou_em, now()), cliques = least(cliques + 1, 1000)
   where token = token_ returning disparo_id into dsp;
  if dsp is null then return jsonb_build_object('destino', null); end if;
  select destino into destino_ from public.disparos where id = dsp;
  return jsonb_build_object('destino', destino_);
end $$;
revoke execute on function public.disparo_link(text) from public;
grant execute on function public.disparo_link(text) to anon, authenticated;

-- a prévia do link para o robô do WhatsApp (pagina-publica, com a chave de serviço): não conta toque
create or replace function public.disparo_previa(token_ text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('titulo', d.previa_titulo, 'texto', d.previa_texto, 'imagem', d.previa_imagem, 'destino', d.destino)
    from public.disparo_envios e join public.disparos d on d.id = e.disparo_id
   where coalesce(token_, '') ~ '^[0-9a-f]{10}$' and e.token = token_
$$;
revoke execute on function public.disparo_previa(text) from public, anon, authenticated;
grant execute on function public.disparo_previa(text) to service_role;

-- ---- a Plataforma acompanha --------------------------------------------------------------------------------------------
create or replace function public.disparo_painel()
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  g public.guia_whats_config;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma vê os disparos'; end if;
  select * into g from public.guia_whats_config where id = 1;
  return jsonb_build_object(
    'guia', jsonb_build_object('instancia', g.instancia, 'numero', g.numero,
              'hoje', (select count(*) from public.disparo_envios where instancia = g.instancia and status = 'enviado' and not teste and enviado_em >= hoje)),
    'numeros', coalesce((select jsonb_agg(jsonb_build_object('instancia', n.instancia, 'rotulo', n.rotulo, 'numero', n.numero,
                  'hoje', (select count(*) from public.disparo_envios e where e.instancia = n.instancia and e.status = 'enviado' and not e.teste and e.enviado_em >= hoje))
                  order by n.criado_em) from public.disparo_numeros n), '[]'::jsonb),
    'disparos', coalesce((select jsonb_agg(x order by x.criado_em desc) from (
      select d.id, d.nome, d.status, d.motivo_pausa, d.criado_em, d.iniciado_em, d.concluido_em, d.numeros, d.alternar, d.ritmo_s,
             count(e.id) filter (where not e.teste) as total,
             count(e.id) filter (where not e.teste and e.status = 'enviado') as enviados,
             count(e.id) filter (where not e.teste and e.status = 'falhou') as falhas,
             count(e.id) filter (where not e.teste and e.status = 'fila') as fila,
             count(e.id) filter (where not e.teste and e.entregue_em is not null) as entregues,
             count(e.id) filter (where not e.teste and e.lida_em is not null) as lidas,
             count(e.id) filter (where not e.teste and e.clicou_em is not null) as clicaram,
             count(e.id) filter (where not e.teste and e.respondeu_em is not null) as responderam
        from public.disparos d left join public.disparo_envios e on e.disparo_id = d.id
       group by d.id
       order by d.criado_em desc
       limit 50) x), '[]'::jsonb));
end $$;
revoke execute on function public.disparo_painel() from public, anon;
grant execute on function public.disparo_painel() to authenticated;

create or replace function public.disparo_detalhe(id_ uuid)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare d public.disparos;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma vê os disparos'; end if;
  select * into d from public.disparos where id = id_;
  if not found then return null; end if;
  return jsonb_build_object('disparo', to_jsonb(d),
    'envios', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'chave', e.chave, 'telefone', e.telefone, 'nome', e.nome, 'cidade', e.cidade,
                 'salao', e.salao, 'instancia', e.instancia, 'status', e.status, 'erro', e.erro, 'enviado_em', e.enviado_em,
                 'entregue_em', e.entregue_em, 'lida_em', e.lida_em, 'clicou_em', e.clicou_em, 'cliques', e.cliques, 'respondeu_em', e.respondeu_em)
                 order by e.id) from public.disparo_envios e where e.disparo_id = id_ and not e.teste), '[]'::jsonb));
end $$;
revoke execute on function public.disparo_detalhe(uuid) from public, anon;
grant execute on function public.disparo_detalhe(uuid) to authenticated;

-- ---- os chips de disparo -----------------------------------------------------------------------------------------------
create or replace function public.disparo_numero_salvar(instancia_ text, rotulo_ text, numero_ text)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare tel text := nullif(regexp_replace(coalesce(numero_, ''), '[^0-9]', '', 'g'), '');
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma mexe nos números'; end if;
  if tel is not null and length(tel) in (10, 11) then tel := '55' || tel; end if;
  begin
    insert into public.disparo_numeros (instancia, rotulo, numero) values (instancia_, coalesce(nullif(btrim(rotulo_), ''), 'Chip'), tel)
    on conflict (instancia) do update set rotulo = excluded.rotulo, numero = coalesce(excluded.numero, disparo_numeros.numero);
  exception when check_violation then
    raise exception '%', case when sqlerrm ~ 'disparo_numeros_numero_check' then 'o número precisa ter DDD (só dígitos, com ou sem o 55)'
                              when sqlerrm ~ 'disparo_numeros_rotulo_check' then 'o nome do chip vai de 1 a 40 caracteres'
                              else 'instância inválida' end;
  end;
  return jsonb_build_object('ok', true, 'instancia', instancia_, 'numero', tel);
end $$;
revoke execute on function public.disparo_numero_salvar(text, text, text) from public, anon;
grant execute on function public.disparo_numero_salvar(text, text, text) to authenticated;

create or replace function public.disparo_numero_apagar(instancia_ text)
returns jsonb language plpgsql security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma mexe nos números'; end if;
  delete from public.disparo_numeros where instancia = instancia_;
  update public.disparos set numeros = array_remove(numeros, instancia_) where instancia_ = any (numeros) and status <> 'concluido';
  return jsonb_build_object('ok', found);
end $$;
revoke execute on function public.disparo_numero_apagar(text) from public, anon;
grant execute on function public.disparo_numero_apagar(text) to authenticated;

-- ---- o prazo dos dados -------------------------------------------------------------------------------------------------
-- depois de retencao_dias (o da Mel, 90): o envio fica sem nome, número e cidade (sobra a contagem); o perfil sai
create or replace function public.disparo_limpar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  dias int := coalesce((select retencao_dias from public.guia_whats_config where id = 1), 90);
  a int; b int;
begin
  update public.disparo_envios set telefone = '', chave = 'apagado-' || id, nome = null, cidade = null, salao = null, apagado_em = now()
   where apagado_em is null and coalesce(enviado_em, (select criado_em from public.disparos where id = disparo_id)) < now() - make_interval(days => dias);
  get diagnostics a = row_count;
  delete from public.guia_whats_perfis where em < now() - make_interval(days => dias);
  get diagnostics b = row_count;
  return jsonb_build_object('envios', a, 'perfis', b);
end $$;
revoke execute on function public.disparo_limpar() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'mimo-disparo-limpar';
select cron.schedule('mimo-disparo-limpar', '23 7 * * *', $$select public.disparo_limpar()$$);

do $$
declare n int;
begin
  select count(distinct chave) into n from public.guia_whats_conversas where not teste and atualizada_em > now() - interval '90 days';
  raise notice '254: disparo pronto (% pessoas conversaram com a Mel nos últimos 90 dias)', n;
end $$;
