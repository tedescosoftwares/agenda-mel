-- 137: e-mails na hora certa e o teste que começa com a agenda pronta (2.82)
--
-- Antes, "Sua agenda no MIMO está pronta" saía no cadastro, antes mesmo de
-- confirmar o e-mail. Agora cada momento tem o seu:
--   • escolheu os 7 dias grátis   parabéns + "o teste começa quando a agenda
--                                 estiver configurada" (serviços e equipe)
--   • pagou a primeira            obrigado + o que fazer agora, e um segundo
--                                 e-mail com o recibo
--   • renovou                     recibo
--   • autônoma liberou o link     sua agenda está no ar
-- E o relógio dos 7 dias só começa quando serviços e equipe existem:
-- assinaturas.teste_comecou_em marca o dia; até lá, teste_ate fica nulo.

alter table public.assinaturas add column if not exists teste_comecou_em timestamptz;

-- ---------------------------------------------------------------------------
-- 1. O cadastro não manda mais "está pronta" pra quem abre negócio
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  convite text := nullif(upper(btrim(meta ->> 'codigo_convite')), '');
  papel text := nullif(meta ->> 'papel_desejado', '');
  alvo jsonb;
  fone text;
  quem text;
  base text;
  e record;
begin
  insert into public.profiles (id, full_name, phone, referral_code)
  values (
    new.id,
    meta ->> 'full_name',
    meta ->> 'phone',
    public.gerar_codigo_indicacao(meta ->> 'full_name')
  );

  -- (a) veio por um código: entra na agenda antes de abrir o app
  if convite is not null then
    begin
      alvo := public.resolver_codigo(convite);
      if alvo is not null then
        perform public.vincular_interno(new.id, (alvo -> 'salao' ->> 'id')::uuid,
                                        (alvo ->> 'profissional_id')::uuid, 'cadastro');
        quem := alvo ->> 'nome';
        base := rtrim((select s.app_url from public.salons s where s.id = (alvo -> 'salao' ->> 'id')::uuid), '/');
      end if;
    exception when others then
      raise notice 'convite % não aplicado: %', convite, sqlerrm;
    end;
  end if;

  -- (b) já foi encaixada pelo telefone: os horários passam a ser dela, e o
  --     salão que a encaixou vira vínculo
  fone := public.telefone_e164(meta ->> 'phone');
  if fone is not null then
    begin
      update public.appointments a
      set client_id = new.id
      where a.client_id is null
        and public.telefone_e164(a.guest_phone) = fone;

      perform public.vincular_interno(new.id, a.salon_id, a.professional_id, 'encaixe')
      from (select distinct on (salon_id) salon_id, professional_id
            from public.appointments
            where client_id = new.id
            order by salon_id, date) a;
    exception when others then
      raise notice 'encaixes de % não amarrados: %', fone, sqlerrm;
    end;
  end if;

  -- (c) escolheu "sou profissional" / "tenho um salão" no cadastro
  if papel in ('autonoma', 'salao') then
    begin
      perform public.abrir_negocio_interno(new.id, papel, meta ->> 'nome_negocio', meta ->> 'cidade');
      -- (c2) o cadastro do onboarding público já traz os dados do salão (115): grava e pula pro passo 3
      if jsonb_typeof(meta -> 'salao') = 'object' then
        perform public.onboarding_salvar_interno(s.id, meta -> 'salao', 3)
        from public.salons s where s.owner_id = new.id order by s.created_at desc limit 1;
      end if;
    exception when others then
      raise notice 'negócio de % não aberto: %', new.id, sqlerrm;
    end;
  end if;

  -- (d) veio pelo convite da equipe de um salão: entra (ou fica esperando a dona configurar)
  if nullif(upper(btrim(meta ->> 'equipe_codigo')), '') is not null then
    begin
      perform public.entrar_na_equipe_interno(new.id, upper(btrim(meta ->> 'equipe_codigo')));
    exception when others then
      raise notice 'convite de equipe % não aplicado: %', meta ->> 'equipe_codigo', sqlerrm;
    end;
  end if;

  -- (e) veio pelo link de acesso que o salão mandou (119): a agenda já está pronta
  if nullif(btrim(meta ->> 'ativar_token'), '') is not null then
    begin
      perform public.ativar_acesso_interno(new.id, meta ->> 'ativar_token', meta ->> 'phone');
    exception when others then
      raise notice 'acesso % não ativado: %', meta ->> 'ativar_token', sqlerrm;
    end;
  end if;

  -- (f) boas-vindas na fila de e-mail: só pra cliente. Quem abre negócio
  --     recebe o e-mail certo na ativação (137), não no cadastro.
  if papel not in ('autonoma', 'salao') or papel is null then
    begin
      if base is null then
        select rtrim(s.app_url, '/') into base from public.salons s where s.app_url is not null order by s.created_at limit 1;
      end if;
      select * into e from public.email_boas_vindas(meta ->> 'full_name', quem, papel, coalesce(base, '') || '/');
      perform public.enfileirar_email(new.email, e.assunto, e.html, 'boas_vindas', e.texto, meta ->> 'full_name', new.id);
    exception when others then
      raise notice 'boas-vindas de % não enfileirado: %', new.email, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Os textos
