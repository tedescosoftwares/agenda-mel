-- Ensaio da 234 (3.94): uma mensalidade aberta por vez, vencendo no dia X, planos com desconto, prazo para pagar.
-- Desfaz no fim.
begin;
do $$
declare
  sid uuid; dona uuid; cob jsonb; cob2 jsonb; r jsonb; pl jsonb; ac jsonb;
  mes integer; hoje date := (now() at time zone 'America/Sao_Paulo')::date; fim date; n integer;
begin
  select s.id, s.owner_id into sid, dona from public.salons s where s.tipo = 'salao' and s.owner_id is not null limit 1;
  delete from public.cobrancas_mimo where salon_id = sid;
  delete from public.assinaturas where salon_id = sid;
  update public.salons set ativado_em = now(), ativacao_pendente_em = null, active = true where id = sid;
  insert into public.assinaturas (salon_id, situacao, pago_ate, metodo, escolha_inicial, avisos)
  values (sid, 'ativa', now() + interval '5 days', 'pix', 'pago', '{}'::jsonb);

  perform set_config('request.jwt.claim.sub', dona::text, true);
  pl := public.planos_do_salao(sid);
  mes := (pl ->> 'mes_cents')::int;
  if jsonb_array_length(pl -> 'planos') <> 3 then raise exception 'J: %', pl; end if;
  if (pl -> 'planos' -> 1 ->> 'total_cents')::int <> public.preco_do_plano(mes, 6, 10)
     or (pl -> 'planos' -> 2 ->> 'total_cents')::int <> public.preco_do_plano(mes, 12, 15)
     or (pl -> 'planos' -> 0 ->> 'total_cents')::int <> mes then raise exception 'J2: %', pl; end if;
  raise notice 'J planos: mensal %, semestral % (10%%), anual % (15%%)', mes, pl -> 'planos' -> 1 ->> 'total_cents', pl -> 'planos' -> 2 ->> 'total_cents';

  -- A. 5 dias antes do fim do período pago, a rotina já deixa a próxima pronta, vencendo no dia X
  perform set_config('request.jwt.claim.sub', '', true);
  n := public.cuidar_das_assinaturas();
  n := public.cuidar_das_assinaturas();
  if (select count(*) from public.cobrancas_mimo where salon_id = sid and status = 'a_criar') <> 1 then raise exception 'A: devia haver uma só'; end if;
  select vencimento into fim from public.cobrancas_mimo where salon_id = sid and status = 'a_criar';
  if fim <> ((now() + interval '5 days') at time zone 'America/Sao_Paulo')::date then raise exception 'A2: vencimento %', fim; end if;
  if (select cancelar_em from public.cobrancas_mimo where salon_id = sid and status = 'a_criar') <> fim + 3 then raise exception 'A3'; end if;
  raise notice 'A a rotina gerou uma (uma vez só), vence em %', fim;

  -- B. a dona abre o mesmo plano: é a mesma (não cria outra no Asaas)
  perform set_config('request.jwt.claim.sub', dona::text, true);
  cob := public.cobranca_manual_abrir(sid, 'pix');
  if not (cob ->> 'existente')::boolean then raise exception 'B: %', cob; end if;
  raise notice 'B reaproveitou %', cob ->> 'id';

  -- C. foi para o Asaas; ela troca para o semestral: a anterior é cancelada e volta para a função apagar no Asaas
  update public.cobrancas_mimo set status = 'aguardando', cobranca_id = 'pay_A', copia_cola = 'pix-A' where id = (cob ->> 'id')::uuid;
  cob2 := public.cobranca_manual_abrir(sid, 'pix', 6);
  if (cob2 ->> 'existente')::boolean or cob2 -> 'anteriores' <> '["pay_A"]'::jsonb then raise exception 'C: %', cob2; end if;
  if (cob2 ->> 'total_cents')::int <> public.preco_do_plano(mes, 6, 10) then raise exception 'C2: %', cob2; end if;
  if (select status from public.cobrancas_mimo where id = (cob ->> 'id')::uuid) <> 'cancelado' then raise exception 'C3'; end if;
  if (select count(*) from public.cobrancas_mimo where salon_id = sid and status in ('a_criar', 'aguardando')) <> 1 then raise exception 'C4'; end if;
  raise notice 'C trocou para o semestral: % (anterior pay_A sai do Asaas)', cob2 ->> 'total_cents';

  -- D. de novo o semestral: a mesma
  cob := public.cobranca_manual_abrir(sid, 'pix', 6);
  if not (cob ->> 'existente')::boolean or cob ->> 'id' <> cob2 ->> 'id' then raise exception 'D: %', cob; end if;

  -- E. pagou o semestral: o período novo começa no dia X e vai 6 meses
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.cobranca_mimo_confirmar((cob2 ->> 'id')::uuid, 'pay_B', now());
  if (r ->> 'pago_ate')::date <> (fim + interval '6 months')::date then raise exception 'E: %', r; end if;
  raise notice 'E pago até %', r ->> 'pago_ate';

  -- F. vencido há 10 dias: o Pix vale 3 dias e começa no pagamento; abrir de novo (outro dia, outro clique) é a mesma
  update public.assinaturas set pago_ate = now() - interval '10 days', avisos = '{}'::jsonb where salon_id = sid;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  cob := public.cobranca_manual_abrir(sid, 'pix');
  if not (cob ->> 'inicio_no_pagamento')::boolean or (cob ->> 'vencimento')::date <> hoje + 3 then raise exception 'F: %', cob; end if;
  update public.cobrancas_mimo set status = 'aguardando', cobranca_id = 'pay_C', copia_cola = 'pix-C', periodo_inicio = hoje - 1 where id = (cob ->> 'id')::uuid;
  cob2 := public.cobranca_manual_abrir(sid, 'pix');
  if not (cob2 ->> 'existente')::boolean or cob2 ->> 'id' <> cob ->> 'id' then raise exception 'F2 (a cobrança por dia): %', cob2; end if;
  raise notice 'F vencido: uma cobrança só, vence %', cob ->> 'vencimento';

  -- G. pagou: o período começa hoje
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.cobranca_mimo_confirmar((cob ->> 'id')::uuid, 'pay_C', now());
  if (select periodo_inicio from public.cobrancas_mimo where id = (cob ->> 'id')::uuid) <> hoje
     or (r ->> 'pago_ate')::date <> (hoje + interval '1 month')::date then raise exception 'G: %', r; end if;
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' then raise exception 'G2: %', ac; end if;
  raise notice 'G começou no pagamento, até %', r ->> 'pago_ate';

  -- H. no teste, "pagar agora e já ativar" o anual: fica ativo na hora, e o ano começa quando o teste acabaria
  delete from public.cobrancas_mimo where salon_id = sid;
  update public.assinaturas set situacao = 'teste', teste_ate = now() + interval '4 days', pago_ate = null, avisos = '{}'::jsonb where salon_id = sid;
  perform set_config('request.jwt.claim.sub', dona::text, true);
  cob := public.cobranca_manual_abrir(sid, 'pix', 12);
  fim := ((now() + interval '4 days') at time zone 'America/Sao_Paulo')::date;
  if (cob ->> 'periodo_inicio')::date <> fim or (cob ->> 'total_cents')::int <> public.preco_do_plano(mes, 12, 15) then raise exception 'H: %', cob; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.cobranca_mimo_confirmar((cob ->> 'id')::uuid, 'pay_D', now());
  ac := public.acesso_do_salao(sid);
  if ac ->> 'fase' <> 'ativa' or (r ->> 'pago_ate')::date <> (fim + interval '12 months')::date then raise exception 'H2: % %', r, ac; end if;
  raise notice 'H pagou no teste: ativo já, anual até %', r ->> 'pago_ate';

  -- I. a não paga depois do prazo entra na lista da função (que apaga no Asaas e marca cancelada)
  insert into public.cobrancas_mimo (salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano, valor_cents, total_cents, metodo, vencimento, status, cobranca_id, cancelar_em, atualizado_em)
  values (sid, 'renovacao', hoje - 5, hoje + 25, 1, 'pro', 4990, 4990, 'pix', hoje - 4, 'aguardando', 'pay_E', hoje - 1, now());
  if not exists (select 1 from public.cobrancas_mimo_para_cuidar(50) x where x.cobranca_id = 'pay_E') then raise exception 'I'; end if;
  raise notice 'I passou do prazo: vai para a função cancelar';

  -- K. no teste, 3 dias antes do fim, a primeira mensalidade fica pronta
  delete from public.cobrancas_mimo where salon_id = sid;
  update public.assinaturas set situacao = 'teste', teste_ate = now() + interval '2 days', pago_ate = null where salon_id = sid;
  n := public.cuidar_das_assinaturas();
  if (select count(*) from public.cobrancas_mimo where salon_id = sid and status = 'a_criar' and vencimento = ((now() + interval '2 days') at time zone 'America/Sao_Paulo')::date) <> 1 then raise exception 'K'; end if;
  raise notice 'K teste acabando: mensalidade pronta para o dia X';

  -- L. quem cancelou a assinatura não ganha cobrança nova
  delete from public.cobrancas_mimo where salon_id = sid;
  update public.assinaturas set situacao = 'cancelada', teste_ate = null, pago_ate = now() + interval '3 days', cancelada_em = now() where salon_id = sid;
  n := public.cuidar_das_assinaturas();
  if exists (select 1 from public.cobrancas_mimo where salon_id = sid) then raise exception 'L'; end if;
  raise notice 'L cancelada: nada gerado';

  raise notice 'ensaio_cobranca_unica: tudo certo';
end $$;
rollback;
