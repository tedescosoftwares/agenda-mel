-- 234 · A mensalidade da MIMO: uma cobrança aberta por vez, com prazo, planos com desconto (3.94)
--
-- O que estava errado:
--   • "Renovar por Pix" só reaproveitava a cobrança aberta do MESMO dia de início. Para o salão vencido o início é
--     "hoje", então cada dia (cada clique em dia novo) abria uma cobrança nova no Asaas, e as velhas ficavam abertas
--     para sempre (pagáveis!) porque ninguém as cancelava.
--   • O Pix vencia no mesmo dia em que era gerado.
--   • A rotina que confere as cobranças no Asaas (chutar_assinaturas › assinatura-cuidar) estava desligada desde a 134.
--
-- Como fica:
--   • Planos: mensal, semestral (10% de desconto) e anual (15%). Na ativação, o mensal mantém os 20% da primeira
--     mensalidade. planos_do_salao(salao, inicial) devolve os três com os preços do salão.
--   • Vencimento pelo dia da contratação: a próxima cobrança vence no dia em que o período atual acaba (o "dia X") e
--     o período novo começa nesse dia. Quem já passou do prazo (ou ainda está configurando) paga em até 3 dias e o
--     período começa no dia do pagamento (inicio_no_pagamento).
--   • A cobrança é gerada antes, sozinha: 7 dias antes do fim do período pago e 3 dias antes do fim do teste
--     (cuidar_das_assinaturas cria a linha; assinatura-cuidar leva para o Asaas). No mesmo plano do último pagamento.
--   • Uma aberta por vez: abrir outra (outro plano, preço mudou, prazo passou) cancela a anterior, e a função apaga
--     a anterior no Asaas antes de criar a nova.
--   • Não paga até 3 dias depois do vencimento (cancelar_em): é apagada no Asaas e fica "cancelada" no painel.
--   • Pagar durante o teste ("pagar agora e já ativar"): o salão vira ativo na hora e o período pago começa quando o
--     teste acabaria (os dias grátis não se perdem).
--   • cobranca_mimo_confirmar ajusta o período das cobranças que começam no pagamento e respeita os meses do plano.

-- ---------------------------------------------------------------------------
-- 1. Colunas novas
-- ---------------------------------------------------------------------------
alter table public.cobrancas_mimo add column if not exists meses integer not null default 1;
alter table public.cobrancas_mimo drop constraint if exists cobrancas_mimo_meses_check;
alter table public.cobrancas_mimo add constraint cobrancas_mimo_meses_check check (meses in (1, 6, 12));
alter table public.cobrancas_mimo add column if not exists inicio_no_pagamento boolean not null default false;
alter table public.cobrancas_mimo add column if not exists cancelar_em date;

-- as abertas que já existem ganham prazo; das duplicadas (várias abertas no mesmo salão), só a mais nova fica:
-- as outras vencem ontem e a próxima volta da rotina as apaga no Asaas
update public.cobrancas_mimo c
   set cancelar_em = c.vencimento + 3
 where c.status in ('a_criar', 'aguardando') and c.cancelar_em is null;
update public.cobrancas_mimo c
   set cancelar_em = (now() at time zone 'America/Sao_Paulo')::date - 1
 where c.status in ('a_criar', 'aguardando')
   and exists (
     select 1 from public.cobrancas_mimo k
      where k.salon_id = c.salon_id and k.status in ('a_criar', 'aguardando')
        and k.criado_em > c.criado_em
   );

-- as que o jeito antigo marcou "expirado" (só no banco) podem seguir abertas, e pagáveis, no Asaas: voltam para a
-- rotina conferir. Paga lá → é creditada; não paga → é apagada no Asaas e fica "cancelada".
update public.cobrancas_mimo
   set status = 'aguardando', cancelar_em = (now() at time zone 'America/Sao_Paulo')::date - 1,
       erro = 'conferir no Asaas (234)', atualizado_em = now() - interval '2 hours'
 where status = 'expirado' and metodo = 'pix' and cobranca_id is not null
   and criado_em > now() - interval '120 days';

-- ---------------------------------------------------------------------------
-- 2. As regras e os planos
-- ---------------------------------------------------------------------------
create or replace function public.planos_da_mimo()
returns jsonb
language sql
immutable
as $$
  select '[
    {"meses": 1,  "nome": "Mensal",    "desconto_pct": 0},
    {"meses": 6,  "nome": "Semestral", "desconto_pct": 10},
    {"meses": 12, "nome": "Anual",     "desconto_pct": 15}
  ]'::jsonb;
