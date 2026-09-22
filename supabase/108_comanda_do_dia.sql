-- 108 · A comanda é da visita, não da cadeira: tudo que a cliente fez no
-- dia, com uma ou mais profissionais, fecha numa comanda só. E o arrasto
-- para um horário que encosta no próprio horário antigo deixa de bater
-- na trava de sobreposição.

-- 1. Remarcar pela casa: cancela o antigo antes de nascer o novo ----------------------------------
create or replace function public.remarcar_por_fora(appt uuid, nova_data date, nova_hora time)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; novo uuid; dur interval; fim time; res record;
begin
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not (public.is_professional(a.professional_id) or public.is_admin_do_salao(a.salon_id)) then raise exception 'Sem permissão.'; end if;
  if a.status not in ('confirmado', 'pendente') then raise exception 'Este horário não pode mais ser remarcado.'; end if;
  if (nova_data + nova_hora) < public.agora_local() - interval '10 minutes' then raise exception 'O novo horário precisa estar no futuro.'; end if;
  dur := a.end_time - a.start_time;
  fim := nova_hora + dur;
  if exists (select 1 from public.appointments x
             where x.professional_id = a.professional_id and x.date = nova_data and x.id <> appt
               and x.status not in ('cancelado', 'faltou')
               and nova_hora < x.end_time and fim > x.start_time) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;

  perform public.silenciar_gatilho();
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';
  -- o antigo sai da frente antes de o novo nascer (senão o novo bate nele quando encosta)
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa' where id = appt;

  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de, pago_cents)
  values (a.client_id, a.professional_id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt, a.pago_cents)
  returning id into novo;
  update public.appointments set remarcado_para = novo where id = appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  select novo, s.service_id, s.name, s.price_cents, s.duration_minutes, s.ordem from public.appointment_services s where s.appointment_id = appt;
  update public.pagamentos set appointment_id = novo where appointment_id = appt and status in ('pago', 'credito');

  if a.client_id is not null then
    select * into res from public.resumo_do_agendamento(novo);
    perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
      res.servico || ' com ' || res.profissional || ' agora é ' || res.quando_longo || '.',
      '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', a.professional_id));
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.remarcar_por_fora(uuid, date, time) from public, anon;
grant execute on function public.remarcar_por_fora(uuid, date, time) to authenticated;

