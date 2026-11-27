-- 281 · Cancelar de uma vez os horários marcados de quem está saindo (4.55)
--
-- Ao desativar ou excluir uma profissional, o salão escolhe o que fazer com o que ela ainda tem na agenda: remarcar
-- (pela Agenda, um a um, para outra profissional ou outro dia) ou cancelar tudo de uma vez. O cancelamento é o mesmo
-- de sempre: cada cliente é avisada, e o sinal pago volta pelas regras de cancelamento da casa. Pedido ainda não
-- confirmado é recusado (a cliente recebe o aviso para escolher outro horário).

create or replace function public.equipe_cancelar_futuros(prof uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; a record; n integer := 0;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.manda_no_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  for a in
    select x.id, x.status from public.appointments x
     where x.professional_id = p.id and x.status in ('pendente', 'confirmado', 'aguardando_pagamento')
       and (x.date + x.start_time) > public.agora_local()
     order by x.date, x.start_time
  loop
    if a.status = 'pendente' then
      begin
        perform public.casa_decide(a.id, false);
      exception when others then
        update public.appointments set status = 'cancelado' where id = a.id and status = 'pendente';
      end;
    else
      update public.appointments set status = 'cancelado' where id = a.id;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cancelados', n);
end;
$$;
revoke execute on function public.equipe_cancelar_futuros(uuid) from public, anon;
grant execute on function public.equipe_cancelar_futuros(uuid) to authenticated;

notify pgrst, 'reload schema';
