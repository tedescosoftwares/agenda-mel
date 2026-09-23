-- Enche a agenda de amanhã de todas as profissionais ativas com horários
-- aleatórios, pra ver o quadro cheio. Só pra teste: usa clientes que já
-- existem, serviços que cada profissional faz e o expediente dela (ou o
-- do salão). Não manda aviso nenhum. Rode no SQL Editor do Supabase.
--
-- Ajustes no topo do bloco: qual salão (null = todos), que dia, e a
-- ocupação (0.75 = três quartos do expediente ocupado).
do $$
declare
  salao_alvo uuid := null;                       -- ex.: '9b1e0a24-…'::uuid; null = todos os salões ativos
  dia date := current_date + 1;                  -- amanhã
  ocupacao numeric := 0.75;
  sal record; prof record; cli uuid; svc record; ini time; fim time; cursor_ time; dur integer; st text; sinal integer; appt uuid; criados integer := 0; pulados integer := 0;
  clientes uuid[]; wd integer := extract(dow from (current_date + 1))::integer;
begin
  perform public.silenciar_gatilho();
  wd := extract(dow from dia)::integer;
  for sal in select s.* from public.salons s where s.active and (salao_alvo is null or s.id = salao_alvo) loop
    -- as clientes da casa (quem já marcou aqui); sem nenhuma, qualquer cliente
    select coalesce(array_agg(distinct a.client_id), '{}') into clientes from public.appointments a where a.salon_id = sal.id and a.client_id is not null;
    if coalesce(array_length(clientes, 1), 0) < 3 then
      select coalesce(array_agg(p.id), '{}') into clientes from (select id from public.profiles where role = 'cliente' order by random() limit 40) p;
    end if;
    if coalesce(array_length(clientes, 1), 0) = 0 then raise notice 'salão % sem clientes, pulei', sal.name; continue; end if;

    for prof in select p.* from public.professionals p where p.salon_id = sal.id and p.active loop
      -- expediente: o da profissional, senão o do salão, senão 9–18
      select h.start_time, h.end_time into ini, fim from public.professional_hours h where h.professional_id = prof.id and h.weekday = wd and h.open;
      if ini is null then select h.start_time, h.end_time into ini, fim from public.business_hours h where h.salon_id = sal.id and h.weekday = wd and h.open; end if;
      if ini is null then ini := time '09:00'; fim := time '18:00'; end if;
      cursor_ := ini;
      while cursor_ < fim loop
        -- serviço aleatório que ela faz (senão qualquer ativo do salão)
        select s.* into svc from public.services s join public.professional_services ps on ps.service_id = s.id and ps.professional_id = prof.id where s.salon_id = sal.id and s.active order by random() limit 1;
        if svc.id is null then select s.* into svc from public.services s where s.salon_id = sal.id and s.active order by random() limit 1; end if;
        if svc.id is null then exit; end if;
        dur := greatest(15, coalesce(svc.duration_minutes, 45));
        -- ocupa ou deixa um buraco (múltiplo de 15 min)
        if random() > ocupacao then
          cursor_ := cursor_ + make_interval(mins => 15 * (1 + floor(random() * 3)::integer));
          continue;
        end if;
        if cursor_ + make_interval(mins => dur) > fim then exit; end if;
        cli := clientes[1 + floor(random() * array_length(clientes, 1))::integer];
        st := case when random() < 0.75 then 'confirmado' else 'pendente' end;
        sinal := case when st = 'confirmado' and random() < 0.4 then round(coalesce(svc.price, 0) * 100 * 0.5)::integer else 0 end;
        begin
          insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, date, start_time, end_time, status, pago_cents, notes)
          values (cli, prof.id, svc.id, svc.name, round(coalesce(svc.price, 0) * 100)::integer, sal.id, dia, cursor_, cursor_ + make_interval(mins => dur), st, sinal, 'teste: agenda cheia')
          returning id into appt;
          insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
          values (appt, svc.id, svc.name, round(coalesce(svc.price, 0) * 100)::integer, dur, 1);
          criados := criados + 1;
        exception when others then
          pulados := pulados + 1;   -- já tinha horário ali (ou a cliente está em outro lugar): segue
        end;
        cursor_ := cursor_ + make_interval(mins => dur) + make_interval(mins => 15 * floor(random() * 2)::integer);
      end loop;
    end loop;
  end loop;
  raise notice 'pronto: % horários criados em %, % pulados por choque', criados, dia, pulados;
end $$;

-- Pra desfazer depois (só o que este script criou):
-- delete from public.appointments where notes = 'teste: agenda cheia';
