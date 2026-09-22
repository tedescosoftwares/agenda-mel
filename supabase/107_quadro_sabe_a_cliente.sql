-- 107 · O quadro sabe quem é a cliente, e o atendimento cresce sem virar outro.
--
-- 1. pdv_dia traz, em cada horário, o resumo da cliente na casa: quantos
--    atendimentos já fez (ou primeira vez), quem é a preferida dela e a
--    última visita. A recepção enxerga "prefere a Camila, está com a Ana"
--    e troca de coluna com critério.
-- 2. adicionar_servico_ao_horario: ela está na cadeira e resolve fazer
--    mais uma coisa. O serviço entra no mesmo horário (itens e valor), o
--    fim estica se couber, e a comanda fecha uma só.
create or replace function public.pdv_dia(salao uuid, dia date default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare d date := coalesce(dia, public.agora_local()::date); r jsonb;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Sem permissão.'; end if;
  select jsonb_build_object(
    'dia', d,
    'agenda', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'start_time', a.start_time, 'end_time', a.end_time, 'status', a.status,
        'client_id', a.client_id, 'cliente', coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'Cliente'),
        'telefone', coalesce(pf.phone, a.guest_phone),
        'professional_id', a.professional_id, 'profissional', p.name,
        'servico', coalesce(a.service_name, sv.name), 'price_cents', a.price_cents, 'pago_cents', coalesce(a.pago_cents, 0),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('service_id', s2.service_id, 'nome', s2.name, 'preco_cents', s2.price_cents, 'duracao', s2.duration_minutes, 'qtd', 1) order by s2.ordem), '[]'::jsonb)
                  from public.appointment_services s2 where s2.appointment_id = a.id),
        'comanda_id', (select c.id from public.comandas c where c.appointment_id = a.id and c.status = 'fechada' limit 1),
        -- a cliente na casa
        'atendimentos', (select count(*) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'concluido' and x.id <> a.id),
        'ultima_visita', (select max(x.date) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'concluido' and x.id <> a.id),
        'faltas', (select count(*) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'faltou'),
        'preferida_id', pp.professional_id, 'preferida', pr.name
      ) order by a.start_time), '[]'::jsonb)
      from public.appointments a
      left join public.profiles pf on pf.id = a.client_id
      left join public.professionals p on p.id = a.professional_id
      left join public.services sv on sv.id = a.service_id
      left join public.profissional_preferida pp on pp.client_id = a.client_id and pp.salon_id = salao
      left join public.professionals pr on pr.id = pp.professional_id
      where a.salon_id = salao and a.date = d and a.status <> 'cancelado'),
    'comandas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'fechada_em', c.fechada_em, 'cliente', coalesce(nullif(btrim(pf.full_name), ''), c.cliente_nome, 'Cliente'),
        'profissional', p.name, 'professional_id', c.professional_id, 'total_cents', c.total_cents, 'desconto_cents', c.desconto_cents,
        'sinal_app_cents', c.sinal_app_cents, 'status', c.status, 'itens', c.itens, 'appointment_id', c.appointment_id,
        'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('forma', m.forma, 'valor_cents', m.valor_cents)), '[]'::jsonb) from public.caixa_movimentos m where m.comanda_id = c.id and m.valor_cents > 0)
      ) order by c.fechada_em desc), '[]'::jsonb)
      from public.comandas c
      left join public.profiles pf on pf.id = c.client_id
      left join public.professionals p on p.id = c.professional_id
      where c.salon_id = salao and (c.fechada_em at time zone 'America/Sao_Paulo')::date = d),
    'caixa', (select jsonb_build_object(
        'total_cents', coalesce(sum(m.valor_cents), 0),
        'balcao_cents', coalesce(sum(m.valor_cents) filter (where m.forma <> 'app'), 0),
        'app_cents', coalesce(sum(m.valor_cents) filter (where m.forma = 'app'), 0),
        'por_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', x.forma, 'valor_cents', x.v) order by x.v desc), '[]'::jsonb)
                      from (select m2.forma, sum(m2.valor_cents) v from public.caixa_movimentos m2 where m2.salon_id = salao and (m2.criado_em at time zone 'America/Sao_Paulo')::date = d group by m2.forma) x),
        'por_profissional', (select coalesce(jsonb_agg(jsonb_build_object('professional_id', y.pid, 'nome', y.nome, 'valor_cents', y.v, 'comandas', y.n) order by y.v desc), '[]'::jsonb)
                      from (select c2.professional_id pid, p2.name nome, sum(c2.total_cents) v, count(*) n
                            from public.comandas c2 left join public.professionals p2 on p2.id = c2.professional_id
                            where c2.salon_id = salao and c2.status = 'fechada' and (c2.fechada_em at time zone 'America/Sao_Paulo')::date = d group by c2.professional_id, p2.name) y))
      from public.caixa_movimentos m where m.salon_id = salao and (m.criado_em at time zone 'America/Sao_Paulo')::date = d)
  ) into r;
  return r;
