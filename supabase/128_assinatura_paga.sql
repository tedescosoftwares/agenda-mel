-- 128 · A assinatura paga: cartão, Pix Automático e Pix à vista
--
-- Na ativação (126) a dona agora tem três caminhos:
--   1. Só testar          7 dias grátis, sem nada (como antes).
--   2. Assinar já         vincula Pix Automático (10% de desconto enquanto
--                         pagar por ele) ou cartão. O teste vale igual e a
--                         primeira cobrança sai no dia em que ele acaba.
--   3. Pagar agora        Pix ou cartão à vista: paga hoje e o primeiro
--                         período tem 30 + 7 dias de bônus (só no primeiro).
--
-- Quem cobra é a MIMO, na conta-pai do Asaas: `cobrancas_mimo` guarda cada
-- mês. A MIMO calcula o valor pelas agendas ativas no dia (mensalidade_do_
-- salao) e cria cada cobrança (Pix Automático em modo MANUAL). A rotina
-- abre as cobranças nos marcos, a Edge Function assinatura-cuidar leva
-- pro Asaas, e o webhook (ou a conferência) dá baixa.
--
-- Tolerância sobe de 5 pra 7 dias: é o prazo que o Pix Automático tem pra
-- tentar de novo depois da data.

create or replace function public.regras_da_assinatura()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('teste_dias', 7, 'tolerancia_dias', 7, 'prazo_ativacao_dias', 30,
                            'periodo_dias', 30, 'bonus_dias', 7, 'desconto_pix_automatico_pct', 10, 'tentativas', 3);
$$;

alter table public.assinaturas
  add column if not exists desconto_pct integer not null default 0,
  add column if not exists customer_id text,
  add column if not exists cartao_token text,
  add column if not exists cartao_final text,
  add column if not exists cartao_bandeira text,
  add column if not exists autorizacao_id text,
  add column if not exists autorizacao_status text,
  add column if not exists autorizacao_qr text,
  add column if not exists autorizacao_imagem text,
  add column if not exists bonus_usado boolean not null default false,
  add column if not exists cancelada_em timestamptz;

