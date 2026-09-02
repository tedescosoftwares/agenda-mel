-- =============================================================
-- Agenda Mel — 039: pedido com prazo não pode esperar na fila
--
-- Duas falhas que só apareceram com o fluxo inteiro rodando.
--
-- 1. O aviso do pedido ia para a message_outbox, como todo o resto. Mas
--    todo o resto não tem cronômetro. Um pedido que dá 2 horas para a
--    profissional responder, parado numa fila que ninguém escoa, expira
--    antes de ela ficar sabendo que existia. A resposta para a cliente
--    já saía na hora, pelo webhook; o aviso dela tem que sair igual.
--
--    A linha na fila continua existindo — é o registro de que a mensagem
--    saiu, e é o plano B se o envio na hora falhar. O que muda é que
--    quem envia é o webhook, na mesma requisição, e depois marca a linha
--    como enviada.
--
-- 2. Aceitar pela AGENDA (mudando o status na tela) não fechava o
--    pedido. A linha em aceites continuava aberta, e o vencimento
--    passava por cima depois — podendo cancelar um horário que a
--    profissional já tinha confirmado com as próprias mãos.
-- =============================================================

-- 1. Qualquer caminho que mexa no status fecha o pedido ------------------
create or replace function public.fecha_aceite_ao_mudar_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  update public.aceites
  set resultado = case when new.status = 'confirmado' then 'aceito' else 'recusado' end,
      resolvido_em = now()
  where appointment_id = new.id
    and resultado is null;

  return new;
end;
$$;

drop trigger if exists tg_fecha_aceite on public.appointments;
create trigger tg_fecha_aceite
  after update of status on public.appointments
  for each row execute function public.fecha_aceite_ao_mudar_status();

