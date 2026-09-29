-- 133 · Ativação inicial simples: 7 dias grátis OU 20% agora
--
-- A primeira escolha comercial fica explícita e não recorrente:
--   • testar: 7 dias grátis, sem cartão e sem cobrança automática;
--   • pagar agora: Pix ou cartão, 20% de desconto na primeira mensalidade,
--     30 dias de acesso, sem guardar cartão e sem renovação automática.
--
-- Serviços e equipe precisam estar prontos antes desta tela. Ao chegar nela,
-- o salão fica com ativacao_pendente_em e, se a pessoa fechar o navegador,
-- volta para a mesma decisão. A oferta é de uso único: escolheu teste, perdeu
-- os 20%; pagou com desconto, não ganha teste depois.

alter table public.salons
  add column if not exists ativacao_pendente_em timestamptz;

alter table public.assinaturas
  add column if not exists escolha_inicial text,
  add column if not exists oferta_inicial_usada_em timestamptz;

alter table public.assinaturas drop constraint if exists assinaturas_escolha_inicial_check;
alter table public.assinaturas add constraint assinaturas_escolha_inicial_check
  check (escolha_inicial is null or escolha_inicial in ('teste', 'pago'));

alter table public.cobrancas_mimo drop constraint if exists cobrancas_mimo_tipo_check;
alter table public.cobrancas_mimo add constraint cobrancas_mimo_tipo_check
  check (tipo in ('inicial', 'avista', 'primeira', 'renovacao'));

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
    'tentativas', 3
  );
$$;
grant execute on function public.regras_da_assinatura() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Estado da decisão inicial
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
  pct integer := 20;
  cheio integer := 0;
  oferta integer := 0;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona vê a ativação do salão.';
  end if;

  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;

  select * into a from public.assinaturas where salon_id = salao;
  m := public.mensalidade_do_salao(salao);
  pct := coalesce((public.regras_da_assinatura() ->> 'desconto_inicial_pct')::int, 20);
  cheio := coalesce((m ->> 'valor_cents')::int, 0);
  oferta := floor(cheio * (100 - pct) / 100.0)::int;

  select x.id, x.status, x.metodo, x.total_cents, x.desconto_cents, x.copia_cola,
         x.link_url, x.vencimento, x.periodo_fim, x.cobranca_id
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
    'cobranca', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'status', c.status, 'metodo', c.metodo,
      'total_cents', c.total_cents, 'desconto_cents', c.desconto_cents,
      'copia_cola', c.copia_cola, 'link_url', c.link_url,
      'vencimento', c.vencimento, 'periodo_fim', c.periodo_fim,
      'cobranca_id', c.cobranca_id
    ) end
  );
end;
$$;
revoke execute on function public.ativacao_inicial_estado(uuid) from public, anon;
grant execute on function public.ativacao_inicial_estado(uuid) to authenticated;

create or replace function public.ativacao_inicial_preparar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  servicos integer := 0;
  equipe integer := 0;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona prepara a ativação.';
  end if;

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then return public.ativacao_inicial_estado(salao); end if;
  if s.onboarding_concluido_em is null then raise exception 'Conclua o cadastro antes de ativar.'; end if;
  if s.ativado_em is not null then return public.ativacao_inicial_estado(salao); end if;

  select count(*) into servicos from public.services x where x.salon_id = salao and x.active;
  select count(*) into equipe from public.professionals x where x.salon_id = salao and x.active;
  if servicos = 0 then raise exception 'Cadastre pelo menos um serviço antes de ativar.'; end if;
  if equipe = 0 then raise exception 'Configure pelo menos uma profissional antes de ativar.'; end if;

  update public.salons
     set ativacao_pendente_em = coalesce(ativacao_pendente_em, now())
   where id = salao;

  return public.ativacao_inicial_estado(salao);
