-- 104 · O PDV anda no tempo: a contagem por dia (para a faixa da semana)
-- e o histórico da cliente na casa (a linha do tempo no cartão).
create or replace function public.pdv_dias(salao uuid, de date, ate date)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when public.is_admin_do_salao(salao) or public.eh_plataforma() then
    coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'quantos', d.quantos, 'concluidos', d.concluidos, 'valor_cents', d.valor) order by d.dia)
     from (select g.dia,
                  count(a.id) filter (where a.status not in ('cancelado', 'faltou')) as quantos,
                  count(a.id) filter (where a.status = 'concluido') as concluidos,
                  coalesce(sum(a.price_cents) filter (where a.status = 'concluido'), 0) as valor
           from generate_series(de, least(ate, de + 62), interval '1 day') g(dia)
           left join public.appointments a on a.salon_id = salao and a.date = g.dia::date
           group by g.dia) d), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
revoke execute on function public.pdv_dias(uuid, date, date) from public, anon;
grant execute on function public.pdv_dias(uuid, date, date) to authenticated;

create or replace function public.pdv_historico(salao uuid, cliente uuid, limite integer default 40)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when public.is_admin_do_salao(salao) or public.eh_plataforma() then
    coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'dia', a.date, 'hora', a.start_time, 'status', a.status,
        'servico', coalesce(a.service_name, sv.name, 'Atendimento'), 'profissional', p.name,
        'price_cents', a.price_cents, 'pago_cents', coalesce(a.pago_cents, 0), 'desconto_cents', a.desconto_cents,
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', s2.name, 'preco_cents', s2.price_cents) order by s2.ordem), '[]'::jsonb) from public.appointment_services s2 where s2.appointment_id = a.id),
        'comanda', (select jsonb_build_object('total_cents', c.total_cents, 'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('forma', m.forma, 'valor_cents', m.valor_cents)), '[]'::jsonb) from public.caixa_movimentos m where m.comanda_id = c.id and m.valor_cents > 0))
                    from public.comandas c where c.appointment_id = a.id and c.status = 'fechada' limit 1),
        'avaliacao', (select r.nota from public.reviews r where r.appointment_id = a.id limit 1)
      ) order by a.date desc, a.start_time desc)
     from (select * from public.appointments x where x.salon_id = salao and x.client_id = cliente and x.status <> 'cancelado' order by x.date desc, x.start_time desc limit greatest(1, least(limite, 200))) a
     left join public.services sv on sv.id = a.service_id
     left join public.professionals p on p.id = a.professional_id), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
revoke execute on function public.pdv_historico(uuid, uuid, integer) from public, anon;
grant execute on function public.pdv_historico(uuid, uuid, integer) to authenticated;