create table if not exists public.cobrancas_mimo (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  tipo text not null check (tipo in ('avista', 'primeira', 'renovacao')),
  periodo_inicio date not null,
  periodo_fim date not null,
  agendas integer not null,
  plano text not null,
  valor_cents integer not null,
  desconto_cents integer not null default 0,
  total_cents integer not null,
  metodo text not null check (metodo in ('pix', 'cartao', 'pix_automatico')),
  status text not null default 'a_criar'
    check (status in ('a_criar', 'aguardando', 'pago', 'falhou', 'cancelado', 'expirado')),
  cobranca_id text,
  copia_cola text,
  link_url text,
  vencimento date not null,
  pago_em timestamptz,
  erro text,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists cobrancas_mimo_salao_idx on public.cobrancas_mimo (salon_id, criado_em desc);
alter table public.cobrancas_mimo enable row level security;
drop policy if exists "dona ve as cobrancas" on public.cobrancas_mimo;
create policy "dona ve as cobrancas" on public.cobrancas_mimo
  for select to authenticated using (public.is_admin_do_salao(salon_id) or public.eh_plataforma());

-- valor em reais pra mensagem: 4490 → R$ 44,90
create or replace function public.reais(cents integer)
returns text
language sql
immutable
as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(cents, 0) / 100.0, 'FM999G999G990.00'), ',', '#'), '.', ','), '#', '.');
$$;
grant execute on function public.reais(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Quanto custa este mês: agendas ativas hoje, plano, desconto
-- ---------------------------------------------------------------------------
create or replace function public.mensalidade_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  n integer;
  plano_ text;
  valor integer;
  total integer;
  pct integer := 0;
begin
  select * into s from public.salons where id = salao;
  if not found then return null; end if;
  if s.tipo = 'autonoma' then return jsonb_build_object('agendas', 1, 'plano', 'autonoma', 'valor_cents', 0, 'desconto_cents', 0, 'total_cents', 0, 'desconto_pct', 0); end if;
  select count(*) into n from public.professionals p where p.salon_id = salao and p.active;
  n := greatest(1, n);
  plano_ := public.plano_do_negocio(s.tipo, n);
  valor := public.mensalidade_cents(plano_, n);
  select * into a from public.assinaturas where salon_id = salao;
  if a.metodo = 'pix_automatico' then pct := coalesce(a.desconto_pct, 0); end if;
  -- desconto sobre o total do mês, arredondado pra baixo nos 10 centavos
  total := (valor * (100 - pct) / 100) / 10 * 10;
  return jsonb_build_object('agendas', n, 'plano', plano_, 'valor_cents', valor, 'desconto_cents', valor - total, 'total_cents', total, 'desconto_pct', pct);
end;
$$;
revoke execute on function public.mensalidade_do_salao(uuid) from public, anon;
grant execute on function public.mensalidade_do_salao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O acesso agora diz também o método, o valor e a data da cobrança
-- ---------------------------------------------------------------------------
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
  if s.tipo = 'autonoma' then return jsonb_build_object('fase', 'gratis', 'tipo', s.tipo); end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then
    return jsonb_build_object('fase', 'configurando', 'tipo', s.tipo,
      'teste_dias', r ->> 'teste_dias',
      'prazo_ativacao', case when s.onboarding_concluido_em is not null then s.onboarding_concluido_em + make_interval(days => (r ->> 'prazo_ativacao_dias')::int) end,
      'mensalidade', public.mensalidade_do_salao(salao));
  end if;

  select c.id, c.copia_cola, c.total_cents, c.vencimento, c.status, c.metodo, c.periodo_fim
    into pend
    from public.cobrancas_mimo c where c.salon_id = salao and c.status in ('a_criar', 'aguardando', 'falhou')
    order by c.criado_em desc limit 1;
  extra := jsonb_build_object(
    'metodo', a.metodo, 'desconto_pct', a.desconto_pct, 'cartao_final', a.cartao_final, 'cartao_bandeira', a.cartao_bandeira,
    'autorizacao_status', a.autorizacao_status, 'autorizacao_qr', a.autorizacao_qr, 'autorizacao_imagem', a.autorizacao_imagem,
    'bonus_usado', a.bonus_usado, 'cancelada', a.situacao = 'cancelada',
    'mensalidade', public.mensalidade_do_salao(salao),
    'pendente', case when pend.id is null then null else jsonb_build_object('id', pend.id, 'copia_cola', pend.copia_cola, 'total_cents', pend.total_cents, 'vencimento', pend.vencimento, 'status', pend.status, 'metodo', pend.metodo, 'periodo_fim', pend.periodo_fim) end);

  if a.situacao = 'ativa' and a.pago_ate is null then
    return jsonb_build_object('fase', 'ativa', 'tipo', s.tipo, 'situacao', a.situacao, 'sem_prazo', true) || extra;
  end if;

  fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
  tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
  fase := case when agora < fim then (case when a.situacao = 'teste' then 'teste' else 'ativa' end)
               when agora < tol then 'leitura'
               else 'bloqueado' end;
  return jsonb_build_object(
    'fase', fase, 'tipo', s.tipo, 'situacao', a.situacao,
    'ate', fim, 'tolerancia_ate', tol,
    'dias', greatest(0, ceil(extract(epoch from (fim - agora)) / 86400.0))::int,
    'dias_tolerancia', greatest(0, ceil(extract(epoch from (tol - agora)) / 86400.0))::int,
    'teste', a.situacao = 'teste',
    -- com método recorrente vinculado no teste, a primeira cobrança sai quando o teste acaba
    'cobrar_em', case when a.situacao = 'teste' and a.metodo in ('cartao', 'pix_automatico') then a.teste_ate
                      when a.situacao = 'ativa' and a.metodo is not null then a.pago_ate end) || extra;
end;
$$;
revoke execute on function public.acesso_do_salao(uuid) from public, anon;
grant execute on function public.acesso_do_salao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O que a Edge Function precisa pra falar com o Asaas (só a dona pede)
-- ---------------------------------------------------------------------------
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
    'customer_id', a.customer_id, 'metodo', a.metodo, 'situacao', a.situacao, 'autorizacao_id', a.autorizacao_id,
    'acesso', public.acesso_do_salao(salao), 'mensalidade', public.mensalidade_do_salao(salao));
end;
$$;
revoke execute on function public.assinatura_preparar(uuid) from public, anon;
grant execute on function public.assinatura_preparar(uuid) to authenticated;

