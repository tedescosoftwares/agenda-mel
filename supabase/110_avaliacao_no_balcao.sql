-- 110: a avaliação da cliente chega ao balcão. O cartão do quadro e a
-- linha do tempo mostram a nota (e o comentário) que ela deu àquele
-- atendimento; e a avaliação nova sai ao vivo pelo Realtime, filtrada
-- por salão (reviews ganha salon_id, preenchido por gatilho).

-- 1. reviews sabe o salão --------------------------------------------------
alter table public.reviews add column if not exists salon_id uuid references public.salons (id) on delete set null;
update public.reviews r set salon_id = a.salon_id from public.appointments a where a.id = r.appointment_id and r.salon_id is null;
create index if not exists reviews_salao_em on public.reviews (salon_id, created_at desc);

create or replace function public.reviews_salao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.salon_id is null then select a.salon_id into new.salon_id from public.appointments a where a.id = new.appointment_id; end if;
  return new;
end;
$$;
drop trigger if exists reviews_salao_tg on public.reviews;
create trigger reviews_salao_tg before insert or update of appointment_id on public.reviews for each row execute function public.reviews_salao();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews') then
    alter publication supabase_realtime add table public.reviews;
  end if;
exception when undefined_object then null;
end $$;
alter table public.reviews replica identity full;

-- 2. pdv_dia: cada horário traz a avaliação, se houver -------------------
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
        'comanda_id', (select c.id from public.comandas c where c.status = 'fechada' and (c.appointment_id = a.id or a.id = any(c.appointment_ids)) limit 1),
        'atendimentos', (select count(*) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'concluido' and x.id <> a.id),
        'ultima_visita', (select max(x.date) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'concluido' and x.id <> a.id),
        'faltas', (select count(*) from public.appointments x where x.client_id = a.client_id and x.salon_id = salao and x.status = 'faltou'),
        'preferida_id', pp.professional_id, 'preferida', pr.name,
        'avaliacao', (select jsonb_build_object('nota', r.nota, 'comentario', nullif(btrim(coalesce(r.comentario, '')), ''), 'em', r.created_at) from public.reviews r where r.appointment_id = a.id limit 1)
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
        'profissional', coalesce(c.atendida_por, p.name), 'professional_id', c.professional_id, 'total_cents', c.total_cents, 'desconto_cents', c.desconto_cents,
        'sinal_app_cents', c.sinal_app_cents, 'status', c.status, 'itens', c.itens, 'appointment_id', c.appointment_id, 'appointment_ids', to_jsonb(c.appointment_ids),
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
                      from (select coalesce((e.value ->> 'professional_id')::uuid, c2.professional_id) pid,
                                   coalesce(e.value ->> 'profissional', p2.name) nome,
                                   sum(coalesce((e.value ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((e.value ->> 'qtd')::integer, 1))) v,
                                   count(distinct c2.id) n
                            from public.comandas c2
                            cross join lateral jsonb_array_elements(c2.itens) e
                            left join public.professionals p2 on p2.id = coalesce((e.value ->> 'professional_id')::uuid, c2.professional_id)
                            where c2.salon_id = salao and c2.status = 'fechada' and (c2.fechada_em at time zone 'America/Sao_Paulo')::date = d
                            group by 1, 2) y))
      from public.caixa_movimentos m where m.salon_id = salao and (m.criado_em at time zone 'America/Sao_Paulo')::date = d)
  ) into r;
  return r;
end;
$$;

-- 3. pdv_historico: a linha do tempo traz o comentário --------------------
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
        'avaliacao', (select r.nota from public.reviews r where r.appointment_id = a.id limit 1),
        'comentario', (select nullif(btrim(coalesce(r.comentario, '')), '') from public.reviews r where r.appointment_id = a.id limit 1)
      ) order by a.date desc, a.start_time desc)
     from (select * from public.appointments x where x.salon_id = salao and x.client_id = cliente and x.status <> 'cancelado' order by x.date desc, x.start_time desc limit greatest(1, least(limite, 200))) a
     left join public.services sv on sv.id = a.service_id
     left join public.professionals p on p.id = a.professional_id), '[]'::jsonb)
  else '[]'::jsonb end;
$$;
