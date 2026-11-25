-- 264: as travas do salão (4.9, lote 1 do levantamento)
--   1. Lembrete e confirmação sempre com link: salons.app_url nascia vazio e só se preenchia num campo técnico da
--      tela de Horário ("Endereço do app na internet"). Agora todo salão tem o endereço da MIMO de fábrica, e o campo
--      sai da tela.
--   2. O aviso "Pedido de horário" para quem manda no salão abria o PDV, que no celular não tem Confirmar nem
--      Recusar. Agora abre a Agenda, onde ficam os "Pedidos esperando você".
--   3. "Minha conta" (dona e profissional) gravava nome e telefone direto em profiles, o que a 066 proibiu: dava erro
--      do banco. minha_conta_nome troca só o nome, e só de quem é do salão (o nome da cliente continua com o suporte;
--      o WhatsApp continua trocando por código).
--   4. O recebimento por Pix fica escondido até a regra do saque ser definida (decisão de 25/11): todo salão volta
--      para pagamento_modo = 'nao' (os cadastros de até aqui são de teste).
--   5. Avisos entre os perfis: a casa cancela ou muda um horário e a profissional fica sabendo; a cliente marca ou
--      cancela e a dona fica sabendo.
--   6. A baixa (veio / não veio) e o "eu compareci" vão para a casa; para a profissional quando é ela quem confirma.
-- Idempotente.

alter table public.salons alter column app_url set default 'https://mimo.com.vc';
update public.salons set app_url = 'https://mimo.com.vc' where app_url is null or btrim(app_url) = '' or app_url ~* '(localhost|127\.0\.0\.1|vercel\.app)';

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
      '/admin/agenda',
      jsonb_build_object('appointment_id', new.appointment_id, 'professional_id', new.professional_id, 'pela_casa', true));
  end loop;
  return new;
end;
$$;

update public.salons set pagamento_modo = 'nao' where pagamento_modo <> 'nao';

create or replace function public.minha_conta_nome(nome_ text)
returns text language plpgsql security definer set search_path = public as $$
declare
  n text := left(btrim(regexp_replace(coalesce(nome_, ''), '\s+', ' ', 'g')), 80);
  papel text;
begin
  if auth.uid() is null then raise exception 'entre na sua conta'; end if;
  select role into papel from public.profiles where id = auth.uid();
  if papel not in ('admin', 'profissional', 'plataforma') then raise exception 'para corrigir o nome, fale com o suporte'; end if;
  if length(n) < 2 then raise exception 'diga o seu nome'; end if;
  update public.profiles set full_name = n where id = auth.uid();
  return n;
end $$;
revoke execute on function public.minha_conta_nome(text) from public, anon;
grant execute on function public.minha_conta_nome(text) to authenticated;

do $$ begin raise notice '264: link de fábrica nas mensagens (app_url), o pedido de horário abre a Agenda, minha_conta_nome'; end $$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Avisos entre os perfis. Até aqui: a dona cancelava ou passava um horário para outra profissional e ela não ficava
--    sabendo; a cliente marcava ou cancelava e a dona (que não é a profissional do horário) não recebia nada.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.nome_da_cliente_do_horario(appt uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(pf.full_name), '') from public.profiles pf where pf.id = a.client_id),
    nullif(btrim(a.guest_name), ''), 'Cliente')
  from public.appointments a where a.id = appt;
$$;
revoke all on function public.nome_da_cliente_do_horario(uuid) from public, anon, authenticated;

create or replace function public.avisa_profissional_do_agendamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare
  conta uuid;
  manual boolean;
  por_historico boolean;
  eh_dona boolean;
  r jsonb;
  pediu boolean := false;
  res record;
  pagina text;
  pago boolean;
  sit jsonb;
  forcado boolean := false;
  casa boolean;