$$;
grant execute on function public.planos_da_mimo() to anon, authenticated;

create or replace function public.regras_da_assinatura()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'teste_dias', 7,
    'tolerancia_dias', 7,
    'prazo_ativacao_dias', 30,
    'periodo_dias', 30,
    'bonus_dias', 0,
    'desconto_inicial_pct', 20,
    'desconto_pix_automatico_pct', 10,
    'tentativas', 3,
    -- 234
    'planos', public.planos_da_mimo(),
    'prazo_pix_dias', 3,          -- quem paga fora do "dia X" (vencido, configurando): o Pix vale 3 dias
    'cancelar_apos_dias', 3,      -- não paga até 3 dias depois do vencimento: é cancelada
    'gerar_antes_dias', 7,        -- a próxima mensalidade aparece 7 dias antes do fim do período pago
    'gerar_antes_teste_dias', 3   -- e 3 dias antes do fim do teste
  );
$$;
grant execute on function public.regras_da_assinatura() to anon, authenticated;

-- o preço de um plano: o mês cheio × meses, com o desconto, arredondado para baixo no centavo
-- (o mesmo jeito da oferta de 20% da ativação: 49,90 → 39,92)
create or replace function public.preco_do_plano(mes_cents integer, meses integer, pct integer)
returns integer
language sql
immutable
as $$
  select ((greatest(0, mes_cents)::bigint * greatest(1, meses) * (100 - greatest(0, least(100, pct)))) / 100)::integer;
$$;
grant execute on function public.preco_do_plano(integer, integer, integer) to anon, authenticated;

-- o desconto de um plano (na ativação, o mensal leva os 20% da primeira mensalidade)
create or replace function public.desconto_do_plano(meses_ integer, inicial boolean default false)
returns integer
language sql
immutable
as $$
  select case
    when inicial and meses_ = 1 then (public.regras_da_assinatura() ->> 'desconto_inicial_pct')::int
    else coalesce((select (p ->> 'desconto_pct')::int from jsonb_array_elements(public.planos_da_mimo()) p where (p ->> 'meses')::int = meses_), 0)
  end;
$$;
grant execute on function public.desconto_do_plano(integer, boolean) to anon, authenticated;

-- os três planos com os preços deste salão
create or replace function public.planos_do_salao(salao uuid, inicial boolean default false)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  m jsonb;
  cheio integer;
  p jsonb;
  pct integer;
  total integer;
  sai jsonb := '[]'::jsonb;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona vê os planos do salão.'; end if;
  m := case when inicial then public.mensalidade_inicial_do_salao(salao) else public.mensalidade_do_salao(salao) end;
  cheio := coalesce((m ->> 'valor_cents')::int, 0);
  for p in select * from jsonb_array_elements(public.planos_da_mimo()) loop
    pct := public.desconto_do_plano((p ->> 'meses')::int, inicial);
    total := public.preco_do_plano(cheio, (p ->> 'meses')::int, pct);
    sai := sai || jsonb_build_array(jsonb_build_object(
      'meses', (p ->> 'meses')::int,
      'nome', p ->> 'nome',
      'desconto_pct', pct,
      'mes_cents', cheio,
      'sem_desconto_cents', cheio * (p ->> 'meses')::int,
      'total_cents', total,
      'economia_cents', cheio * (p ->> 'meses')::int - total,
      'por_mes_cents', total / (p ->> 'meses')::int
    ));
  end loop;
  return jsonb_build_object('agendas', (m ->> 'agendas')::int, 'plano', m ->> 'plano', 'mes_cents', cheio, 'planos', sai);