create or replace function public.mover_horario(appt uuid, nova_data date, nova_hora time, nova_prof uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.appointments%rowtype; p public.professionals%rowtype; novo uuid; dur interval; fim time; res record; mudou_prof boolean;
begin
  select * into a from public.appointments where id = appt;
  if not found then raise exception 'Agendamento não encontrado.'; end if;
  if not public.is_admin_do_salao(a.salon_id) then raise exception 'Só a dona do salão move horários pelo quadro.'; end if;
  if a.status not in ('confirmado', 'pendente') then raise exception 'Este horário não pode mais ser movido (%).', a.status; end if;
  if (nova_data + nova_hora) < public.agora_local() - interval '10 minutes' then raise exception 'O novo horário precisa estar no futuro.'; end if;
  select * into p from public.professionals where id = coalesce(nova_prof, a.professional_id);
  if p.id is null or p.salon_id <> a.salon_id or not p.active then raise exception 'Profissional não encontrada neste salão.'; end if;
  mudou_prof := p.id <> a.professional_id;
  if mudou_prof and a.service_id is not null and not exists (select 1 from public.professional_services ps where ps.professional_id = p.id and ps.service_id = a.service_id) then
    return jsonb_build_object('ok', false, 'motivo', 'nao_faz', 'profissional', p.name);
  end if;
  dur := a.end_time - a.start_time;
  fim := nova_hora + dur;
  if exists (select 1 from public.appointments x
             where x.professional_id = p.id and x.date = nova_data and x.id <> appt
               and x.status not in ('cancelado', 'faltou')
               and nova_hora < x.end_time and fim > x.start_time) then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado');
  end if;
  if not mudou_prof then return public.remarcar_por_fora(appt, nova_data, nova_hora); end if;

  perform public.silenciar_gatilho();
  update public.aceites set resultado = 'recusado', resolvido_em = now()
    where appointment_id in (select t.id from public.appointments t where t.remarca_de = appt and t.status = 'pendente') and resultado is null;
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa'
    where remarca_de = appt and status = 'pendente';
  update public.appointments set status = 'cancelado', cancelado_por = 'sistema', motivo_cancelamento = 'remarcado_pela_casa' where id = appt;
  insert into public.appointments (client_id, professional_id, service_id, service_name, price_cents, salon_id, notes, guest_name, guest_phone,
                                   date, start_time, end_time, status, remarca_de, pago_cents)
  values (a.client_id, p.id, a.service_id, a.service_name, a.price_cents, a.salon_id, a.notes, a.guest_name, a.guest_phone,
          nova_data, nova_hora, fim, 'confirmado', appt, a.pago_cents)
  returning id into novo;
  update public.appointments set remarcado_para = novo where id = appt;
  insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
  select novo, s.service_id, s.name, s.price_cents, s.duration_minutes, s.ordem from public.appointment_services s where s.appointment_id = appt;
  update public.pagamentos set appointment_id = novo where appointment_id = appt and status in ('pago', 'credito');
  if a.client_id is not null then
    select * into res from public.resumo_do_agendamento(novo);
    perform public.notificar(a.client_id, 'remarcacao_aceita', 'Remarcado! 🎉',
      res.servico || ' agora é ' || res.quando_longo || ', com ' || p.name || '.',
      '/cliente/agendamento/' || novo::text, jsonb_build_object('appointment_id', novo, 'professional_id', p.id));
  end if;
  return jsonb_build_object('ok', true, 'appointment_id', novo);
end;
$$;
revoke execute on function public.mover_horario(uuid, date, time, uuid) from public, anon;
grant execute on function public.mover_horario(uuid, date, time, uuid) to authenticated;

-- 2. A comanda junta os horários da visita -----------------------------------------------------------
alter table public.comandas
  add column if not exists appointment_ids uuid[] not null default '{}',
  add column if not exists horarios_originais jsonb not null default '{}'::jsonb;
create index if not exists comandas_appointment_ids on public.comandas using gin (appointment_ids);

-- `comanda` = {appointment_id?, appointment_ids?: [..], client_id?, cliente_nome?, professional_id,
--   itens: [{service_id?, nome, preco_cents, qtd?, duracao?, appointment_id?, professional_id?}],
--   desconto_cents?, pagamentos: [{forma, valor_cents, recebido_cents?, detalhe?, parcelas?}], observacao?, enviar_cupom?}
create or replace function public.pdv_fechar(salao uuid, comanda jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype; x public.appointments%rowtype;
  prof public.professionals%rowtype;
  appt uuid; cli uuid; nome text; obs text; ids uuid[] := '{}'; um uuid; t text;
  itens jsonb; pagos jsonb; it jsonb; pg jsonb; pagos_ok jsonb := '[]'::jsonb; itens_ok jsonb := '[]'::jsonb; originais jsonb := '{}'::jsonb;
  subtotal integer := 0; desconto integer; total integer; sinal integer := 0; pago integer := 0; soma_appt integer; dur_appt integer;
  duracao integer := 0; agora timestamp := public.agora_local();
  nova uuid; primeiro uuid; i integer := 0; fim_av timestamp; dur_av interval; ult timestamp;
  v integer; rec integer; troco integer; forma text; mandar_cupom boolean; item_prof uuid; item_appt uuid; nome_prof text;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão fecha comanda.'; end if;
  itens := coalesce(comanda -> 'itens', '[]'::jsonb);
  pagos := coalesce(comanda -> 'pagamentos', '[]'::jsonb);
  mandar_cupom := coalesce((comanda ->> 'enviar_cupom')::boolean, true);
  if jsonb_typeof(itens) <> 'array' or jsonb_array_length(itens) = 0 then raise exception 'A comanda está vazia.'; end if;
  begin appt := nullif(comanda ->> 'appointment_id', '')::uuid; exception when others then appt := null; end;
  begin cli := nullif(comanda ->> 'client_id', '')::uuid; exception when others then cli := null; end;
  nome := nullif(btrim(coalesce(comanda ->> 'cliente_nome', '')), '');
  obs := nullif(btrim(coalesce(comanda ->> 'observacao', '')), '');
  desconto := greatest(0, coalesce((comanda ->> 'desconto_cents')::integer, 0));

  select * into prof from public.professionals p where p.id = nullif(comanda ->> 'professional_id', '')::uuid and p.salon_id = salao;
  if prof.id is null then raise exception 'Diga qual profissional atendeu.'; end if;

  -- os horários da visita: o principal e os outros que a tela mandou
  if appt is not null then ids := array[appt]; end if;
  if jsonb_typeof(comanda -> 'appointment_ids') = 'array' then
    for t in select value #>> '{}' from jsonb_array_elements(comanda -> 'appointment_ids') loop
      begin um := t::uuid; exception when others then continue; end;
      if not (um = any(ids)) then ids := ids || um; end if;
    end loop;
  end if;
  if appt is null and array_length(ids, 1) > 0 then appt := ids[1]; end if;

  -- os itens: cada um sabe de que horário e de quem é (sem dizer, é do principal)
  for it in select * from jsonb_array_elements(itens) loop
    if coalesce(it ->> 'nome', '') = '' then raise exception 'Item sem nome.'; end if;
    begin item_appt := nullif(it ->> 'appointment_id', '')::uuid; exception when others then item_appt := null; end;
    begin item_prof := nullif(it ->> 'professional_id', '')::uuid; exception when others then item_prof := null; end;
    if item_appt is not null and not (item_appt = any(ids)) then ids := ids || item_appt; end if;
    if item_appt is null then item_appt := appt; end if;
    if item_prof is null then select professional_id into item_prof from public.appointments where id = item_appt; end if;
    if item_prof is null then item_prof := prof.id; end if;
    select name into nome_prof from public.professionals where id = item_prof;
    subtotal := subtotal + coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    duracao := duracao + coalesce((it ->> 'duracao')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    if primeiro is null then begin primeiro := nullif(it ->> 'service_id', '')::uuid; exception when others then primeiro := null; end; end if;
    itens_ok := itens_ok || jsonb_build_array(it || jsonb_build_object('appointment_id', item_appt, 'professional_id', item_prof, 'profissional', nome_prof));
  end loop;
  if desconto > subtotal then raise exception 'O desconto é maior que a comanda.'; end if;
  total := subtotal - desconto;
  if primeiro is null then select id into primeiro from public.services sv where sv.salon_id = salao and sv.active order by sv.name limit 1; end if;
  if primeiro is null and appt is null then raise exception 'Cadastre ao menos um serviço no catálogo para fechar comanda avulsa.'; end if;

  -- confere cada horário da visita
  foreach um in array ids loop
    select * into x from public.appointments where id = um;
    if x.id is null or x.salon_id <> salao then raise exception 'Horário não encontrado neste salão.'; end if;
    if x.status not in ('pendente', 'confirmado') then raise exception 'O horário das % não está esperando fechamento (%).', to_char(x.start_time, 'HH24:MI'), x.status; end if;
    if exists (select 1 from public.comandas c where c.status = 'fechada' and (c.appointment_id = um or um = any(c.appointment_ids))) then raise exception 'O horário das % já tem comanda fechada.', to_char(x.start_time, 'HH24:MI'); end if;
    if x.date > agora::date then raise exception 'O horário das % é de %. A comanda fecha no dia do atendimento.', to_char(x.start_time, 'HH24:MI'), to_char(x.date, 'DD/MM'); end if;
    if um = appt then a := x; cli := coalesce(cli, x.client_id); nome := coalesce(nome, x.guest_name);
    elsif x.client_id is distinct from coalesce(cli, a.client_id) then raise exception 'O horário das % é de outra cliente.', to_char(x.start_time, 'HH24:MI'); end if;
    sinal := sinal + coalesce(x.pago_cents, 0);
    originais := originais || jsonb_build_object(um::text, jsonb_build_object('date', x.date, 'start_time', x.start_time, 'end_time', x.end_time, 'status', x.status, 'price_cents', x.price_cents, 'service_name', x.service_name));
  end loop;
  if cli is null and nome is null then raise exception 'Diga quem é a cliente (ou o nome, se for avulsa).'; end if;

  for pg in select * from jsonb_array_elements(pagos) loop
    forma := coalesce(pg ->> 'forma', '');
    if forma not in ('dinheiro', 'debito', 'credito', 'pix', 'outro') then raise exception 'Forma de pagamento desconhecida: %', forma; end if;
    v := coalesce((pg ->> 'valor_cents')::integer, 0);
    if v <= 0 then continue; end if;
    rec := nullif(coalesce((pg ->> 'recebido_cents')::integer, 0), 0);
    if forma = 'dinheiro' and rec is not null and rec < v then raise exception 'No dinheiro, o valor entregue (R$ %) é menor que o cobrado (R$ %).', to_char(rec / 100.0, 'FM999G990D00'), to_char(v / 100.0, 'FM999G990D00'); end if;
    troco := case when forma = 'dinheiro' and rec is not null then rec - v else 0 end;
    pago := pago + v;
    pagos_ok := pagos_ok || jsonb_build_array(jsonb_build_object('forma', forma, 'valor_cents', v, 'recebido_cents', rec, 'troco_cents', troco,
      'detalhe', nullif(btrim(coalesce(pg ->> 'detalhe', '')), ''), 'parcelas', nullif(coalesce((pg ->> 'parcelas')::integer, 0), 0)));
  end loop;
  if pago + sinal <> total then
    raise exception 'Os pagamentos (R$ %) não fecham com o total (R$ %).', to_char((pago + sinal) / 100.0, 'FM999G990D00'), to_char(total / 100.0, 'FM999G990D00');
  end if;
  if sinal > 0 then pagos_ok := jsonb_build_array(jsonb_build_object('forma', 'app', 'valor_cents', sinal, 'recebido_cents', null, 'troco_cents', 0, 'detalhe', 'sinal pago pelo app', 'parcelas', null)) || pagos_ok; end if;

  if appt is not null then
    -- cada horário da visita: itens trocados pelos dele, valor dele, concluído
    foreach um in array ids loop
      select * into x from public.appointments where id = um;
      if x.date = agora::date and (x.date + x.start_time) > agora then
        begin
          update public.appointments set start_time = agora::time, end_time = least(agora::time + (x.end_time - x.start_time), time '23:59') where id = um;
        exception when exclusion_violation or unique_violation then
          begin
            update public.appointments set start_time = greatest(agora - interval '1 minute', agora::date + time '00:00')::time, end_time = agora::time where id = um;
          exception when exclusion_violation or unique_violation then null;
          end;
        end;
      end if;
      delete from public.appointment_services where appointment_id = um;
      i := 0; soma_appt := 0;
      for it in select * from jsonb_array_elements(itens_ok) e where (e.value ->> 'appointment_id')::uuid = um loop
        i := i + 1;
        soma_appt := soma_appt + coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
        insert into public.appointment_services (appointment_id, service_id, name, price_cents, duration_minutes, ordem)
        values (um, (case when coalesce(it ->> 'service_id', '') = '' then null else (it ->> 'service_id')::uuid end), it ->> 'nome',
                coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1)), coalesce((it ->> 'duracao')::integer, 0), i);
      end loop;
      update public.appointments
         set status = 'concluido', baixa_por = 'salao', price_cents = greatest(0, soma_appt - case when um = appt then desconto else 0 end), desconto_cents = case when um = appt then desconto else 0 end,
             service_name = coalesce((select string_agg(s.name, ' + ' order by s.ordem) from public.appointment_services s where s.appointment_id = um), service_name)
       where id = um;
    end loop;
    nova := appt;
  else
    fim_av := agora; dur_av := make_interval(mins => greatest(duracao, 15));
    if fim_av < agora::date + interval '1 minute' then fim_av := agora::date + interval '1 minute'; end if;
    if fim_av - dur_av < agora::date then dur_av := greatest(fim_av - agora::date, interval '1 minute'); end if;
    for i in 1..20 loop
      select min(y.date + y.start_time) into ult from public.appointments y
       where y.professional_id = prof.id and y.date = agora::date and y.status not in ('cancelado', 'faltou')
         and (y.date + y.start_time) < fim_av and (y.date + y.end_time) > fim_av - dur_av;
      exit when ult is null;
      fim_av := ult;
      if fim_av - dur_av < agora::date + time '00:01' then dur_av := interval '1 minute'; end if;
      if fim_av <= agora::date + time '00:01' then fim_av := null; exit; end if;
    end loop;
    if fim_av is null then
      dur_av := make_interval(mins => greatest(duracao, 15));
      ult := agora;
      for i in 1..20 loop
        select max(y.date + y.end_time) into fim_av from public.appointments y
         where y.professional_id = prof.id and y.date = agora::date and y.status not in ('cancelado', 'faltou')
           and (y.date + y.start_time) < ult + dur_av and (y.date + y.end_time) > ult;
        exit when fim_av is null;
        ult := fim_av;
      end loop;
      fim_av := ult + dur_av;
      if fim_av > agora::date + time '23:59' then fim_av := agora::date + time '23:59'; dur_av := fim_av - ult; end if;
      if dur_av < interval '1 minute' then raise exception 'Não há brecha na agenda de hoje desta profissional para registrar uma avulsa.'; end if;
    end if;
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
    ids := array[nova];
    -- os itens da avulsa são todos do horário que nasceu agora
    select coalesce(jsonb_agg(e.value || jsonb_build_object('appointment_id', nova, 'professional_id', prof.id, 'profissional', prof.name)), '[]'::jsonb) into itens_ok from jsonb_array_elements(itens_ok) e;
  end if;

  insert into public.comandas (salon_id, appointment_id, appointment_ids, client_id, cliente_nome, professional_id, itens, subtotal_cents, desconto_cents, total_cents, sinal_app_cents, observacao, por, pagamentos, atendida_por, horario_original, horarios_originais)
  values (salao, nova, ids, cli, nome, prof.id, itens_ok, subtotal, desconto, total, sinal, obs, auth.uid(), pagos_ok,
          (select string_agg(distinct e.value ->> 'profissional', ' e ') from jsonb_array_elements(itens_ok) e),
          originais -> nova::text, originais)
  returning id into primeiro;
  for pg in select * from jsonb_array_elements(pagos_ok) loop
    insert into public.caixa_movimentos (salon_id, comanda_id, appointment_id, professional_id, forma, valor_cents, por, recebido_cents, troco_cents, detalhe, parcelas)
    values (salao, primeiro, nova, prof.id, pg ->> 'forma', (pg ->> 'valor_cents')::integer, auth.uid(), (pg ->> 'recebido_cents')::integer, coalesce((pg ->> 'troco_cents')::integer, 0), pg ->> 'detalhe', (pg ->> 'parcelas')::integer);
  end loop;

  if mandar_cupom and cli is not null then
    begin perform public.enviar_cupom(primeiro); exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'comanda_id', primeiro, 'appointment_id', nova, 'appointment_ids', to_jsonb(ids), 'total_cents', total, 'sinal_app_cents', sinal,
    'cupom', mandar_cupom and cli is not null);
