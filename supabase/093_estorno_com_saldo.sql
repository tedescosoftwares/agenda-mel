-- 093 · Estorno sem quebrar quando falta saldo
--
-- O Asaas não devolve a taxa do PIX e só estorna se a subconta tiver
-- saldo. Devolver R$ 35 inteiros de um PIX que rendeu R$ 33,01 exige
-- que a profissional tenha saldo, e se ela sacou, não tem. A fila ficava
-- tentando a cada 5 minutos, em silêncio, para sempre.
--
--   salons.estorno_desconta_taxa   cliente cancelou com antecedência: devolve
--                                  o líquido (menos a taxa do PIX); a casa
--                                  cancelou: devolve tudo. Padrão ligado.
--   pagamentos.tentativas_estorno / proxima_tentativa_em / estorno_avisado_em
--                                  tentativas espaçadas (30 min, 1h30, 4h30…)
--   contas_de_recebimento.pix_chave  a chave da subconta, para repor saldo
--   estorno_sem_saldo (push)       a profissional sabe que falta saldo e quanto
--   estorno_atrasado (push)        a cliente sabe que está demorando

alter table public.salons add column if not exists estorno_desconta_taxa boolean not null default true;
grant update (estorno_desconta_taxa) on public.salons to authenticated;
alter table public.pagamentos add column if not exists tentativas_estorno integer not null default 0;
alter table public.pagamentos add column if not exists proxima_tentativa_em timestamptz;
alter table public.pagamentos add column if not exists estorno_avisado_em timestamptz;
alter table public.contas_de_recebimento add column if not exists pix_chave text;

create or replace function public.pagamento_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'modo', case when c.conta_id is not null then s.pagamento_modo else 'nao' end,
    'sinal_pct', s.sinal_pct,
    'estorno_horas', s.estorno_horas,
    'estorno_desconta_taxa', s.estorno_desconta_taxa)
  from public.salons s
  left join public.contas_de_recebimento c on c.salon_id = s.id
  where s.id = salao;
$$;
grant execute on function public.pagamento_do_salao(uuid) to anon, authenticated;

-- cancelou: quanto volta
create or replace function public.agenda_estorno_ao_cancelar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  horas smallint;
  desconta boolean;
  devolve boolean;
  pela_casa boolean;
  quanto integer;
  taxa integer;
  res record;
