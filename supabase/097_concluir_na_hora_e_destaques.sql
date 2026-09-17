-- 097 · Concluir só depois que o horário começou; todos os destaques
--
-- Duas coisas que a dona pediu:
--
-- 1. "Concluir" aparecia assim que o horário era marcado, mesmo faltando
--    uma semana. Um toque errado e o atendimento virava concluído antes
--    de acontecer — com indicação creditada, convite de avaliação, tudo.
--    Agora só dá para concluir depois que o horário COMEÇOU. A tela
--    esconde o botão; aqui o banco recusa mesmo assim, nas duas portas:
--    o update direto (valida_status_agendamento) e a baixa do fim do dia
--    (dar_baixa com 'veio'). As rotinas do sistema
--    (concluir_atendimentos_passados) rodam depois do horário e como
--    postgres: não passam por esta guarda.
--
--    De quebra: a 090 recriou valida_status_agendamento como SECURITY
--    DEFINER, e dentro de uma função assim current_user é o dono
--    (postgres), não quem chamou. A primeira linha ("se não é
--    authenticated/anon, devolve new") valia para todo mundo, e a
--    validação estava desligada desde então — uma cliente conseguia
--    concluir o próprio horário. Volta a ser SECURITY INVOKER, como na
--    022; as funções que ela consulta (is_admin, is_professional,
--    meu_id, agora_local) já são definer e liberadas para authenticated.
--
-- 2. Nem todos os serviços em destaque apareciam na home da cliente.
--    destaques_para_mim cortava em 12 e só olhava os vínculos: quem
--    marcou com uma profissional, favoritou, ou é da própria equipe do
--    salão e não tinha vínculo não via nada. Agora os salões são os
--    mesmos das promoções (vínculo, favoritas, agendamentos, equipe,
--    dona), e o limite é folgado (60): a fileira rola.

-- 1. Concluir só depois que começou ------------------------------------------------
create or replace function public.valida_status_agendamento()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- escrita nascida dentro de uma função do servidor (SECURITY DEFINER)
  -- ou vinda do service_role: já foi validada lá dentro
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not (public.is_admin() or public.is_admin_do_salao(new.salon_id) or public.is_professional(new.professional_id)) then
      if new.status <> 'pendente' then
        raise exception 'Um agendamento novo começa como pendente';
      end if;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    -- vale para todo mundo, profissional e admin inclusive: antes do
    -- horário começar ainda dá para cancelar, concluir não
    if new.status = 'concluido' and (old.date + old.start_time) > public.agora_local() then
      raise exception 'Só dá para concluir depois que o horário começou.';
    end if;

    -- a profissional do horário, a dona do salão (dona ou admin do salão) ou a plataforma
    if public.is_admin() or public.is_admin_do_salao(old.salon_id) or public.is_professional(old.professional_id) then
      return new;
    end if;

    if old.client_id = public.meu_id() then
      if new.status <> 'cancelado' then
        raise exception 'Você só pode cancelar o seu agendamento';
      end if;
      if old.status not in ('pendente', 'confirmado', 'aguardando_pagamento') then
        raise exception 'Este agendamento não pode mais ser cancelado';
      end if;
      return new;
    end if;

    raise exception 'Sem permissão para alterar este agendamento';
  end if;

  return new;
end;
$$;
revoke execute on function public.valida_status_agendamento() from public, anon, authenticated;

-- a baixa do fim do dia: 'veio' também só depois que começou
create or replace function public.dar_baixa(appt uuid, resultado text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; troca public.appointments%rowtype; quem text;
begin
  if resultado not in ('veio', 'nao_veio') then raise exception 'Resultado desconhecido.'; end if;
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)) then raise exception 'Sem permissão.'; end if;
  quem := case when public.is_professional(a.professional_id) then 'profissional' else 'salao' end;
  select * into troca from public.appointments t where t.remarca_de = appt and t.status = 'pendente' limit 1;

  if a.status = 'confirmado' then
    if resultado = 'veio' then
      if (a.date + a.start_time) > public.agora_local() then raise exception 'Só dá para concluir depois que o horário começou.'; end if;
      if troca.id is not null then
        -- ela veio: a troca perdeu o sentido
        update public.aceites set resultado = 'recusado', resolvido_em = now() where appointment_id = troca.id and resultado is null;
        perform public.silenciar_gatilho();
        update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'veio_no_horario_original' where id = troca.id;
      end if;
      update public.appointments set status = 'concluido', baixa_por = quem where id = appt;
      return jsonb_build_object('ok', true, 'status', 'concluido');
    else
      if troca.id is not null then
        -- ela tinha pedido para trocar e ninguém respondeu: não é falta dela
        perform public.vencer_aceite(troca.id);
        return jsonb_build_object('ok', true, 'status', 'cancelado', 'motivo', 'troca_sem_resposta');
      end if;
      update public.appointments set status = 'faltou', baixa_por = quem where id = appt;
      return jsonb_build_object('ok', true, 'status', 'faltou');
    end if;
  end if;

  if a.status = 'concluido' and resultado = 'nao_veio' then
    if a.baixa_por is distinct from 'sistema' then raise exception 'Este atendimento foi concluído por você. Para desfazer, fale com a plataforma.'; end if;
    if (a.date + a.end_time) < public.agora_local() - interval '72 hours' then raise exception 'Passaram mais de 3 dias. Fale com a plataforma.'; end if;
    if exists (select 1 from public.reviews r where r.appointment_id = appt) then raise exception 'A cliente já avaliou este atendimento.'; end if;
    if exists (select 1 from public.referrals r where r.appointment_id = appt and r.status = 'creditada') then
      raise exception 'Este atendimento creditou uma indicação. Fale com a plataforma para reverter.';
    end if;
    update public.appointments set status = 'faltou', baixa_por = quem where id = appt;
    return jsonb_build_object('ok', true, 'status', 'faltou');
  end if;

  raise exception 'Este atendimento não está esperando baixa.';
