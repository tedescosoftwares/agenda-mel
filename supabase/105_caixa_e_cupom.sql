-- 105 · O caixa bem feito: troco, detalhe do pagamento (máquina, parcelas)
-- e o cupom do atendimento para a cliente, no app e por e-mail.
--
-- A cliente continua pagando pelo app só o sinal, como já é. No balcão,
-- o resto entra por dinheiro (com troco), PIX na chave do salão, cartão
-- (com a máquina e as parcelas anotadas) ou outro. Ao fechar, ela
-- recebe o comprovante: um aviso no app que abre o cupom, e um e-mail
-- com o cupom inteiro.

alter table public.caixa_movimentos
  add column if not exists recebido_cents integer,
  add column if not exists troco_cents integer not null default 0,
  add column if not exists detalhe text,
  add column if not exists parcelas integer;
alter table public.comandas
  add column if not exists horario_original jsonb,
  add column if not exists pagamentos jsonb not null default '[]'::jsonb,
  add column if not exists cupom_enviado_em timestamptz,
  add column if not exists atendida_por text;

-- a cliente vê a própria comanda (para o cupom no app)
drop policy if exists "comandas: a casa ve" on public.comandas;
create policy "comandas: a casa ve" on public.comandas for select to authenticated
  using (public.is_admin_do_salao(salon_id) or public.eh_plataforma() or client_id = auth.uid()
         or exists (select 1 from public.professionals p where p.id = professional_id and p.user_id = auth.uid()));

-- 1. Fechar, agora com troco, detalhe e o cupom -------------------------------------------------
create or replace function public.pdv_fechar(salao uuid, comanda jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  prof public.professionals%rowtype;
  appt uuid; cli uuid; nome text; obs text;
  itens jsonb; pagos jsonb; it jsonb; pg jsonb; pagos_ok jsonb := '[]'::jsonb;
  subtotal integer := 0; desconto integer; total integer; sinal integer := 0; pago integer := 0;
  duracao integer := 0; agora timestamp := public.agora_local();
  nova uuid; primeiro uuid; i integer := 0; fim_av timestamp; dur_av interval; ult timestamp;
  v integer; rec integer; troco integer; forma text; mandar_cupom boolean;
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

  for it in select * from jsonb_array_elements(itens) loop
    if coalesce(it ->> 'nome', '') = '' then raise exception 'Item sem nome.'; end if;
    subtotal := subtotal + coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    duracao := duracao + coalesce((it ->> 'duracao')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1));
    if primeiro is null then begin primeiro := nullif(it ->> 'service_id', '')::uuid; exception when others then primeiro := null; end; end if;
  end loop;
  if desconto > subtotal then raise exception 'O desconto é maior que a comanda.'; end if;
  total := subtotal - desconto;
  if primeiro is null then select id into primeiro from public.services sv where sv.salon_id = salao and sv.active order by sv.name limit 1; end if;
  if primeiro is null and appt is null then raise exception 'Cadastre ao menos um serviço no catálogo para fechar comanda avulsa.'; end if;

  if appt is not null then
    select * into a from public.appointments where id = appt;
    if a.id is null or a.salon_id <> salao then raise exception 'Horário não encontrado neste salão.'; end if;
    if a.status not in ('pendente', 'confirmado') then raise exception 'Este horário não está esperando fechamento (%).', a.status; end if;
    if exists (select 1 from public.comandas c where c.appointment_id = appt and c.status = 'fechada') then raise exception 'Este horário já tem comanda fechada.'; end if;
    -- a comanda fecha no dia do atendimento (ou depois, se ficou para trás); nunca antes
    if a.date > agora::date then raise exception 'Esse horário é de %. A comanda fecha no dia do atendimento.', to_char(a.date, 'DD/MM'); end if;
    sinal := coalesce(a.pago_cents, 0);
    cli := coalesce(cli, a.client_id);
    nome := coalesce(nome, a.guest_name);
  end if;
  if cli is null and nome is null then raise exception 'Diga quem é a cliente (ou o nome, se for avulsa).'; end if;

  -- os pagamentos: valor, e no dinheiro o que ela entregou (troco = entregue - valor)
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
    if a.date = agora::date and (a.date + a.start_time) > agora then
      -- ela chegou antes (hoje): o horário passa a começar agora, com a duração de sempre (ou o que couber)
      begin
        update public.appointments set start_time = agora::time, end_time = least(agora::time + (a.end_time - a.start_time), time '23:59') where id = appt;
      exception when exclusion_violation or unique_violation then
        begin
          -- outro horário começa neste minuto: encosta um minuto antes
          update public.appointments set start_time = greatest(agora - interval '1 minute', agora::date + time '00:00')::time, end_time = agora::time where id = appt;
        exception when exclusion_violation or unique_violation then
          null;   -- sem espaço para encostar: fica com a hora marcada, e fecha do mesmo jeito
        end;
      end;
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
    fim_av := agora; dur_av := make_interval(mins => greatest(duracao, 15));
    -- perto da meia-noite, a brecha não pode vazar para o dia anterior
    if fim_av < agora::date + interval '1 minute' then fim_av := agora::date + interval '1 minute'; end if;
    if fim_av - dur_av < agora::date then dur_av := greatest(fim_av - agora::date, interval '1 minute'); end if;
    for i in 1..20 loop
      select min(x.date + x.start_time) into ult from public.appointments x
       where x.professional_id = prof.id and x.date = agora::date and x.status not in ('cancelado', 'faltou')
         and (x.date + x.start_time) < fim_av and (x.date + x.end_time) > fim_av - dur_av;
      exit when ult is null;
      fim_av := ult;
      if fim_av - dur_av < agora::date + time '00:01' then dur_av := interval '1 minute'; end if;
      if fim_av <= agora::date + time '00:01' then
        -- não coube antes de agora: vai para a primeira brecha depois de agora
        fim_av := null; exit;
      end if;
    end loop;
    if fim_av is null then
      dur_av := make_interval(mins => greatest(duracao, 15));
      ult := agora;                       -- aqui `ult` é o começo candidato
      for i in 1..20 loop
        select max(x.date + x.end_time) into fim_av from public.appointments x
         where x.professional_id = prof.id and x.date = agora::date and x.status not in ('cancelado', 'faltou')
           and (x.date + x.start_time) < ult + dur_av and (x.date + x.end_time) > ult;
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
  end if;

  insert into public.comandas (salon_id, appointment_id, client_id, cliente_nome, professional_id, itens, subtotal_cents, desconto_cents, total_cents, sinal_app_cents, observacao, por, pagamentos, atendida_por, horario_original)
  values (salao, nova, cli, nome, prof.id, itens, subtotal, desconto, total, sinal, obs, auth.uid(), pagos_ok, prof.name,
          case when appt is not null then jsonb_build_object('date', a.date, 'start_time', a.start_time, 'end_time', a.end_time, 'status', a.status, 'price_cents', a.price_cents, 'service_name', a.service_name) else null end)
  returning id into primeiro;
  for pg in select * from jsonb_array_elements(pagos_ok) loop
    insert into public.caixa_movimentos (salon_id, comanda_id, appointment_id, professional_id, forma, valor_cents, por, recebido_cents, troco_cents, detalhe, parcelas)
    values (salao, primeiro, nova, prof.id, pg ->> 'forma', (pg ->> 'valor_cents')::integer, auth.uid(), (pg ->> 'recebido_cents')::integer, coalesce((pg ->> 'troco_cents')::integer, 0), pg ->> 'detalhe', (pg ->> 'parcelas')::integer);
  end loop;

  if mandar_cupom and cli is not null then
    begin perform public.enviar_cupom(primeiro); exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'comanda_id', primeiro, 'appointment_id', nova, 'total_cents', total, 'sinal_app_cents', sinal,
    'cupom', mandar_cupom and cli is not null);
