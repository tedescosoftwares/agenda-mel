-- 215: a promoção completa do salão do guia (3.71)
--
-- A Plataforma promove um salão do guia a salão com agenda de ponta a ponta: a conta da dona (criada
-- pela Edge Function plataforma-promover, com ou sem o e-mail de confirmação), o salão com os dados
-- do guia e os que faltavam (e-mail, WhatsApp, CPF/CNPJ), o plano pela equipe prevista, o teste de
-- 7 dias disparado e a primeira mensalidade emitida por Pix para vencer quando o teste acaba.
--
--   guia_promover_interno(lugar_, dono, tipo_, dados)   o miolo (liga ou cria o salão, copia o guia)
--   guia_promover(lugar_, dono_email_, tipo_)            o de antes (212), agora por cima do miolo
--   plataforma_conta_por_email(email_)                   a conta já existe? confirmada? já tem negócio?
--   plataforma_promover_guia(lugar_, dono_, dados)       o salão, o teste e a cobrança
--   cobranca_mimo_lote(cobranca)                         uma cobrança no formato que o Asaas precisa
--   plataforma_promocao_mensagens(salao, link, modo, cobranca)  o e-mail e o texto do WhatsApp

-- ---------------------------------------------------------------------------
-- 1. o miolo: liga ao salão da dona ou cria um novo com os dados do guia
-- ---------------------------------------------------------------------------
create or replace function public.guia_promover_interno(lugar_ uuid, dono uuid, tipo_ text default 'salao', dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.guia_lugares%rowtype;
  s public.salons%rowtype;
  r jsonb;
  novo boolean := false;
  cep8 text;
  doc text := regexp_replace(coalesce(dados ->> 'documento', ''), '\D', '', 'g');
  zap text := regexp_replace(coalesce(dados ->> 'whatsapp', ''), '\D', '', 'g');
  email_ text := lower(btrim(coalesce(dados ->> 'email', '')));
  equipe integer := nullif((dados ->> 'equipe')::integer, 0);
begin
  select * into l from public.guia_lugares where id = lugar_;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Salão do guia não encontrado.'); end if;
  if l.salon_id is not null then
    return jsonb_build_object('ok', false, 'motivo', 'Esse salão do guia já está ligado a um salão da MIMO.', 'salao_id', l.salon_id);
  end if;
  if dono is null or not exists (select 1 from public.profiles where id = dono) then
    return jsonb_build_object('ok', false, 'motivo', 'Conta da dona não encontrada.');
  end if;

  -- o salão da dona que ainda não está no guia; senão, nasce um com o nome e a cidade do guia
  select * into s from public.salons x
   where x.owner_id = dono and not exists (select 1 from public.guia_lugares g where g.salon_id = x.id)
   order by x.created_at desc limit 1;
  if not found then
    begin
      r := public.abrir_negocio_interno(dono, case when tipo_ = 'autonoma' then 'autonoma' else 'salao' end, l.nome, l.cidade);
    exception when others then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    end;
    select * into s from public.salons where id = (r ->> 'salao_id')::uuid;
    novo := true;
  end if;

  cep8 := regexp_replace(coalesce(l.cep, ''), '\D', '', 'g');
  update public.salons x set
    address = coalesce(x.address, l.endereco),
    bairro = coalesce(x.bairro, l.bairro),
    cep = coalesce(x.cep, case when cep8 ~ '^[0-9]{8}$' then cep8 end),
    uf = coalesce(x.uf, l.uf),
    city = coalesce(x.city, l.cidade),
    phone = coalesce(x.phone, nullif(zap, ''), l.telefone, l.whatsapp),
    whatsapp = coalesce(nullif(left(zap, 30), ''), x.whatsapp, left(l.whatsapp, 30)),
    instagram = coalesce(x.instagram, left(l.instagram, 60)),
    lat = case when x.lat is null and l.latitude is not null and l.longitude is not null then l.latitude else x.lat end,
    lng = case when x.lng is null and l.latitude is not null and l.longitude is not null then l.longitude else x.lng end,
    fotos = case when coalesce(array_length(x.fotos, 1), 0) = 0 then coalesce(l.fotos, '{}') else x.fotos end,
    descricao = coalesce(x.descricao, left(l.conteudo ->> 'resumo', 800)),
    -- 3.71: o que a Plataforma completou
    email = coalesce(nullif(email_, ''), x.email),
    equipe_prevista = coalesce(equipe, x.equipe_prevista),
    cnpj = case when length(doc) = 14 then doc else coalesce(x.cnpj, case when regexp_replace(coalesce(l.cnpj, ''), '\D', '', 'g') ~ '^[0-9]{14}$' then regexp_replace(l.cnpj, '\D', '', 'g') end) end,
    responsavel_cpf = case when length(doc) = 11 then doc else x.responsavel_cpf end,
    documento_tipo = case when length(doc) = 11 then 'cpf' when length(doc) = 14 then 'cnpj' else x.documento_tipo end,
    responsavel_nome = coalesce(x.responsavel_nome, nullif(btrim(coalesce(dados ->> 'nome', '')), ''))
  where x.id = s.id;

  update public.guia_lugares set salon_id = s.id, atualizado_em = now() where id = l.id;
  select * into s from public.salons where id = s.id;
  return jsonb_build_object('ok', true, 'salao_id', s.id, 'novo', novo, 'nome', s.name, 'slug', s.slug, 'codigo', s.codigo, 'tipo', s.tipo);
end;
$$;
revoke execute on function public.guia_promover_interno(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- o de antes (212), pelo e-mail da conta
create or replace function public.guia_promover(lugar_ uuid, dono_email_ text, tipo_ text default 'salao')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma promove um salão do guia'; end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(btrim(coalesce(dono_email_, '')));
  if uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'Não achei conta com esse e-mail. A dona cria a conta primeiro (mimo.com.vc/comecar) e você promove depois.');
  end if;
  return public.guia_promover_interno(lugar_, uid, tipo_, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. a conta pelo e-mail (a Edge Function decide se cria, convida ou reaproveita)
-- ---------------------------------------------------------------------------
create or replace function public.plataforma_conta_por_email(email_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  u record;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma'; end if;
  select x.id, x.email_confirmed_at, p.full_name, p.phone, p.role into u
    from auth.users x left join public.profiles p on p.id = x.id
   where lower(x.email) = lower(btrim(coalesce(email_, '')));
  if u.id is null then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object(
    'existe', true, 'id', u.id, 'confirmado', u.email_confirmed_at is not null, 'nome', u.full_name, 'telefone', u.phone, 'papel', u.role,
    'tem_negocio', exists (select 1 from public.salons s where s.owner_id = u.id)
                   or exists (select 1 from public.professionals p where p.user_id = u.id)
                   or exists (select 1 from public.salon_members m where m.user_id = u.id),
    'salao_sem_guia', exists (select 1 from public.salons s where s.owner_id = u.id and not exists (select 1 from public.guia_lugares g where g.salon_id = s.id)));
end;
$$;
revoke execute on function public.plataforma_conta_por_email(text) from public, anon;
grant execute on function public.plataforma_conta_por_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. a promoção: o salão, o teste de 7 dias e a primeira mensalidade por Pix
-- ---------------------------------------------------------------------------
create or replace function public.plataforma_promover_guia(lugar_ uuid, dono_ uuid, dados jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  s public.salons%rowtype;
  tipo_ text := case when dados ->> 'tipo' = 'autonoma' then 'autonoma' else 'salao' end;
  regras jsonb := public.regras_da_assinatura();
  teste_dias integer := coalesce((regras ->> 'teste_dias')::int, 7);
  m jsonb;
  ini date;
  fim date;
  cob uuid;
  acesso jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma promove um salão do guia'; end if;
  r := public.guia_promover_interno(lugar_, dono_, tipo_, dados);
  if not (r ->> 'ok')::boolean then return r; end if;
  select * into s from public.salons where id = (r ->> 'salao_id')::uuid;

  -- a conta nasceu pela Plataforma: o e-mail de boas-vindas da cliente não faz sentido para a dona
  update public.email_outbox set status = 'cancelado'
   where user_id = dono_ and kind = 'boas_vindas' and status in ('na_fila', 'aguarda_confirmacao');

  -- o cadastro conta como concluído: a dona entra direto no painel e configura serviços e equipe
  update public.salons
     set onboarding_concluido_em = coalesce(onboarding_concluido_em, now()), onboarding_passo = greatest(coalesce(onboarding_passo, 0), 7)
   where id = s.id;

  -- o gatilho dos 7 dias grátis (o relógio começa quando serviços e equipe existirem, 137)
  if s.ativado_em is null then
    begin
      if tipo_ = 'salao' then perform public.ativacao_inicial_preparar(s.id); end if;
      acesso := public.ativacao_inicial_teste(s.id);
    exception when others then
      acesso := jsonb_build_object('erro', sqlerrm);
    end;
  else
    acesso := public.acesso_do_salao(s.id);
  end if;

  -- a primeira mensalidade por Pix, vencendo no fim do teste (só salão; a autônoma é grátis)
  if tipo_ = 'salao' and coalesce((dados ->> 'cobrar')::boolean, false) then
    m := public.mensalidade_inicial_do_salao(s.id);
    if (m ->> 'valor_cents')::int > 0 then
      ini := (now() at time zone 'America/Sao_Paulo')::date + teste_dias;
      fim := ini + coalesce((regras ->> 'periodo_dias')::int, 30);
      select c.id into cob from public.cobrancas_mimo c
       where c.salon_id = s.id and c.status in ('a_criar', 'aguardando') order by c.criado_em desc limit 1;
      if cob is null then
        insert into public.cobrancas_mimo (salon_id, tipo, periodo_inicio, periodo_fim, agendas, plano, valor_cents, desconto_cents, total_cents, metodo, vencimento)
        values (s.id, 'primeira', ini, fim, (m ->> 'agendas')::int, m ->> 'plano', (m ->> 'valor_cents')::int, 0, (m ->> 'valor_cents')::int, 'pix', ini)
        returning id into cob;
      end if;
    end if;
  end if;

  select * into s from public.salons where id = s.id;
  return r || jsonb_build_object(
    'plano', s.plano, 'equipe', s.equipe_prevista, 'mensalidade', public.mensalidade_inicial_do_salao(s.id),
    'teste_dias', teste_dias, 'acesso', acesso, 'cobranca_id', cob);
end;
$$;
revoke execute on function public.plataforma_promover_guia(uuid, uuid, jsonb) from public, anon;
grant execute on function public.plataforma_promover_guia(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. uma cobrança no formato do lote (para a Edge Function criar no Asaas na hora)
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_mimo_lote(cobranca uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null or public.eh_plataforma() then (
    select jsonb_build_object(
      'id', c.id, 'salon_id', c.salon_id, 'tipo', c.tipo, 'status', c.status, 'metodo', c.metodo, 'total_cents', c.total_cents, 'vencimento', c.vencimento,
      'cobranca_id', c.cobranca_id, 'periodo_inicio', c.periodo_inicio, 'periodo_fim', c.periodo_fim, 'copia_cola', c.copia_cola, 'link_url', c.link_url,
      'descricao', format('MIMO %s · %s a %s', s.name, to_char(c.periodo_inicio, 'DD/MM'), to_char(c.periodo_fim, 'DD/MM')),
      'customer_id', a.customer_id, 'cartao_token', a.cartao_token, 'autorizacao_id', a.autorizacao_id, 'autorizacao_status', a.autorizacao_status,
      'nome', coalesce(s.razao_social, s.name),
      'documento', coalesce(nullif(regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(s.responsavel_cpf, ''), '\D', '', 'g'), ''), nullif(regexp_replace(coalesce(p.cpf, ''), '\D', '', 'g'), '')),
      'email', coalesce(s.email, (select u.email from auth.users u where u.id = s.owner_id)),
      'telefone', coalesce(s.whatsapp, s.phone, p.phone),
      'tentativas', c.tentativas)
      from public.cobrancas_mimo c
      join public.salons s on s.id = c.salon_id
      left join public.assinaturas a on a.salon_id = c.salon_id
      left join public.profiles p on p.id = s.owner_id
     where c.id = cobranca)
  else null end;
$$;
revoke execute on function public.cobranca_mimo_lote(uuid) from public, anon;
grant execute on function public.cobranca_mimo_lote(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. as mensagens: o e-mail para a dona (fila) e o texto pronto do WhatsApp
-- ---------------------------------------------------------------------------
create or replace function public.plataforma_promocao_mensagens(salao uuid, link_senha text, modo text default 'automatica', cobranca uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.salons%rowtype;
  c public.cobrancas_mimo%rowtype;
  p public.profiles%rowtype;
  em text;
  primeiro text;
  plano_nome text;
  corpo text;
  pix text := '';
  e record;
  enviado uuid;
  zap text;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma'; end if;
  select * into s from public.salons where id = salao;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Salão não encontrado.'); end if;
  select * into p from public.profiles where id = s.owner_id;
  select u.email into em from auth.users u where u.id = s.owner_id;
  em := coalesce(s.email, em);
  primeiro := coalesce(nullif(split_part(coalesce(p.full_name, s.responsavel_nome, ''), ' ', 1), ''), 'Oi');
  plano_nome := case s.plano when 'autonoma' then 'Agenda autônoma (grátis)' when 'promais' then 'MIMO Pro+' else 'MIMO Pro' end;
  if cobranca is not null then select * into c from public.cobrancas_mimo where id = cobranca; end if;

  corpo := format('Criamos a agenda do %s na MIMO. Plano %s%s. Seus 7 dias grátis começam assim que a agenda estiver configurada (serviços e equipe): até lá você entra e deixa tudo pronto.',
    s.name, plano_nome,
    case when s.tipo = 'autonoma' then '' else format(', para até %s %s, por %s por mês', coalesce(s.equipe_prevista, 1), case when coalesce(s.equipe_prevista, 1) = 1 then 'profissional' else 'profissionais' end, public.reais(public.mensalidade_cents(s.plano, coalesce(s.equipe_prevista, 1)))) end);
  if c.id is not null then
    pix := format(' A primeira mensalidade, %s, vence em %s e pode ser paga por Pix', public.reais(c.total_cents), to_char(c.vencimento, 'DD/MM'));
    pix := pix || case when c.copia_cola is not null then format(' (copia e cola): %s', c.copia_cola) else ': o código Pix chega em seguida.' end;
    corpo := corpo || pix;
  end if;
  corpo := corpo || case when modo = 'email' then ' Para entrar, confirme o seu e-mail e crie a sua senha pelo botão abaixo.' else ' Para entrar, crie a sua senha pelo botão abaixo.' end;

  select * into e from public.email_aviso(coalesce(p.full_name, s.responsavel_nome), format('Sua agenda no MIMO está criada: %s', s.name), corpo, 'Criar minha senha', link_senha);
  if em is not null then enviado := public.enfileirar_email(em, e.assunto, e.html, 'ativacao', e.texto, coalesce(p.full_name, s.responsavel_nome), s.owner_id); end if;
  begin perform public.chutar_agora(); exception when others then null; end;

  zap := format('Oi, %s! Aqui é a MIMO 💗 Criamos a agenda do %s: plano %s%s. Crie a sua senha e entre por este link: %s',
    primeiro, s.name, plano_nome,
    case when s.tipo = 'autonoma' then '' else format(' (até %s profissionais), com 7 dias grátis para começar', coalesce(s.equipe_prevista, 1)) end,
    link_senha);
  if c.id is not null then
    zap := zap || format(E'\n\nA primeira mensalidade (%s) vence em %s.', public.reais(c.total_cents), to_char(c.vencimento, 'DD/MM'));
    if c.copia_cola is not null then zap := zap || E'\nPix copia e cola:\n' || c.copia_cola; end if;
  end if;

  return jsonb_build_object('ok', true, 'email', em, 'email_enviado', enviado is not null, 'whats_numero', regexp_replace(coalesce(s.whatsapp, s.phone, p.phone, ''), '\D', '', 'g'), 'whats_texto', zap);
end;
$$;
revoke execute on function public.plataforma_promocao_mensagens(uuid, text, text, uuid) from public, anon;
grant execute on function public.plataforma_promocao_mensagens(uuid, text, text, uuid) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('215_promocao_completa.sql') on conflict (arquivo) do nothing;
do $$ begin raise notice '215: guia_promover_interno, plataforma_conta_por_email, plataforma_promover_guia, cobranca_mimo_lote, plataforma_promocao_mensagens'; end $$;