-- ---------------------------------------------------------------------------
-- o endereço do painel (pro.mimo.com.vc) a partir do app_url cadastrado
create or replace function public.url_do_painel(caminho text default '/admin')
returns text
language sql
stable
as $$
  select regexp_replace(coalesce((select rtrim(s.app_url, '/') from public.salons s where s.app_url is not null order by s.created_at limit 1), 'https://mimo.com.vc'), '^(https?://)', '\1pro.') || coalesce(caminho, '/admin');
$$;

create or replace function public.email_ativacao(nome text, salao text, modo text, link text, ate date default null)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare
  primeiro text := coalesce(nullif(split_part(coalesce(nome, ''), ' ', 1), ''), 'Oi');
  casa text := coalesce(nullif(salao, ''), 'seu salão');
  corpo text;
  chamada text;
  assunto_ text;
  rodape text := 'Precisa de ajuda? É só responder este e-mail.';
begin
  if modo = 'teste' then
    assunto_ := 'Parabéns! ' || casa || ' está no MIMO 🎉';
    corpo := 'Sua conta está criada e o salão já tem link e QR Code. Seus 7 dias grátis começam a contar assim que a agenda estiver configurada: cadastre os serviços e as profissionais, e pronto, o teste começa. Até lá, nada conta e nada é cobrado. Sem cartão: quando o teste acabar, você decide se continua.';
    chamada := 'Configurar minha agenda';
  elsif modo = 'pago' then
    assunto_ := 'Obrigada! ' || casa || ' está no ar 💗';
    corpo := 'Sua primeira mensalidade está confirmada' || case when ate is not null then ' e o salão fica liberado até ' || to_char(ate, 'DD/MM/YYYY') else '' end
             || '. Agora é só montar a agenda: cadastre os serviços (nome, duração e preço) e as profissionais da casa. Cada uma recebe o acesso dela por e-mail e entra com tudo pronto. O recibo vai num e-mail separado.';
    chamada := 'Montar minha agenda';
  else
    assunto_ := 'Sua agenda está no ar 💛';
    corpo := 'Seu link e o QR Code estão liberados: coloque na bio e no status do WhatsApp, e suas clientes passam a marcar sozinhas pelo app. A agenda autônoma do MIMO é grátis, sem prazo e sem cartão.';
    chamada := 'Abrir minha agenda';
  end if;

  assunto := assunto_;
  texto := primeiro || ', ' || E'\n\n' || corpo || E'\n\n' || chamada || ': ' || link
           || E'\n\n' || 'MIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:15px;line-height:1.55;margin:0 0 24px;color:#3d3d44">' || public.escapar_html(corpo) || '</p>',
    chamada, link, rodape);
  return next;
end;
$$;

create or replace function public.email_recibo(nome text, salao text, total_cents integer, desconto_cents integer, metodo text, inicio date, fim date, referencia text, link text)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare
  primeiro text := coalesce(nullif(split_part(coalesce(nome, ''), ' ', 1), ''), 'Oi');
  casa text := coalesce(nullif(salao, ''), 'seu salão');
  forma text := case metodo when 'pix' then 'Pix' when 'cartao' then 'cartão de crédito' else coalesce(metodo, '') end;
  linhas text;
