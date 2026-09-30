-- 136 · preço inicial usa a quantidade informada no onboarding
--
-- Como serviços/equipe só serão cadastrados depois da ativação, a primeira
-- mensalidade não pode contar profissionais já criadas no banco. Ela usa
-- salons.equipe_prevista, que é justamente o número escolhido em "Quase lá".

create or replace function public.mensalidade_inicial_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  n integer;
  plano_ text;
  valor integer;
begin
  select * into s from public.salons where id = salao;
  if not found then return null; end if;
  if s.tipo = 'autonoma' then
    return jsonb_build_object('agendas', 1, 'plano', 'autonoma', 'valor_cents', 0, 'desconto_cents', 0, 'total_cents', 0, 'desconto_pct', 0);
  end if;

  n := greatest(1, coalesce(s.equipe_prevista, 1));
  plano_ := public.plano_do_negocio(s.tipo, n);
  valor := public.mensalidade_cents(plano_, n);

  return jsonb_build_object(
    'agendas', n,
    'plano', plano_,
    'valor_cents', valor,
    'desconto_cents', 0,
    'total_cents', valor,
    'desconto_pct', 0
  );
end;
$$;
revoke execute on function public.mensalidade_inicial_do_salao(uuid) from public, anon;
grant execute on function public.mensalidade_inicial_do_salao(uuid) to authenticated;

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
  m := public.mensalidade_inicial_do_salao(salao);
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

  m := public.mensalidade_inicial_do_salao(salao);
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