end;
$$;
revoke execute on function public.pdv_fechar(uuid, jsonb) from public, anon;
grant execute on function public.pdv_fechar(uuid, jsonb) to authenticated;

-- 2. O cupom -----------------------------------------------------------------------------------------
create or replace function public.rotulo_forma(f text)
returns text
language sql
immutable
as $$
  select case f when 'dinheiro' then 'Dinheiro' when 'debito' then 'Cartão de débito' when 'credito' then 'Cartão de crédito'
                when 'pix' then 'PIX' when 'app' then 'Pago pelo app' else 'Outro' end;
$$;

-- o cupom em HTML para o e-mail (a tela do app monta o dela a partir de comprovante_da_comanda)
create or replace function public.cupom_html(comanda uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare c public.comandas%rowtype; s public.salons%rowtype; a public.appointments%rowtype; it jsonb; pg jsonb; linhas text := ''; pags text := ''; quando text;
begin
  select * into c from public.comandas where id = comanda;
  if c.id is null then return null; end if;
  select * into s from public.salons where id = c.salon_id;
  if c.appointment_id is not null then select * into a from public.appointments where id = c.appointment_id; end if;
  quando := to_char(coalesce(a.date, (c.fechada_em at time zone 'America/Sao_Paulo')::date), 'DD/MM/YYYY') || case when a.start_time is not null then ' às ' || to_char(a.start_time, 'HH24:MI') else '' end;
  for it in select * from jsonb_array_elements(c.itens) loop
    linhas := linhas || '<tr><td style="padding:6px 0;border-bottom:1px solid #f0e6f2">' || public.escapar_html(coalesce(it ->> 'nome', 'Serviço'))
      || case when coalesce((it ->> 'qtd')::integer, 1) > 1 then ' × ' || (it ->> 'qtd') else '' end
      || '</td><td style="padding:6px 0;border-bottom:1px solid #f0e6f2;text-align:right;white-space:nowrap">R$ '
      || to_char(coalesce((it ->> 'preco_cents')::integer, 0) * greatest(1, coalesce((it ->> 'qtd')::integer, 1)) / 100.0, 'FM999G990D00') || '</td></tr>';
  end loop;
  for pg in select * from jsonb_array_elements(c.pagamentos) loop
    pags := pags || '<tr><td style="padding:4px 0;color:#6b7280">' || public.rotulo_forma(pg ->> 'forma')
      || case when nullif(pg ->> 'parcelas', '') is not null and (pg ->> 'parcelas')::integer > 1 then ' em ' || (pg ->> 'parcelas') || 'x' else '' end
      || case when nullif(pg ->> 'detalhe', '') is not null and (pg ->> 'forma') <> 'app' then ' · ' || public.escapar_html(pg ->> 'detalhe') else '' end
      || '</td><td style="padding:4px 0;text-align:right;white-space:nowrap">R$ ' || to_char(coalesce((pg ->> 'valor_cents')::integer, 0) / 100.0, 'FM999G990D00') || '</td></tr>'
      || case when coalesce((pg ->> 'troco_cents')::integer, 0) > 0 then '<tr><td style="padding:0 0 4px;color:#6b7280;font-size:12px">entregue R$ ' || to_char((pg ->> 'recebido_cents')::integer / 100.0, 'FM999G990D00') || ' · troco R$ ' || to_char((pg ->> 'troco_cents')::integer / 100.0, 'FM999G990D00') || '</td><td></td></tr>' else '' end;
  end loop;
  return '<p style="margin:0 0 4px;font-size:15px">Seu comprovante em <strong>' || public.escapar_html(s.name) || '</strong></p>'
    || '<p style="margin:0 0 18px;color:#6b7280;font-size:13px">' || quando || case when c.atendida_por is not null then ' · com ' || public.escapar_html(c.atendida_por) else '' end || '</p>'
    || '<table style="width:100%;border-collapse:collapse;font-size:14px">' || linhas
    || case when c.desconto_cents > 0 then '<tr><td style="padding:6px 0;color:#6b7280">Desconto</td><td style="padding:6px 0;text-align:right">− R$ ' || to_char(c.desconto_cents / 100.0, 'FM999G990D00') || '</td></tr>' else '' end
    || '<tr><td style="padding:10px 0 4px;font-weight:700;font-size:16px">Total</td><td style="padding:10px 0 4px;text-align:right;font-weight:800;font-size:18px;color:#3d0c4e">R$ ' || to_char(c.total_cents / 100.0, 'FM999G990D00') || '</td></tr>'
    || '</table>'
    || '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:10px;border-top:1px dashed #e5e7eb;padding-top:8px">' || pags || '</table>'
    || case when s.address is not null then '<p style="margin:18px 0 0;font-size:12px;color:#8a8a94">' || public.escapar_html(s.name) || case when s.cnpj is not null then ' · CNPJ ' || s.cnpj else '' end || '<br>' || public.escapar_html(coalesce(s.address, '')) || case when s.city is not null then ' · ' || public.escapar_html(s.city) else '' end || '</p>' else '' end
    || '<p style="margin:12px 0 18px;font-size:12px;color:#8a8a94">Comprovante nº ' || left(c.id::text, 8) || ' · emitido pelo MIMO. Não é documento fiscal.</p>';
end;
$$;
revoke execute on function public.cupom_html(uuid) from public, anon, authenticated;

create or replace function public.enviar_cupom(comanda uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.comandas%rowtype; s public.salons%rowtype; pessoa record; html text; link text; primeiro text; mandou_email boolean := false;
begin
  select * into c from public.comandas where id = comanda;
  if c.id is null then raise exception 'Comanda não encontrada.'; end if;
  if not (public.is_admin_do_salao(c.salon_id) or public.eh_plataforma()) then raise exception 'Sem permissão.'; end if;
  if c.client_id is null then return jsonb_build_object('ok', false, 'motivo', 'cliente avulsa, sem conta'); end if;
  select * into s from public.salons where id = c.salon_id;
  link := public.app_base() || '/cliente/comanda/' || c.id::text;
  perform public.notificar(c.client_id, 'cupom_atendimento', 'Seu comprovante de hoje',
    'R$ ' || to_char(c.total_cents / 100.0, 'FM999G990D00') || ' em ' || s.name || coalesce(', com ' || c.atendida_por, '') || '. Toque para ver o cupom.',
    '/cliente/comanda/' || c.id::text, jsonb_build_object('comanda_id', c.id, 'professional_id', c.professional_id));
  select u.email, p.full_name, p.aceita_email into pessoa from auth.users u join public.profiles p on p.id = u.id where u.id = c.client_id;
  if found and pessoa.email is not null and coalesce(pessoa.aceita_email, true) then
    primeiro := nullif(split_part(coalesce(pessoa.full_name, ''), ' ', 1), '');
    html := public.email_layout(primeiro, public.cupom_html(c.id), 'Ver no app', link,
      'Você recebe este e-mail porque foi atendida em ' || public.escapar_html(s.name) || ' e tem conta no MIMO.');
    perform public.enfileirar_email(pessoa.email, 'Seu comprovante em ' || s.name, html, 'cupom_atendimento', 'Seu comprovante: R$ ' || to_char(c.total_cents / 100.0, 'FM999G990D00') || ' em ' || s.name || '. Veja em ' || link, pessoa.full_name, c.client_id);
    mandou_email := true;
  end if;
  update public.comandas set cupom_enviado_em = now() where id = c.id;
  begin perform public.chutar_agora(); exception when others then null; end;
  return jsonb_build_object('ok', true, 'email', mandou_email);
end;
$$;
revoke execute on function public.enviar_cupom(uuid) from public, anon;
grant execute on function public.enviar_cupom(uuid) to authenticated;

-- 3. O cupom no app da cliente (e a dona também pode olhar) -----------------------------------------
create or replace function public.comprovante_da_comanda(comanda uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'fechada_em', c.fechada_em, 'status', c.status, 'itens', c.itens, 'subtotal_cents', c.subtotal_cents, 'desconto_cents', c.desconto_cents,
    'total_cents', c.total_cents, 'sinal_app_cents', c.sinal_app_cents, 'pagamentos', c.pagamentos, 'atendida_por', c.atendida_por, 'observacao', c.observacao,
    'appointment_id', c.appointment_id, 'dia', a.date, 'hora', a.start_time,
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'tipo', s.tipo, 'endereco', s.address, 'cidade', s.city, 'cnpj', s.cnpj, 'logo_url', s.logo_url),
    'cliente', coalesce(nullif(btrim(pf.full_name), ''), c.cliente_nome))
  from public.comandas c
  join public.salons s on s.id = c.salon_id
  left join public.appointments a on a.id = c.appointment_id
  left join public.profiles pf on pf.id = c.client_id
  where c.id = comanda and (c.client_id = auth.uid() or public.is_admin_do_salao(c.salon_id) or public.eh_plataforma());
$$;
revoke execute on function public.comprovante_da_comanda(uuid) from public, anon;
grant execute on function public.comprovante_da_comanda(uuid) to authenticated;

-- 4. Avisos ------------------------------------------------------------------------------------------
insert into public.modelos_de_mensagem (chave, grupo, titulo, descricao, variaveis, padrao, ordem, exemplo) values
('push.cupom_atendimento', 'push', 'Comprovante do atendimento', 'Ao fechar a comanda no balcão, a cliente recebe o cupom no app.', '{titulo,texto,nome}', E'{titulo}\n{texto}', 840,
  '{"titulo":"Seu comprovante de hoje","texto":"R$ 120,00 em Studio Mel, com Camila. Toque para ver o cupom."}')
on conflict (chave) do update set grupo = excluded.grupo, titulo = excluded.titulo, descricao = excluded.descricao,
  variaveis = excluded.variaveis, ordem = excluded.ordem, exemplo = excluded.exemplo;
insert into public.push_regras (kind, envia) values ('cupom_atendimento', true) on conflict (kind) do nothing;

-- 5. Estornar devolve o horário como era (hora, valor e situação de antes) ----------------------------
create or replace function public.pdv_estornar(comanda uuid, motivo text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare c public.comandas%rowtype; h jsonb;
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
    h := c.horario_original;
    perform public.silenciar_gatilho();
    if h is not null then
      begin
        update public.appointments
           set status = coalesce(h ->> 'status', 'confirmado'), baixa_por = null,
               start_time = coalesce((h ->> 'start_time')::time, start_time), end_time = coalesce((h ->> 'end_time')::time, end_time),
               price_cents = (h ->> 'price_cents')::integer, service_name = h ->> 'service_name'
         where id = c.appointment_id and status = 'concluido';
      exception when exclusion_violation then
        -- o lugar de antes foi ocupado enquanto isso: volta só a situação
        update public.appointments set status = coalesce(h ->> 'status', 'confirmado'), baixa_por = null where id = c.appointment_id and status = 'concluido';
      end;
    else
      update public.appointments set status = 'confirmado', baixa_por = null where id = c.appointment_id and status = 'concluido';
    end if;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.pdv_estornar(uuid, text) from public, anon;
grant execute on function public.pdv_estornar(uuid, text) to authenticated;
