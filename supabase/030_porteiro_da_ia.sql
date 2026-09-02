-- =============================================================
-- Agenda Mel — 030: o porteiro da IA
--
-- Sem isto, toda mensagem que chega no WhatsApp vira chamada de API:
-- um "oi", uma figurinha, um número errado, um engraçadinho mandando
-- mil mensagens. Cada uma custa cota, e a cota é do salão inteiro.
--
-- A ideia é um funil, do mais barato para o mais caro. A IA é o último
-- recurso, não o primeiro, e só é alcançada pelo que nenhuma consulta
-- de banco soube resolver:
--
--   1. telefone válido?                    (regex, custo zero)
--   2. o número fala com algum salão meu?  (uma consulta)
--   3. o salão ligou a IA?                 (desligada de fábrica)
--   4. o texto tem tamanho de frase?       (custo zero)
--   5. é "1", "sim", "cancelar"?           (resolve sem IA)
--   6. o salão ainda tem cota hoje?        (uma contagem)
--   7. este número já falou demais?        (uma contagem)
--
-- Só o que passa pelos sete é texto solto de verdade.
-- =============================================================

-- 1. Configuração, por salão ---------------------------------------------
-- Desligada de fábrica, de propósito: ninguém liga IA sem querer, e
-- salão que nunca ouviu falar disso continua funcionando igual.
alter table public.whatsapp_channels
  add column if not exists usa_ia boolean not null default false;

alter table public.whatsapp_channels
  add column if not exists teto_ia_diario integer not null default 200;

alter table public.whatsapp_channels
  add column if not exists teto_ia_por_numero integer not null default 10;