-- 2. pedir_aceite devolve o que precisa ser enviado na hora --------------
create or replace function public.pedir_aceite(appt uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  p public.professionals%rowtype;
  tel_prof text;
  tel_cli text;
  nome_cli text;
  quando text;
  prazo timestamptz;
  aviso uuid;
  na_fila record;
begin
  select * into a from public.appointments where id = appt;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sem agendamento'); end if;

  select * into p from public.professionals where id = a.professional_id;
  if not found or not p.aceite_manual then
    return jsonb_build_object('ok', false, 'motivo', 'aceite desligado');
  end if;

  select public.telefone_e164(pf.phone) into tel_prof
  from public.profiles pf where pf.id = p.user_id;

  select public.telefone_e164(pf.phone), nullif(btrim(pf.full_name), '')
    into tel_cli, nome_cli
  from public.profiles pf where pf.id = a.client_id;

  if tel_prof is null then
    return jsonb_build_object('ok', false, 'motivo', 'profissional sem telefone');
  end if;

  prazo := now() + make_interval(mins => p.minutos_para_aceitar);
  quando := public.dia_por_extenso(a.date) || ' às ' || to_char(a.start_time, 'HH24:MI');

  insert into public.aceites
    (appointment_id, professional_id, salon_id, telefone_prof, telefone_cliente, expira_em)
  values (appt, p.id, a.salon_id, tel_prof, coalesce(tel_cli, ''), prazo)
  on conflict (appointment_id) do nothing;

  aviso := public.notificar(
    p.user_id, 'pedido_de_aceite', 'Pedido de horário',
    coalesce(nome_cli, 'Uma cliente') || ' quer ' ||
      coalesce(a.service_name, 'um atendimento') || ' ' || quando,
    '/pro/pedidos',
    jsonb_build_object('appointment_id', appt, 'professional_id', p.id));

  -- a linha que o notificar() acabou de pôr na fila, para quem chamou
  -- poder mandar agora e marcar como enviada
  select o.id, o.telefone, o.corpo into na_fila
  from public.message_outbox o
  where o.notification_id = aviso and o.status = 'na_fila'
  limit 1;

  return jsonb_build_object('ok', true, 'expira_em', prazo,
    'minutos', p.minutos_para_aceitar,
    'avisar', case when na_fila.id is not null then
      jsonb_build_object('fila_id', na_fila.id,
                         'telefone', na_fila.telefone,
                         'corpo', na_fila.corpo)
    end);
end;
$$;

revoke execute on function public.pedir_aceite(uuid)
  from public, anon, authenticated;

-- 3. O aviso sobe pela conversa até quem envia ----------------------------
create or replace function public.fechar_pela_conversa(
  cliente uuid, prof uuid, salao uuid, serv uuid,
  dia date, hora time, dur integer
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  manual boolean;
  novo uuid;
  pedido jsonb;
begin
  select aceite_manual into manual from public.professionals where id = prof;

  insert into public.appointments
    (client_id, professional_id, salon_id, service_id,
     date, start_time, end_time, status)
  values
    (cliente, prof, salao, serv, dia, hora,
     (hora + make_interval(mins => dur))::time,
     case when coalesce(manual, false) then 'pendente' else 'confirmado' end)
  returning id into novo;

  if coalesce(manual, false) then
    pedido := public.pedir_aceite(novo);
    if not coalesce((pedido ->> 'ok')::boolean, false) then
      update public.appointments set status = 'confirmado' where id = novo;
      return jsonb_build_object('appointment_id', novo, 'pendente', false);
    end if;
    return jsonb_build_object('appointment_id', novo, 'pendente', true,
                              'minutos', pedido -> 'minutos',
                              'avisar', pedido -> 'avisar');
  end if;

  return jsonb_build_object('appointment_id', novo, 'pendente', false);
end;
$$;

revoke execute on function
  public.fechar_pela_conversa(uuid, uuid, uuid, uuid, date, time, integer)
  from public, anon, authenticated;

-- 4. Marcar como enviada, para o webhook chamar depois de mandar ---------
create or replace function public.avisei_na_hora(fila_id uuid, id_provedor text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.confirmar_envio(fila_id, id_provedor);
end;
$$;

revoke execute on function public.avisei_na_hora(uuid, text)
  from public, anon, authenticated;

-- 5. A conversa repassa o aviso -------------------------------------------
create or replace function public.avancar_conversa(
  tel text,
  texto text,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  c public.conversas%rowtype;
  cliente uuid;
  escolha jsonb;
  novas jsonb;
  d jsonb;
  cabecalho text := '';
  limpo text;
  dur integer;
  nome_serv text;
  prof_id uuid;
  prof_nome text;
  dia_esc date;
  hora_esc time;
  novo_appt uuid;
  fecho jsonb;
  quantos integer;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  limpo := lower(btrim(coalesce(texto, '')));
  limpo := translate(limpo, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');

  -- Sair da conversa é sagrado: tem que funcionar em qualquer passo, e
  -- tem que ser óbvio. Ninguém fica preso num menu.
  if limpo in ('cancelar', 'parar', 'sair', 'desistir', 'deixa', 'deixa pra la') then
    delete from public.conversas where telefone = e164;
    return jsonb_build_object('acao', 'desistiu',
      'responder', 'Tudo bem, cancelei por aqui. Quando quiser, é só chamar 💛');
  end if;

  -- conversa velha não vale: apaga antes de ler
  delete from public.conversas where telefone = e164 and expira_em < now();
  select * into c from public.conversas where telefone = e164;

  -- ---------------------------------------------------------------------
  -- Começo
  -- ---------------------------------------------------------------------
  if not found then
    -- Quem chama normalmente passa o salão, mas depender disso é frágil:
    -- basta a conversa expirar no meio para a próxima mensagem chegar sem
    -- ele, e a cliente receber silêncio. O histórico responde.
    if salao is null then
      select o.salon_id into salao
      from public.message_outbox o
      where o.telefone = e164
      order by o.criado_em desc
      limit 1;
    end if;
    if salao is null then
      return jsonb_build_object('acao', 'sem_canal');
    end if;

    cliente := public.cliente_pelo_telefone(e164);
    if cliente is null then
      -- O bot marca para quem já é cliente. Criar conta exige criar
      -- usuário de autenticação, que não é coisa para uma conversa de
      -- WhatsApp fazer sozinha — e um cadastro meia-boca vira cliente
      -- duplicada na agenda de alguém.
      return jsonb_build_object('acao', 'sem_cadastro');
    end if;

    -- os apelidos levam sufixo _c porque plpgsql resolve nome de coluna
    -- e de variável no mesmo escopo: uma coluna chamada "dur" ao lado da
    -- variável "dur" faz o Postgres recusar a consulta inteira
    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', rotulo_c,
             'busca', nome_c, 'dur', dur_c))
      into novas
    from (
      select row_number() over (order by s.name) as linha_c,
             s.id as id_c, s.name as nome_c, s.duration_minutes as dur_c,
             s.name || ' · R$ ' || to_char(s.price, 'FM999G990D00') as rotulo_c
      from public.services s
      where s.salon_id = salao and s.active
      order by s.name
      limit 9
    ) t;

    if novas is null then
      return jsonb_build_object('acao', 'sem_servico',
        'responder', 'Ainda não tenho serviços cadastrados por aqui 😅');
    end if;

    insert into public.conversas (telefone, salon_id, client_id, estado, opcoes, dados)
    values (e164, salao, cliente, 'servico', novas, '{}'::jsonb);

    return jsonb_build_object('acao', 'perguntou', 'estado', 'servico',
      'responder', '💛 Vamos marcar! O que você quer fazer?' || E'\n\n'
                   || public.lista_numerada(novas) || E'\n\n'
                   || '_Responda com o número._');
  end if;

  escolha := public.escolher_opcao(c.opcoes, texto);
  if escolha is null then
    return jsonb_build_object('acao', 'nao_entendi', 'estado', c.estado,
      'responder', '🤔 Não peguei. Responda com o número de uma das opções:'
                   || E'\n\n' || public.lista_numerada(c.opcoes)
                   || E'\n\n' || '_Ou responda CANCELAR para parar._');
  end if;

  d := c.dados;

  -- ---------------------------------------------------------------------
  -- Escolheu o serviço -> quem atende
  -- ---------------------------------------------------------------------
  if c.estado = 'servico' then
    d := d || jsonb_build_object('servico_id', escolha ->> 'id',
                                 'servico', escolha ->> 'busca',
                                 'dur', (escolha ->> 'dur')::int);

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', id_c, 'rotulo', nome_c, 'busca', nome_c))
      into novas
    from (
      select row_number() over (order by p.name) as linha_c,
             p.id as id_c, p.name as nome_c
      from public.professionals p
      join public.professional_services ps on ps.professional_id = p.id
      where p.salon_id = c.salon_id and p.active
        and ps.service_id = (escolha ->> 'id')::uuid
      order by p.name
      limit 9
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_profissional',
        'responder', 'Ninguém está atendendo esse serviço agora 😕 Me chama que a gente dá um jeito.');
    end if;

    select count(*) into quantos from jsonb_array_elements(novas);

    -- uma profissional só: perguntar seria burocracia
    if quantos = 1 then
      escolha := novas -> 0;
      cabecalho := '✨ ' || (d ->> 'servico') || ' com *' || (escolha ->> 'rotulo') || '*' || E'\n\n';
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
      c.estado := 'profissional';
    else
      update public.conversas
      set estado = 'profissional', dados = d, opcoes = novas,
          atualizada_em = now(), expira_em = now() + interval '30 minutes'
      where telefone = e164;

      return jsonb_build_object('acao', 'perguntou', 'estado', 'profissional',
        'responder', '✨ ' || (d ->> 'servico') || '! Com quem você prefere?'
                     || E'\n\n' || public.lista_numerada(novas)
                     || E'\n\n' || '_Responda com o número._');
    end if;
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu quem atende -> que dia
  -- ---------------------------------------------------------------------
  if c.estado = 'profissional' then
    if d ->> 'prof_id' is null then
      d := d || jsonb_build_object('prof_id', escolha ->> 'id', 'prof', escolha ->> 'rotulo');
    end if;
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', dia_c::text, 'rotulo', rotulo_c, 'busca', rotulo_c))
      into novas
    from (
      select row_number() over (order by v.dia) as linha_c, v.dia as dia_c,
             public.dia_por_extenso(v.dia) || ' · ' || v.vagas || ' horários' as rotulo_c
      from public.dias_com_vaga(prof_id, dur, 5) v
    ) t;

    if novas is null then
      delete from public.conversas where telefone = e164;
      return jsonb_build_object('acao', 'sem_vaga',
        'responder', 'Puxa, a agenda dela está cheia nos próximos dias 😕'
                     || E'\n\n' || 'Me chama que a gente encaixa você.');
    end if;

    update public.conversas
    set estado = 'dia', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'dia',
      'responder', cabecalho || '📅 Que dia fica melhor?' || E'\n\n'
                   || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu o dia -> que horas
  -- ---------------------------------------------------------------------
  if c.estado = 'dia' then
    d := d || jsonb_build_object('dia', escolha ->> 'id');
    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;

    select jsonb_agg(jsonb_build_object(
             'n', linha_c, 'id', to_char(hora_c, 'HH24:MI'),
             'rotulo', to_char(hora_c, 'HH24:MI'), 'busca', to_char(hora_c, 'HH24:MI')))
      into novas
    from (
      select row_number() over (order by h.hora) as linha_c, h.hora as hora_c
      from public.horarios_livres(prof_id, dia_esc, dur) h
      limit 9
    ) t;

    if novas is null then
      -- alguém pegou o dia entre a pergunta e a resposta
      update public.conversas set estado = 'profissional', dados = d,
             atualizada_em = now() where telefone = e164;
      return jsonb_build_object('acao', 'dia_lotou',
        'responder', 'Esse dia acabou de encher 😕 Responda qualquer coisa que eu mostro os outros.');
    end if;

    update public.conversas
    set estado = 'hora', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'hora',
      'responder', '🕒 ' || public.dia_por_extenso(dia_esc) || '. Que horas?'
                   || E'\n\n' || public.lista_numerada(novas)
                   || E'\n\n' || '_Responda com o número._');
  end if;

  -- ---------------------------------------------------------------------
  -- Escolheu a hora -> confere antes de marcar
  -- ---------------------------------------------------------------------
  if c.estado = 'hora' then
    d := d || jsonb_build_object('hora', escolha ->> 'id');
    novas := jsonb_build_array(
      jsonb_build_object('n', 1, 'id', 'sim', 'rotulo', 'Confirmar', 'busca', 'confirmar sim isso'),
      jsonb_build_object('n', 2, 'id', 'nao', 'rotulo', 'Recomeçar',  'busca', 'recomecar nao mudar'));

    update public.conversas
    set estado = 'confirma', dados = d, opcoes = novas,
        atualizada_em = now(), expira_em = now() + interval '30 minutes'
    where telefone = e164;

    return jsonb_build_object('acao', 'perguntou', 'estado', 'confirma',
      'responder', 'Confere pra mim:' || E'\n\n'
                   || '✨ ' || (d ->> 'servico') || E'\n'
                   || '👩 com *' || (d ->> 'prof') || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso((d ->> 'dia')::date)
                   || ' às ' || (d ->> 'hora') || E'\n\n'
                   || public.lista_numerada(novas));
  end if;

  -- ---------------------------------------------------------------------
  -- Confirmou -> marca de verdade
  -- ---------------------------------------------------------------------
  if c.estado = 'confirma' then
    if (escolha ->> 'id') = 'nao' then
      delete from public.conversas where telefone = e164;
      return public.avancar_conversa(e164, 'recomecar', c.salon_id);
    end if;

    dur := (d ->> 'dur')::int;
    prof_id := (d ->> 'prof_id')::uuid;
    dia_esc := (d ->> 'dia')::date;
    hora_esc := (d ->> 'hora')::time;
    nome_serv := d ->> 'servico';
    prof_nome := d ->> 'prof';

    -- Entre a pergunta e a resposta dela, alguém pode ter marcado. O
    -- índice único de (data, hora) barra o choque, mas conferir antes
    -- deixa a resposta decente em vez de um erro de banco.
    if not exists (
      select 1 from public.horarios_livres(prof_id, dia_esc, dur) h
      where h.hora = hora_esc
    ) then
      update public.conversas set estado = 'profissional', atualizada_em = now()
      where telefone = e164;
      return jsonb_build_object('acao', 'hora_foi',
        'responder', 'Que pena, pegaram esse horário agora 😕'
                     || E'\n\n' || 'Responda qualquer coisa que eu mostro os que sobraram.');
    end if;

    fecho := public.fechar_pela_conversa(
               c.client_id, prof_id, c.salon_id, (d ->> 'servico_id')::uuid,
               dia_esc, hora_esc, dur);
    novo_appt := (fecho ->> 'appointment_id')::uuid;

    delete from public.conversas where telefone = e164;

    -- Quem espera aceite ouve outra coisa. Dizer "marcado" e depois
    -- voltar atrás seria pior do que ser honesto agora.
    if coalesce((fecho ->> 'pendente')::boolean, false) then
      return jsonb_build_object('acao', 'pediu', 'appointment_id', novo_appt,
        -- sobe junto o que precisa ser mandado para a profissional AGORA:
        -- o prazo dela já começou a correr
        'avisar', fecho -> 'avisar',
        'responder', '📩 *Pedido enviado!*' || E'\n\n'
                     || '✨ ' || nome_serv || E'\n'
                     || '👩 com *' || prof_nome || '*' || E'\n'
                     || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                     || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                     || 'Guardei esse horário pra você. Assim que a *'
                     || prof_nome || '* confirmar, eu te aviso aqui 💛');
    end if;

    return jsonb_build_object('acao', 'marcou', 'appointment_id', novo_appt,
      'responder', '✅ *Marcado!*' || E'\n\n'
                   || '✨ ' || nome_serv || E'\n'
                   || '👩 com *' || prof_nome || '*' || E'\n'
                   || '🗓️ ' || public.dia_por_extenso(dia_esc) || ' às '
                   || to_char(hora_esc, 'HH24:MI') || E'\n\n'
                   || 'Te espero! Se precisar mudar, é só me chamar 💛');
  end if;

  return jsonb_build_object('acao', 'nada');
end;
$$;

revoke execute on function public.avancar_conversa(text, text, uuid)
  from public, anon, authenticated;