end;
$$;
revoke execute on function public.planos_do_salao(uuid, boolean) from public, anon;
grant execute on function public.planos_do_salao(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A primeira cobrança (ativação, "pagar agora"), agora com o plano
-- ---------------------------------------------------------------------------
drop function if exists public.cobranca_inicial_abrir(uuid, text);
create or replace function public.cobranca_inicial_abrir(salao uuid, metodo_ text, meses_ integer default 1)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  m jsonb;
  r jsonb := public.regras_da_assinatura();
  pct integer;
  cheio integer;
  total integer;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini date;
  fim date;
  n integer;
  plano_ text;
  nova uuid;
  existente record;
  anterior text;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona abre a primeira cobrança.'; end if;
  if metodo_ not in ('pix', 'cartao') then raise exception 'Escolha Pix ou cartão.'; end if;
  if coalesce(meses_, 1) not in (1, 6, 12) then raise exception 'Escolha o plano mensal, semestral ou anual.'; end if;
  meses_ := coalesce(meses_, 1);

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'A agenda autônoma é grátis.'; end if;
  if s.ativacao_pendente_em is null then perform public.ativacao_inicial_preparar(salao); end if;
  if s.ativado_em is not null then raise exception 'Esse salão já foi ativado.'; end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.escolha_inicial is not null or a.oferta_inicial_usada_em is not null then
    raise exception 'A escolha inicial já foi usada.';
  end if;

  m := public.mensalidade_inicial_do_salao(salao);
  cheio := (m ->> 'valor_cents')::int;
  n := (m ->> 'agendas')::int;
  plano_ := m ->> 'plano';
  if cheio <= 0 then raise exception 'Nada a cobrar.'; end if;
  pct := public.desconto_do_plano(meses_, true);
  total := public.preco_do_plano(cheio, meses_, pct);

  select c.id, c.status, c.metodo, c.meses, c.total_cents, c.copia_cola, c.link_url, c.vencimento, c.periodo_fim, c.cobranca_id, c.cancelar_em
    into existente
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.tipo = 'inicial'
     and c.status in ('a_criar', 'aguardando')
   order by c.criado_em desc limit 1;
  if existente.id is not null then
    if existente.metodo <> metodo_ then raise exception 'Já há outro pagamento inicial em andamento.'; end if;
    -- a mesma, ainda no prazo: reaproveita (não cria outra no Asaas)
    if existente.meses = meses_ and existente.total_cents = total
       and hoje <= coalesce(existente.cancelar_em, existente.vencimento + 3) then
      -- quem vai levar ao Asaas agora é a função da dona: a rotina espera uns minutos (não cria em dobro)
      update public.cobrancas_mimo set atualizado_em = now() where id = existente.id and status = 'a_criar';
      return jsonb_build_object(
        'id', existente.id, 'existente', true, 'status', existente.status,
        'metodo', existente.metodo, 'meses', existente.meses, 'total_cents', existente.total_cents,
        'copia_cola', existente.copia_cola, 'link_url', existente.link_url,
        'vencimento', existente.vencimento, 'periodo_fim', existente.periodo_fim,
        'cobranca_id', existente.cobranca_id, 'desconto_pct', pct, 'anteriores', '[]'::jsonb
      );
    end if;
    -- outro plano (ou o prazo passou): a anterior sai, e a função a apaga no Asaas
    anterior := existente.cobranca_id;
    update public.cobrancas_mimo
       set status = 'cancelado', erro = 'substituída por outra cobrança', atualizado_em = now()
     where id = existente.id;
  end if;

  ini := hoje;
  fim := ini + make_interval(months => meses_);

  insert into public.cobrancas_mimo (
    salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano,
    valor_cents, desconto_cents, total_cents, metodo, vencimento,
    meses, inicio_no_pagamento, cancelar_em
  )
  values (
    salao, 'inicial', ini, fim, n, plano_,
    cheio * meses_, cheio * meses_ - total, total, metodo_, hoje,
    meses_, true, hoje + (r ->> 'cancelar_apos_dias')::int
  )
  returning id into nova;

  return jsonb_build_object(
    'id', nova, 'existente', false, 'status', 'a_criar', 'metodo', metodo_, 'meses', meses_,
    'valor_cents', cheio * meses_, 'desconto_cents', cheio * meses_ - total, 'desconto_pct', pct,
    'total_cents', total, 'periodo_fim', fim, 'vencimento', hoje,
    'anteriores', case when anterior is null then '[]'::jsonb else jsonb_build_array(anterior) end
  );
end;
$$;
revoke execute on function public.cobranca_inicial_abrir(uuid, text, integer) from public, anon;
grant execute on function public.cobranca_inicial_abrir(uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A mensalidade seguinte (renovação, "pagar agora" no teste): uma aberta por vez
-- ---------------------------------------------------------------------------
-- O núcleo, usado pela dona (cobranca_manual_abrir) e pela rotina (cuidar_das_assinaturas)
create or replace function public.cobranca_renovacao_preparar(salao uuid, metodo_ text, meses_ integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  m jsonb;
  r jsonb := public.regras_da_assinatura();
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  fim_atual timestamptz;
  ini date;
  fim date;
  venc date;
  no_pagamento boolean;
  cheio integer;
  pct integer;
  total integer;
  nova uuid;
  existente record;
  anteriores jsonb := '[]'::jsonb;
  k record;
begin
  if metodo_ not in ('pix', 'cartao') then raise exception 'Escolha Pix ou cartão.'; end if;
  if coalesce(meses_, 1) not in (1, 6, 12) then raise exception 'Escolha o plano mensal, semestral ou anual.'; end if;
  meses_ := coalesce(meses_, 1);

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'A agenda autônoma é grátis.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then raise exception 'Ative o salão primeiro.'; end if;

  -- o "dia X": o período novo começa quando o atual acaba (o teste ou o período pago) e vence nesse dia
  fim_atual := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
  if fim_atual is not null and fim_atual > now() then
    ini := (fim_atual at time zone 'America/Sao_Paulo')::date;
    venc := greatest(ini, hoje);
    no_pagamento := false;
  else
    -- passou do prazo (ou o teste nem começou a contar): o período começa no dia do pagamento
    ini := hoje;
    venc := hoje + (r ->> 'prazo_pix_dias')::int;
    no_pagamento := true;
  end if;
  fim := ini + make_interval(months => meses_);

  m := public.mensalidade_do_salao(salao);
  cheio := (m ->> 'valor_cents')::int;
  if cheio <= 0 then raise exception 'Nada a cobrar.'; end if;
  pct := public.desconto_do_plano(meses_, false);
  total := public.preco_do_plano(cheio, meses_, pct);

  -- já existe uma aberta igual, no prazo: é ela (não cria outra no Asaas)
  select c.id, c.status, c.metodo, c.meses, c.total_cents, c.copia_cola, c.link_url, c.vencimento, c.periodo_inicio,
         c.periodo_fim, c.cobranca_id, c.cancelar_em, c.inicio_no_pagamento
    into existente
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.tipo = 'renovacao' and c.status in ('a_criar', 'aguardando')
   order by c.criado_em desc limit 1;
  if existente.id is not null and existente.metodo <> metodo_ then raise exception 'Já há outra renovação em andamento.'; end if;
  if existente.id is not null
     and existente.meses = meses_ and existente.total_cents = total
     and existente.inicio_no_pagamento = no_pagamento
     and (no_pagamento or existente.periodo_inicio = ini)
     and hoje <= coalesce(existente.cancelar_em, existente.vencimento + 3) then
    update public.cobrancas_mimo set atualizado_em = now() where id = existente.id and status = 'a_criar';
    return jsonb_build_object(
      'id', existente.id, 'existente', true, 'status', existente.status,
      'metodo', existente.metodo, 'meses', existente.meses, 'total_cents', existente.total_cents,
      'desconto_pct', pct, 'copia_cola', existente.copia_cola, 'link_url', existente.link_url,
      'vencimento', existente.vencimento, 'periodo_inicio', existente.periodo_inicio,
      'periodo_fim', existente.periodo_fim, 'cobranca_id', existente.cobranca_id,
      'cancelar_em', existente.cancelar_em, 'anteriores', '[]'::jsonb
    );
  end if;

  -- qualquer outra aberta sai (e a função apaga no Asaas as que já tinham ido para lá)
  for k in
    select c.id, c.cobranca_id from public.cobrancas_mimo c
     where c.salon_id = salao and c.tipo = 'renovacao' and c.status in ('a_criar', 'aguardando')
  loop
    update public.cobrancas_mimo set status = 'cancelado', erro = 'substituída por outra cobrança', atualizado_em = now() where id = k.id;
    if k.cobranca_id is not null then anteriores := anteriores || jsonb_build_array(k.cobranca_id); end if;
  end loop;

  insert into public.cobrancas_mimo (
    salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano,
    valor_cents, desconto_cents, total_cents, metodo, vencimento,
    meses, inicio_no_pagamento, cancelar_em
  )
  values (
    salao, 'renovacao', ini, fim, (m ->> 'agendas')::int, m ->> 'plano',
    cheio * meses_, cheio * meses_ - total, total, metodo_, venc,
    meses_, no_pagamento, venc + (r ->> 'cancelar_apos_dias')::int
  )
  returning id into nova;

  return jsonb_build_object(
    'id', nova, 'existente', false, 'status', 'a_criar', 'metodo', metodo_, 'meses', meses_,
    'valor_cents', cheio * meses_, 'desconto_cents', cheio * meses_ - total, 'desconto_pct', pct,
    'total_cents', total, 'periodo_inicio', ini, 'periodo_fim', fim, 'vencimento', venc,
    'cancelar_em', venc + (r ->> 'cancelar_apos_dias')::int, 'inicio_no_pagamento', no_pagamento,
    'anteriores', anteriores
  );
end;
$$;
revoke execute on function public.cobranca_renovacao_preparar(uuid, text, integer) from public, anon, authenticated;

drop function if exists public.cobranca_manual_abrir(uuid, text);
create or replace function public.cobranca_manual_abrir(salao uuid, metodo_ text, meses_ integer default 1)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona abre a mensalidade.'; end if;
  return public.cobranca_renovacao_preparar(salao, metodo_, coalesce(meses_, 1));
end;
$$;
revoke execute on function public.cobranca_manual_abrir(uuid, text, integer) from public, anon;
grant execute on function public.cobranca_manual_abrir(uuid, text, integer) to authenticated;

-- a cobrança aberta do salão (a que a tela mostra), sem criar nada
create or replace function public.cobranca_aberta(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then null else (
    select jsonb_build_object(
      'id', c.id, 'tipo', c.tipo, 'status', c.status, 'metodo', c.metodo, 'meses', c.meses,
      'total_cents', c.total_cents, 'desconto_cents', c.desconto_cents, 'copia_cola', c.copia_cola,
      'link_url', c.link_url, 'vencimento', c.vencimento, 'periodo_inicio', c.periodo_inicio,
      'periodo_fim', c.periodo_fim, 'cancelar_em', c.cancelar_em, 'inicio_no_pagamento', c.inicio_no_pagamento
    )
    from public.cobrancas_mimo c
    where c.salon_id = salao and c.status in ('a_criar', 'aguardando')
    order by c.criado_em desc limit 1
  ) end;
$$;
revoke execute on function public.cobranca_aberta(uuid) from public, anon;
grant execute on function public.cobranca_aberta(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Confirmar: o período das que começam no pagamento e os meses do plano
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_mimo_confirmar(cobranca uuid, cobranca_asaas text default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  c public.cobrancas_mimo%rowtype;
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  pago_ate_ timestamptz;
  ini date;
  fim date;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca for update;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'cobrança desconhecida'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;

  -- 234: a que começa no pagamento ganha o período a partir do dia em que foi paga (sem engolir dias já pagos)
  ini := c.periodo_inicio;
  fim := c.periodo_fim;
  if c.inicio_no_pagamento then
    ini := (quando at time zone 'America/Sao_Paulo')::date;
    select * into a from public.assinaturas where salon_id = c.salon_id;
    if a.salon_id is not null and a.situacao = 'ativa' and a.pago_ate is not null and a.pago_ate > quando then
      ini := (a.pago_ate at time zone 'America/Sao_Paulo')::date;
    end if;
    fim := ini + make_interval(months => greatest(1, c.meses));
  end if;

  update public.cobrancas_mimo
     set status = 'pago', pago_em = quando,
         cobranca_id = coalesce(cobranca_asaas, cobranca_id),
         periodo_inicio = ini, periodo_fim = fim,
         erro = null, atualizado_em = now()
   where id = cobranca;

  pago_ate_ := (fim::timestamp + interval '23 hours 59 minutes') at time zone 'America/Sao_Paulo';

  -- pagou esta: qualquer outra aberta do salão vence ontem, e a assinatura-cuidar a apaga no Asaas (sem pagar duas)
  update public.cobrancas_mimo
     set cancelar_em = (now() at time zone 'America/Sao_Paulo')::date - 1, atualizado_em = now() - interval '2 hours'
   where salon_id = c.salon_id and id <> c.id and status in ('a_criar', 'aguardando');

  if c.tipo = 'inicial' then
    insert into public.assinaturas (
      salon_id, situacao, teste_ate, pago_ate, metodo, referencia,
      desconto_pct, cartao_token, cartao_final, cartao_bandeira,
      autorizacao_id, autorizacao_status, autorizacao_qr, autorizacao_imagem,
      bonus_usado, cancelada_em, escolha_inicial, oferta_inicial_usada_em,
      avisos, atualizado_em
    )
    values (
      c.salon_id, 'ativa', null, pago_ate_, c.metodo, coalesce(cobranca_asaas, c.cobranca_id),
      0, null, null, null, null, null, null, null,
      true, null, 'pago', now(), '{}'::jsonb, now()
    )
    on conflict (salon_id) do update set
      situacao = 'ativa',
      teste_ate = null,
      pago_ate = greatest(coalesce(public.assinaturas.pago_ate, '-infinity'::timestamptz), excluded.pago_ate),
      metodo = excluded.metodo,
      referencia = excluded.referencia,
      desconto_pct = 0,
      cartao_token = null,
      cartao_final = null,
      cartao_bandeira = null,
      autorizacao_id = null,
      autorizacao_status = null,
      autorizacao_qr = null,
      autorizacao_imagem = null,
      bonus_usado = true,
      cancelada_em = null,
      escolha_inicial = 'pago',
      oferta_inicial_usada_em = coalesce(public.assinaturas.oferta_inicial_usada_em, now()),
      avisos = '{}'::jsonb,
      atualizado_em = now();

    update public.salons
       set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null
     where id = c.salon_id;
  else
    -- renovação, ou o "pagar agora" do teste: o salão fica ativo na hora
    update public.assinaturas
       set situacao = 'ativa',
           pago_ate = greatest(coalesce(pago_ate, '-infinity'::timestamptz), pago_ate_),
           metodo = c.metodo,
           referencia = coalesce(cobranca_asaas, c.cobranca_id, referencia),
           desconto_pct = 0,
           cartao_token = null,
           cartao_final = null,
           cartao_bandeira = null,
           autorizacao_id = null,
           autorizacao_status = null,
           autorizacao_qr = null,
           autorizacao_imagem = null,
           bonus_usado = true,
           cancelada_em = null,
           avisos = '{}'::jsonb,
           atualizado_em = now()
     where salon_id = c.salon_id;
  end if;

  select * into s from public.salons where id = c.salon_id;
  if s.owner_id is not null then
    begin
      perform public.notificar(
        s.owner_id, 'cobranca_paga', 'Pagamento confirmado',
        format('%s está em dia até %s. Obrigada por ficar com a gente 💗', s.name, to_char(fim, 'DD/MM/YYYY')),
        '/admin/assinatura', jsonb_build_object('salon_id', s.id, 'cobranca', c.id)
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'pago_ate', fim);
end;
$$;
revoke execute on function public.cobranca_mimo_confirmar(uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. O estado da ativação ganha os planos
-- ---------------------------------------------------------------------------
create or replace function public.ativacao_inicial_estado(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  m jsonb;
  c record;
  pct integer;
  cheio integer := 0;
  oferta integer := 0;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona vê a ativação do salão.';
  end if;

  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;

  select * into a from public.assinaturas where salon_id = salao;
  m := public.mensalidade_inicial_do_salao(salao);
  pct := public.desconto_do_plano(1, true);
  cheio := coalesce((m ->> 'valor_cents')::int, 0);
  oferta := public.preco_do_plano(cheio, 1, pct);

  select x.id, x.status, x.metodo, x.meses, x.total_cents, x.desconto_cents, x.copia_cola,
         x.link_url, x.vencimento, x.periodo_fim, x.cobranca_id, x.cancelar_em
    into c
    from public.cobrancas_mimo x
   where x.salon_id = salao and x.tipo = 'inicial'
     and x.status in ('a_criar', 'aguardando', 'falhou', 'pago')
   order by x.criado_em desc
   limit 1;

  return jsonb_build_object(
    'salao', salao,
    'ativado', s.ativado_em is not null,
    'pendente_desde', s.ativacao_pendente_em,
    'escolha', a.escolha_inicial,
    'oferta_usada', a.oferta_inicial_usada_em is not null,
    'desconto_pct', pct,
    'valor_cents', cheio,
    'oferta_cents', oferta,
    'mensalidade', m,
    'planos', public.planos_do_salao(salao, true) -> 'planos',
    'cobranca', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'status', c.status, 'metodo', c.metodo, 'meses', c.meses,
      'total_cents', c.total_cents, 'desconto_cents', c.desconto_cents,
      'copia_cola', c.copia_cola, 'link_url', c.link_url,
      'vencimento', c.vencimento, 'periodo_fim', c.periodo_fim,
      'cobranca_id', c.cobranca_id, 'cancelar_em', c.cancelar_em
    ) end
  );
end;
$$;
revoke execute on function public.ativacao_inicial_estado(uuid) from public, anon;
grant execute on function public.ativacao_inicial_estado(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. O que a função assinatura-cuidar olha: criar no Asaas, conferir, cancelar o que passou do prazo
-- ---------------------------------------------------------------------------
drop function if exists public.cobrancas_mimo_para_cuidar(integer);
create or replace function public.cobrancas_mimo_para_cuidar(quantos integer default 20)
returns table (id uuid, salon_id uuid, tipo text, status text, metodo text, total_cents integer, vencimento date, cobranca_id text,
               periodo_inicio date, periodo_fim date, descricao text, customer_id text, cartao_token text, autorizacao_id text, autorizacao_status text,
               nome text, documento text, email text, telefone text, tentativas integer, meses integer, cancelar_em date)
language sql
stable
security definer set search_path = public
as $$
  select c.id, c.salon_id, c.tipo, c.status, c.metodo, c.total_cents, c.vencimento, c.cobranca_id, c.periodo_inicio, c.periodo_fim,
         format('MIMO %s · %s · %s', case c.meses when 12 then 'plano anual' when 6 then 'plano semestral' else 'mensalidade' end, s.name,
                case when c.inicio_no_pagamento then format('%s %s a partir do pagamento', c.meses, case when c.meses = 1 then 'mês' else 'meses' end)
                     else format('%s a %s', to_char(c.periodo_inicio, 'DD/MM/YYYY'), to_char(c.periodo_fim, 'DD/MM/YYYY')) end),
         a.customer_id, a.cartao_token, a.autorizacao_id, a.autorizacao_status,
         coalesce(s.razao_social, s.name),
         coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
         coalesce(s.email, (select u.email from auth.users u where u.id = s.owner_id)),
         coalesce(s.whatsapp, s.phone, p.phone),
         c.tentativas, c.meses, coalesce(c.cancelar_em, c.vencimento + 3)
  from public.cobrancas_mimo c
  join public.salons s on s.id = c.salon_id
  join public.assinaturas a on a.salon_id = c.salon_id
  left join public.profiles p on p.id = s.owner_id
  where (c.status = 'a_criar' and c.criado_em < now() - interval '2 minutes' and c.atualizado_em < now() - interval '3 minutes')
     or (c.status = 'aguardando' and (
           c.atualizado_em < now() - interval '1 hour'
        or coalesce(c.cancelar_em, c.vencimento + 3) < (now() at time zone 'America/Sao_Paulo')::date
        or c.metodo <> 'pix'))
  order by c.criado_em
  limit quantos;
$$;
revoke execute on function public.cobrancas_mimo_para_cuidar(integer) from public, anon, authenticated;

-- o relógio volta a chamar a função (desligado na 134, quando ela criava cobrança recorrente; agora ela só leva
-- ao Asaas as cobranças Pix que a rotina abriu, confere e cancela as vencidas)
create or replace function public.chutar_assinaturas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare url text; chave text; pedido bigint;
begin
  if not exists (select 1 from public.cobrancas_mimo_para_cuidar(1)) then
    return jsonb_build_object('ok', true, 'vazio', true);
  end if;
  begin
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_url' $q$ into url;
    execute $q$ select decrypted_secret from vault.decrypted_secrets where name = 'mimo_service_role' $q$ into chave;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'Vault indisponível: ' || sqlerrm);
  end;
  if url is null or chave is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem credenciais — rode select public.ligar_relogio(url, chave)');
  end if;
  begin
    execute format(
      $q$ select net.http_post(url := %L, headers := %L::jsonb, body := '{}'::jsonb, timeout_milliseconds := 30000) $q$,
      rtrim(url, '/') || '/functions/v1/assinatura-cuidar',
      jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || chave)::text)
    into pedido;
  exception when others then
    return jsonb_build_object('ok', false, 'motivo', 'pg_net: ' || sqlerrm);
  end;
  return jsonb_build_object('ok', true, 'pedido', pedido);
end;
$$;
revoke execute on function public.chutar_assinaturas() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. A rotina: os avisos de sempre + gerar a próxima mensalidade antes do dia X + avisar que está pronta
-- ---------------------------------------------------------------------------
create or replace function public.cuidar_das_assinaturas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r jsonb := public.regras_da_assinatura();
  a record;
  c record;
  quantos integer := 0;
  fim timestamptz;
  tol timestamptz;
  painel text;
  meses_ integer;
begin
  for a in
    select y.*, x.owner_id, x.name
      from public.assinaturas y
      join public.salons x on x.id = y.salon_id
     where x.active and (y.situacao = 'teste' or y.pago_ate is not null)
  loop
    fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
    if fim is null or a.owner_id is null then continue; end if;
    tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
    painel := case when a.situacao = 'teste' then 'teste' else 'assinatura' end;

    if now() >= tol and a.avisos ->> 'bloqueado' is null then
      perform public.notificar(
        a.owner_id, 'painel_bloqueado', 'Painel pausado',
        format('O %s de %s venceu e o painel foi pausado. Nada foi apagado: renove para voltar.', painel, a.name),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id)
      );
      update public.assinaturas
         set avisos = avisos || jsonb_build_object('bloqueado', now()), atualizado_em = now()
       where salon_id = a.salon_id;
      quantos := quantos + 1;

    elsif now() >= fim and now() < tol and a.avisos ->> 'leitura' is null then
      perform public.notificar(
        a.owner_id, 'modo_leitura',
        case when a.situacao = 'teste' then 'Seu teste grátis acabou' else 'Sua mensalidade venceu' end,
        format('%s está em modo leitura por %s dias. Os horários marcados continuam valendo; pague o Pix da mensalidade para voltar a receber.', a.name, r ->> 'tolerancia_dias'),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id)
      );
      update public.assinaturas
         set avisos = avisos || jsonb_build_object('leitura', now()), atualizado_em = now()
       where salon_id = a.salon_id;
      quantos := quantos + 1;

    elsif now() >= fim - interval '2 days' and now() < fim and a.avisos ->> 'acabando' is null then
      perform public.notificar(
        a.owner_id, 'teste_acabando',
        case when a.situacao = 'teste' then 'Seu teste grátis acaba em 2 dias' else 'Sua mensalidade vence em 2 dias' end,
        format('%s: faltam 2 dias. O Pix da próxima mensalidade já está pronto em Plano e mensalidade; não há cobrança automática.', a.name),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id)
      );
      update public.assinaturas
         set avisos = avisos || jsonb_build_object('acabando', now()), atualizado_em = now()
       where salon_id = a.salon_id;
      quantos := quantos + 1;
    end if;

    -- 234: a próxima mensalidade já pronta, vencendo no dia X (7 dias antes do fim do período pago; 3 antes do fim
    -- do teste). No plano do último pagamento. Uma só: se já há uma aberta, nada.
    if a.situacao in ('teste', 'ativa') and now() < fim
       and now() >= fim - make_interval(days => case when a.situacao = 'teste' then (r ->> 'gerar_antes_teste_dias')::int else (r ->> 'gerar_antes_dias')::int end)
       and not exists (select 1 from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.status in ('a_criar', 'aguardando'))
       and not exists (select 1 from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.tipo = 'renovacao'
                        and k.periodo_inicio = (fim at time zone 'America/Sao_Paulo')::date)
    then
      select coalesce((select k.meses from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.status = 'pago' order by k.pago_em desc nulls last limit 1), 1)
        into meses_;
      begin
        perform public.cobranca_renovacao_preparar(a.salon_id, 'pix', meses_);
        quantos := quantos + 1;
      exception when others then null;   -- sem CPF/CNPJ, salão sem agenda...: a dona gera na tela, com a mensagem certa
      end;
    end if;
  end loop;

  -- a mensalidade chegou ao Asaas (tem o Pix): avisa a dona uma vez
  for c in
    select k.id, k.salon_id, k.total_cents, k.vencimento, k.inicio_no_pagamento, x.owner_id, x.name
      from public.cobrancas_mimo k join public.salons x on x.id = k.salon_id
     where k.status = 'aguardando' and k.metodo = 'pix' and k.tipo = 'renovacao' and k.copia_cola is not null
       and not exists (select 1 from public.assinaturas y where y.salon_id = k.salon_id and y.avisos ? ('pix_' || k.id::text))
  loop
    if c.owner_id is not null then
      perform public.notificar(c.owner_id, 'cobranca_pix', 'Sua mensalidade está pronta para pagar',
        format('%s: %s por Pix até %s, para continuar recebendo agendamentos sem pausa.', c.name, public.reais(c.total_cents), to_char(c.vencimento, 'DD/MM')),
        '/admin/assinatura', jsonb_build_object('salon_id', c.salon_id, 'cobranca', c.id));
    end if;
    update public.assinaturas set avisos = avisos || jsonb_build_object('pix_' || c.id::text, now()) where salon_id = c.salon_id;
    quantos := quantos + 1;
  end loop;

  perform public.chutar_assinaturas();
  return quantos;
end;
$$;
revoke execute on function public.cuidar_das_assinaturas() from public, anon, authenticated;

do $$ begin raise notice '234: uma mensalidade aberta por vez, vencendo no dia X; planos semestral (10%%) e anual (15%%); não pagas são canceladas'; end $$;