end;
$$;
revoke execute on function public.dar_baixa(uuid, text) from public, anon;
grant execute on function public.dar_baixa(uuid, text) to authenticated;

-- 2. Os destaques da home, todos ---------------------------------------------------
-- os salões da cliente são os mesmos que promocoes_visiveis_para usa,
-- mais a própria casa de quem é da equipe (a dona testa como cliente)
create or replace function public.destaques_para_mim()
returns table (id uuid, name text, price numeric, duration_minutes integer, images text[], is_combo boolean, salon_id uuid, salao text, quem jsonb)
language sql
stable
security definer set search_path = public
as $$
  with eu as (select auth.uid() as id),
  minhas_profs as (
    select f.professional_id from public.client_favorites f, eu where f.client_id = eu.id
    union
    select a.professional_id from public.appointments a, eu where a.client_id = eu.id and a.professional_id is not null
    union
    select v.trazida_por from public.vinculos v, eu where v.client_id = eu.id and v.saiu_em is null and v.trazida_por is not null
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v, eu where v.client_id = eu.id and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id where p.salon_id is not null
    union
    select p.salon_id from public.professionals p, eu where p.user_id = eu.id and p.salon_id is not null
    union
    select s.id from public.salons s, eu where s.owner_id = eu.id
  )
  select sv.id, sv.name, sv.price, sv.duration_minutes, sv.images, sv.is_combo, sv.salon_id, s.name,
         (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
            from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active
           where ps.service_id = sv.id)
  from public.services sv
  join public.salons s on s.id = sv.salon_id and s.active
  where sv.active and sv.destaque
    and sv.salon_id in (select ms.salon_id from meus_saloes ms)
  order by s.name, sv.name
  limit 60;
$$;
revoke execute on function public.destaques_para_mim() from public, anon;
grant execute on function public.destaques_para_mim() to authenticated;
