-- 130 · Pix Automático do jeito que a Asaas faz (jornada 3)
--
-- O QR Code da autorização já é o primeiro pagamento: a dona paga o
-- primeiro mês e, no mesmo ato, autoriza os próximos. Por isso o Pix
-- Automático passa a ser um jeito de "pagar agora" (30 + 7 dias de bônus,
-- 10% de desconto), e "vincular e cobrar depois do teste" fica só no
-- cartão. Aqui: assinatura_preparar devolve o status da autorização, e a
-- rotina abre a renovação do Pix Automático com 7 dias de antecedência
-- (a instrução tem de existir entre 2 e 10 dias úteis antes do vencimento)
-- e deixa as novas tentativas por conta da instituição da pagadora.

create or replace function public.assinatura_preparar(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare s public.salons%rowtype; a public.assinaturas%rowtype; p public.profiles%rowtype; em text;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona mexe na assinatura.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then raise exception 'A autônoma não tem assinatura: é grátis.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  select * into p from public.profiles where id = s.owner_id;
  select u.email into em from auth.users u where u.id = s.owner_id;
  return jsonb_build_object(
    'salon_id', s.id, 'nome', s.name, 'ativado', s.ativado_em is not null,
    'documento', coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
    'razao_social', coalesce(s.razao_social, s.name), 'responsavel', coalesce(s.responsavel_nome, p.full_name),
    'email', coalesce(s.email, em), 'telefone', coalesce(s.whatsapp, s.phone, p.phone),
    'cep', coalesce(s.endereco_fiscal ->> 'cep', s.cep), 'numero', coalesce(s.endereco_fiscal ->> 'numero', ''),
    'customer_id', a.customer_id, 'metodo', a.metodo, 'situacao', a.situacao, 'autorizacao_id', a.autorizacao_id, 'autorizacao_status', a.autorizacao_status,
    'acesso', public.acesso_do_salao(salao), 'mensalidade', public.mensalidade_do_salao(salao));
end;
$$;
revoke execute on function public.assinatura_preparar(uuid) from public, anon;
grant execute on function public.assinatura_preparar(uuid) to authenticated;

create or replace function public.cuidar_das_assinaturas()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  r jsonb := public.regras_da_assinatura();
  s record;
  a record;
  c record;
  quantos integer := 0;
  fim timestamptz;
  tol timestamptz;
  painel text;
  m jsonb;
  como text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- concluiu o cadastro, não ativou em 30 dias: o teste começa sozinho
  for s in
    select x.id, x.owner_id, x.name from public.salons x
    where x.tipo <> 'autonoma' and x.active
      and x.onboarding_concluido_em is not null
      and x.onboarding_concluido_em + make_interval(days => (r ->> 'prazo_ativacao_dias')::int) <= now()
      and not exists (select 1 from public.assinaturas y where y.salon_id = x.id)
  loop
    insert into public.assinaturas (salon_id, situacao, teste_ate, avisos)
    values (s.id, 'teste', now() + make_interval(days => (r ->> 'teste_dias')::int), jsonb_build_object('comecou', now()))
    on conflict (salon_id) do nothing;
    update public.salons set ativado_em = coalesce(ativado_em, now()) where id = s.id;
    if s.owner_id is not null then
      perform public.notificar(s.owner_id, 'teste_comecou', 'Seu teste grátis começou',
        format('%s tem 7 dias grátis a partir de hoje. Cadastre os serviços e a equipe pra receber agendamentos.', s.name),
        '/admin/configurar', jsonb_build_object('salon_id', s.id));
    end if;
    quantos := quantos + 1;
  end loop;

  -- as cobranças nos marcos
  for a in
    select y.*, x.owner_id, x.name from public.assinaturas y join public.salons x on x.id = y.salon_id
    where x.active and y.metodo in ('pix', 'cartao', 'pix_automatico')
  loop
    -- o teste acabou com método recorrente vinculado: a primeira cobrança
    if a.situacao = 'teste' and a.metodo in ('cartao', 'pix_automatico') and a.teste_ate <= now()
       and not exists (select 1 from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.periodo_inicio = (a.teste_ate at time zone 'America/Sao_Paulo')::date) then
      perform public.cobranca_mimo_abrir(a.salon_id, 'primeira'); quantos := quantos + 1;
    end if;
    -- o período pago está acabando: a renovação. Pix Automático precisa da
    -- instrução entre 2 e 10 dias úteis antes do vencimento: abre 7 dias antes
    if a.situacao = 'ativa' and a.pago_ate is not null
       and a.pago_ate - make_interval(days => case when a.metodo = 'pix_automatico' then 7 else 3 end) <= now()
       and not exists (select 1 from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.periodo_inicio = (a.pago_ate at time zone 'America/Sao_Paulo')::date) then
      perform public.cobranca_mimo_abrir(a.salon_id, 'renovacao'); quantos := quantos + 1;
    end if;
  end loop;

  -- cartão que falhou: tenta de novo no dia seguinte, até o limite. (No Pix
  -- Automático quem tenta de novo é a instituição da pagadora, por 7 dias.)
  for c in
    select k.* from public.cobrancas_mimo k
    where k.status = 'falhou' and k.metodo = 'cartao' and k.tentativas < (r ->> 'tentativas')::int
      and k.atualizado_em <= now() - interval '1 day'
      and exists (select 1 from public.assinaturas y where y.salon_id = k.salon_id and y.metodo = k.metodo)
  loop
    update public.cobrancas_mimo set status = 'a_criar', atualizado_em = now() where id = c.id; quantos := quantos + 1;
  end loop;

  -- Pix à vista/renovação aberto e ainda não avisado: a dona precisa pagar
  for c in
    select k.*, x.owner_id, x.name from public.cobrancas_mimo k join public.salons x on x.id = k.salon_id
    where k.status = 'aguardando' and k.metodo = 'pix' and k.tipo = 'renovacao' and k.copia_cola is not null
      and not exists (select 1 from public.assinaturas y where y.salon_id = k.salon_id and y.avisos ? ('pix_' || k.id::text))
  loop
    if c.owner_id is not null then
      perform public.notificar(c.owner_id, 'cobranca_pix', 'Sua mensalidade está pronta pra pagar',
        format('%s: %s por Pix até %s pra continuar recebendo agendamentos sem pausa.', c.name, public.reais(c.total_cents), to_char(c.vencimento, 'DD/MM')),
        '/admin/assinatura', jsonb_build_object('salon_id', c.salon_id, 'cobranca', c.id));
    end if;
    update public.assinaturas set avisos = avisos || jsonb_build_object('pix_' || c.id::text, now()) where salon_id = c.salon_id;
    quantos := quantos + 1;
  end loop;

  -- os marcos: 2 dias antes de acabar, quando acaba (modo leitura) e quando o painel pausa
  for a in
    select y.*, x.owner_id, x.name from public.assinaturas y join public.salons x on x.id = y.salon_id
    where x.active and (y.situacao = 'teste' or y.pago_ate is not null)
  loop
    fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
    if fim is null or a.owner_id is null then continue; end if;
    tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
    painel := case when a.situacao = 'teste' then 'teste' else 'assinatura' end;
    m := public.mensalidade_do_salao(a.salon_id);
    como := case a.metodo when 'cartao' then 'no cartão final ' || coalesce(a.cartao_final, '')
                          when 'pix_automatico' then 'por Pix Automático'
                          when 'pix' then 'por Pix' else null end;

    if now() >= tol and a.avisos ->> 'bloqueado' is null then
      perform public.notificar(a.owner_id, 'painel_bloqueado', 'Painel pausado',
        format('O %s de %s venceu e o painel foi pausado. Assine pra reativar: nada foi apagado.', painel, a.name),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('bloqueado', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    elsif now() >= fim and now() < tol and a.avisos ->> 'leitura' is null and (a.metodo is null or a.metodo = 'pix' or a.situacao = 'cancelada') then
      perform public.notificar(a.owner_id, 'modo_leitura',
        case when a.situacao = 'teste' then 'Seu teste grátis acabou' else 'Sua assinatura venceu' end,
        format('%s está em modo leitura por %s dias: os horários marcados continuam valendo, mas o link não recebe agendamento novo. Assine pra voltar a receber.', a.name, r ->> 'tolerancia_dias'),
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('leitura', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    elsif now() >= fim - interval '2 days' and now() < fim and a.avisos ->> 'acabando' is null then
      perform public.notificar(a.owner_id, 'teste_acabando',
        case when a.situacao = 'teste' then 'Seu teste grátis acaba em 2 dias' else 'Sua assinatura vence em 2 dias' end,
        case when a.metodo in ('cartao', 'pix_automatico') and a.situacao <> 'cancelada'
             then format('%s: no dia %s vamos cobrar %s %s. Tudo continua funcionando sem pausa. Pra não cobrar, cancele antes em Plano e assinatura.',
                    a.name, to_char(fim at time zone 'America/Sao_Paulo', 'DD/MM'), public.reais((m ->> 'total_cents')::int), como)
             else format('%s: %s. Depois disso o link para de receber agendamento novo.',
                    a.name, case when a.situacao = 'teste' then 'faltam 2 dias de teste grátis' else 'a assinatura vence em 2 dias' end) end,
        '/admin/assinatura', jsonb_build_object('salon_id', a.salon_id));
      update public.assinaturas set avisos = avisos || jsonb_build_object('acabando', now()), atualizado_em = now() where salon_id = a.salon_id;
      quantos := quantos + 1;
    end if;
  end loop;

  perform public.chutar_assinaturas();
  return quantos;
end;
$$;
revoke execute on function public.cuidar_das_assinaturas() from public, anon, authenticated;
