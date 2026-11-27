-- 275 · Atendimento de serviço "a combinar": o valor é informado ao concluir, ou depois (4.43)
--
-- Serviço sem preço (a cliente vê "a combinar") virava atendimento concluído de R$ 0: entrava assim no dia, no mês e
-- no repasse. Agora o app pergunta "quanto ficou?" na hora de concluir, deixa informar depois e lista o que ficou sem
-- valor. O valor mora onde sempre morou (appointments.price_cents); o que é novo:
--
--   appointments.cortesia          o R$ 0 foi de propósito (não fica pedindo valor para sempre)
--   informar_valor(appt, valor, cortesia)   quem atende ou quem manda no salão acerta o valor, antes ou depois de concluir
--   atendimentos_sem_valor(salao)  os concluídos dos últimos 60 dias sem valor, sem comanda e sem ser cortesia

alter table public.appointments add column if not exists cortesia boolean not null default false;

create or replace function public.informar_valor(appt uuid, valor_cents integer default null, cortesia_ boolean default false)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null or not (public.is_admin() or public.is_admin_do_salao(a.salon_id) or public.is_professional(a.professional_id)) then
    raise exception 'Atendimento não encontrado.';
  end if;
  if a.status in ('cancelado', 'faltou') then raise exception 'Esse horário não aconteceu: não tem valor para informar.'; end if;
  if exists (select 1 from public.comandas c where c.status = 'fechada' and (c.appointment_id = a.id or a.id = any(c.appointment_ids))) then
    raise exception 'Esse atendimento já foi fechado no caixa: o valor é o da comanda.';
  end if;
  if coalesce(cortesia_, false) then
    update public.appointments set price_cents = 0, cortesia = true where id = a.id;
    return jsonb_build_object('ok', true, 'cortesia', true);
  end if;
  if valor_cents is null or valor_cents <= 0 or valor_cents > 100000000 then raise exception 'Informe o valor cobrado.'; end if;
  if coalesce(a.pago_cents, 0) > valor_cents then raise exception 'O valor não pode ser menor que o sinal que a cliente já pagou.'; end if;
  update public.appointments set price_cents = valor_cents, cortesia = false where id = a.id;
  return jsonb_build_object('ok', true, 'price_cents', valor_cents);
end;
$$;
revoke execute on function public.informar_valor(uuid, integer, boolean) from public, anon;
grant execute on function public.informar_valor(uuid, integer, boolean) to authenticated;

create or replace function public.atendimentos_sem_valor(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Sem permissão.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.date, 'start_time', a.start_time,
             'cliente', coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'Cliente'),
             'servico', coalesce(a.service_name, sv.name), 'profissional', p.name, 'pago_cents', coalesce(a.pago_cents, 0))
             order by a.date desc, a.start_time desc)
      from public.appointments a
      left join public.profiles pf on pf.id = a.client_id
      left join public.professionals p on p.id = a.professional_id
      left join public.services sv on sv.id = a.service_id
     where a.salon_id = salao and a.status = 'concluido' and a.date >= (public.agora_local()::date - 60)
       and coalesce(a.price_cents, 0) = 0 and not a.cortesia
       and not exists (select 1 from public.comandas c where c.status = 'fechada' and (c.appointment_id = a.id or a.id = any(c.appointment_ids)))
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.atendimentos_sem_valor(uuid) from public, anon;
grant execute on function public.atendimentos_sem_valor(uuid) to authenticated;

notify pgrst, 'reload schema';