begin
  assunto := 'Recibo MIMO · ' || casa || ' · ' || to_char(coalesce(inicio, current_date), 'DD/MM/YYYY');
  linhas := 'Salão: ' || casa || E'\n'
         || 'Valor pago: ' || public.reais(total_cents)
         || case when coalesce(desconto_cents, 0) > 0 then ' (com desconto de ' || public.reais(desconto_cents) || ')' else '' end || E'\n'
         || 'Forma de pagamento: ' || forma || E'\n'
         || 'Período: ' || to_char(inicio, 'DD/MM/YYYY') || ' a ' || to_char(fim, 'DD/MM/YYYY') || E'\n'
         || case when referencia is not null then 'Referência: ' || referencia || E'\n' else '' end;
  texto := primeiro || ', ' || E'\n\n' || 'Recebemos o seu pagamento. Obrigada por ficar com a gente.' || E'\n\n' || linhas
           || E'\n' || 'Ver o plano: ' || link || E'\n\n' || 'MIMO — beleza na palma da mão';
  html := public.email_layout(
    public.escapar_html(primeiro),
    '<p style="font-size:15px;line-height:1.55;margin:0 0 18px;color:#3d3d44">Recebemos o seu pagamento. Obrigada por ficar com a gente.</p>'
    || '<table style="border-collapse:collapse;width:100%;margin:0 0 24px;font-size:14px;color:#3d3d44">'
    || '<tr><td style="padding:8px 0;border-bottom:1px solid #eee6ef;color:#8a8a94">Salão</td><td style="padding:8px 0;border-bottom:1px solid #eee6ef;text-align:right;font-weight:700">' || public.escapar_html(casa) || '</td></tr>'
    || '<tr><td style="padding:8px 0;border-bottom:1px solid #eee6ef;color:#8a8a94">Valor pago</td><td style="padding:8px 0;border-bottom:1px solid #eee6ef;text-align:right;font-weight:700">' || public.reais(total_cents)
    || case when coalesce(desconto_cents, 0) > 0 then '<br><span style="font-weight:400;font-size:12px;color:#8a8a94">desconto de ' || public.reais(desconto_cents) || '</span>' else '' end || '</td></tr>'
    || '<tr><td style="padding:8px 0;border-bottom:1px solid #eee6ef;color:#8a8a94">Forma</td><td style="padding:8px 0;border-bottom:1px solid #eee6ef;text-align:right">' || public.escapar_html(forma) || '</td></tr>'
    || '<tr><td style="padding:8px 0;border-bottom:1px solid #eee6ef;color:#8a8a94">Período</td><td style="padding:8px 0;border-bottom:1px solid #eee6ef;text-align:right">' || to_char(inicio, 'DD/MM/YYYY') || ' a ' || to_char(fim, 'DD/MM/YYYY') || '</td></tr>'
    || case when referencia is not null then '<tr><td style="padding:8px 0;color:#8a8a94">Referência</td><td style="padding:8px 0;text-align:right;font-size:12px">' || public.escapar_html(referencia) || '</td></tr>' else '' end
    || '</table>',
    'Ver o plano', link,
    'Este é o recibo do pagamento da mensalidade do MIMO. Guarde para o seu controle.');
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. O teste só começa a contar com a agenda pronta
-- ---------------------------------------------------------------------------
create or replace function public.salao_configurado(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.services sv where sv.salon_id = salao and sv.active)
     and exists (select 1 from public.professionals p where p.salon_id = salao and p.active and coalesce(p.situacao, 'ativa') in ('configurada', 'ativa'));
$$;

-- dá a partida no relógio dos 7 dias se o salão está em teste, ainda não
-- começou a contar e já tem serviços e equipe. Idempotente.
create or replace function public.teste_relogio(salao uuid)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  a public.assinaturas%rowtype;
  s public.salons%rowtype;
  r jsonb := public.regras_da_assinatura();
  ate timestamptz;
begin
  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null or a.situacao <> 'teste' or a.teste_comecou_em is not null then return false; end if;
  if not public.salao_configurado(salao) then return false; end if;
  ate := now() + make_interval(days => (r ->> 'teste_dias')::int);
  update public.assinaturas set teste_comecou_em = now(), teste_ate = ate, atualizado_em = now() where salon_id = salao;
  select * into s from public.salons where id = salao;
  if s.owner_id is not null then
    begin
      perform public.notificar(s.owner_id, 'teste_comecou', 'Seu teste grátis começou',
        format('%s está com a agenda pronta: são %s dias grátis, até %s. Sem cartão: você só assina se quiser continuar.', s.name, r ->> 'teste_dias', to_char(ate at time zone 'America/Sao_Paulo', 'DD/MM')),
        '/admin/assinatura', jsonb_build_object('salon_id', s.id));
    exception when others then null;
    end;
  end if;
  return true;
end;
$$;
revoke execute on function public.teste_relogio(uuid) from public, anon, authenticated;

create or replace function public.tg_teste_relogio()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.salon_id is not null then perform public.teste_relogio(new.salon_id); end if;
  return new;
end;
$$;
drop trigger if exists zz_teste_relogio on public.services;
create trigger zz_teste_relogio after insert or update on public.services
  for each row execute function public.tg_teste_relogio();
