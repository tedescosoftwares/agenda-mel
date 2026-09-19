-- 102 · O PDV do salão: comanda, caixa e o fechamento pelo balcão.
--
-- No computador do balcão, a dona abre o dia, puxa o horário da cliente
-- (ou começa uma comanda avulsa), acrescenta serviços, dá desconto,
-- registra como foi pago (dinheiro, débito, crédito, PIX na hora; o
-- sinal pago pelo app já entra abatido) e fecha. Fechar a comanda
-- conclui o atendimento na agenda, ajusta o valor e os itens, e deixa
-- o rastro no caixa. É esse rastro que, na fase B da parceria, vira o
-- demonstrativo de repasse por profissional.

-- 1. Tabelas -----------------------------------------------------------------------------------
create table if not exists public.comandas (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  client_id uuid references public.profiles (id) on delete set null,
  cliente_nome text,
  professional_id uuid references public.professionals (id) on delete set null,
  itens jsonb not null default '[]'::jsonb,        -- [{service_id, nome, preco_cents, qtd, duracao}]
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  desconto_cents integer not null default 0 check (desconto_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  sinal_app_cents integer not null default 0 check (sinal_app_cents >= 0),
  observacao text,
  status text not null default 'fechada' check (status in ('fechada', 'estornada')),
  fechada_em timestamptz not null default now(),
  por uuid references public.profiles (id) on delete set null
);
comment on table public.comandas is 'Uma venda fechada no PDV (102): itens, desconto, total e de quem foi o atendimento.';
create index if not exists comandas_salao_dia on public.comandas (salon_id, fechada_em desc);
create index if not exists comandas_prof on public.comandas (professional_id, fechada_em desc);
create unique index if not exists comandas_uma_por_agendamento on public.comandas (appointment_id) where appointment_id is not null and status = 'fechada';

create table if not exists public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons (id) on delete cascade,
  comanda_id uuid references public.comandas (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  professional_id uuid references public.professionals (id) on delete set null,
  forma text not null check (forma in ('dinheiro', 'debito', 'credito', 'pix', 'app', 'outro')),
  valor_cents integer not null,
  criado_em timestamptz not null default now(),
  por uuid references public.profiles (id) on delete set null
);
comment on table public.caixa_movimentos is 'Cada pagamento registrado no PDV (102), por forma. O sinal pelo app entra como forma = app.';
create index if not exists caixa_salao_dia on public.caixa_movimentos (salon_id, criado_em desc);

alter table public.comandas enable row level security;
alter table public.caixa_movimentos enable row level security;
drop policy if exists "comandas: a casa ve" on public.comandas;
create policy "comandas: a casa ve" on public.comandas for select to authenticated
  using (public.is_admin_do_salao(salon_id) or public.eh_plataforma()
         or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = auth.uid()));
drop policy if exists "caixa: a casa ve" on public.caixa_movimentos;
create policy "caixa: a casa ve" on public.caixa_movimentos for select to authenticated
  using (public.is_admin_do_salao(salon_id) or public.eh_plataforma()
         or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = auth.uid()));
grant select on public.comandas, public.caixa_movimentos to authenticated;
-- escrita só pelas funções abaixo