begin
  if new.status = 'cancelado' then
    return new;
  end if;

  select p.user_id, p.aceite_manual, coalesce(p.confirmar_historico_ruim, true) into conta, manual, por_historico
  from public.professionals p where p.id = new.professional_id;

  -- 245: no modo "a casa confirma" o pedido é da casa, tenha a profissional conta ou não
  casa := coalesce((select s.aceite_modo = 'casa' from public.salons s where s.id = new.salon_id), false);
  if conta is null and not casa then
    return new;
  end if;

  if conta = new.client_id or conta = auth.uid() then
    return new;
  end if;

  -- pago pelo app (ou troca de um horário pago): entra confirmado, sem aceite
  pago := coalesce(new.pago_cents, 0) > 0
          or (new.remarca_de is not null and exists (select 1 from public.appointments o where o.id = new.remarca_de and coalesce(o.pago_cents, 0) > 0));
  if pago then
    if conta is null then
      return new;                    -- como antes: sem conta, não há a quem avisar
    end if;
    if new.status = 'pendente' then
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
    perform public.avisar_horario_pago(new.id, new.remarca_de is not null);
    if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
      select * into res from public.resumo_do_agendamento(new.id);
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. Seu crédito entrou como sinal.',
        '/cliente/agendamento/' || new.id::text, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
    return new;
  end if;

  eh_dona := public.is_admin_do_salao(new.salon_id);
  -- histórico ruim com ELA: o pedido passa pela mão dela mesmo no automático
  por_historico := por_historico and not coalesce(manual, false)
                   and new.client_id is not null and public.historico_ruim_comigo(new.client_id, new.professional_id);

  -- 3.98 (242): as regras do salão para a cliente que marca sozinha (app ou assistente): o primeiro horário de cliente
  -- nova (a casa confirma / só a equipe) e as faltas além do limite viram pedido para a casa confirmar
  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null and new.status = 'pendente' then
    sit := public.situacao_da_cliente(new.salon_id, new.client_id, new.id);
    forcado := coalesce(((sit ->> 'nova')::boolean and sit ->> 'cliente_nova' in ('casa_confirma', 'so_equipe'))
                        or (sit ->> 'faltas')::integer >= (sit ->> 'limite_faltas')::integer, false);
  end if;

  if (coalesce(manual, false) or casa or por_historico or forcado) and not eh_dona and new.status = 'pendente' then
    r := public.pedir_aceite(new.id, por_historico or forcado);
    if coalesce((r ->> 'ok')::boolean, false) then
      pediu := true;
    else
      update public.appointments set status = 'confirmado' where id = new.id;
    end if;
  elsif new.status = 'pendente' then
    update public.appointments set status = 'confirmado' where id = new.id;
  end if;

  -- 245: um aviso só (a regra da 078, que a 095 perdeu): se abriu o pedido para ela, o pedido já avisou; se o pedido é
  -- da casa, ela só fica sabendo depois que a casa confirmar (avisa_profissional_ao_confirmar)
  if conta is not null and not pediu then
    -- 264: o aviso diz o que é (quem, o quê, quando), e quando foi a casa que mudou o horário ele diz isso
    select * into res from public.resumo_do_agendamento(new.id);
    perform public.notificar(
      conta, 'novo_agendamento',
      case when new.remarca_de is not null and eh_dona then 'O salão mudou um horário seu' else 'Horário novo na sua agenda' end,
      public.nome_da_cliente_do_horario(new.id) || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, ''),
      '/pro',
      jsonb_build_object('appointment_id', new.id,
                         'professional_id', new.professional_id));
  end if;

  if new.client_id is not null and new.client_id = auth.uid() and new.remarca_de is null then
    select * into res from public.resumo_do_agendamento(new.id);
    pagina := '/cliente/agendamento/' || new.id::text;
    if pediu then
      perform public.notificar(new.client_id, 'pedido_enviado', 'Pedido enviado! ⏳',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '. ' || coalesce((select nullif(btrim(sx.name), '') from public.salons sx where sx.id = new.salon_id), 'O salão') || ' confirma em breve.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    else
      perform public.notificar(new.client_id, 'agendamento_confirmado', 'Agendamento confirmado! 🎉',
        res.servico || ' com ' || res.profissional || ', ' || res.quando_longo || '.',
        pagina, jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.avisa_a_outra_ponta()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  quem text; conta_prof uuid; conta_antiga uuid; res record; cli text; adm uuid; ant public.appointments%rowtype; linha text;
begin
  quem := public.quem_age_e(new);
  select user_id into conta_prof from public.professionals where id = new.professional_id;

  if tg_op = 'UPDATE' then
    if new.status <> 'cancelado' or old.status = 'cancelado' or old.status not in ('pendente', 'confirmado') then return new; end if;
    -- a troca de horário avisa pelo horário novo, não pelo antigo que sai
    if new.remarcado_para is not null or new.motivo_cancelamento = 'remarcado_pela_casa' or new.cancelado_por = 'remarcacao' then return new; end if;
    select * into res from public.resumo_do_agendamento(new.id);
    cli := public.nome_da_cliente_do_horario(new.id);
    linha := cli || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, '');
    if quem = 'salao' and conta_prof is not null and conta_prof <> auth.uid() then
      -- pedido que era só da casa e caiu antes de confirmar: ela nunca soube dele
      if old.status = 'pendente' and coalesce((select bool_or(x.so_a_casa) from public.aceites x where x.appointment_id = new.id), false) then return new; end if;
      perform public.notificar(conta_prof, 'cancelou_comigo', 'O salão cancelou um horário seu', linha, '/pro',
        jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id, 'pela_casa', true));
    elsif quem = 'cliente' and not public.gatilho_silenciado() then
      for adm in select m.user_id from public.salon_members m
                 where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
        perform public.notificar(adm, 'cancelou_comigo', 'A cliente cancelou um horário',
          linha || ', com ' || coalesce(res.profissional, 'a equipe'), '/admin/agenda',
          jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
      end loop;
    end if;
    return new;
  end if;

  -- INSERT
  if new.status = 'cancelado' then return new; end if;
  select * into res from public.resumo_do_agendamento(new.id);
  cli := public.nome_da_cliente_do_horario(new.id);
  linha := cli || ' · ' || coalesce(res.servico, 'atendimento') || ' · ' || coalesce(res.quando_longo, '');

  -- a casa passou o horário para outra profissional: a que perdeu fica sabendo
  if new.remarca_de is not null and quem = 'salao' then
    select * into ant from public.appointments where id = new.remarca_de;
    if ant.id is not null and ant.professional_id <> new.professional_id then
      select user_id into conta_antiga from public.professionals where id = ant.professional_id;
      if conta_antiga is not null and conta_antiga <> auth.uid() then
        perform public.notificar(conta_antiga, 'cancelou_comigo', 'O salão passou um horário seu para ' || coalesce(split_part(res.profissional, ' ', 1), 'outra profissional'),
          cli || ' · ' || coalesce(ant.service_name, res.servico, 'atendimento') || ' · ' || public.dia_por_extenso(ant.date) || ' às ' || to_char(ant.start_time, 'HH24:MI'),
          '/pro', jsonb_build_object('appointment_id', ant.id, 'professional_id', ant.professional_id, 'pela_casa', true));
      end if;
    end if;
    return new;
  end if;

  -- a cliente marcou (pelo app ou pela assistente): a dona que não é a profissional do horário fica sabendo.
  -- Se o pedido já foi para a casa confirmar, o pedido é o aviso.
  if quem in ('cliente', 'sistema') then
    if exists (select 1 from public.aceites x join public.salons s on s.id = x.salon_id
               where x.appointment_id = new.id and (s.aceite_modo = 'casa' or conta_prof is null)) then
      return new;
    end if;
    for adm in select m.user_id from public.salon_members m
               where m.salon_id = new.salon_id and m.papel = 'admin' and m.user_id is distinct from conta_prof loop
      perform public.notificar(adm, 'novo_agendamento',
        case when new.remarca_de is not null then 'A cliente pediu para trocar um horário'
             when exists (select 1 from public.aceites x where x.appointment_id = new.id and x.resultado is null)
               then 'Pedido de horário para ' || coalesce(split_part(res.profissional, ' ', 1), 'a equipe')
             else 'Horário novo no salão' end,
        linha || ', com ' || coalesce(res.profissional, 'a equipe'), '/admin/agenda',
        jsonb_build_object('appointment_id', new.id, 'professional_id', new.professional_id));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_zzz_avisa_a_outra_ponta_novo on public.appointments;
create trigger tg_zzz_avisa_a_outra_ponta_novo after insert on public.appointments
  for each row when (new.status <> 'aguardando_pagamento') execute function public.avisa_a_outra_ponta();
drop trigger if exists tg_zzz_avisa_a_outra_ponta_cancelou on public.appointments;
create trigger tg_zzz_avisa_a_outra_ponta_cancelou after update of status on public.appointments
  for each row execute function public.avisa_a_outra_ponta();

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Quem dá a baixa (veio / não veio) e quem recebe o "eu compareci" da cliente (decisão de 25/11): é a casa. Quando
--    o salão deixa a confirmação dos horários com a profissional (aceite_modo = 'profissional') e ela tem acesso, a
--    responsável é ela, e a casa continua podendo dar a baixa pelo Fechar o dia.
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public.quem_da_baixa(prof uuid)
returns table(user_id uuid, papel text)
language sql stable security definer set search_path = public
as $$
  with p as (
    select pr.user_id, pr.salon_id, s.owner_id,
           (coalesce(s.aceite_modo, 'profissional') = 'profissional' and pr.user_id is not null) as dela
    from public.professionals pr join public.salons s on s.id = pr.salon_id where pr.id = prof
  )
  select p.user_id, 'profissional' from p where p.dela
  union
  select p.owner_id, 'salao' from p where not p.dela and p.owner_id is not null
  union
  select m.user_id, 'salao' from p join public.salon_members m on m.salon_id = p.salon_id where not p.dela and m.papel = 'admin';
$$;
revoke all on function public.quem_da_baixa(uuid) from public, anon, authenticated;

create or replace function public.perguntar_se_veio()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare r record; q record; n integer := 0; agora timestamp := public.agora_local(); nome text; servico text;
begin
  if extract(hour from agora) < 7 or extract(hour from agora) >= 22 then return 0; end if;
  for r in
    select a.*, pr.name as prof_nome
    from public.appointments a
    join public.professionals pr on pr.id = a.professional_id
    where a.status = 'confirmado' and a.perguntado_em is null
      and (a.date + a.end_time) + interval '5 minutes' < agora
      and (a.date + a.end_time) > agora - interval '3 days'
      and not exists (select 1 from public.appointments t where t.remarca_de = a.id and t.status = 'pendente')
      and not exists (select 1 from public.aceites ac where ac.appointment_id = a.id and ac.resultado is null)
    order by a.date, a.start_time
    limit 100
  loop
    update public.appointments set perguntado_em = now() where id = r.id;
    select coalesce(nullif(btrim(pf.full_name), ''), r.guest_name, 'A cliente') into nome from public.profiles pf where pf.id = r.client_id;
    nome := coalesce(nome, r.guest_name, 'A cliente');
    select coalesce(r.service_name, s.name, 'atendimento') into servico from public.services s where s.id = r.service_id;
    servico := coalesce(servico, r.service_name, 'atendimento');
    for q in select * from public.quem_da_baixa(r.professional_id) loop
      perform public.notificar(q.user_id, 'veio', split_part(nome, ' ', 1) || ' veio?',
        servico || ' às ' || to_char(r.start_time, 'HH24:MI')
          || case when q.papel = 'salao' then ' com ' || r.prof_nome else '' end
          || '. Toque para dar baixa: Veio, Não veio ou Remarcamos. Sem resposta em 3 h, conclui sozinho.',
        case when q.papel = 'salao' then '/admin/fechar-dia' else '/pro/fechar-dia' end,
        jsonb_build_object('appointment_id', r.id, 'professional_id', r.professional_id));
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.contestar_falta(ciencia uuid, texto text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
as $$
declare c record; a record; q record; nome text;
begin
  select * into c from public.ciencias where id = ciencia and client_id = auth.uid() and motivo = 'falta' and contestada_em is null;
  if not found then raise exception 'Nada para contestar.'; end if;
  update public.ciencias set contestada_em = now(), contestacao = nullif(btrim(coalesce(texto, '')), '') where id = ciencia;
  select ap.*, p.user_id as conta_prof, p.salon_id as sal into a
    from public.appointments ap join public.professionals p on p.id = ap.professional_id where ap.id = c.appointment_id;
  select nullif(btrim(full_name), '') into nome from public.profiles where id = auth.uid();
  -- 264: vai para quem dá a baixa (a casa; ou a profissional, quando é ela quem confirma os horários)
  for q in select * from public.quem_da_baixa(a.professional_id) loop
    perform public.notificar(q.user_id, 'contestacao', coalesce(nome, 'Uma cliente') || ' diz que compareceu',
      'Falta marcada em ' || public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI')
        || '. Se ela veio, use "Perdoar falta" na agenda.' || coalesce(E'\n"' || nullif(btrim(coalesce(texto, '')), '') || '"', ''),
      case when q.papel = 'salao' then '/admin/agenda?dia=' else '/pro/agenda?dia=' end || a.date::text,
      jsonb_build_object('appointment_id', a.id, 'professional_id', a.professional_id));
  end loop;
end;
$$;

create or replace function public.pendencias_de_baixa()
 RETURNS TABLE(appointment_id uuid, professional_id uuid, profissional text, client_id uuid, cliente text, servico text, dia date, inicio time without time zone, fim time without time zone, situacao text, perguntado_em timestamp with time zone, conclui_em timestamp with time zone, troca jsonb, ficha jsonb, pode_corrigir boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
as $$
  select a.id, a.professional_id, p.name, a.client_id,
         coalesce(nullif(btrim(pf.full_name), ''), a.guest_name, 'Cliente'),
         coalesce(a.service_name, s.name, 'Atendimento'),
         a.date, a.start_time, a.end_time,
         case when a.status = 'confirmado' then 'esperando' else 'concluido_sozinho' end,
         a.perguntado_em,
         case when a.status = 'confirmado' and a.perguntado_em is not null then a.perguntado_em + interval '3 hours' end,
         (select jsonb_build_object('id', t.id, 'quando', public.dia_por_extenso(t.date) || ' às ' || to_char(t.start_time, 'HH24:MI'), 'expira_em', ac.expira_em)
            from public.appointments t left join public.aceites ac on ac.appointment_id = t.id
           where t.remarca_de = a.id and t.status = 'pendente' limit 1),
         case when a.client_id is not null then public.ficha_para_profissional(a.client_id, a.professional_id) end,
         a.status = 'concluido' and a.baixa_por = 'sistema' and (a.date + a.end_time) > public.agora_local() - interval '72 hours'
  from public.appointments a
  join public.professionals p on p.id = a.professional_id
  left join public.profiles pf on pf.id = a.client_id
  left join public.services s on s.id = a.service_id
  where (a.date + a.end_time) < public.agora_local()
    and (a.date + a.end_time) > public.agora_local() - interval '72 hours'
    and ((a.status = 'confirmado') or (a.status = 'concluido' and a.baixa_por = 'sistema'))
    and (public.is_admin_do_salao(a.salon_id)
         or (public.is_professional(a.professional_id)
             and coalesce((select sx.aceite_modo from public.salons sx where sx.id = a.salon_id), 'profissional') <> 'casa'))
  order by a.status desc, a.date desc, a.start_time desc;
$$;