-- a Edge Function grava o que o Asaas devolveu (chave de serviço)
create or replace function public.assinatura_metodo_definir(salao uuid, metodo_ text, dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare r jsonb := public.regras_da_assinatura(); s public.salons%rowtype;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma grava o método.'; end if;
  if metodo_ is not null and metodo_ not in ('pix', 'cartao', 'pix_automatico') then raise exception 'Método inválido: %', metodo_; end if;
  select * into s from public.salons where id = salao;
  -- vincular método sem ter ativado: ativa (começa o teste) pra ter a data da primeira cobrança
  if s.ativado_em is null or not exists (select 1 from public.assinaturas where salon_id = salao) then
    update public.salons set ativado_em = coalesce(ativado_em, now()) where id = salao;
    insert into public.assinaturas (salon_id, situacao, teste_ate, avisos)
    values (salao, 'teste', now() + make_interval(days => (r ->> 'teste_dias')::int), jsonb_build_object('comecou', now()))
    on conflict (salon_id) do nothing;
  end if;
  update public.assinaturas set
    metodo = metodo_,
    desconto_pct = case when metodo_ = 'pix_automatico' then (r ->> 'desconto_pix_automatico_pct')::int else 0 end,
    customer_id = coalesce(dados ->> 'customer_id', customer_id),
    cartao_token = case when metodo_ = 'cartao' then coalesce(dados ->> 'cartao_token', cartao_token) else null end,
    cartao_final = case when metodo_ = 'cartao' then coalesce(dados ->> 'cartao_final', cartao_final) else null end,
    cartao_bandeira = case when metodo_ = 'cartao' then coalesce(dados ->> 'cartao_bandeira', cartao_bandeira) else null end,
    autorizacao_id = case when metodo_ = 'pix_automatico' then coalesce(dados ->> 'autorizacao_id', autorizacao_id) else null end,
    autorizacao_status = case when metodo_ = 'pix_automatico' then coalesce(dados ->> 'autorizacao_status', autorizacao_status) else null end,
    autorizacao_qr = case when metodo_ = 'pix_automatico' then coalesce(dados ->> 'autorizacao_qr', autorizacao_qr) else null end,
    autorizacao_imagem = case when metodo_ = 'pix_automatico' then coalesce(dados ->> 'autorizacao_imagem', autorizacao_imagem) else null end,
    -- quem tinha cancelado e vincula de novo volta a valer
    situacao = case when situacao = 'cancelada' and metodo_ is not null then 'ativa' else situacao end,
    cancelada_em = case when metodo_ is null then cancelada_em else null end,
    atualizado_em = now()
  where salon_id = salao;
  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.assinatura_metodo_definir(uuid, text, jsonb) from public, anon;
grant execute on function public.assinatura_metodo_definir(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Abrir, gravar, confirmar e falhar uma cobrança
-- ---------------------------------------------------------------------------
-- tipo: avista (paga hoje, 30 + bônus), primeira (o teste acabou), renovacao (o período pago acabou)
create or replace function public.cobranca_mimo_abrir(salao uuid, tipo_ text, metodo_ text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r jsonb := public.regras_da_assinatura();
  a public.assinaturas%rowtype;
  m jsonb;
  ini date; fim date; venc date; met text; bonus integer := 0; nova uuid; existente record;
begin
  if auth.uid() is not null and not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona abre uma cobrança.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then raise exception 'O salão ainda não foi ativado.'; end if;
  met := coalesce(metodo_, a.metodo);
  if met is null or met not in ('pix', 'cartao', 'pix_automatico') then raise exception 'Escolha como pagar antes.'; end if;
  m := public.mensalidade_do_salao(salao);
  if (m ->> 'total_cents')::int <= 0 then raise exception 'Nada a cobrar.'; end if;

  if tipo_ = 'avista' then
    ini := (now() at time zone 'America/Sao_Paulo')::date;
    if not a.bonus_usado then bonus := (r ->> 'bonus_dias')::int; end if;
    -- já está pago até uma data futura? o novo período começa depois dela
    if a.situacao = 'ativa' and a.pago_ate is not null and a.pago_ate > now() then ini := (a.pago_ate at time zone 'America/Sao_Paulo')::date; bonus := 0; end if;
    fim := ini + (r ->> 'periodo_dias')::int + bonus;
    venc := (now() at time zone 'America/Sao_Paulo')::date;
  elsif tipo_ = 'primeira' then
    ini := (coalesce(a.teste_ate, now()) at time zone 'America/Sao_Paulo')::date; fim := ini + (r ->> 'periodo_dias')::int; venc := ini;
  elsif tipo_ = 'renovacao' then
    ini := (coalesce(a.pago_ate, now()) at time zone 'America/Sao_Paulo')::date; fim := ini + (r ->> 'periodo_dias')::int; venc := ini;
  else
    raise exception 'Tipo de cobrança inválido: %', tipo_;
  end if;

  -- uma cobrança aberta pro mesmo período basta
  select c.id, c.status into existente from public.cobrancas_mimo c
    where c.salon_id = salao and c.periodo_inicio = ini and c.status in ('a_criar', 'aguardando', 'pago') limit 1;
  if existente.id is not null then return jsonb_build_object('id', existente.id, 'existente', true, 'status', existente.status); end if;

  insert into public.cobrancas_mimo (salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano, valor_cents, desconto_cents, total_cents, metodo, vencimento)
  values (salao, tipo_, ini, fim, (m ->> 'agendas')::int, m ->> 'plano', (m ->> 'valor_cents')::int, (m ->> 'desconto_cents')::int, (m ->> 'total_cents')::int, met, venc)
  returning id into nova;
  return jsonb_build_object('id', nova, 'existente', false, 'status', 'a_criar', 'total_cents', (m ->> 'total_cents')::int, 'periodo_fim', fim, 'bonus_dias', bonus);
end;
$$;
revoke execute on function public.cobranca_mimo_abrir(uuid, text, text) from public, anon;
grant execute on function public.cobranca_mimo_abrir(uuid, text, text) to authenticated;

-- o lote pra Edge Function: o que criar no Asaas e o que conferir (chave de serviço)
create or replace function public.cobrancas_mimo_para_cuidar(quantos integer default 20)
returns table (id uuid, salon_id uuid, tipo text, status text, metodo text, total_cents integer, vencimento date, cobranca_id text,
               periodo_inicio date, periodo_fim date, descricao text, customer_id text, cartao_token text, autorizacao_id text, autorizacao_status text,
               nome text, documento text, email text, telefone text, tentativas integer)
language sql
stable
security definer set search_path = public
as $$
  select c.id, c.salon_id, c.tipo, c.status, c.metodo, c.total_cents, c.vencimento, c.cobranca_id, c.periodo_inicio, c.periodo_fim,
         format('MIMO %s · %s a %s', s.name, to_char(c.periodo_inicio, 'DD/MM'), to_char(c.periodo_fim, 'DD/MM')),
         a.customer_id, a.cartao_token, a.autorizacao_id, a.autorizacao_status,
         coalesce(s.razao_social, s.name),
         coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
         coalesce(s.email, (select u.email from auth.users u where u.id = s.owner_id)),
         coalesce(s.whatsapp, s.phone, p.phone),
         c.tentativas
  from public.cobrancas_mimo c
  join public.salons s on s.id = c.salon_id
  join public.assinaturas a on a.salon_id = c.salon_id
  left join public.profiles p on p.id = s.owner_id
  where c.status = 'a_criar'
     or (c.status = 'aguardando' and (c.vencimento < (now() at time zone 'America/Sao_Paulo')::date or c.metodo <> 'pix' or c.atualizado_em < now() - interval '1 hour'))
  order by c.criado_em
  limit quantos;
$$;
revoke execute on function public.cobrancas_mimo_para_cuidar(integer) from public, anon, authenticated;

create or replace function public.cobranca_mimo_atualizar(cobranca uuid, dados jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  update public.cobrancas_mimo set
    status = coalesce(dados ->> 'status', status),
    cobranca_id = coalesce(dados ->> 'cobranca_id', cobranca_id),
    copia_cola = coalesce(dados ->> 'copia_cola', copia_cola),
    link_url = coalesce(dados ->> 'link_url', link_url),
    erro = case when dados ? 'erro' then left(dados ->> 'erro', 300) else erro end,
    tentativas = tentativas + case when coalesce((dados ->> 'tentativa')::boolean, false) then 1 else 0 end,
    atualizado_em = now()
  where id = cobranca;
  if dados ? 'customer_id' then
    update public.assinaturas a set customer_id = dados ->> 'customer_id', atualizado_em = now()
    from public.cobrancas_mimo c where c.id = cobranca and a.salon_id = c.salon_id;
  end if;
  if dados ? 'autorizacao_status' then
    update public.assinaturas a set autorizacao_status = dados ->> 'autorizacao_status', atualizado_em = now()
    from public.cobrancas_mimo c where c.id = cobranca and a.salon_id = c.salon_id;
  end if;
end;
$$;
revoke execute on function public.cobranca_mimo_atualizar(uuid, jsonb) from public, anon, authenticated;

-- a cobrança caiu: o salão fica ativo até o fim do período
create or replace function public.cobranca_mimo_confirmar(cobranca uuid, cobranca_asaas text default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.cobrancas_mimo%rowtype; s public.salons%rowtype;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca for update;
  if c.id is null then return jsonb_build_object('ok', false, 'motivo', 'cobrança desconhecida'); end if;
  if c.status = 'pago' then return jsonb_build_object('ok', true, 'repetido', true); end if;
  update public.cobrancas_mimo set status = 'pago', pago_em = quando, cobranca_id = coalesce(cobranca_asaas, cobranca_id), erro = null, atualizado_em = now() where id = cobranca;
  update public.assinaturas set
    situacao = 'ativa',
    pago_ate = greatest(coalesce(pago_ate, '-infinity'::timestamptz), (c.periodo_fim::timestamp + interval '23 hours 59 minutes') at time zone 'America/Sao_Paulo'),
    bonus_usado = bonus_usado or c.tipo = 'avista',
    metodo = coalesce(metodo, c.metodo),
    avisos = '{}'::jsonb, cancelada_em = null, atualizado_em = now()
  where salon_id = c.salon_id;
  select * into s from public.salons where id = c.salon_id;
  if s.owner_id is not null then
    begin
      perform public.notificar(s.owner_id, 'cobranca_paga', 'Pagamento confirmado',
        format('%s está em dia até %s. Obrigada por ficar com a gente 💗', s.name, to_char(c.periodo_fim, 'DD/MM')),
        '/admin/assinatura', jsonb_build_object('salon_id', s.id, 'cobranca', c.id));
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true, 'pago_ate', c.periodo_fim);
end;
$$;
revoke execute on function public.cobranca_mimo_confirmar(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.cobranca_mimo_falhou(cobranca uuid, motivo text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare c public.cobrancas_mimo%rowtype; s public.salons%rowtype; r jsonb := public.regras_da_assinatura();
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca;
  if c.id is null or c.status = 'pago' then return; end if;
  update public.cobrancas_mimo set status = 'falhou', erro = left(motivo, 300), tentativas = tentativas + 1, atualizado_em = now() where id = cobranca;
  select * into s from public.salons where id = c.salon_id;
  if s.owner_id is not null and c.tentativas + 1 <= (r ->> 'tentativas')::int then
    begin
      perform public.notificar(s.owner_id, 'cobranca_falhou', 'Não deu pra cobrar',
        format('A cobrança de %s (%s) não passou: %s. Vamos tentar de novo amanhã; se preferir, troque a forma de pagamento.',
          s.name, case c.metodo when 'cartao' then 'cartão' when 'pix_automatico' then 'Pix Automático' else 'Pix' end, left(motivo, 120)),
        '/admin/assinatura', jsonb_build_object('salon_id', s.id, 'cobranca', c.id));
    exception when others then null;
    end;
  end if;
end;
$$;
revoke execute on function public.cobranca_mimo_falhou(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Cancelar: usa até o fim do que pagou; no teste, só desvincula
-- ---------------------------------------------------------------------------
create or replace function public.assinatura_cancelar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.assinaturas%rowtype;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona cancela.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then return public.acesso_do_salao(salao); end if;
  update public.cobrancas_mimo set status = 'cancelado', atualizado_em = now() where salon_id = salao and status in ('a_criar', 'aguardando', 'falhou');
  update public.assinaturas set
    situacao = case when situacao = 'ativa' and pago_ate is not null then 'cancelada' else situacao end,
    metodo = null, desconto_pct = 0, cartao_token = null, cartao_final = null, cartao_bandeira = null,
    autorizacao_id = null, autorizacao_status = null, autorizacao_qr = null, autorizacao_imagem = null,
    cancelada_em = now(), atualizado_em = now()
  where salon_id = salao;
  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.assinatura_cancelar(uuid) from public, anon;
grant execute on function public.assinatura_cancelar(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A rotina: abre as cobranças nos marcos e chama a Edge Function
-- ---------------------------------------------------------------------------
insert into public.push_regras (kind, envia) values ('cobranca_paga', true), ('cobranca_falhou', true), ('cobranca_pix', true)
on conflict (kind) do nothing;
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values ('cobranca_falhou', true, 'utilidade', null), ('cobranca_pix', true, 'utilidade', null)
on conflict (kind) do nothing;

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
    -- o período pago está acabando (3 dias antes): a renovação
    if a.situacao = 'ativa' and a.pago_ate is not null and a.pago_ate - interval '3 days' <= now()
       and not exists (select 1 from public.cobrancas_mimo k where k.salon_id = a.salon_id and k.periodo_inicio = (a.pago_ate at time zone 'America/Sao_Paulo')::date) then
      perform public.cobranca_mimo_abrir(a.salon_id, 'renovacao'); quantos := quantos + 1;
    end if;
  end loop;

  -- cobrança recorrente que falhou: tenta de novo no dia seguinte, até o limite
  for c in
    select k.* from public.cobrancas_mimo k
    where k.status = 'falhou' and k.metodo in ('cartao', 'pix_automatico') and k.tentativas < (r ->> 'tentativas')::int
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