end;
$$;
revoke execute on function public.pdv_dia(uuid, date) from public, anon;
grant execute on function public.pdv_dia(uuid, date) to authenticated;

-- 2. mais um serviço no mesmo atendimento --------------------------------------------------------
create or replace function public.adicionar_servico_ao_horario(appt uuid, servico uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; s public.services%rowtype; n integer; preco integer; novo_fim time; esticou boolean := true;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null then raise exception 'Horário não encontrado.'; end if;
  if not (public.is_admin_do_salao(a.salon_id) or public.is_professional(a.professional_id)) then raise exception 'Sem permissão.'; end if;
  if a.status not in ('pendente', 'confirmado') then raise exception 'Este horário não aceita mais serviço (%).', a.status; end if;
  if exists (select 1 from public.comandas c where c.appointment_id = appt and c.status = 'fechada') then raise exception 'A comanda deste horário já foi fechada.'; end if;
  select * into s from public.services where id = servico and salon_id = a.salon_id and active;
  if s.id is null then raise exception 'Serviço não encontrado neste salão.'; end if;
  preco := round(s.price * 100)::integer;

  -- se o horário nasceu com um serviço só (sem itens), o primeiro item é ele
  if not exists (select 1 from public.appointment_services x where x.appointment_id = appt) then
    insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
    select appt, a.service_id, coalesce(a.service_name, sv.name, 'Atendimento'), coalesce(a.price_cents, round(sv.price * 100)::integer, 0), coalesce(sv.duration_minutes, 0), 1
    from public.services sv where sv.id = a.service_id;
  end if;
  select coalesce(max(ordem), 0) + 1 into n from public.appointment_services where appointment_id = appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  values (appt, s.id, s.name, preco, s.duration_minutes, n);

  novo_fim := least(a.end_time + make_interval(mins => s.duration_minutes), time '23:59');
  perform public.silenciar_gatilho();
  begin
    update public.appointments
       set end_time = novo_fim, price_cents = coalesce(price_cents, 0) + preco,
           service_name = coalesce(a.service_name, (select sv.name from public.services sv where sv.id = a.service_id)) || ' + ' || s.name
     where id = appt;
  exception when exclusion_violation then
    -- o próximo horário da profissional começa antes: o serviço entra, o fim fica
    esticou := false;
    update public.appointments
       set price_cents = coalesce(price_cents, 0) + preco,
           service_name = coalesce(a.service_name, (select sv.name from public.services sv where sv.id = a.service_id)) || ' + ' || s.name
     where id = appt;
  end;
  return jsonb_build_object('ok', true, 'esticou', esticou, 'fim', case when esticou then novo_fim else a.end_time end, 'price_cents', coalesce(a.price_cents, 0) + preco);
end;
$$;
revoke execute on function public.adicionar_servico_ao_horario(uuid, uuid) from public, anon;
grant execute on function public.adicionar_servico_ao_horario(uuid, uuid) to authenticated;
