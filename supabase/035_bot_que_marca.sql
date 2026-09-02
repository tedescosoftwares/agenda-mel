-- =============================================================
-- Agenda Mel — 035: o bot que marca sozinho
--
-- Uma conversa por telefone, com estado guardado, perguntando uma coisa
-- de cada vez e sempre com opções numeradas. O modelo de linguagem NÃO
-- participa daqui: ele já fez o trabalho dele lá atrás, decidindo que a
-- pessoa quer marcar. Daqui em diante é máquina de estados, porque
-- escolher entre cinco serviços não precisa de inteligência nenhuma e
-- precisa muito de previsibilidade.
--
-- O limite honesto: o bot marca para quem JÁ É CLIENTE — quem tem
-- telefone no cadastro. Criar conta exige criar usuário de autenticação,
-- que não é coisa para uma conversa de WhatsApp fazer sozinha. Quem
-- ainda não é cliente recebe o link e é bem recebida por gente.
-- =============================================================

-- 1. Horário livre, uma implementação só ---------------------------------
-- Isto já existia, em JavaScript, dentro do navegador (lib/booking.js).
-- Escrever uma segunda versão aqui criaria duas verdades sobre "que
-- horas estão livres", e um dia elas discordariam — provavelmente no dia
-- em que duas clientes pegassem o mesmo horário. Então esta função passa
-- a ser A resposta, e a página pública passa a chamá-la também.
--
-- A grade de 30 em 30 minutos e a regra "não oferecer horário que já
-- passou hoje" são as mesmas do gerarSlots(); há um teste comparando as
-- duas saídas.
drop function if exists public.horarios_livres(uuid, date, integer);
create or replace function public.horarios_livres(
  prof uuid,
  dia date,
  duracao integer
)
returns table (hora time)
language sql
stable
security definer set search_path = public
as $$
  with expediente as (
    select h.start_time as abre, h.end_time as fecha
    from public.professional_hours h
    where h.professional_id = prof
      and h.weekday = extract(dow from dia)
      and h.open
  ),
  ocupado as (
    select * from public.get_busy_slots(dia, prof)
  ),
  grade as (
    select (generate_series(
              dia + e.abre,
              dia + e.fecha - make_interval(mins => duracao),
              interval '30 minutes'))::time as t
    from expediente e
  )
  select g.t
  from grade g
  where not exists (
          select 1 from ocupado o
          where g.t < o.end_time
            and (g.t + make_interval(mins => duracao))::time > o.start_time)
    -- horário que já passou não é vaga
    and (dia > (public.agora_local())::date
         or (dia = (public.agora_local())::date
             and g.t > (public.agora_local())::time))
  order by g.t;
$$;

grant execute on function public.horarios_livres(uuid, date, integer)
  to anon, authenticated;

-- 2. Os próximos dias com vaga -------------------------------------------
create or replace function public.dias_com_vaga(
  prof uuid,
  duracao integer,
  quantos integer default 5
)
returns table (dia date, vagas integer)
language sql
stable
security definer set search_path = public
as $$
  select d.dia, count(*)::integer
  from generate_series(
         (public.agora_local())::date,
         (public.agora_local())::date + 20,
         interval '1 day') as s(dia)
  cross join lateral (select s.dia::date as dia) d
  cross join lateral public.horarios_livres(prof, d.dia, duracao) h
  group by d.dia
  having count(*) > 0
  order by d.dia
  limit greatest(1, least(coalesce(quantos, 5), 10));
$$;

revoke execute on function public.dias_com_vaga(uuid, integer, integer)
  from public, anon, authenticated;

-- 3. A conversa -----------------------------------------------------------
-- Uma por telefone. Guardar as OPÇÕES oferecidas é o que faz "2"
-- significar alguma coisa: sem isso o número que ela responde não tem a
-- que se referir, e o bot teria que adivinhar.
create table if not exists public.conversas (
  telefone text primary key,
  salon_id uuid not null references public.salons (id) on delete cascade,
  client_id uuid references public.profiles (id) on delete set null,
  -- servico | profissional | dia | hora | confirma
  estado text not null default 'servico',
  dados jsonb not null default '{}'::jsonb,
  opcoes jsonb,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  -- conversa esquecida morre. Confirmar às cegas um horário escolhido
  -- há três dias é pior do que recomeçar.
  expira_em timestamptz not null default now() + interval '30 minutes'
);

