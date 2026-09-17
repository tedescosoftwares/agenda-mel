-- 094 · Política de cancelamento, crédito de remarcação e financeiro
--
-- Antes o prazo de devolução era um número solto (6, 12, 24, 48 h) e
-- quem marcava já dentro do prazo nascia com um sinal "não devolvível".
-- Agora:
--
--   politica_cancelamento   flexivel (6 h) · moderada (12 h) · rigorosa (24 h)
--                           Até o prazo: devolve o sinal menos a taxa do PIX,
--                           ou remarca levando o sinal junto. Depois do prazo:
--                           não devolve, mas o sinal vira crédito por 30 dias
--                           para marcar de novo com a mesma casa.
--   carência                quem paga já dentro do prazo ainda pode cancelar
--                           com devolução até 1 h depois de pagar (antes do
--                           atendimento).
--   crédito                 pagamentos.status = 'credito', com credito_ate.
--                           marcar_servicos usa o crédito como sinal; a troca
--                           aceita (remarca_de) leva o sinal para o novo horário.
--   financeiro_do_salao     o mês em números: recebido, taxas, líquido,
--                           devolvido, retido, créditos, por profissional, por dia.
--
-- estorno_desconta_taxa deixa de ser escolha: a cliente que cancela sempre
-- recebe o líquido; a casa que cancela devolve tudo.

-- 1. A política ------------------------------------------------------------------
alter table public.salons add column if not exists politica_cancelamento text not null default 'moderada';
alter table public.salons drop constraint if exists salons_politica_cancelamento_check;
alter table public.salons add constraint salons_politica_cancelamento_check check (politica_cancelamento in ('flexivel', 'moderada', 'rigorosa'));
grant update (politica_cancelamento) on public.salons to authenticated;

create or replace function public.horas_da_politica(p text)
returns smallint
language sql
immutable
as $$
  select case p when 'flexivel' then 6 when 'rigorosa' then 24 else 12 end::smallint;
$$;
grant execute on function public.horas_da_politica(text) to anon, authenticated;

-- estorno_horas continua existindo (quem lê ainda encontra), mas é a política que manda
create or replace function public.politica_define_horas()
returns trigger
language plpgsql
as $$
begin
  new.estorno_horas := public.horas_da_politica(new.politica_cancelamento);
  return new;
end;
$$;
drop trigger if exists tg_politica_define_horas on public.salons;
create trigger tg_politica_define_horas
  before insert or update of politica_cancelamento on public.salons
  for each row execute function public.politica_define_horas();
update public.salons set politica_cancelamento = 'moderada' where true;

-- 2. O crédito ---------------------------------------------------------------------
alter table public.pagamentos drop constraint if exists pagamentos_status_check;
alter table public.pagamentos add constraint pagamentos_status_check
  check (status in ('aguardando', 'pago', 'expirado', 'cancelado', 'estorno_pendente', 'estornado', 'retido', 'falhou', 'credito'));
alter table public.pagamentos add column if not exists credito_ate date;
alter table public.pagamentos add column if not exists remarcado_de uuid references public.appointments (id) on delete set null;
create index if not exists pagamentos_credito_idx on public.pagamentos (client_id, salon_id) where status = 'credito';

create or replace function public.pagamento_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'modo', case when c.conta_id is not null then s.pagamento_modo else 'nao' end,
    'sinal_pct', s.sinal_pct,
    'politica', s.politica_cancelamento,
    'estorno_horas', public.horas_da_politica(s.politica_cancelamento),
    'credito_dias', 30,
    'carencia_min', 60)
  from public.salons s
  left join public.contas_de_recebimento c on c.salon_id = s.id
  where s.id = salao;
$$;
grant execute on function public.pagamento_do_salao(uuid) to anon, authenticated;