begin
  if new.status <> 'cancelado' or old.status = 'cancelado' or coalesce(new.pago_cents, 0) <= 0 then return new; end if;
  select * into p from public.pagamentos where appointment_id = new.id and status = 'pago' order by pago_em desc limit 1;
  if p.id is null then return new; end if;
  select estorno_horas, estorno_desconta_taxa into horas, desconta from public.salons where id = new.salon_id;
  pela_casa := coalesce(new.cancelado_por, 'sistema') <> 'cliente';
  devolve := pela_casa
             or (coalesce(new.cancelado_em, now()) at time zone 'America/Sao_Paulo') <= (new.date + new.start_time) - make_interval(hours => coalesce(horas, 24));
  taxa := greatest(0, p.valor_cents - coalesce(p.liquido_cents, p.valor_cents));
  quanto := case when not pela_casa and coalesce(desconta, true) then p.valor_cents - taxa else p.valor_cents end;
  if devolve then
    update public.pagamentos set status = 'estorno_pendente', estorno_cents = quanto, tentativas_estorno = 0, proxima_tentativa_em = null,
      motivo_estorno = case when pela_casa then 'cancelado pela casa' else 'cancelado com antecedência' end,
      atualizado_em = now() where id = p.id;
  else
    update public.pagamentos set status = 'retido', motivo_estorno = 'cancelado em cima da hora', atualizado_em = now() where id = p.id;
  end if;
  if new.client_id is not null then
    select * into res from public.resumo_do_agendamento(new.id);
    if devolve then
      perform public.notificar(new.client_id, 'estorno_a_caminho', 'Seu dinheiro está voltando',
        'R$ ' || to_char(quanto / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' volta para a sua conta em até 1 dia útil.'
          || case when quanto < p.valor_cents then ' A taxa do PIX, R$ ' || to_char(taxa / 100.0, 'FM999G999D00') || ', não é devolvida.' else '' end,
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    else
      perform public.notificar(new.client_id, 'sinal_retido', 'Sinal não devolvido',
        'Como o cancelamento foi com menos de ' || coalesce(horas, 24) || ' h de antecedência, o sinal de R$ ' || to_char(p.valor_cents / 100.0, 'FM999G999D00') || ' fica com a profissional.',
        '/cliente/agendamento/' || new.id, jsonb_build_object('appointment_id', new.id));
    end if;
  end if;
  return new;
end;
$$;

-- a fila respeita a próxima tentativa
create or replace function public.pagamentos_para_cuidar(quantos integer default 20)
returns setof public.pagamentos
language sql
security definer set search_path = public
as $$
  select * from public.pagamentos
  where ((status = 'estorno_pendente' and (proxima_tentativa_em is null or proxima_tentativa_em <= now()))
     or (status in ('expirado', 'cancelado') and cobranca_id is not null and baixa_no_provedor_em is null))
  order by atualizado_em nulls first, criado_em
  limit quantos;
$$;
revoke execute on function public.pagamentos_para_cuidar(integer) from public, anon, authenticated;

-- falhou: espaça a próxima tentativa (30 min, 1h30, 4h30, 13h30, 24h…),
-- avisa quem recebe a partir da 2ª falha (e de novo a cada 24 h), e a
-- cliente na 3ª
create or replace function public.pagamento_cuidado(pagamento uuid, resultado text, detalhe text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  p public.pagamentos%rowtype;
  a public.appointments%rowtype;
  q record;
  res record;
  nome_cli text;
  chave text;
  n integer;
begin
  if resultado = 'estornado' then
    update public.pagamentos set status = 'estornado', estornado_em = now(), baixa_no_provedor_em = now(), erro = null, proxima_tentativa_em = null, atualizado_em = now() where id = pagamento;
    return;
  elsif resultado = 'baixado' then
    update public.pagamentos set baixa_no_provedor_em = now(), erro = null, atualizado_em = now() where id = pagamento;
    return;
  end if;

  select * into p from public.pagamentos where id = pagamento;
  if p.id is null then return; end if;
  if p.status <> 'estorno_pendente' then
    update public.pagamentos set erro = left(coalesce(detalhe, resultado), 300), atualizado_em = now() where id = pagamento;
    return;
  end if;

  n := p.tentativas_estorno + 1;
  update public.pagamentos
  set erro = left(coalesce(detalhe, resultado), 300), tentativas_estorno = n,
      proxima_tentativa_em = now() + least(make_interval(mins => (30 * power(3, n - 1))::integer), interval '24 hours'),
      atualizado_em = now()
  where id = pagamento;

  select * into a from public.appointments where id = p.appointment_id;
  if n >= 2 and (p.estorno_avisado_em is null or p.estorno_avisado_em < now() - interval '24 hours') then
    select coalesce(nullif(btrim(pf.full_name), ''), 'a cliente') into nome_cli from public.profiles pf where pf.id = p.client_id;
    select c.pix_chave into chave from public.contas_de_recebimento c where c.salon_id = p.salon_id;
    for q in select * from public.quem_responde_por(a.professional_id) loop
      perform public.notificar(q.user_id, 'estorno_sem_saldo', 'Devolução parada: falta saldo',
        'R$ ' || to_char(coalesce(p.estorno_cents, p.valor_cents) / 100.0, 'FM999G999D00') || ' precisam voltar para ' || nome_cli
          || ' e a sua conta de recebimento não tem esse saldo. Deposite por Pix'
          || case when chave is not null then ' na chave ' || chave else '' end
          || ' e a devolução sai sozinha em até 1 hora.',
        case when q.papel = 'salao' then '/admin/receber' else '/pro/receber' end,
        jsonb_build_object('appointment_id', p.appointment_id, 'pagamento_id', p.id));
    end loop;
    update public.pagamentos set estorno_avisado_em = now() where id = pagamento;
  end if;
  if n = 3 and p.client_id is not null then
    select * into res from public.resumo_do_agendamento(p.appointment_id);
    perform public.notificar(p.client_id, 'estorno_atrasado', 'Sua devolução está demorando',
      'A devolução de R$ ' || to_char(coalesce(p.estorno_cents, p.valor_cents) / 100.0, 'FM999G999D00') || ' de ' || res.servico
        || ' ainda não saiu. Já avisamos a profissional; assim que sair, você recebe um aviso.',
      '/cliente/agendamento/' || p.appointment_id, jsonb_build_object('appointment_id', p.appointment_id));
  end if;
end;
$$;
revoke execute on function public.pagamento_cuidado(uuid, text, text) from public, anon, authenticated;

-- e quando finalmente sai, a cliente fica sabendo
create or replace function public.avisa_estorno_feito()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare res record;
begin
  if new.status = 'estornado' and old.status is distinct from 'estornado' and old.status = 'estorno_pendente' and old.tentativas_estorno >= 3 and new.client_id is not null then
    select * into res from public.resumo_do_agendamento(new.appointment_id);
    perform public.notificar(new.client_id, 'estorno_a_caminho', 'Devolução feita',
      'R$ ' || to_char(coalesce(new.estorno_cents, new.valor_cents) / 100.0, 'FM999G999D00') || ' de ' || res.servico || ' já voltaram para a sua conta.',
      '/cliente/agendamento/' || new.appointment_id, jsonb_build_object('appointment_id', new.appointment_id));
  end if;
  return new;
end;
$$;
drop trigger if exists tg_avisa_estorno_feito on public.pagamentos;
create trigger tg_avisa_estorno_feito
  after update of status on public.pagamentos
  for each row execute function public.avisa_estorno_feito();

insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.estorno_sem_saldo', 'push', 'Devolução parada (falta saldo)', 'A profissional precisa repor saldo na conta de recebimento para a devolução sair.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 820,
  '{"titulo":"Devolução parada: falta saldo","texto":"R$ 33,01 precisam voltar para Juliana e a sua conta de recebimento não tem esse saldo. Deposite por Pix na chave … e a devolução sai sozinha em até 1 hora."}'),
('push.estorno_atrasado', 'push', 'Devolução atrasada', 'A cliente fica sabendo que a devolução está demorando.', '{titulo,texto,nome,servico}', E'{titulo}\n{texto}', 764,
  '{"titulo":"Sua devolução está demorando","texto":"A devolução de R$ 33,01 de Manicure ainda não saiu. Já avisamos a profissional; assim que sair, você recebe um aviso."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('estorno_sem_saldo', true), ('estorno_atrasado', true) on conflict (kind) do nothing;