alter table public.conversas enable row level security;

drop policy if exists "equipe ve as conversas" on public.conversas;
create policy "equipe ve as conversas"
  on public.conversas for select
  to authenticated
  using (public.is_admin_do_salao(salon_id));

revoke insert, update, delete on public.conversas from authenticated, anon;

-- 4. Numerar e escolher ---------------------------------------------------
create or replace function public.lista_numerada(opcoes jsonb)
returns text
language sql
immutable
as $$
  select string_agg('*' || (o.valor ->> 'n') || '* · ' || (o.valor ->> 'rotulo'),
                    E'\n' order by (o.valor ->> 'n')::int)
  from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor);
$$;

-- Aceita o número, e também o texto por extenso quando ele bate sozinho:
-- quem responde "manicure" em vez de "1" não errou, só é gente.
create or replace function public.escolher_opcao(opcoes jsonb, texto text)
returns jsonb
language plpgsql
immutable
as $$
declare
  limpo text;
  n integer;
  achou jsonb;
  quantos integer;
begin
  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  limpo := regexp_replace(limpo, '[^a-z0-9: ]', '', 'g');
  limpo := btrim(limpo);
  if limpo = '' then return null; end if;

  if limpo ~ '^[0-9]{1,2}$' then
    n := limpo::int;
    select o.valor into achou
    from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
    where (o.valor ->> 'n')::int = n;
    return achou;
  end if;

  -- texto que aparece em exatamente UMA opção. Batendo em duas, devolver
  -- a primeira seria escolher no lugar dela; melhor perguntar de novo.
  select count(*) into quantos
  from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
  where position(limpo in lower(translate(coalesce(o.valor ->> 'busca', ''),
        'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))) > 0;

  if quantos = 1 then
    select o.valor into achou
    from jsonb_array_elements(coalesce(opcoes, '[]'::jsonb)) as o(valor)
    where position(limpo in lower(translate(coalesce(o.valor ->> 'busca', ''),
          'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'))) > 0;
    return achou;
  end if;

  return null;
end;
$$;

-- 5. Data por extenso, sem depender do idioma do banco --------------------
create or replace function public.dia_por_extenso(d date)
returns text
language sql
immutable
as $$
  select (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])
           [extract(dow from d)::int + 1]
         || ' ' || to_char(d, 'DD/MM');
$$;

-- 6. A máquina de estados -------------------------------------------------
-- Uma pergunta de cada vez, sempre com opções numeradas, e cada resposta
-- avança um passo. Devolve o que dizer e, quando fecha, o id do horário.
create or replace function public.avancar_conversa(
  tel text,
  texto text,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  c public.conversas%rowtype;
  cliente uuid;
  escolha jsonb;
  novas jsonb;
  d jsonb;
  cabecalho text := '';
  limpo text;
  dur integer;
  nome_serv text;
  prof_id uuid;
  prof_nome text;
  dia_esc date;
  hora_esc time;
  novo_appt uuid;
  quantos integer;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

  -- Sair da conversa é sagrado: tem que funcionar em qualquer passo, e
  -- tem que ser óbvio. Ninguém fica preso num menu.
  if limpo in ('cancelar', 'parar', 'sair', 'desistir', 'deixa', 'deixa pra la') then
    delete from public.conversas where telefone = e164;
    return jsonb_build_object('acao', 'desistiu',
      'responder', 'Tudo bem, cancelei por aqui. Quando quiser, é só chamar 💛');
  end if;

  -- conversa velha não vale: apaga antes de ler
  delete from public.conversas where telefone = e164 and expira_em < now();
  select * into c from public.conversas where telefone = e164;

  -- ---------------------------------------------------------------------
  -- Começo
  -- ---------------------------------------------------------------------
  if not found then
    -- Quem chama normalmente passa o salão, mas depender disso é frágil:
    -- basta a conversa expirar no meio para a próxima mensagem chegar sem
    -- ele, e a cliente receber silêncio. O histórico responde.
    if salao is null then
      select o.salon_id into salao
      from public.message_outbox o
      where o.telefone = e164
      order by o.criado_em desc
      limit 1;
    end if;
    if salao is null then
      return jsonb_build_object('acao', 'sem_canal');
    end if;

    cliente := public.cliente_pelo_telefone(e164);
    if cliente is null then
      -- O bot marca para quem já é cliente. Criar conta exige criar
      -- usuário de autenticação, que não é coisa para uma conversa de
      -- WhatsApp fazer sozinha — e um cadastro meia-boca vira cliente
      -- duplicada na agenda de alguém.
      return jsonb_build_object('acao', 'sem_cadastro');
    end if;

    -- os apelidos levam sufixo _c porque plpgsql resolve nome de coluna
    -- e de variável no mesmo escopo: uma coluna chamada "dur" ao lado da
    -- variável "dur" faz o Postgres recusar a consulta inteira
    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', rotulo_c,
             'busca', nome_c, 'dur', dur_c))
      into novas
    from (
      select row_number() over (order by s.name) as linha_c,
             s.id as id_c, s.name as nome_c, s.duration_minutes as dur_c,
             s.name || ' · R$ ' || to_char(s.price, 'FM999G990D00') as rotulo_c
      from public.services s
      where s.salon_id = salao and s.active
      order by s.name
      limit 9
    ) t;

    if novas is null then
      return jsonb_build_object('acao', 'sem_servico',
        'responder', 'Ainda não tenho serviços cadastrados por aqui 😅');
    end if;

    insert into public.conversas (telefone, salon_id, client_id, estado, opcoes, dados)
    values (e164, salao, cliente, 'servico', novas, '{}'::jsonb);

    return jsonb_build_object('acao', 'perguntou', 'estado', 'servico',
      'responder', '💛 Vamos marcar! O que você quer fazer?' || E'\n\n'
                   || public.lista_numerada(novas) || E'\n\n'
                   || '_Responda com o número._');
  end if;

  escolha := public.escolher_opcao(c.opcoes, texto);
  if escolha is null then
    return jsonb_build_object('acao', 'nao_entendi', 'estado', c.estado,
      'responder', '🤔 Não peguei. Responda com o número de uma das opções:'
                   || E'\n\n' || public.lista_numerada(c.opcoes)
                   || E'\n\n' || '_Ou responda CANCELAR para parar._');
  end if;

  d := c.dados;

  -- ---------------------------------------------------------------------
  -- Escolheu o serviço -> quem atende
  -- ---------------------------------------------------------------------
  if c.estado = 'servico' then
    d := d || jsonb_build_object('servico_id', escolha ->> 'id',
                                 'servico', escolha ->> 'busca',
                                 'dur', (escolha ->> 'dur')::int);

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', nome_c, 'busca', nome_c))
      into novas
    from (
      select row_number() over (order by p.name) as linha_c,
             p.id as id_c, p.name as nome_c
      from public.professionals p
      join public.professional_services ps on ps.professional_id = p.id
      where p.salon_id = c.salon_id and p.active
        and ps.service_id = (escolha ->> 'id')::uuid
      order by p.name
      limit 9
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_profissional',
        'responder', 'Ninguém está atendendo esse serviço agora 😕 Me chama que a gente dá um jeito.');
    end if;

    select count(*) into quantos from jsonb_array_elements(novas);

    -- uma profissional só: perguntar seria burocracia
    if quantos = 1 then
      escolha := novas -> 0;
      cabecalho := '✨ ' || (d ->> 'servico') || ' com *' || (escolha ->> 'rotulo') || '*' || E'\n\n';
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
      c.estado := 'profissional';
    else
      update public.conversas
      set estado = 'profissional', dados = d, opcoes = novas,
          atualizada_em = now(), expira_em = now() + interval '30 minutes'
      where telefone = e164;

      return jsonb_build_object('acao', 'perguntou', 'estado', 'profissional',
        'responder', '✨ ' || (d ->> 'servico') || '! Com quem você prefere?'
                     || E'\n\n' || public.lista_numerada(novas)
                     || E'\n\n' || '_Responda com o número._');
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu quem atende -> que dia
  -- ---------------------------------------------------------------------
  if c.estado = 'profissional' then
    if d ->> 'prof_id' is null then
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
    end if;
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', dia_c::text, 'rotulo', rotulo_c, 'busca', rotulo_c))
      into novas
    from (
      select row_number() over (order by v.dia) as linha_c, v.dia as dia_c,
             public.dia_por_extenso(v.dia) || ' · ' || v.vagas || ' horários' as rotulo_c
      from public.dias_com_vaga(prof_id, dur, 5) v
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_vaga',
        'responder', 'Puxa, a agenda dela está cheia nos próximos dias 😕'
                     || E'\n\n' || 'Me chama que a gente encaixa você.');
    end if;

    update public.conversas
    set estado = 'dia', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'dia',
      'responder', cabecalho || '📅 Que dia fica melhor?' || E'\n\n'
                   || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu o dia -> que horas
  -- ---------------------------------------------------------------------
  if c.estado = 'dia' then
    d := d || jsonb_build_object('dia', escolha ->> 'id');
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', to_char(hora_c, 'HH24:MI'),
             'rotulo', to_char(hora_c, 'HH24:MI'), 'busca', to_char(hora_c, 'HH24:MI')))
      into novas
    from (
      select row_number() over (order by h.hora) as linha_c, h.hora as hora_c
      from public.horarios_livres(prof_id, dia_esc, dur) h
      limit 9
    ) t;

    if novas is null then
      -- alguém pegou o dia entre a pergunta e a resposta
      update public.conversas set estado = 'profissional', dados = d,
             atualizada_em = now() where telefone = e164;
      return jsonb_build_object('acao', 'dia_lotou',
        'responder', 'Esse dia acabou de encher 😕 Responda qualquer coisa que eu mostro os outros.');
    end if;

    update public.conversas
    set estado = 'hora', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'hora',
      'responder', '🕒 ' || public.dia_por_extenso(dia_esc) || '. Que horas?'
                   || E'\n\n' || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu a hora -> confere antes de marcar
  -- ---------------------------------------------------------------------
  if c.estado = 'hora' then
    d := d || jsonb_build_object('hora', escolha ->> 'id');
    novas := jsonb_build_array(
      jsonb_build_object('n', 1, 'id', 'sim', 'rotulo', 'Confirmar', 'busca', 'confirmar sim isso'),
      jsonb_build_object('n', 2, 'id', 'nao', 'rotulo', 'Recomeçar',  'busca', 'recomecar nao mudar'));

    update public.conversas
    set estado = 'confirma', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'confirma',
      'responder', 'Confere pra mim:' || E'\n\n'
                   || '✨ ' || (d ->> 'servico') || E'\n'
                   || '👩 com *' || (d ->> 'prof') || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso((d ->> 'dia')::date)
                   || ' às ' || (d ->> 'hora') || E'\n\n'
                   || public.lista_numerada(novas));
  end if;

  -- ---------------------------------------------------------------------
  -- Confirmou -> marca de verdade
  -- ---------------------------------------------------------------------
  if c.estado = 'confirma' then
    if (escolha ->> 'id') = 'nao' then
      delete from public.conversas where telefone = e164;
      return public.avancar_conversa(e164, 'recomecar', c.salon_id);
    end if;

    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;
    hora_esc := (d ->> 'hora')::time;
    nome_serv := d ->> 'servico';
    prof_nome := d ->> 'prof';

    -- Entre a pergunta e a resposta dela, alguém pode ter marcado. O
    -- índice único de (data, hora) barra o choque, mas conferir antes
    -- deixa a resposta decente em vez de um erro de banco.
    if not exists (
      select 1 from public.horarios_livres(prof_id, dia_esc, dur) h
      where h.hora = hora_esc
    ) then
      update public.conversas set estado = 'profissional', atualizada_em = now()
      where telefone = e164;
      return jsonb_build_object('acao', 'hora_foi',
        'responder', 'Que pena, pegaram esse horário agora 😕'
                     || E'\n\n' || 'Responda qualquer coisa que eu mostro os que sobraram.');
    end if;

    insert into public.appointments
      (client_id, professional_id, salon_id, service_id,
       date, start_time, end_time, status)
    values
      (c.client_id, prof_id, c.salon_id, (d ->> 'servico_id')::uuid,
       dia_esc, hora_esc, (hora_esc + make_interval(mins => dur))::time,
       'confirmado')
    returning id into novo_appt;

    delete from public.conversas where telefone = e164;

    return jsonb_build_object('acao', 'marcou', 'appointment_id', novo_appt,
      'responder', '✅ *Marcado!*' || E'\n\n'
                   || '✨ ' || nome_serv || E'\n'
                   || '👩 com *' || prof_nome || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                   || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                   || 'Te espero! Se precisar mudar, é só me chamar 💛');
  end if;

  return jsonb_build_object('acao', 'nada');
