-- 265: as agendas do plano (4.10)
--   O passo "Quase lá" (quantas agendas) saiu do cadastro. Até 3 profissionais o valor é o mesmo, então:
--   1. Todo salão começa com 3 agendas liberadas (salons.equipe_prevista nunca fica abaixo de 3).
--   2. Na tela de ativação a dona diz se tem mais de 3 (ativacao_equipe); a primeira mensalidade sai por esse número.
--   3. Na Equipe, passar das agendas liberadas abre a conta (agendas_do_salao):
--        • no teste grátis (ou antes de pagar): libera sem cobrança e avisa o novo valor (agendas_liberar);
--        • com o plano pago: um Pix do excedente, a diferença da mensalidade × os meses que faltam do período pago
--          (agendas_compra_*; a função respostas-extras conversa com o Asaas, referência agendas:<id>).
--   4. A trava vale no banco: profissional com agenda além das liberadas não entra (professionals_agendas_tg).
--   A mensalidade seguinte continua seguindo as profissionais ativas (mensalidade_do_salao, como já era).
-- Idempotente.

update public.salons set equipe_prevista = 3 where tipo <> 'autonoma' and coalesce(equipe_prevista, 0) < 3;

create table if not exists public.agendas_compras (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  agendas integer not null check (agendas > 0),        -- quantas a mais
  total_depois integer not null,                         -- agendas liberadas depois de pagar
  meses integer not null default 1 check (meses > 0),    -- meses que faltam do período pago
  valor_cents integer not null check (valor_cents > 0),
  status text not null default 'aguardando' check (status in ('aguardando', 'pago', 'cancelado')),
  cobranca_id text,
  copia_cola text,
  erro text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  pago_em timestamptz
);
create index if not exists agendas_compras_salao on public.agendas_compras (salon_id, criado_em desc);
alter table public.agendas_compras enable row level security;
revoke all on public.agendas_compras from public, anon, authenticated;

-- a conta: quantas tem, quantas estão liberadas, e quanto custa cada uma a mais
create or replace function public.agendas_do_salao(salao uuid, a_mais integer default 1)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare s public.salons%rowtype; a public.assinaturas%rowtype; ativas integer; liberadas integer; base integer; depois integer;
        paga boolean; meses integer := 1; antes_cents integer; depois_cents integer; k integer := greatest(1, coalesce(a_mais, 1));
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só quem manda no salão vê as agendas do plano.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  select * into a from public.assinaturas where salon_id = salao;
  select count(*) into ativas from public.professionals p where p.salon_id = salao and p.active;
  liberadas := greatest(3, coalesce(s.equipe_prevista, 0));
  base := greatest(liberadas, ativas);
  depois := base + k;
  paga := s.tipo <> 'autonoma' and a.situacao = 'ativa' and a.pago_ate is not null and a.pago_ate > now();
  if paga then meses := greatest(1, ceil(extract(epoch from (a.pago_ate - now())) / 86400.0 / 30.0)::int); end if;
  antes_cents := public.mensalidade_cents(public.plano_do_negocio(s.tipo, base), base);
  depois_cents := public.mensalidade_cents(public.plano_do_negocio(s.tipo, depois), depois);
  return jsonb_build_object(
    'ativas', ativas, 'liberadas', liberadas, 'a_mais', k, 'total_depois', depois,
    'paga', paga, 'meses', meses, 'pago_ate', a.pago_ate,
    'mensalidade_antes_cents', antes_cents, 'mensalidade_depois_cents', depois_cents,
    'por_mes_cents', depois_cents - antes_cents,
    'agora_cents', case when paga then (depois_cents - antes_cents) * meses else 0 end);
end;
$$;
revoke execute on function public.agendas_do_salao(uuid, integer) from public, anon;
grant execute on function public.agendas_do_salao(uuid, integer) to authenticated;