end;
$$;
revoke execute on function public.pdv_fechar(uuid, jsonb) from public, anon;
grant execute on function public.pdv_fechar(uuid, jsonb) to authenticated;

-- 3. O estorno devolve todos os horários da visita ---------------------------------------------------
create or replace function public.pdv_estornar(comanda uuid, motivo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.comandas%rowtype; h jsonb; um uuid; ids uuid[];
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
  ids := c.appointment_ids;
  if c.appointment_id is not null and not (c.appointment_id = any(ids)) then ids := ids || c.appointment_id; end if;
  perform public.silenciar_gatilho();
  foreach um in array ids loop
    h := coalesce(c.horarios_originais -> um::text, case when um = c.appointment_id then c.horario_original else null end);
    if h is not null then
      begin
        update public.appointments
           set status = coalesce(h ->> 'status', 'confirmado'), baixa_por = null,
               start_time = coalesce((h ->> 'start_time')::time, start_time), end_time = coalesce((h ->> 'end_time')::time, end_time),
               price_cents = (h ->> 'price_cents')::integer, service_name = h ->> 'service_name'
         where id = um and status = 'concluido';
      exception when exclusion_violation or unique_violation then
        update public.appointments set status = coalesce(h ->> 'status', 'confirmado'), baixa_por = null where id = um and status = 'concluido';
      end;
    else
      update public.appointments set status = 'confirmado', baixa_por = null where id = um and status = 'concluido';
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.pdv_estornar(uuid, text) from public, anon;
grant execute on function public.pdv_estornar(uuid, text) to authenticated;

-- 4. O dia: comanda por horário considera a visita; por profissional soma os itens de cada uma --------
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
        'preferida_id', pp.professional_id, 'preferida', pr.name
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
revoke execute on function public.pdv_dia(uuid, date) from public, anon;
grant execute on function public.pdv_dia(uuid, date) to authenticated;