end;
$$;
revoke execute on function public.ativacao_inicial_preparar(uuid) from public, anon;
grant execute on function public.ativacao_inicial_preparar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Escolheu testar: a oferta de 20% é consumida e começam os 7 dias
-- ---------------------------------------------------------------------------
create or replace function public.ativacao_inicial_teste(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  r jsonb := public.regras_da_assinatura();
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona ativa o teste.';
  end if;

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then
    update public.salons set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null where id = salao;
    return public.acesso_do_salao(salao);
  end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.escolha_inicial = 'pago' or exists (
    select 1 from public.cobrancas_mimo c
     where c.salon_id = salao and c.tipo = 'inicial' and c.status = 'pago'
  ) then
    raise exception 'A primeira mensalidade já foi paga.';
  end if;

  if exists (
    select 1 from public.cobrancas_mimo c
     where c.salon_id = salao and c.tipo = 'inicial'
       and c.status in ('a_criar', 'aguardando') and c.cobranca_id is not null
  ) then
    raise exception 'Há um pagamento em andamento. Cancele essa cobrança antes de iniciar o teste.';
  end if;

  update public.cobrancas_mimo
     set status = 'cancelado', atualizado_em = now()
   where salon_id = salao and tipo = 'inicial' and status in ('a_criar', 'aguardando', 'falhou');

  insert into public.assinaturas (
    salon_id, situacao, teste_ate, pago_ate, metodo, desconto_pct,
    escolha_inicial, oferta_inicial_usada_em, bonus_usado, avisos, atualizado_em
  )
  values (
    salao, 'teste', now() + make_interval(days => (r ->> 'teste_dias')::int),
    null, null, 0, 'teste', now(), true, jsonb_build_object('comecou', now()), now()
  )
  on conflict (salon_id) do update set
    situacao = 'teste',
    teste_ate = now() + make_interval(days => (r ->> 'teste_dias')::int),
    pago_ate = null,
    metodo = null,
    desconto_pct = 0,
    cartao_token = null,
    cartao_final = null,
    cartao_bandeira = null,
    autorizacao_id = null,
    autorizacao_status = null,
    autorizacao_qr = null,
    autorizacao_imagem = null,
    escolha_inicial = coalesce(public.assinaturas.escolha_inicial, 'teste'),
    oferta_inicial_usada_em = coalesce(public.assinaturas.oferta_inicial_usada_em, now()),
    bonus_usado = true,
    cancelada_em = null,
    avisos = jsonb_build_object('comecou', now()),
    atualizado_em = now();

  update public.salons
     set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null
   where id = salao;

  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.ativacao_inicial_teste(uuid) from public, anon;
grant execute on function public.ativacao_inicial_teste(uuid) to authenticated;

-- Compatibilidade: qualquer caminho antigo que chame salao_ativar agora entra
-- exatamente na escolha "7 dias grátis". Autônoma continua só liberando o link.
create or replace function public.salao_ativar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona ativa o salão.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then
    update public.salons set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null where id = salao;
    return public.acesso_do_salao(salao);
  end if;
  return public.ativacao_inicial_teste(salao);
end;
$$;
revoke execute on function public.salao_ativar(uuid) from public, anon;
grant execute on function public.salao_ativar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Primeira mensalidade com 20%: a cobrança nasce, mas o salão só ativa
--    quando o webhook/conferência confirmar o pagamento.
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_inicial_abrir(salao uuid, metodo_ text)
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
  desconto integer;
  total integer;
  ini date;
  fim date;
  n integer;
  plano_ text;
  nova uuid;
  existente record;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona abre a primeira cobrança.'; end if;
  if metodo_ not in ('pix', 'cartao') then raise exception 'Escolha Pix ou cartão.'; end if;

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'A agenda autônoma é grátis.'; end if;
  if s.ativacao_pendente_em is null then perform public.ativacao_inicial_preparar(salao); end if;
  if s.ativado_em is not null then raise exception 'Esse salão já foi ativado.'; end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.escolha_inicial is not null or a.oferta_inicial_usada_em is not null then
    raise exception 'A escolha inicial já foi usada.';
  end if;

  select c.id, c.status, c.metodo, c.total_cents, c.copia_cola, c.link_url, c.vencimento, c.periodo_fim, c.cobranca_id
    into existente
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.tipo = 'inicial'
     and c.status in ('a_criar', 'aguardando')
   order by c.criado_em desc limit 1;
  if existente.id is not null then
    if existente.metodo <> metodo_ then raise exception 'Já há outro pagamento inicial em andamento.'; end if;
    return jsonb_build_object(
      'id', existente.id, 'existente', true, 'status', existente.status,
      'metodo', existente.metodo, 'total_cents', existente.total_cents,
      'copia_cola', existente.copia_cola, 'link_url', existente.link_url,
      'vencimento', existente.vencimento, 'periodo_fim', existente.periodo_fim,
      'cobranca_id', existente.cobranca_id
    );
  end if;

  m := public.mensalidade_do_salao(salao);
  cheio := (m ->> 'valor_cents')::int;
  n := (m ->> 'agendas')::int;
  plano_ := m ->> 'plano';
  if cheio <= 0 then raise exception 'Nada a cobrar.'; end if;

  pct := (r ->> 'desconto_inicial_pct')::int;
  total := floor(cheio * (100 - pct) / 100.0)::int;
  desconto := cheio - total;
  ini := (now() at time zone 'America/Sao_Paulo')::date;
  fim := ini + (r ->> 'periodo_dias')::int;

  insert into public.cobrancas_mimo (
    salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano,
    valor_cents, desconto_cents, total_cents, metodo, vencimento
  )
  values (
    salao, 'inicial', ini, fim, n, plano_,
    cheio, desconto, total, metodo_, ini
  )
  returning id into nova;

  return jsonb_build_object(
    'id', nova, 'existente', false, 'status', 'a_criar', 'metodo', metodo_,
    'valor_cents', cheio, 'desconto_cents', desconto, 'desconto_pct', pct,
    'total_cents', total, 'periodo_fim', fim, 'vencimento', ini
  );
end;
$$;
revoke execute on function public.cobranca_inicial_abrir(uuid, text) from public, anon;
grant execute on function public.cobranca_inicial_abrir(uuid, text) to authenticated;

create or replace function public.cobranca_inicial_cancelar(salao uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona cancela a cobrança inicial.'; end if;
  update public.cobrancas_mimo
     set status = 'cancelado', atualizado_em = now()
   where salon_id = salao and tipo = 'inicial' and status in ('a_criar', 'aguardando', 'falhou');
end;
$$;
revoke execute on function public.cobranca_inicial_cancelar(uuid) from public, anon;
grant execute on function public.cobranca_inicial_cancelar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Renovação manual: Pix ou cartão, preço cheio, 30 dias, sem recorrência
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_manual_abrir(salao uuid, metodo_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  m jsonb;
  r jsonb := public.regras_da_assinatura();
  ini date;
  fim date;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nova uuid;
  existente record;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona abre a renovação.'; end if;
  if metodo_ not in ('pix', 'cartao') then raise exception 'Escolha Pix ou cartão.'; end if;

  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'A agenda autônoma é grátis.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then raise exception 'Ative o salão primeiro.'; end if;

  ini := hoje;
  if a.situacao = 'ativa' and a.pago_ate is not null and a.pago_ate > now() then
    ini := (a.pago_ate at time zone 'America/Sao_Paulo')::date;
  end if;
  fim := ini + (r ->> 'periodo_dias')::int;

  select c.id, c.status, c.metodo, c.total_cents, c.copia_cola, c.link_url, c.vencimento, c.periodo_fim, c.cobranca_id
    into existente
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.tipo = 'renovacao' and c.periodo_inicio = ini
     and c.status in ('a_criar', 'aguardando')
   order by c.criado_em desc limit 1;
  if existente.id is not null then
    if existente.metodo <> metodo_ then raise exception 'Já há outra renovação em andamento.'; end if;
    return jsonb_build_object(
      'id', existente.id, 'existente', true, 'status', existente.status,
      'metodo', existente.metodo, 'total_cents', existente.total_cents,
      'copia_cola', existente.copia_cola, 'link_url', existente.link_url,
      'vencimento', existente.vencimento, 'periodo_fim', existente.periodo_fim,
      'cobranca_id', existente.cobranca_id
    );
  end if;

  m := public.mensalidade_do_salao(salao);
  insert into public.cobrancas_mimo (
    salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano,
    valor_cents, desconto_cents, total_cents, metodo, vencimento
  )
  values (
    salao, 'renovacao', ini, fim, (m ->> 'agendas')::int, m ->> 'plano',
    (m ->> 'valor_cents')::int, 0, (m ->> 'valor_cents')::int, metodo_, hoje
  )
  returning id into nova;

  return jsonb_build_object(
    'id', nova, 'existente', false, 'status', 'a_criar', 'metodo', metodo_,
    'valor_cents', (m ->> 'valor_cents')::int, 'desconto_cents', 0,
    'total_cents', (m ->> 'valor_cents')::int, 'periodo_fim', fim, 'vencimento', hoje
  );
end;
$$;
revoke execute on function public.cobranca_manual_abrir(uuid, text) from public, anon;
grant execute on function public.cobranca_manual_abrir(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dar baixa: a cobrança inicial cria/ativa a assinatura; as demais
--    prolongam o período já pago. Nada fica configurado como recorrente.
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_mimo_confirmar(cobranca uuid, cobranca_asaas text default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  c public.cobrancas_mimo%rowtype;
  s public.salons%rowtype;
  pago_ate_ timestamptz;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca for update;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'cobrança desconhecida'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;

  update public.cobrancas_mimo
     set status = 'pago', pago_em = quando,
         cobranca_id = coalesce(cobranca_asaas, cobranca_id),
         erro = null, atualizado_em = now()
   where id = cobranca;

  pago_ate_ := (c.periodo_fim::timestamp + interval '23 hours 59 minutes') at time zone 'America/Sao_Paulo';

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
        format('%s está em dia até %s. Obrigada por ficar com a gente 💗', s.name, to_char(c.periodo_fim, 'DD/MM')),
        '/admin/assinatura', jsonb_build_object('salon_id', s.id, 'cobranca', c.id)
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'pago_ate', c.periodo_fim);
end;
$$;
revoke execute on function public.cobranca_mimo_confirmar(uuid, text, timestamptz) from public, anon, authenticated;

-- O acesso deixa explícito que não existe cobrança automática nesta versão.
create or replace function public.acesso_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  r jsonb := public.regras_da_assinatura();
  agora timestamptz := now();
  fim timestamptz;
  tol timestamptz;
  fase text;
  extra jsonb;
  pend record;
begin
  select * into s from public.salons where id = salao;
  if not found then return null; end if;
  if s.tipo = 'autonoma' then return jsonb_build_object('fase', 'gratis', 'tipo', s.tipo, 'recorrente', false); end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then
    return jsonb_build_object(
      'fase', 'configurando', 'tipo', s.tipo, 'recorrente', false,
      'ativacao_pendente', s.ativacao_pendente_em is not null,
      'teste_dias', r ->> 'teste_dias',
      'desconto_inicial_pct', r ->> 'desconto_inicial_pct',
      'mensalidade', public.mensalidade_do_salao(salao)
    );
  end if;

  select c.id, c.copia_cola, c.total_cents, c.vencimento, c.status, c.metodo, c.periodo_fim, c.tipo
    into pend
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.status in ('a_criar', 'aguardando', 'falhou')
   order by c.criado_em desc limit 1;

  extra := jsonb_build_object(
    'metodo', a.metodo,
    'recorrente', false,
    'escolha_inicial', a.escolha_inicial,
    'oferta_inicial_usada', a.oferta_inicial_usada_em is not null,
    'mensalidade', public.mensalidade_do_salao(salao),
    'pendente', case when pend.id is null then null else jsonb_build_object(
      'id', pend.id, 'tipo', pend.tipo, 'copia_cola', pend.copia_cola,
      'total_cents', pend.total_cents, 'vencimento', pend.vencimento,
      'status', pend.status, 'metodo', pend.metodo, 'periodo_fim', pend.periodo_fim
    ) end
  );

  if a.situacao = 'ativa' and a.pago_ate is null then
    return jsonb_build_object('fase', 'ativa', 'tipo', s.tipo, 'situacao', a.situacao, 'sem_prazo', true) || extra;
  end if;

  fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
  tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
  fase := case
    when agora < fim then case when a.situacao = 'teste' then 'teste' else 'ativa' end
    when agora < tol then 'leitura'
    else 'bloqueado'
  end;

  return jsonb_build_object(
    'fase', fase, 'tipo', s.tipo, 'situacao', a.situacao,
    'ate', fim, 'tolerancia_ate', tol,
    'dias', greatest(0, ceil(extract(epoch from (fim - agora)) / 86400.0))::int,
    'dias_tolerancia', greatest(0, ceil(extract(epoch from (tol - agora)) / 86400.0))::int,
    'teste', a.situacao = 'teste',
    'cobrar_em', null
  ) || extra;
end;
$$;
revoke execute on function public.acesso_do_salao(uuid) from public, anon;
grant execute on function public.acesso_do_salao(uuid) to authenticated;

-- Configurando não recebe cliente ainda: o link só abre para agendamento
-- depois que ela escolheu teste ou confirmou o primeiro pagamento.
create or replace function public.aceita_agendamentos(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(public.acesso_do_salao(salao) ->> 'fase', 'gratis') in ('gratis', 'teste', 'ativa');
$$;
grant execute on function public.aceita_agendamentos(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Rotina sem recorrência: só lembra, entra em leitura e pausa. Nunca cria
--    cobrança sozinha e nunca tenta cartão/Pix automaticamente.
-- ---------------------------------------------------------------------------
create or replace function public.cuidar_das_assinaturas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r jsonb := public.regras_da_assinatura();
  a record;
  quantos integer := 0;
  fim timestamptz;
  tol timestamptz;
  painel text;
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
        format('%s está em modo leitura por %s dias. Os horários marcados continuam valendo; renove por Pix ou cartão para voltar a receber.', a.name, r ->> 'tolerancia_dias'),
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
        format('%s: faltam 2 dias. Não há cobrança automática; quando quiser continuar, renove por Pix ou cartão.', a.name),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id)
      );
      update public.assinaturas
         set avisos = avisos || jsonb_build_object('acabando', now()), atualizado_em = now()
       where salon_id = a.salon_id;
      quantos := quantos + 1;
    end if;
  end loop;
  return quantos;
end;
$$;
revoke execute on function public.cuidar_das_assinaturas() from public, anon, authenticated;