-- sem plano pago (teste grátis, configurando): libera na hora, sem cobrança
create or replace function public.agendas_liberar(salao uuid, a_mais integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare e jsonb;
begin
  e := public.agendas_do_salao(salao, a_mais);
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão libera agendas.'; end if;
  if (e ->> 'paga')::boolean then raise exception 'Com o plano pago, as agendas a mais entram pelo Pix.'; end if;
  if coalesce(a_mais, 0) < 1 or a_mais > 50 then raise exception 'Quantidade inválida.'; end if;
  update public.salons set equipe_prevista = (e ->> 'total_depois')::int where id = salao;
  return public.agendas_do_salao(salao, 1);
end;
$$;
revoke execute on function public.agendas_liberar(uuid, integer) from public, anon;
grant execute on function public.agendas_liberar(uuid, integer) to authenticated;

-- a tela de ativação: o tamanho da equipe antes da primeira mensalidade
create or replace function public.ativacao_equipe(salao uuid, agendas_ integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona muda o tamanho da equipe.'; end if;
  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.ativado_em is not null then raise exception 'O salão já está ativo: as agendas a mais entram pela Equipe.'; end if;
  if coalesce(agendas_, 0) < 1 or agendas_ > 200 then raise exception 'Quantidade inválida.'; end if;
  if exists (select 1 from public.cobrancas_mimo x where x.salon_id = salao and x.tipo = 'inicial' and x.status in ('aguardando', 'pago')) then
    raise exception 'Já existe um Pix aberto com outro valor. Volte e troque a opção para mudar a equipe.';
  end if;
  update public.salons set equipe_prevista = greatest(3, agendas_) where id = salao;
  return public.ativacao_inicial_estado(salao);
end;
$$;
revoke execute on function public.ativacao_equipe(uuid, integer) from public, anon;
grant execute on function public.ativacao_equipe(uuid, integer) to authenticated;

-- com o plano pago: abre (ou reaproveita) a compra das agendas a mais
create or replace function public.agendas_compra_abrir(salao uuid, agendas_ integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; p public.profiles%rowtype; em text; e jsonb; c public.agendas_compras%rowtype;
        anteriores text[]; cliente_asaas text;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só quem manda no salão libera agendas.'; end if;
  if coalesce(agendas_, 0) < 1 or agendas_ > 50 then raise exception 'Quantidade inválida.'; end if;
  e := public.agendas_do_salao(salao, agendas_);
  if not (e ->> 'paga')::boolean then raise exception 'Sem plano pago não tem Pix: as agendas entram direto.'; end if;
  select * into s from public.salons where id = salao;
  select * into p from public.profiles where id = s.owner_id;
  select u.email into em from auth.users u where u.id = s.owner_id;
  select a.customer_id into cliente_asaas from public.assinaturas a where a.salon_id = salao;

  -- o mesmo pedido aguardando, de hoje e com o mesmo valor: é ele (tocar duas vezes não cria dois Pix)
  select * into c from public.agendas_compras r
   where r.salon_id = salao and r.status = 'aguardando' and r.agendas = agendas_ and r.total_depois = (e ->> 'total_depois')::int
     and r.valor_cents = (e ->> 'agora_cents')::int and r.criado_em > now() - interval '20 hours'
   order by r.criado_em desc limit 1;
  select array_agg(r.cobranca_id) filter (where r.cobranca_id is not null) into anteriores
    from public.agendas_compras r where r.salon_id = salao and r.status = 'aguardando' and r.id is distinct from c.id;
  update public.agendas_compras r set status = 'cancelado', erro = 'trocou a quantidade'
   where r.salon_id = salao and r.status = 'aguardando' and r.id is distinct from c.id;
  if c.id is null then
    insert into public.agendas_compras (salon_id, agendas, total_depois, meses, valor_cents, criado_por)
    values (salao, agendas_, (e ->> 'total_depois')::int, (e ->> 'meses')::int, (e ->> 'agora_cents')::int, auth.uid())
    returning * into c;
  end if;
  return jsonb_build_object(
    'id', c.id, 'agendas', c.agendas, 'meses', c.meses, 'valor_cents', c.valor_cents, 'status', c.status,
    'cobranca_id', c.cobranca_id, 'copia_cola', c.copia_cola, 'anteriores', coalesce(to_jsonb(anteriores), '[]'::jsonb),
    'cliente', jsonb_build_object(
      'nome', s.name, 'razao_social', coalesce(s.razao_social, s.name),
      'documento', coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), '')),
      'email', coalesce(s.email, em), 'telefone', coalesce(s.whatsapp, s.phone, p.phone), 'customer_id', cliente_asaas));
end;
$$;

create or replace function public.agendas_compra_atualizar(compra uuid, cobranca_id_ text, copia_cola_ text, erro_ text default null)
returns void
language sql
security definer set search_path = public
as $$
  update public.agendas_compras
     set cobranca_id = coalesce(cobranca_id_, cobranca_id), copia_cola = coalesce(copia_cola_, copia_cola), erro = erro_
   where id = compra;