do $$ begin
  alter table public.whatsapp_channels
    add constraint teto_ia_diario_razoavel check (teto_ia_diario between 0 and 5000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.whatsapp_channels
    add constraint teto_ia_numero_razoavel check (teto_ia_por_numero between 0 and 200);
exception when duplicate_object then null; end $$;

-- o app precisa poder ligar e ajustar isso pela tela de ajustes
grant update (usa_ia, teto_ia_diario, teto_ia_por_numero)
  on public.whatsapp_channels to authenticated;

-- 2. Registro de cada chamada --------------------------------------------
-- Serve para duas coisas ao mesmo tempo: contar, para os tetos, e
-- prestar contas depois ("por que a IA respondeu isso pra minha
-- cliente?"). Guardar só o número de tokens e não o texto é de
-- propósito: o texto já está na whatsapp_inbox, e duplicar dado de
-- cliente em mais uma tabela é aumentar a superfície à toa.
create table if not exists public.ia_chamadas (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  telefone text not null,
  inbox_id uuid references public.whatsapp_inbox (id) on delete set null,
  modelo text,
  tokens_prompt integer,
  tokens_resposta integer,
  -- quanto tempo o provedor levou, para saber quando ele degradar
  ms integer,
  erro text,
  criado_em timestamptz not null default now()
);

create index if not exists ia_chamadas_salao_idx
  on public.ia_chamadas (salon_id, criado_em desc);
create index if not exists ia_chamadas_telefone_idx
  on public.ia_chamadas (telefone, criado_em desc);

alter table public.ia_chamadas enable row level security;

drop policy if exists "admin ve o consumo de ia" on public.ia_chamadas;
create policy "admin ve o consumo de ia"
  on public.ia_chamadas for select
  to authenticated
  using (public.is_admin_do_salao(salon_id));

revoke insert, update, delete on public.ia_chamadas from authenticated, anon;

-- 3. De instância para salão ----------------------------------------------
-- A cliente que escreve pela primeira vez nunca recebeu nada nossa, então
-- canal_do_telefone() não a encontra. Quem sabe de que salão é a conversa
-- é o número que RECEBEU: no Evolution, o nome da instância.
create or replace function public.salao_do_canal(instancia text)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select c.salon_id
  from public.whatsapp_channels c
  where c.ativo
    and c.identificador is not null
    and c.identificador = instancia
  limit 1;
$$;

revoke execute on function public.salao_do_canal(text)
  from public, anon, authenticated;

-- 4. Quanto já se gastou --------------------------------------------------
create or replace function public.ia_gastas_hoje(salao uuid)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.ia_chamadas
  where salon_id = salao
    and erro is null
    and criado_em >= date_trunc('day', public.agora_local())
                     at time zone 'America/Sao_Paulo';
$$;

revoke execute on function public.ia_gastas_hoje(uuid)
  from public, anon, authenticated;

create or replace function public.ia_gastas_do_numero(tel text)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select count(*)::integer
  from public.ia_chamadas
  where telefone = public.telefone_e164(tel)
    and erro is null
    and criado_em > now() - interval '1 hour';
$$;

revoke execute on function public.ia_gastas_do_numero(text)
  from public, anon, authenticated;

-- 5. O PORTEIRO -----------------------------------------------------------
-- Devolve sempre um objeto com 'permitido' e 'motivo'. O motivo importa:
-- é o que a Edge Function usa para decidir o que responder, e é o que
-- aparece no diagnóstico quando alguém disser "o bot não respondeu".
--
-- Quando a resposta é um simples "1" ou "cancelar", devolve permitido =
-- false com motivo 'resposta_simples' e a ação já mastigada: quem chamou
-- manda direto para receber_resposta_whatsapp() e não gasta um token.
create or replace function public.ia_permitida(
  tel text,
  texto text,
  instancia text default null
)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  e164 text;
  salao uuid;
  ligada boolean;
  teto_dia integer;
  teto_num integer;
  gastas integer;
  acao text;
  limpo text;
begin
  -- 1. telefone -----------------------------------------------------
  e164 := public.telefone_e164(tel);
  if e164 is null then
    return jsonb_build_object('permitido', false, 'motivo', 'telefone_invalido');
  end if;

  -- 2. de quem é esta conversa --------------------------------------
  -- primeiro pela instância que recebeu; se não vier, pelo histórico
  salao := public.salao_do_canal(instancia);
  if salao is null then
    select o.salon_id into salao
    from public.message_outbox o
    where o.telefone = e164
      and o.status in ('enviado', 'entregue', 'lido')
    order by o.enviado_em desc nulls last
    limit 1;
  end if;

  if salao is null then
    return jsonb_build_object('permitido', false, 'motivo', 'sem_canal');
  end if;

  -- 3. o salão quer IA? ---------------------------------------------
  select c.usa_ia and c.ativo, c.teto_ia_diario, c.teto_ia_por_numero
    into ligada, teto_dia, teto_num
  from public.whatsapp_channels c
  where c.salon_id = salao;

  if not coalesce(ligada, false) then
    return jsonb_build_object('permitido', false, 'motivo', 'ia_desligada',
                              'salon_id', salao);
  end if;

  -- 4. isto é uma frase? --------------------------------------------
  limpo := btrim(coalesce(texto, ''));
  if limpo = '' then
    -- figurinha, áudio, imagem: chegam sem texto
    return jsonb_build_object('permitido', false, 'motivo', 'sem_texto',
                              'salon_id', salao);
  end if;
  if length(limpo) > 500 then
    -- ninguém agenda manicure em 500 caracteres. Texto desse tamanho é
    -- engano ou abuso, e ainda custaria caro em tokens.
    return jsonb_build_object('permitido', false, 'motivo', 'texto_longo',
                              'salon_id', salao);
  end if;

  -- 5. dá para resolver sem IA? -------------------------------------
  acao := public.interpretar_resposta(limpo);
  if acao <> 'nada' then
    return jsonb_build_object('permitido', false, 'motivo', 'resposta_simples',
                              'acao', acao, 'salon_id', salao);
  end if;

  -- 6. o salão ainda tem cota hoje? ---------------------------------
  gastas := public.ia_gastas_hoje(salao);
  if gastas >= coalesce(teto_dia, 0) then
    return jsonb_build_object('permitido', false, 'motivo', 'teto_do_salao',
                              'salon_id', salao, 'gastas', gastas,
                              'teto', teto_dia);
  end if;

  -- 7. este número já falou demais? ---------------------------------
  -- é a trava contra o número hostil: sem ela, mil mensagens de um
  -- telefone só queimam a cota do salão inteiro em minutos
  gastas := public.ia_gastas_do_numero(e164);
  if gastas >= coalesce(teto_num, 0) then
    return jsonb_build_object('permitido', false, 'motivo', 'teto_do_numero',
                              'salon_id', salao, 'gastas', gastas,
                              'teto', teto_num);
  end if;

  return jsonb_build_object('permitido', true, 'motivo', 'ok',
                            'salon_id', salao,
                            'client_id', public.cliente_pelo_telefone(e164));
end;
$$;

revoke execute on function public.ia_permitida(text, text, text)
  from public, anon, authenticated;

-- 6. Registrar o que foi gasto -------------------------------------------
-- Chamada DEPOIS da resposta do provedor. Erro também é registrado, com
-- erro preenchido: aparece no diagnóstico, mas não conta contra o teto —
-- cobrar do salão uma chamada que falhou seria punir pelo defeito alheio.
create or replace function public.registrar_chamada_ia(
  salao uuid,
  tel text,
  modelo_usado text default null,
  tk_prompt integer default null,
  tk_resposta integer default null,
  duracao_ms integer default null,
  deu_erro text default null,
  inbox uuid default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  novo uuid;
begin
  insert into public.ia_chamadas
    (salon_id, telefone, inbox_id, modelo, tokens_prompt, tokens_resposta, ms, erro)
  values
    (salao, public.telefone_e164(tel), inbox, modelo_usado,
     tk_prompt, tk_resposta, duracao_ms, deu_erro)
  returning id into novo;
  return novo;
end;
$$;

revoke execute on function public.registrar_chamada_ia(uuid, text, text, integer, integer, integer, text, uuid)
  from public, anon, authenticated;

-- 7. Para a tela de ajustes ----------------------------------------------
-- A dona precisa ver o consumo sem abrir o painel do provedor.
drop function if exists public.resumo_da_ia(uuid);
create or replace function public.resumo_da_ia(salao uuid)
returns table (
  ligada boolean,
  teto_diario integer,
  gastas_hoje integer,
  gastas_7d integer,
  falhas_7d integer,
  ms_medio integer,
  ultimo_uso timestamptz
)
language sql
stable
security definer set search_path = public
as $$
  select
    c.usa_ia,
    c.teto_ia_diario,
    public.ia_gastas_hoje(salao),
    (select count(*)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is null
        and x.criado_em > now() - interval '7 days'),
    (select count(*)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is not null
        and x.criado_em > now() - interval '7 days'),
    (select avg(x.ms)::integer from public.ia_chamadas x
      where x.salon_id = salao and x.erro is null
        and x.criado_em > now() - interval '7 days'),
    (select max(x.criado_em) from public.ia_chamadas x where x.salon_id = salao)
  from public.whatsapp_channels c
  where c.salon_id = salao
    and public.is_admin_do_salao(salao);
$$;

revoke execute on function public.resumo_da_ia(uuid) from public, anon;
grant execute on function public.resumo_da_ia(uuid) to authenticated;
