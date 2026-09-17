-- 091 · DELETE com WHERE, porque o Supabase exige
--
-- A API do Supabase carrega a extensão safeupdate: DELETE e UPDATE sem
-- WHERE são recusados ("DELETE requires a WHERE clause"). A marcar_servicos
-- limpava a tabela temporária dos itens sem WHERE e caía na hora de
-- marcar. É a mesma função da 090, com "where true".

-- marcar: nasce aguardando quando o salão exige, ou quando ele aceita e a cliente quer
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
    pg := public.pagamento_do_salao(sal);
    if pg ->> 'modo' = 'obrigatorio' or (pg ->> 'modo' = 'opcional' and coalesce(pagar, false)) then
      st := 'aguardando_pagamento';
    end if;
  end if;

  begin
    insert into public.appointments
      (client_id, professional_id, service_id, service_name, price_cents, desconto_cents, date, start_time, end_time, notes, status)
    values
      (eu, prof, servicos[1], nomes, total_cents, total_desconto, dia, hora, (hora + make_interval(mins => total_min))::time, nullif(btrim(coalesce(obs, '')), ''), st)
    returning id into novo;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end;

  insert into public.appointment_services (appointment_id, service_id, name, price_cents, preco_cheio_cents, promocao_id, duration_minutes, ordem)
  select novo, i.service_id, i.name, i.cents, i.cheio, i.promocao_id, i.duration_minutes, i.ord
  from itens_do_pedido i order by i.ord;

  return jsonb_build_object('ok', true, 'appointment_id', novo, 'servicos', n, 'minutos', total_min, 'cents', total_cents, 'desconto_cents', total_desconto,
                            'pagar', st = 'aguardando_pagamento');
end;
$$;
grant execute on function public.marcar_servicos(uuid, uuid[], date, time, text, boolean) to authenticated;