$$;

-- pagou: libera uma vez só, e avisa
create or replace function public.agendas_compra_paga(compra uuid, cobranca_asaas text default null, quando timestamptz default now())
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.agendas_compras%rowtype; total integer;
begin
  update public.agendas_compras
     set status = 'pago', pago_em = coalesce(quando, now()), cobranca_id = coalesce(cobranca_asaas, cobranca_id), erro = null
   where id = compra and status <> 'pago'
  returning * into c;
  if c.id is null then
    select * into c from public.agendas_compras where id = compra;
    return jsonb_build_object('ok', c.id is not null, 'ja', true, 'liberadas', (select greatest(3, coalesce(equipe_prevista, 0)) from public.salons where id = c.salon_id));
  end if;
  update public.salons set equipe_prevista = greatest(coalesce(equipe_prevista, 0), c.total_depois) where id = c.salon_id returning equipe_prevista into total;
  perform public.avisar_quem_manda(c.salon_id, 'agendas_pagas',
    'Pix confirmado: +' || c.agendas || case when c.agendas = 1 then ' agenda' else ' agendas' end,
    'Seu salão agora tem ' || total || ' agendas liberadas. É só cadastrar em Equipe.');
  return jsonb_build_object('ok', true, 'liberadas', total, 'agendas', c.agendas);
end;
$$;

create or replace function public.agendas_compra_cancelar(compra uuid, motivo text default null)
returns void
language sql
security definer set search_path = public
as $$
  update public.agendas_compras set status = 'cancelado', erro = coalesce(motivo, erro) where id = compra and status = 'aguardando';
$$;

create or replace function public.agendas_compra_estado(compra uuid)
returns jsonb
language plpgsql
stable security definer set search_path = public
as $$
declare c public.agendas_compras%rowtype;
begin
  select * into c from public.agendas_compras where id = compra;
  if c.id is null or not (public.is_admin_do_salao(c.salon_id) or public.eh_plataforma()) then raise exception 'Compra não encontrada.'; end if;
  return jsonb_build_object('id', c.id, 'salon_id', c.salon_id, 'status', c.status, 'agendas', c.agendas, 'meses', c.meses, 'valor_cents', c.valor_cents,
    'cobranca_id', c.cobranca_id, 'copia_cola', c.copia_cola,
    'liberadas', (select greatest(3, coalesce(equipe_prevista, 0)) from public.salons where id = c.salon_id));
end;
$$;

revoke execute on function public.agendas_compra_abrir(uuid, integer) from public, anon;
grant execute on function public.agendas_compra_abrir(uuid, integer) to authenticated;
revoke execute on function public.agendas_compra_estado(uuid) from public, anon;
grant execute on function public.agendas_compra_estado(uuid) to authenticated;
revoke execute on function public.agendas_compra_atualizar(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.agendas_compra_paga(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.agendas_compra_cancelar(uuid, text) from public, anon, authenticated;

-- a trava: quem está logada não põe no ar uma profissional além das agendas liberadas (o sistema e a plataforma passam)
create or replace function public.professionals_agendas()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; ativas integer; liberadas integer;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then return new; end if;
  if auth.uid() is null or public.eh_plataforma() then return new; end if;
  select * into s from public.salons where id = new.salon_id;
  if s.id is null or s.tipo = 'autonoma' then return new; end if;
  liberadas := greatest(3, coalesce(s.equipe_prevista, 0));
  select count(*) into ativas from public.professionals p where p.salon_id = new.salon_id and p.active and p.id <> new.id;
  if ativas >= liberadas then
    raise exception 'Seu plano cobre % profissionais com agenda. Para cadastrar mais uma, libere mais agendas em Equipe › Adicionar profissional.', liberadas
      using errcode = 'MI003';
  end if;
  return new;
end;
$$;
-- o nome com zz: roda depois de professionals_situacao_tg, que é quem decide se ela fica com a agenda no ar (active)
drop trigger if exists professionals_agendas_tg on public.professionals;
drop trigger if exists professionals_zz_agendas_tg on public.professionals;
create trigger professionals_zz_agendas_tg before insert or update of active, situacao on public.professionals
  for each row execute function public.professionals_agendas();

do $$ begin raise notice '265: agendas do plano (3 de fábrica, ativacao_equipe, agendas_do_salao, agendas_liberar, agendas_compra_*, trava na equipe)'; end $$;
