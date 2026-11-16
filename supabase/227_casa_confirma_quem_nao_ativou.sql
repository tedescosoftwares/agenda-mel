-- 227 · A casa confirma por quem ainda não ativou o acesso (3.82)
--
-- A profissional que o salão cadastra já entra na agenda (situação 'configurada': active, a cliente marca com ela)
-- antes de abrir o e-mail de acesso e criar a senha. No modo de aceite 'profissional', o pedido de horário só
-- avisava ela, e quem ainda não ativou não vê nada: o pedido ficava sem resposta até o prazo. Agora, enquanto ela
-- não tem conta (user_id vazio), o pedido também chega para quem manda no salão, que já podia responder por ela
-- (responder_pedido aceita o admin do salão). No modo 'casa', igual à 111.

create or replace function public.aceites_avisa_a_casa()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; a public.appointments%rowtype; res record; nome_cli text; conta_prof uuid; adm uuid; por_ela boolean;
begin
  select * into s from public.salons where id = new.salon_id;
  select user_id into conta_prof from public.professionals where id = new.professional_id;
  -- no modo 'profissional', a casa só entra quando ela ainda não ativou o acesso
  por_ela := s.aceite_modo = 'profissional' and conta_prof is null;
  if s.aceite_modo <> 'casa' and not por_ela then return new; end if;
  select * into a from public.appointments where id = new.appointment_id;
  select * into res from public.resumo_do_agendamento(new.appointment_id);
  select nullif(btrim(pf.full_name), '') into nome_cli from public.profiles pf where pf.id = a.client_id;
  for adm in select m.user_id from public.salon_members m where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
    perform public.notificar(adm, 'pedido_de_aceite',
      case when a.remarca_de is not null then 'Pedido de troca de horário' else 'Pedido de horário' end,
      coalesce(nome_cli, 'Uma cliente') || ' quer ' || coalesce(res.servico, 'um atendimento') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '. '
        || case when por_ela then coalesce(split_part(res.profissional, ' ', 1), 'Ela') || ' ainda não ativou o acesso: confirme por ela em até ' else 'A casa confirma em até ' end
        || coalesce(greatest(1, round(extract(epoch from (new.expira_em - new.pedido_em)) / 60))::int, s.minutos_para_aceitar) || ' min.',
      '/admin/pdv',
      jsonb_build_object('appointment_id', new.appointment_id, 'professional_id', new.professional_id, 'pela_casa', true));
  end loop;
  return new;
end;
$$;
drop trigger if exists aceites_avisa_a_casa_tg on public.aceites;
create trigger aceites_avisa_a_casa_tg after insert on public.aceites for each row execute function public.aceites_avisa_a_casa();

do $$ begin raise notice '227: no aceite pela profissional, a casa confirma por quem ainda não ativou o acesso'; end $$;