drop trigger if exists zz_teste_relogio on public.professionals;
create trigger zz_teste_relogio after insert or update on public.professionals
  for each row execute function public.tg_teste_relogio();

-- escolheu testar: o relógio fica parado até a agenda estar pronta
create or replace function public.ativacao_inicial_teste(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona ativa o teste.';
  end if;

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then
    update public.salons set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null where id = salao;
    return public.acesso_do_salao(salao);
  end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.escolha_inicial = 'pago' or exists (
    select 1 from public.cobrancas_mimo c
     where c.salon_id = salao and c.tipo = 'inicial' and c.status = 'pago'
  ) then
    raise exception 'A primeira mensalidade já foi paga.';
  end if;

  if exists (
    select 1 from public.cobrancas_mimo c
     where c.salon_id = salao and c.tipo = 'inicial'
       and c.status in ('a_criar', 'aguardando') and c.cobranca_id is not null
  ) then
    raise exception 'Há um pagamento em andamento. Cancele essa cobrança antes de iniciar o teste.';
  end if;

  update public.cobrancas_mimo
     set status = 'cancelado', atualizado_em = now()
   where salon_id = salao and tipo = 'inicial' and status in ('a_criar', 'aguardando', 'falhou');

  insert into public.assinaturas (
    salon_id, situacao, teste_ate, teste_comecou_em, pago_ate, metodo, desconto_pct,
    escolha_inicial, oferta_inicial_usada_em, bonus_usado, avisos, atualizado_em
  )
  values (
    salao, 'teste', null, null,
    null, null, 0, 'teste', now(), true, jsonb_build_object('escolheu', now()), now()
  )
  on conflict (salon_id) do update set
    situacao = 'teste',
    teste_ate = null,
    teste_comecou_em = null,
    pago_ate = null,
    metodo = null,
    desconto_pct = 0,
    cartao_token = null,
    cartao_final = null,
    cartao_bandeira = null,
    autorizacao_id = null,
    autorizacao_status = null,
    autorizacao_qr = null,
    autorizacao_imagem = null,
    escolha_inicial = coalesce(public.assinaturas.escolha_inicial, 'teste'),
    oferta_inicial_usada_em = coalesce(public.assinaturas.oferta_inicial_usada_em, now()),
    bonus_usado = true,
    cancelada_em = null,
    avisos = jsonb_build_object('escolheu', now()),
    atualizado_em = now();

  update public.salons
     set ativado_em = coalesce(ativado_em, now()), ativacao_pendente_em = null
   where id = salao;

  -- já tem serviços e equipe? então começa agora
  perform public.teste_relogio(salao);

  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.ativacao_inicial_teste(uuid) from public, anon;
grant execute on function public.ativacao_inicial_teste(uuid) to authenticated;

-- o acesso entende o teste que ainda não começou a contar
create or replace function public.acesso_do_salao(salao uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  a public.assinaturas%rowtype;
  r jsonb := public.regras_da_assinatura();
  agora timestamptz := now();
  fim timestamptz;
  tol timestamptz;
  fase text;
  extra jsonb;
  pend record;
begin
  select * into s from public.salons where id = salao;
  if not found then return null; end if;
  if s.tipo = 'autonoma' then return jsonb_build_object('fase', 'gratis', 'tipo', s.tipo, 'recorrente', false); end if;

  select * into a from public.assinaturas where salon_id = salao;
  if a.salon_id is null then
    return jsonb_build_object(
      'fase', 'configurando', 'tipo', s.tipo, 'recorrente', false,
      'ativacao_pendente', s.ativacao_pendente_em is not null,
      'teste_dias', r ->> 'teste_dias',
      'desconto_inicial_pct', r ->> 'desconto_inicial_pct',
      'mensalidade', public.mensalidade_do_salao(salao)
    );
  end if;

  select c.id, c.copia_cola, c.total_cents, c.vencimento, c.status, c.metodo, c.periodo_fim, c.tipo
    into pend
    from public.cobrancas_mimo c
   where c.salon_id = salao and c.status in ('a_criar', 'aguardando', 'falhou')
   order by c.criado_em desc limit 1;

  extra := jsonb_build_object(
    'metodo', a.metodo,
    'recorrente', false,
    'escolha_inicial', a.escolha_inicial,
    'oferta_inicial_usada', a.oferta_inicial_usada_em is not null,
    'mensalidade', public.mensalidade_do_salao(salao),
    'pendente', case when pend.id is null then null else jsonb_build_object(
      'id', pend.id, 'tipo', pend.tipo, 'copia_cola', pend.copia_cola,
      'total_cents', pend.total_cents, 'vencimento', pend.vencimento,
      'status', pend.status, 'metodo', pend.metodo, 'periodo_fim', pend.periodo_fim
    ) end
  );

  if a.situacao = 'ativa' and a.pago_ate is null then
    return jsonb_build_object('fase', 'ativa', 'tipo', s.tipo, 'situacao', a.situacao, 'sem_prazo', true) || extra;
  end if;

  -- em teste, mas a agenda ainda não está pronta: o relógio não começou
  if a.situacao = 'teste' and a.teste_ate is null then
    return jsonb_build_object(
      'fase', 'teste', 'tipo', s.tipo, 'situacao', a.situacao,
      'ate', null, 'tolerancia_ate', null,
      'dias', (r ->> 'teste_dias')::int, 'dias_tolerancia', (r ->> 'tolerancia_dias')::int,
      'teste', true, 'aguardando_configuracao', true, 'cobrar_em', null
    ) || extra;
  end if;

  fim := case when a.situacao = 'teste' then a.teste_ate else a.pago_ate end;
  tol := fim + make_interval(days => (r ->> 'tolerancia_dias')::int);
  fase := case
    when agora < fim then case when a.situacao = 'teste' then 'teste' else 'ativa' end
    when agora < tol then 'leitura'
    else 'bloqueado'
  end;

  return jsonb_build_object(
    'fase', fase, 'tipo', s.tipo, 'situacao', a.situacao,
    'ate', fim, 'tolerancia_ate', tol,
    'dias', greatest(0, ceil(extract(epoch from (fim - agora)) / 86400.0))::int,
    'dias_tolerancia', greatest(0, ceil(extract(epoch from (tol - agora)) / 86400.0))::int,
    'teste', a.situacao = 'teste',
    'cobrar_em', null
  ) || extra;
end;
$$;
revoke execute on function public.acesso_do_salao(uuid) from public, anon;
grant execute on function public.acesso_do_salao(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Os disparos: ativou (teste, pago ou autônoma) e pagou (recibo)
-- ---------------------------------------------------------------------------
create or replace function public.tg_email_ativacao()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  dona record;
  a public.assinaturas%rowtype;
  modo text;
  e record;
  link text;
  ate date;
begin
  if old.ativado_em is not null or new.ativado_em is null then return new; end if;
  if new.owner_id is null then return new; end if;
  select u.email, p.full_name into dona from auth.users u left join public.profiles p on p.id = u.id where u.id = new.owner_id;
  if dona.email is null then return new; end if;

  if new.tipo = 'autonoma' then
    modo := 'autonoma'; link := public.url_do_painel('/pro/agenda');
  else
    select * into a from public.assinaturas where salon_id = new.id;
    if a.situacao = 'ativa' then
      modo := 'pago'; ate := (a.pago_ate at time zone 'America/Sao_Paulo')::date;
    else
      modo := 'teste';
    end if;
    link := public.url_do_painel('/admin/configurar');
  end if;

  begin
    select * into e from public.email_ativacao(dona.full_name, new.name, modo, link, ate);
    perform public.enfileirar_email(dona.email, e.assunto, e.html, 'ativacao', e.texto, dona.full_name, new.owner_id);
  exception when others then
    raise notice 'e-mail de ativação de % não enfileirado: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists zz_email_ativacao on public.salons;
create trigger zz_email_ativacao after update of ativado_em on public.salons
  for each row execute function public.tg_email_ativacao();

create or replace function public.tg_email_recibo()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  dona record;
  e record;
begin
  if new.status <> 'pago' or old.status = 'pago' then return new; end if;
  select * into s from public.salons where id = new.salon_id;
  if s.owner_id is null then return new; end if;
  select u.email, p.full_name into dona from auth.users u left join public.profiles p on p.id = u.id where u.id = s.owner_id;
  if dona.email is null then return new; end if;
  begin
    select * into e from public.email_recibo(dona.full_name, s.name, new.total_cents, new.desconto_cents, new.metodo,
                                             new.periodo_inicio, new.periodo_fim, coalesce(new.cobranca_id, new.id::text), public.url_do_painel('/admin/assinatura'));
    perform public.enfileirar_email(dona.email, e.assunto, e.html, 'recibo', e.texto, dona.full_name, s.owner_id);
  exception when others then
    raise notice 'recibo de % não enfileirado: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;
drop trigger if exists zz_email_recibo on public.cobrancas_mimo;
create trigger zz_email_recibo after update of status on public.cobrancas_mimo
  for each row execute function public.tg_email_recibo();