-- 2. Fechar a comanda ---------------------------------------------------------------------------
-- `comanda` = {appointment_id?, client_id?, cliente_nome?, professional_id,
--   itens: [{service_id?, nome, preco_cents, qtd?, duracao?}], desconto_cents?,
--   pagamentos: [{forma, valor_cents}], observacao?}
create or replace function public.pdv_fechar(salao uuid, comanda jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  prof public.professionals%rowtype;
  appt uuid; cli uuid; nome text; obs text;
  itens jsonb; pagos jsonb; it jsonb; pg jsonb;
  subtotal integer := 0; desconto integer; total integer; sinal integer := 0; pago integer := 0;
  duracao integer := 0; agora timestamp := public.agora_local();
  nova uuid; primeiro uuid; i integer := 0; fim_av timestamp; dur_av interval; ult timestamp;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão fecha comanda.'; end if;
  itens := coalesce(comanda -> 'itens', '[]'::jsonb);
  pagos := coalesce(comanda -> 'pagamentos', '[]'::jsonb);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then raise exception 'A comanda está vazia.'; end if;
  begin appt := nullif(comanda ->> 'appointment_id', '')::uuid; exception when others then appt := null; end;
  begin cli := nullif(comanda ->> 'client_id', '')::uuid; exception when others then cli := null; end;
  nome := nullif(btrim(coalesce(comanda ->> 'cliente_nome', '')), '');
  obs := nullif(btrim(coalesce(comanda ->> 'observacao', '')), '');
  desconto := greatest(0, coalesce((comanda ->> 'desconto_cents')::integer, 0));

  select * into prof from public.professionals p where p.id = nullif(comanda ->> 'professional_id', '')::uuid and p.salon_id = salao;
  if prof.id is null then raise exception 'Diga qual profissional atendeu.'; end if;

  for it in select * from jsonb_array_elements(itens) loop
    if coalesce(it ->> 'nome', '') = '' then raise exception 'Item sem nome.'; end if;
    subtotal := subtotal + coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    duracao := duracao + coalesce((it ->> 'duracao')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    if primeiro is null then begin primeiro := nullif(it ->> 'service_id', '')::uuid; exception when others then primeiro := null; end; end if;
  end loop;
  if desconto > subtotal then raise exception 'O desconto é maior que a comanda.'; end if;
  total := subtotal - desconto;

  if appt is not null then
    select * into a from public.appointments where id = appt;
    if a.id is null or a.salon_id <> salao then raise exception 'Horário não encontrado neste salão.'; end if;
    if a.status not in ('pendente', 'confirmado') then raise exception 'Este horário não está esperando fechamento (%).', a.status; end if;
    if exists (select 1 from public.comandas c where c.appointment_id = appt and c.status = 'fechada') then raise exception 'Este horário já tem comanda fechada.'; end if;
    sinal := coalesce(a.pago_cents, 0);
    cli := coalesce(cli, a.client_id);
    nome := coalesce(nome, a.guest_name);
  end if;
  if cli is null and nome is null then raise exception 'Diga quem é a cliente (ou o nome, se for avulsa).'; end if;

  for pg in select * from jsonb_array_elements(pagos) loop
    if coalesce(pg ->> 'forma', '') not in ('dinheiro', 'debito', 'credito', 'pix', 'outro') then raise exception 'Forma de pagamento desconhecida: %', pg ->> 'forma'; end if;
    pago := pago + coalesce((pg ->> 'valor_cents')::integer, 0);
  end loop;
  if pago + sinal <> total then
    raise exception 'Os pagamentos (R$ %) não fecham com o total (R$ %).', to_char((pago + sinal) / 100.0, 'FM999G990D00'), to_char(total / 100.0, 'FM999G990D00');
  end if;

  if appt is not null then
    -- a cliente veio antes da hora: o horário começa agora, para a regra de "só conclui depois de começar"
    if (a.date + a.start_time) > agora then
      update public.appointments set start_time = agora::time where id = appt;
    end if;
    delete from public.appointment_services where appointment_id = appt;
    for it in select * from jsonb_array_elements(itens) loop
      i := i + 1;
      insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
      values (appt, (case when coalesce(it ->> 'service_id', '') = '' then null else (it ->> 'service_id')::uuid end), it ->> 'nome',
              coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1)), coalesce((it ->> 'duracao')::integer, 0), i);
    end loop;
    update public.appointments
       set status = 'concluido', baixa_por = 'salao', price_cents = total, desconto_cents = desconto,
           service_name = case when jsonb_array_length(itens) > 1 then (itens -> 0 ->> 'nome') || ' + ' || (jsonb_array_length(itens) - 1) || ' mais' else itens -> 0 ->> 'nome' end
     where id = appt;
    nova := appt;
  else
    -- avulsa: o atendimento nasce já concluído, na última brecha da agenda da
    -- profissional que termina agora (ou antes, se ela está com alguém)
    fim_av := agora; dur_av := make_interval(mins => greatest(duracao, 15));
    for i in 1..20 loop
      select min(x.date + x.start_time) into ult from public.appointments x
       where x.professional_id = prof.id and x.date = agora::date and x.status not in ('cancelado', 'faltou')
         and (x.date + x.start_time) < fim_av and (x.date + x.end_time) > fim_av - dur_av;
      exit when ult is null;
      fim_av := ult;
      if fim_av - dur_av < agora::date + time '00:01' then dur_av := interval '1 minute'; end if;
      if fim_av <= agora::date + time '00:01' then raise exception 'Não há brecha na agenda de hoje desta profissional para registrar uma avulsa.'; end if;
    end loop;
    insert into public.appointments (client_id, guest_name, professional_id, service_id, salon_id, date, start_time, end_time, status, baixa_por, price_cents, desconto_cents, service_name)
    values (cli, case when cli is null then nome else null end, prof.id, primeiro, salao, agora::date,
            (fim_av - dur_av)::time, fim_av::time, 'confirmado', 'salao', total, desconto,
            case when jsonb_array_length(itens) > 1 then (itens -> 0 ->> 'nome') || ' + ' || (jsonb_array_length(itens) - 1) || ' mais' else itens -> 0 ->> 'nome' end)
    returning id into nova;
    i := 0;
    for it in select * from jsonb_array_elements(itens) loop
      i := i + 1;
      insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
      values (nova, (case when coalesce(it ->> 'service_id', '') = '' then null else (it ->> 'service_id')::uuid end), it ->> 'nome',
              coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1)), coalesce((it ->> 'duracao')::integer, 0), i);
    end loop;
    update public.appointments set status = 'concluido' where id = nova;
  end if;

  insert into public.comandas (salon_id, appointment_id, client_id, cliente_nome, professional_id, itens, subtotal_cents, desconto_cents, total_cents, sinal_app_cents, observacao, por)
  values (salao, nova, cli, nome, prof.id, itens, subtotal, desconto, total, sinal, obs, auth.uid())
  returning id into primeiro;
  if sinal > 0 then
    insert into public.caixa_movimentos (salon_id, comanda_id, appointment_id, professional_id, forma, valor_cents, por)
    values (salao, primeiro, nova, prof.id, 'app', sinal, auth.uid());
  end if;
  for pg in select * from jsonb_array_elements(pagos) loop
    if coalesce((pg ->> 'valor_cents')::integer, 0) <> 0 then
      insert into public.caixa_movimentos (salon_id, comanda_id, appointment_id, professional_id, forma, valor_cents, por)
      values (salao, primeiro, nova, prof.id, pg ->> 'forma', (pg ->> 'valor_cents')::integer, auth.uid());
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'comanda_id', primeiro, 'appointment_id', nova, 'total_cents', total, 'sinal_app_cents', sinal);
end;
$$;
revoke execute on function public.pdv_fechar(uuid, jsonb) from public, anon;
grant execute on function public.pdv_fechar(uuid, jsonb) to authenticated;