end;
$$;

revoke execute on function public.avancar_conversa(text, text, uuid)
  from public, anon, authenticated;

-- 7. O bot entra na porta de entrada --------------------------------------
-- Até aqui, "quer marcar" respondia com o link e avisava a profissional.
-- Agora, quando o salão liga o bot, quem responde é ele — e o link vira
-- o plano B, para salão que não quer bot e para cliente sem cadastro.
alter table public.whatsapp_channels
  add column if not exists usa_bot boolean not null default false;

grant update (usa_bot) on public.whatsapp_channels to authenticated;

drop function if exists public.ligar_bot(uuid, boolean);
create or replace function public.ligar_bot(salao uuid, ligado boolean)
returns boolean
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'só a dona do salão liga o bot';
  end if;
  update public.whatsapp_channels set usa_bot = ligado where salon_id = salao;
  return ligado;
end;
$$;

revoke execute on function public.ligar_bot(uuid, boolean) from public, anon;
grant execute on function public.ligar_bot(uuid, boolean) to authenticated;

-- 8. Uma porta só ---------------------------------------------------------
-- O webhook chama esta, e ela decide: conversa em andamento continua,
-- mesmo que a mensagem pareça outra coisa; senão vale o caminho de
-- sempre. Sem isto, a cliente respondendo "2" no meio do menu cairia em
-- interpretar_resposta() e cancelaria um agendamento por engano.
create or replace function public.receber_mensagem(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  intencao_do_modelo text default null,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  r jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  -- repetida não age duas vezes, nem no bot
  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select c.usa_bot into bot_ligado
  from public.whatsapp_channels c where c.salon_id = salao;

  select exists (
    select 1 from public.conversas
    where telefone = e164 and expira_em > now()
  ) into tem_conversa;

  -- Conversa aberta ganha de tudo. É o passo mais importante desta
  -- função: no meio de um menu, "2" quer dizer "a segunda opção", nunca
  -- "cancele meu horário".
  if tem_conversa or (coalesce(bot_ligado, false)
                      and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);

    insert into public.whatsapp_inbox
      (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
    values (e164, texto, id_provedor,
            public.cliente_pelo_telefone(e164),
            'bot:' || coalesce(r ->> 'acao', '?'),
            nullif(r ->> 'appointment_id', '')::uuid,
            case when tem_conversa then 'bot' else 'ia' end,
            intencao_do_modelo);

    -- quem não tem cadastro não some: cai no caminho antigo, que manda o
    -- link e avisa gente
    if (r ->> 'acao') <> 'sem_cadastro' then
      return r;
    end if;
  end if;

  return public.receber_resposta_whatsapp(
    e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);
end;
$$;

revoke execute on function
  public.receber_mensagem(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- 'bot' entra na lista de origens conhecidas
do $$ begin
  alter table public.whatsapp_inbox drop constraint if exists via_conhecida;
  alter table public.whatsapp_inbox
    add constraint via_conhecida check (via in ('regra', 'ia', 'bot'));
exception when others then null; end $$;