-- até quando a cliente pode cancelar com devolução (horário local):
-- o prazo da política, ou 1 h depois de pagar se ela pagou já dentro do
-- prazo; nunca depois do atendimento
create or replace function public.limite_devolucao(inicio timestamp, pago_em timestamptz, horas integer)
returns timestamp
language sql
immutable
as $$
  select least(inicio, greatest(inicio - make_interval(hours => coalesce(horas, 12)),
                                 coalesce(pago_em at time zone 'America/Sao_Paulo', inicio - make_interval(hours => coalesce(horas, 12))) + interval '1 hour'));
$$;

-- o que a cliente precisa saber sobre o dinheiro deste horário
create or replace function public.regras_do_agendamento(appt uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  p public.pagamentos%rowtype;
  s public.salons%rowtype;
  horas integer;
  limite timestamp;
  taxa integer;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null or a.client_id is distinct from auth.uid() then return null; end if;
  select * into s from public.salons where id = a.salon_id;
  select * into p from public.pagamentos where appointment_id = appt order by criado_em desc limit 1;
  horas := public.horas_da_politica(coalesce(s.politica_cancelamento, 'moderada'));
  limite := public.limite_devolucao(a.date + a.start_time, p.pago_em, horas);
  taxa := greatest(0, coalesce(p.valor_cents, 0) - coalesce(p.liquido_cents, p.valor_cents, 0));
  return jsonb_build_object(
    'politica', coalesce(s.politica_cancelamento, 'moderada'),
    'horas', horas,
    'credito_dias', 30,
    'limite', limite,
    'dentro_do_prazo', public.agora_local() <= limite,
    'pago_cents', coalesce(a.pago_cents, 0),
    'taxa_cents', taxa,
    'volta_cents', greatest(0, coalesce(p.valor_cents, 0) - taxa),
    'credito_ate', case when p.status = 'credito' then p.credito_ate else null end,
    'credito_ate_se_cancelar', greatest(a.date, public.agora_local()::date) + 30,
    'salao', s.name,
    'salon_id', s.id);
end;
$$;
grant execute on function public.regras_do_agendamento(uuid) to authenticated;

-- o crédito que a cliente tem com uma casa
create or replace function public.meu_credito(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object('pagamento_id', p.id, 'valor_cents', p.valor_cents, 'ate', p.credito_ate,
                            'de', a.service_name, 'de_quando', a.date)
  from public.pagamentos p
  left join public.appointments a on a.id = p.appointment_id
  where p.client_id = auth.uid() and p.salon_id = salao and p.status = 'credito' and p.credito_ate >= public.agora_local()::date
  order by p.credito_ate, p.valor_cents desc
  limit 1;
$$;
grant execute on function public.meu_credito(uuid) to authenticated;

-- 3. Cancelou: devolve, vira crédito ou leva junto na troca --------------------------
create or replace function public.agenda_estorno_ao_cancelar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  s public.salons%rowtype;
  horas integer;
  limite timestamp;
  pela_casa boolean;
  quanto integer;
  taxa integer;
  ate date;
  res record;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' or coalesce(new.pago_cents, 0) <= 0 then return new; end if;
  select * into p from public.pagamentos where appointment_id = new.id and status = 'pago' order by pago_em desc limit 1;
  if p.id is null then return new; end if;

  -- troca aceita (ou remarcada pela casa): o sinal vai junto para o novo horário
  if new.remarcado_para is not null then
    update public.pagamentos set appointment_id = new.remarcado_para, remarcado_de = coalesce(remarcado_de, new.id), atualizado_em = now() where id = p.id;
    update public.appointments set pago_cents = coalesce(pago_cents, 0) + p.valor_cents where id = new.remarcado_para;
    return new;
  end if;

  select * into s from public.salons where id = new.salon_id;
  horas := public.horas_da_politica(coalesce(s.politica_cancelamento, 'moderada'));
  limite := public.limite_devolucao(new.date + new.start_time, p.pago_em, horas);
  pela_casa := coalesce(new.cancelado_por, 'sistema') <> 'cliente';
  taxa := greatest(0, p.valor_cents - coalesce(p.liquido_cents, p.valor_cents));
  if new.client_id is not null then select * into res from public.resumo_do_agendamento(new.id); end if;

  if pela_casa then
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = p.valor_cents, tentativas_estorno = 0, proxima_tentativa_em = null,
      motivo_estorno = 'cancelado pela casa', atualizado_em = now() where id = p.id;
    if new.client_id is not null then
      perform public.notificar(new.client_id, 'estorno_a_caminho', 'Seu dinheiro está voltando',
        'R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' voltam inteiros para a sua conta em até 1 dia útil.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    end if;
  elsif public.agora_local() <= limite then
    quanto := p.valor_cents - taxa;
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = quanto, tentativas_estorno = 0, proxima_tentativa_em = null,
      motivo_estorno = 'cancelado com antecedência', atualizado_em = now() where id = p.id;
    if new.client_id is not null then
      perform public.notificar(new.client_id, 'estorno_a_caminho', 'Seu dinheiro está voltando',
        'R$ ' || to_char(quanto / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' voltam para a sua conta em até 1 dia útil.'
          || case when taxa > 0 then ' A taxa do PIX, R$ ' || to_char(taxa / 100.0, 'FM999G999D00') || ', não é devolvida.' else '' end,
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    end if;
  else
    ate := greatest(new.date, public.agora_local()::date) + 30;
    update public.pagamentos set status = 'credito', credito_ate = ate, motivo_estorno = 'cancelado depois do prazo: virou crédito', atualizado_em = now() where id = p.id;
    if new.client_id is not null then
      perform public.notificar(new.client_id, 'sinal_em_credito', 'Seu sinal virou crédito',
        'Como faltavam menos de ' || horas || ' h, o sinal de R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' não volta, mas fica como crédito com '
          || coalesce(s.name, 'a profissional') || ' até ' || to_char(ate, 'DD/MM') || '. Marque de novo e ele entra como sinal.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id, 'salon_id', new.salon_id));
    end if;
  end if;
  return new;
end;
$$;

-- 4. Marcar usando o crédito ------------------------------------------------------------
create or replace function public.marcar_servicos(prof uuid, servicos uuid[], dia date, hora time, obs text default null, pagar boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  itens record;
  total_min integer := 0;
  total_cents integer := 0;
  total_desconto integer := 0;
  nomes text := '';
  novo uuid;
  n integer := 0;
  sal uuid;
  pg jsonb;
  st text := 'pendente';
  cred public.pagamentos%rowtype;
begin
  if eu is null then raise exception 'Entre na sua conta para marcar.'; end if;
  if servicos is null or array_length(servicos, 1) is null then raise exception 'Escolha pelo menos um serviço.'; end if;
  if array_length(servicos, 1) > 6 then raise exception 'No máximo 6 serviços por horário.'; end if;
  select p.salon_id into sal from public.professionals p where p.id = prof and p.active;
  if sal is null and not exists (select 1 from public.professionals p where p.id = prof and p.active) then raise exception 'Profissional não encontrada.'; end if;

  create temp table if not exists itens_do_pedido (
    ord integer, service_id uuid, name text, cents integer, cheio integer, promocao_id uuid, duration_minutes integer
  ) on commit drop;
  delete from itens_do_pedido where true;
  insert into itens_do_pedido (ord, service_id, name, cents, cheio, promocao_id, duration_minutes)
  select x.ord, s.id, s.name,
         coalesce(d.preco_com_desconto_cents, round(s.price * 100)::integer),
         round(s.price * 100)::integer,
         d.promocao_id,
         s.duration_minutes
  from unnest(servicos) with ordinality as x(id, ord)
  join public.services s on s.id = x.id and s.active
  join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof
  left join public.descontos_para_mim(servicos) d on d.service_id = s.id;

  for itens in select * from itens_do_pedido order by ord loop
    n := n + 1;
    total_min := total_min + coalesce(itens.duration_minutes, 0);
    total_cents := total_cents + coalesce(itens.cents, 0);
    total_desconto := total_desconto + (coalesce(itens.cheio, 0) - coalesce(itens.cents, 0));
    nomes := nomes || case when nomes = '' then '' else ' + ' end || itens.name;
  end loop;
  if n <> array_length(servicos, 1) then raise exception 'Algum serviço não está disponível com essa profissional.'; end if;
  if total_min <= 0 then raise exception 'Serviço sem duração.'; end if;

  -- pagamento pelo app: só fora de visita e com valor para cobrar
  if sal is not null and total_cents > 0 and coalesce(current_setting('agenda_mel.em_visita', true), '') <> '1' then
    -- um crédito de remarcação com esta casa vale como sinal: não paga de novo
    select * into cred from public.pagamentos
    where client_id = eu and salon_id = sal and status = 'credito' and credito_ate >= public.agora_local()::date
    order by credito_ate, valor_cents desc limit 1;
    if cred.id is null then
      pg := public.pagamento_do_salao(sal);
      if pg ->> 'modo' = 'obrigatorio' or (pg ->> 'modo' = 'opcional' and coalesce(pagar, false)) then
        st := 'aguardando_pagamento';
      end if;
    end if;
  end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, desconto_cents, date, start_time, end_time, notes, status, pago_cents)
    values
      (eu, prof, servicos[1], nomes, total_cents, total_desconto, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), st,
       coalesce(cred.valor_cents, 0))
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
  select novo, i.service_id, i.name, i.cents, i.cheio, i.promocao_id, i.duration_minutes, i.ord
  from itens_do_pedido i order by i.ord;

  if cred.id is not null then
    update public.pagamentos
    set appointment_id = novo, status = 'pago', remarcado_de = coalesce(remarcado_de, cred.appointment_id), credito_ate = null,
        motivo_estorno = null, atualizado_em = now()
    where id = cred.id;
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents, 'desconto_cents', total_desconto,
                            'pagar', st = 'aguardando_pagamento', 'credito_usado', coalesce(cred.valor_cents, 0));
end;
$$;
grant execute on function public.marcar_servicos(uuid, uuid[], date, time, text, boolean) to authenticated;

-- 5. Crédito que venceu fica com a casa ----------------------------------------------------
create or replace function public.expirar_creditos()
returns integer
language plpgsql
security definer set search_path = public
as $$
declare r record; n integer := 0; res record;
begin
  for r in
    select p.*, s.name as salao from public.pagamentos p left join public.salons s on s.id = p.salon_id
    where p.status = 'credito' and p.credito_ate < public.agora_local()::date
  loop
    update public.pagamentos set status = 'retido', motivo_estorno = 'crédito venceu sem uso', atualizado_em = now() where id = r.id;
    if r.client_id is not null then
      perform public.notificar(r.client_id, 'credito_vencido', 'Seu crédito venceu',
        'O crédito de R$ ' || to_char(r.valor_cents / 100.0, 'FM999G999D00') || ' com ' || coalesce(r.salao, 'a profissional') || ' passou dos 30 dias sem uso e ficou com a casa.',
        '/cliente/agendamento/' || r.appointment_id, jsonb_build_object('appointment_id', r.appointment_id));
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.expirar_creditos() from public, anon, authenticated;

create or replace function public.rodar_rotinas()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  vencidos integer := 0;
  ofertas integer := 0;
  lembretes integer := 0;
  perguntas integer := 0;
  fechamentos integer := 0;
  concluidos integer := 0;
  avaliacoes integer := 0;
  reservas integer := 0;
  creditos integer := 0;
  pagamentos jsonb := '{}'::jsonb;
begin
  vencidos   := coalesce(public.resolver_aceites_vencidos(), 0);
  ofertas    := coalesce(public.avancar_ofertas_expiradas(), 0);
  lembretes  := coalesce(public.enviar_lembretes(), 0);
  begin
    perguntas := coalesce(public.perguntar_se_veio(), 0);
  exception when others then perguntas := -1;
  end;
  begin
    fechamentos := coalesce(public.lembrar_fechar_dia(), 0);
  exception when others then fechamentos := -1;
  end;
  begin
    concluidos := coalesce(public.concluir_atendimentos_passados(), 0);
  exception when others then concluidos := -1;
  end;
  begin
    avaliacoes := coalesce(public.convidar_avaliacoes(), 0);
  exception when others then avaliacoes := -1;
  end;
  begin
    reservas := coalesce(public.expirar_reservas_nao_pagas(), 0);
  exception when others then reservas := -1;
  end;
  begin
    creditos := coalesce(public.expirar_creditos(), 0);
  exception when others then creditos := -1;
  end;
  begin
    pagamentos := public.chutar_pagamentos();
  exception when others then pagamentos := jsonb_build_object('ok', false, 'motivo', sqlerrm);
  end;
  return jsonb_build_object(
    'aceites_vencidos', vencidos,
    'ofertas_expiradas', ofertas,
    'lembretes', lembretes,
    'perguntas', perguntas,
    'fechamentos', fechamentos,
    'concluidos', concluidos,
    'avaliacoes', avaliacoes,
    'reservas_expiradas', reservas,
    'creditos_vencidos', creditos,
    'pagamentos', pagamentos,
    'em', now());
end;
$$;
revoke execute on function public.rodar_rotinas() from public, anon, authenticated;

-- 6. O financeiro do salão ---------------------------------------------------------------------
create or replace function public.financeiro_do_salao(salao uuid, mes text default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  ini date;
  fim date;
  ini_ant date;
  hoje date := public.agora_local()::date;
  r jsonb;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Sem permissão.'; end if;
  ini := coalesce(to_date(mes, 'YYYY-MM'), date_trunc('month', hoje)::date);
  fim := (ini + interval '1 month')::date;
  ini_ant := (ini - interval '1 month')::date;

  with pagos as (
    select p.*, (p.pago_em at time zone 'America/Sao_Paulo')::date as dia
    from public.pagamentos p
    where p.salon_id = salao and p.pago_em is not null
      and p.status in ('pago', 'estorno_pendente', 'estornado', 'retido', 'credito')
  ),
  do_mes as (select * from pagos where dia >= ini and dia < fim),
  do_mes_ant as (select * from pagos where dia >= ini_ant and dia < ini)
  select jsonb_build_object(
    'mes', to_char(ini, 'YYYY-MM'),
    'recebido_cents', coalesce((select sum(valor_cents) from do_mes), 0),
    'recebido_anterior_cents', coalesce((select sum(valor_cents) from do_mes_ant), 0),
    'taxas_cents', coalesce((select sum(greatest(0, valor_cents - coalesce(liquido_cents, valor_cents))) from do_mes), 0),
    'mimo_cents', coalesce((select sum(coalesce(mimo_cents, 0)) from do_mes), 0),
    'liquido_cents', coalesce((select sum(coalesce(liquido_cents, valor_cents) - coalesce(mimo_cents, 0)) from do_mes), 0),
    'pagamentos', (select count(*) from do_mes),
    'clientes', (select count(distinct client_id) from do_mes),
    'devolvido_cents', coalesce((select sum(coalesce(estorno_cents, valor_cents)) from public.pagamentos p
      where p.salon_id = salao and p.status = 'estornado' and (p.estornado_em at time zone 'America/Sao_Paulo')::date >= ini and (p.estornado_em at time zone 'America/Sao_Paulo')::date < fim), 0),
    'a_devolver_cents', coalesce((select sum(coalesce(estorno_cents, valor_cents)) from public.pagamentos p where p.salon_id = salao and p.status = 'estorno_pendente'), 0),
    'devolucoes_paradas', (select count(*) from public.pagamentos p where p.salon_id = salao and p.status = 'estorno_pendente' and p.tentativas_estorno >= 2),
    'retido_cents', coalesce((select sum(valor_cents) from public.pagamentos p
      where p.salon_id = salao and p.status = 'retido' and (p.atualizado_em at time zone 'America/Sao_Paulo')::date >= ini and (p.atualizado_em at time zone 'America/Sao_Paulo')::date < fim), 0),
    'creditos_cents', coalesce((select sum(valor_cents) from public.pagamentos p where p.salon_id = salao and p.status = 'credito' and p.credito_ate >= hoje), 0),
    'creditos', (select count(*) from public.pagamentos p where p.salon_id = salao and p.status = 'credito' and p.credito_ate >= hoje),
    'a_receber_cents', coalesce((select sum(greatest(0, coalesce(a.price_cents, 0) - coalesce(a.pago_cents, 0))) from public.appointments a
      where a.salon_id = salao and a.pago_cents > 0 and a.status in ('pendente', 'confirmado') and (a.date + a.start_time) >= public.agora_local()), 0),
    'aguardando', (select count(*) from public.pagamentos p where p.salon_id = salao and p.status = 'aguardando' and (p.expira_em is null or p.expira_em > now())),
    'saldo_cents', (select (c.situacao ->> 'saldo_cents')::integer from public.contas_de_recebimento c where c.salon_id = salao),
    'saldo_em', (select c.situacao ->> 'saldo_em' from public.contas_de_recebimento c where c.salon_id = salao),
    'por_profissional', coalesce((select jsonb_agg(x order by x.recebido_cents desc) from (
      select pr.id, pr.name as nome, count(*) as quantos, sum(m.valor_cents) as recebido_cents,
             sum(coalesce(m.liquido_cents, m.valor_cents) - coalesce(m.mimo_cents, 0)) as liquido_cents
      from do_mes m join public.appointments a on a.id = m.appointment_id join public.professionals pr on pr.id = a.professional_id
      group by pr.id, pr.name) x), '[]'::jsonb),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'recebido_cents', d.tot) order by d.dia) from (
      select dia, sum(valor_cents) as tot from do_mes group by dia) d), '[]'::jsonb),
    'movimentos', coalesce((select jsonb_agg(x order by x.quando desc) from (
      select p.id, p.status, p.valor_cents, p.total_cents, p.sinal_pct, p.liquido_cents, p.mimo_cents, p.estorno_cents, p.credito_ate,
             p.tentativas_estorno, p.proxima_tentativa_em, p.erro, p.motivo_estorno, p.appointment_id,
             coalesce(p.pago_em, p.criado_em) as quando,
             coalesce(nullif(btrim(pf.full_name), ''), 'Cliente') as cliente,
             a.service_name as servico, a.date as dia, a.start_time as hora, pr.name as profissional
      from public.pagamentos p
      left join public.appointments a on a.id = p.appointment_id
      left join public.professionals pr on pr.id = a.professional_id
      left join public.profiles pf on pf.id = p.client_id
      where p.salon_id = salao
        and ((p.pago_em is not null and (p.pago_em at time zone 'America/Sao_Paulo')::date >= ini and (p.pago_em at time zone 'America/Sao_Paulo')::date < fim)
          or (p.pago_em is null and (p.criado_em at time zone 'America/Sao_Paulo')::date >= ini and (p.criado_em at time zone 'America/Sao_Paulo')::date < fim)
          or p.status in ('estorno_pendente', 'credito'))
      order by coalesce(p.pago_em, p.criado_em) desc
      limit 200) x), '[]'::jsonb)
  ) into r;
  return r;
end;
$$;
grant execute on function public.financeiro_do_salao(uuid, text) to authenticated;

-- 7. Avisos ------------------------------------------------------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.sinal_em_credito', 'push', 'Sinal virou crédito', 'A cliente cancelou depois do prazo: o sinal fica como crédito por 30 dias.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 766,
  '{"titulo":"Seu sinal virou crédito","texto":"Como faltavam menos de 12 h, o sinal de R$ 35,00 não volta, mas fica como crédito com Studio Mel até 20/10. Marque de novo e ele entra como sinal."}'),
('push.credito_vencido', 'push', 'Crédito venceu', 'O crédito de remarcação passou dos 30 dias sem uso.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 767,
  '{"titulo":"Seu crédito venceu","texto":"O crédito de R$ 35,00 com Studio Mel passou dos 30 dias sem uso e ficou com a casa."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('sinal_em_credito', true), ('credito_vencido', true) on conflict (kind) do nothing;
