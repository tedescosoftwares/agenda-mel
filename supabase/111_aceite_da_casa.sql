-- 111: quem confirma o horário é a casa. Até aqui cada profissional
-- dizia se pede confirmação, em quantos minutos e o que acontece no
-- silêncio (038). Num salão isso é regra da casa: ou tudo entra
-- confirmado na hora, ou a casa confirma dentro de um prazo (e no
-- silêncio confirma ou cancela), ou cada profissional decide como hoje.
-- A regra do salão se propaga para as colunas das profissionais, então
-- todo o mecanismo de aceite (pedido, prazo, vencimento, WhatsApp)
-- continua o mesmo. E a casa pode decidir pelo quadro, na hora.

-- 1. A regra do salão ---------------------------------------------------------
alter table public.salons add column if not exists aceite_modo text not null default 'profissional';
alter table public.salons add column if not exists minutos_para_aceitar integer not null default 120;
alter table public.salons add column if not exists ao_expirar text not null default 'confirma';
do $$ begin
  alter table public.salons add constraint salons_aceite_modo_conhecido check (aceite_modo in ('automatico', 'casa', 'profissional'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_prazo_de_aceite_razoavel check (minutos_para_aceitar between 5 and 2880);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_ao_expirar_conhecido check (ao_expirar in ('confirma', 'cancela'));
exception when duplicate_object then null; end $$;

-- aplica a regra da casa nas profissionais dela (no modo 'profissional' não mexe)
create or replace function public.aplicar_aceite_da_casa(salao uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; n integer := 0;
begin
  select * into s from public.salons where id = salao;
  if s.id is null then return 0; end if;
  if s.aceite_modo = 'automatico' then
    update public.professionals set aceite_manual = false where salon_id = salao and aceite_manual;
    get diagnostics n = row_count;
  elsif s.aceite_modo = 'casa' then
    update public.professionals set aceite_manual = true, minutos_para_aceitar = s.minutos_para_aceitar, ao_expirar = s.ao_expirar
     where salon_id = salao and (not aceite_manual or minutos_para_aceitar <> s.minutos_para_aceitar or ao_expirar <> s.ao_expirar);
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;
revoke execute on function public.aplicar_aceite_da_casa(uuid) from public, anon, authenticated;

create or replace function public.salons_aceite_propaga()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.aplicar_aceite_da_casa(new.id);
  return new;
end;
$$;
drop trigger if exists salons_aceite_propaga_tg on public.salons;
create trigger salons_aceite_propaga_tg after update of aceite_modo, minutos_para_aceitar, ao_expirar on public.salons
  for each row execute function public.salons_aceite_propaga();

-- profissional nova já nasce com a regra da casa
create or replace function public.professionals_aceite_da_casa()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  select * into s from public.salons where id = new.salon_id;
  if s.aceite_modo = 'automatico' then new.aceite_manual := false;
  elsif s.aceite_modo = 'casa' then new.aceite_manual := true; new.minutos_para_aceitar := s.minutos_para_aceitar; new.ao_expirar := s.ao_expirar;
  end if;
  return new;
end;
$$;
drop trigger if exists professionals_aceite_da_casa_tg on public.professionals;
create trigger professionals_aceite_da_casa_tg before insert on public.professionals
  for each row execute function public.professionals_aceite_da_casa();

-- a tela: a dona escolhe o modo
create or replace function public.salao_aceite(salao uuid, modo text, minutos integer default null, no_silencio text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare n integer; s public.salons%rowtype;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão muda isso.'; end if;
  if modo not in ('automatico', 'casa', 'profissional') then raise exception 'Modo desconhecido.'; end if;
  update public.salons
     set aceite_modo = modo,
         minutos_para_aceitar = coalesce(minutos, minutos_para_aceitar),
         ao_expirar = coalesce(no_silencio, ao_expirar)
   where id = salao;
  -- o gatilho do update já propagou; aqui só conta quem passou a seguir a regra
  select * into s from public.salons where id = salao;
  select case when s.aceite_modo = 'profissional' then 0 else count(*) end into n from public.professionals where salon_id = salao and active;
  return jsonb_build_object('modo', s.aceite_modo, 'minutos', s.minutos_para_aceitar, 'no_silencio', s.ao_expirar, 'profissionais_ajustadas', n);
end;
$$;
revoke execute on function public.salao_aceite(uuid, text, integer, text) from public, anon;
grant execute on function public.salao_aceite(uuid, text, integer, text) to authenticated;

-- 2. No modo 'casa', o pedido chega também para quem manda no salão ----------
create or replace function public.aceites_avisa_a_casa()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; a public.appointments%rowtype; res record; nome_cli text; conta_prof uuid; adm uuid;
begin
  select * into s from public.salons where id = new.salon_id;
  if s.aceite_modo <> 'casa' then return new; end if;
  select * into a from public.appointments where id = new.appointment_id;
  select * into res from public.resumo_do_agendamento(new.appointment_id);
  select nullif(btrim(pf.full_name), '') into nome_cli from public.profiles pf where pf.id = a.client_id;
  select user_id into conta_prof from public.professionals where id = new.professional_id;
  for adm in select m.user_id from public.salon_members m where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
    perform public.notificar(adm, 'pedido_de_aceite',
      case when a.remarca_de is not null then 'Pedido de troca de horário' else 'Pedido de horário' end,
      coalesce(nome_cli, 'Uma cliente') || ' quer ' || coalesce(res.servico, 'um atendimento') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '. A casa confirma em até ' || s.minutos_para_aceitar || ' min.',
      '/admin/pdv',
      jsonb_build_object('appointment_id', new.appointment_id, 'professional_id', new.professional_id, 'pela_casa', true));
  end loop;
  return new;
end;
$$;
drop trigger if exists aceites_avisa_a_casa_tg on public.aceites;
create trigger aceites_avisa_a_casa_tg after insert on public.aceites for each row execute function public.aceites_avisa_a_casa();

-- 3. A casa decide pelo quadro -------------------------------------------------
-- Com pedido aberto, resolve o pedido (a cliente é avisada como sempre).
-- Sem pedido (horário pendente antigo, ou criado por fora), decide direto
-- e avisa a cliente do mesmo jeito.
create or replace function public.casa_decide(appt uuid, aceitou boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; res record; pagina text;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null then raise exception 'Horário não encontrado.'; end if;
  if not (public.is_admin_do_salao(a.salon_id) or public.is_professional(a.professional_id) or public.eh_plataforma()) then raise exception 'Esse horário não é seu.'; end if;
  if a.status <> 'pendente' then return jsonb_build_object('ok', false, 'motivo', 'já está ' || a.status, 'status', a.status); end if;
  if exists (select 1 from public.aceites x where x.appointment_id = appt and x.resultado is null) then
    return public.resolver_aceite(appt, aceitou) || jsonb_build_object('status', case when aceitou then 'confirmado' else 'cancelado' end);
  end if;
  select * into res from public.resumo_do_agendamento(appt);
  pagina := '/cliente/agendamento/' || appt::text;
  perform public.silenciar_gatilho();
  if aceitou then
    update public.appointments set status = 'confirmado' where id = appt;
    if a.client_id is not null then
      perform public.notificar(a.client_id, 'pedido_aceito', 'Agendamento confirmado! 🎉',
        coalesce(res.servico, 'Seu horário') || ' com ' || coalesce(res.profissional, 'a equipe') || ', ' || coalesce(res.quando_longo, '') || '.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  else
    update public.appointments set status = 'cancelado', cancelado_por = 'salao', cancelado_em = now(), motivo_cancelamento = 'recusado_pela_casa' where id = appt;
    if a.client_id is not null then
      perform public.notificar(a.client_id, 'pedido_recusado', 'Horário não confirmado',
        coalesce(res.profissional, 'A equipe') || ' não pôde atender ' || coalesce(res.quando_longo, 'nesse horário') || '. Escolha outro horário.',
        pagina, jsonb_build_object('appointment_id', appt, 'professional_id', a.professional_id));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'status', case when aceitou then 'confirmado' else 'cancelado' end);
end;
$$;
revoke execute on function public.casa_decide(uuid, boolean) from public, anon;
grant execute on function public.casa_decide(uuid, boolean) to authenticated;