-- desfazer uma comanda fechada por engano (mesmo dia): o caixa é estornado e o horário volta a confirmado
create or replace function public.pdv_estornar(comanda uuid, motivo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.comandas%rowtype;
begin
  select * into c from public.comandas where id = comanda;
  if c.id is null then raise exception 'Comanda não encontrada.'; end if;
  if not public.is_admin_do_salao(c.salon_id) then raise exception 'Só a dona do salão estorna.'; end if;
  if c.status <> 'fechada' then raise exception 'Esta comanda já foi estornada.'; end if;
  if c.fechada_em < now() - interval '36 hours' then raise exception 'Passou o prazo para estornar por aqui. Fale com a plataforma.'; end if;
  update public.comandas set status = 'estornada', observacao = concat_ws(' · ', observacao, 'estornada: ' || coalesce(motivo, 'sem motivo')) where id = comanda;
  insert into public.caixa_movimentos (salon_id, comanda_id, appointment_id, professional_id, forma, valor_cents, por)
  select m.salon_id, m.comanda_id, m.appointment_id, m.professional_id, m.forma, -m.valor_cents, auth.uid()
  from public.caixa_movimentos m where m.comanda_id = comanda and m.valor_cents > 0;
  if c.appointment_id is not null then
    update public.appointments set status = 'confirmado', baixa_por = null where id = c.appointment_id and status = 'concluido';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.pdv_estornar(uuid, text) from public, anon;
grant execute on function public.pdv_estornar(uuid, text) to authenticated;

-- 3. O dia do PDV ---------------------------------------------------------------------------------
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
        'comanda_id', (select c.id from public.comandas c where c.appointment_id = a.id and c.status = 'fechada' limit 1)
      ) order by a.start_time), '[]'::jsonb)
      from public.appointments a
      left join public.profiles pf on pf.id = a.client_id
      left join public.professionals p on p.id = a.professional_id
      left join public.services sv on sv.id = a.service_id
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
