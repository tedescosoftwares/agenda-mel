-- 114: o onboarding do salão. Os campos que o fluxo de entrada pede e que
-- ainda não existiam (e-mail, UF, bairro, antecedência mínima, reagendar,
-- sinal em valor fixo), o passo em que a conta parou, o convite de equipe
-- por link/QR, e a conclusão. Quem já existe nasce concluído.

-- 1. Campos novos ------------------------------------------------------------------
alter table public.salons add column if not exists email text;
alter table public.salons add column if not exists uf text;
alter table public.salons add column if not exists bairro text;
alter table public.salons add column if not exists antecedencia_min_minutos integer not null default 60;
alter table public.salons add column if not exists permite_remarcar boolean not null default true;
alter table public.salons add column if not exists sinal_modo text not null default 'pct';
alter table public.salons add column if not exists sinal_fixo_cents integer;
alter table public.salons add column if not exists equipe_prevista integer;
alter table public.salons add column if not exists onboarding_passo smallint not null default 1;
alter table public.salons add column if not exists onboarding_concluido_em timestamptz;
alter table public.salons add column if not exists codigo_equipe text;
do $$ begin
  alter table public.salons add constraint salons_sinal_modo_conhecido check (sinal_modo in ('pct', 'fixo'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.salons add constraint salons_antecedencia_razoavel check (antecedencia_min_minutos between 0 and 10080);
exception when duplicate_object then null; end $$;
create unique index if not exists salons_codigo_equipe_idx on public.salons (codigo_equipe) where codigo_equipe is not null;

-- quem já existe não passa pelo onboarding
update public.salons set onboarding_concluido_em = coalesce(onboarding_concluido_em, created_at), onboarding_passo = 7 where onboarding_concluido_em is null;

-- código de convite da equipe: um por salão
create or replace function public.gerar_codigo_equipe()
returns text
language plpgsql
volatile
as $$
declare c text;
begin
  loop
    c := public.gerar_codigo_curto();
    exit when not exists (select 1 from public.salons where codigo_equipe = c) and not exists (select 1 from public.salons where codigo = c) and not exists (select 1 from public.professionals where codigo = c);
  end loop;
  return c;
end;
$$;
update public.salons set codigo_equipe = public.gerar_codigo_equipe() where codigo_equipe is null;
create or replace function public.salons_codigo_equipe()
returns trigger
language plpgsql
as $$
begin
  if new.codigo_equipe is null then new.codigo_equipe := public.gerar_codigo_equipe(); end if;
  return new;
end;
$$;
drop trigger if exists salons_codigo_equipe_tg on public.salons;
create trigger salons_codigo_equipe_tg before insert on public.salons for each row execute function public.salons_codigo_equipe();
grant select (codigo_equipe, email, uf, bairro, antecedencia_min_minutos, permite_remarcar, sinal_modo, sinal_fixo_cents, equipe_prevista, onboarding_passo, onboarding_concluido_em) on public.salons to authenticated;

-- 2. Salvar um passo --------------------------------------------------------------
-- a tela manda só o que mudou; as chaves conhecidas são gravadas, o resto é ignorado
create or replace function public.onboarding_salvar(salao uuid, dados jsonb, passo integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão faz o cadastro.'; end if;
  update public.salons set
    name = coalesce(nullif(btrim(dados ->> 'name'), ''), name),
    cnpj = case when dados ? 'cnpj' then nullif(btrim(dados ->> 'cnpj'), '') else cnpj end,
    whatsapp = case when dados ? 'whatsapp' then nullif(btrim(dados ->> 'whatsapp'), '') else whatsapp end,
    phone = case when dados ? 'whatsapp' then coalesce(nullif(btrim(dados ->> 'whatsapp'), ''), phone) else phone end,
    email = case when dados ? 'email' then nullif(lower(btrim(dados ->> 'email')), '') else email end,
    responsavel_nome = case when dados ? 'responsavel_nome' then nullif(btrim(dados ->> 'responsavel_nome'), '') else responsavel_nome end,
    logo_url = case when dados ? 'logo_url' then nullif(dados ->> 'logo_url', '') else logo_url end,
    address = case when dados ? 'address' then nullif(btrim(dados ->> 'address'), '') else address end,
    bairro = case when dados ? 'bairro' then nullif(btrim(dados ->> 'bairro'), '') else bairro end,
    city = case when dados ? 'city' then nullif(btrim(dados ->> 'city'), '') else city end,
    uf = case when dados ? 'uf' then nullif(upper(btrim(dados ->> 'uf')), '') else uf end,
    cep = case when dados ? 'cep' then nullif(regexp_replace(dados ->> 'cep', '\D', '', 'g'), '') else cep end,
    lat = case when dados ? 'lat' then (dados ->> 'lat')::double precision else lat end,
    lng = case when dados ? 'lng' then (dados ->> 'lng')::double precision else lng end,
    pino_ajustado_em = case when dados ? 'lat' then now() else pino_ajustado_em end,
    antecedencia_min_minutos = coalesce((dados ->> 'antecedencia_min_minutos')::integer, antecedencia_min_minutos),
    politica_cancelamento = case when dados ->> 'politica_cancelamento' in ('flexivel', 'moderada', 'rigorosa') then dados ->> 'politica_cancelamento' else politica_cancelamento end,
    permite_remarcar = coalesce((dados ->> 'permite_remarcar')::boolean, permite_remarcar),
    sinal_modo = case when dados ->> 'sinal_modo' in ('pct', 'fixo') then dados ->> 'sinal_modo' else sinal_modo end,
    sinal_fixo_cents = case when dados ? 'sinal_fixo_cents' then nullif((dados ->> 'sinal_fixo_cents')::integer, 0) else sinal_fixo_cents end,
    sinal_pct = case when (dados ->> 'sinal_pct')::integer in (30, 50, 100) then (dados ->> 'sinal_pct')::integer else sinal_pct end,
    pagamento_modo = case when dados ->> 'pagamento_modo' in ('nao', 'opcional', 'obrigatorio') then dados ->> 'pagamento_modo' else pagamento_modo end,
    equipe_prevista = case when dados ? 'equipe_prevista' then nullif((dados ->> 'equipe_prevista')::integer, 0) else equipe_prevista end,
    aceite_modo = case when dados ->> 'aceite_modo' in ('automatico', 'casa', 'profissional') then dados ->> 'aceite_modo' else aceite_modo end,
    minutos_para_aceitar = coalesce((dados ->> 'minutos_para_aceitar')::integer, minutos_para_aceitar),
    onboarding_passo = greatest(onboarding_passo, coalesce(passo, onboarding_passo))
  where id = salao;
  select * into s from public.salons where id = salao;
  return jsonb_build_object('ok', true, 'passo', s.onboarding_passo);
end;
$$;
revoke execute on function public.onboarding_salvar(uuid, jsonb, integer) from public, anon;
grant execute on function public.onboarding_salvar(uuid, jsonb, integer) to authenticated;

create or replace function public.onboarding_concluir(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão faz o cadastro.'; end if;
  update public.salons set onboarding_concluido_em = coalesce(onboarding_concluido_em, now()), onboarding_passo = 7 where id = salao;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.onboarding_concluir(uuid) from public, anon;
grant execute on function public.onboarding_concluir(uuid) to authenticated;

-- trocar o tipo no passo 1 (salão ↔ autônoma), enquanto ainda não tem equipe
create or replace function public.trocar_tipo_negocio(salao uuid, novo text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; dona uuid; nome_pessoa text; fone text; base text; sl text; i integer := 0; prof uuid;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão muda isso.'; end if;
  if novo not in ('autonoma', 'salao') then raise exception 'Tipo desconhecido.'; end if;
  select * into s from public.salons where id = salao;
  if s.tipo = novo then return jsonb_build_object('ok', true, 'tipo', novo); end if;
  dona := auth.uid();
  if novo = 'autonoma' then
    if exists (select 1 from public.professionals p where p.salon_id = salao and p.active and p.user_id is distinct from dona) then
      raise exception 'Com outras profissionais na equipe, o negócio é um salão.';
    end if;
    select id into prof from public.professionals where salon_id = salao and user_id = dona;
    if prof is null then
      select full_name, phone into nome_pessoa, fone from public.profiles where id = dona;
      base := coalesce(nullif(public.slug_de(nome_pessoa), ''), 'profissional'); sl := base;
      while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
      insert into public.professionals (salon_id, user_id, name, slug, phone, aceite_manual) values (salao, dona, coalesce(nome_pessoa, s.name), sl, fone, true);
    end if;
    insert into public.salon_members (salon_id, user_id, papel) values (salao, dona, 'profissional') on conflict do nothing;
    update public.profiles set role = 'profissional' where id = dona;
  else
    update public.profiles set role = 'admin' where id = dona;
  end if;
  update public.salons set tipo = novo where id = salao;
  return jsonb_build_object('ok', true, 'tipo', novo);
end;
$$;
revoke execute on function public.trocar_tipo_negocio(uuid, text) from public, anon;
grant execute on function public.trocar_tipo_negocio(uuid, text) to authenticated;

-- 3. Convite da equipe -------------------------------------------------------------
create or replace function public.equipe_por_codigo(convite text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city, 'logo_url', s.logo_url, 'tipo', s.tipo,
                            'quantas', (select count(*) from public.professionals p where p.salon_id = s.id and p.active))
  from public.salons s where s.codigo_equipe = upper(btrim(convite)) and s.active;
$$;
grant execute on function public.equipe_por_codigo(text) to anon, authenticated;

create or replace function public.entrar_na_equipe_interno(conta uuid, convite text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype; nome_pessoa text; fone text; e164 text; prof uuid; base text; sl text; i integer := 0; papel_atual text;
begin
  select * into s from public.salons where codigo_equipe = upper(btrim(convite)) and active;
  if s.id is null then raise exception 'Convite não encontrado.'; end if;
  select full_name, phone, role into nome_pessoa, fone, papel_atual from public.profiles where id = conta;
  if papel_atual in ('admin', 'plataforma') or exists (select 1 from public.salons x where x.owner_id = conta) then
    raise exception 'Essa conta já é dona de um negócio.';
  end if;
  -- já é dela?
  select id into prof from public.professionals where salon_id = s.id and user_id = conta;
  if prof is null then
    -- a dona já cadastrou a profissional com esse telefone: é a mesma pessoa
    e164 := public.telefone_e164(fone);
    if e164 is not null then
      select id into prof from public.professionals p where p.salon_id = s.id and p.user_id is null and public.telefone_e164(p.phone) = e164 limit 1;
    end if;
    if prof is not null then
      update public.professionals set user_id = conta, active = true where id = prof;
    else
      base := coalesce(nullif(public.slug_de(nome_pessoa), ''), 'profissional'); sl := base;
      while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
      insert into public.professionals (salon_id, user_id, name, slug, phone, aceite_manual)
      values (s.id, conta, coalesce(nome_pessoa, 'Profissional'), sl, fone, true) returning id into prof;
    end if;
  end if;
  insert into public.salon_members (salon_id, user_id, papel) values (s.id, conta, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = conta and role = 'cliente';
  return jsonb_build_object('ok', true, 'salao_id', s.id, 'salao', s.name, 'professional_id', prof);
end;
$$;
revoke execute on function public.entrar_na_equipe_interno(uuid, text) from public, anon, authenticated;

create or replace function public.entrar_na_equipe(convite text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para aceitar o convite.'; end if;
  return public.entrar_na_equipe_interno(auth.uid(), convite);
end;
$$;
revoke execute on function public.entrar_na_equipe(text) from public, anon;
grant execute on function public.entrar_na_equipe(text) to authenticated;

-- o cadastro novo com convite de equipe entra na hora (handle_new_user, versão com o passo d)
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
    exception when others then
      raise notice 'negócio de % não aberto: %', new.id, sqlerrm;
    end;
  end if;

  -- (d) veio pelo convite da equipe de um salão: já entra como profissional de lá
  if nullif(upper(btrim(meta ->> 'equipe_codigo')), '') is not null then
    begin
      perform public.entrar_na_equipe_interno(new.id, upper(btrim(meta ->> 'equipe_codigo')));
    exception when others then
      raise notice 'convite de equipe % não aplicado: %', meta ->> 'equipe_codigo', sqlerrm;
    end;
  end if;

  -- (d) boas-vindas na fila de e-mail
  begin
    if base is null then
      select rtrim(s.app_url, '/') into base from public.salons s where s.app_url is not null order by s.created_at limit 1;
    end if;
    select * into e from public.email_boas_vindas(meta ->> 'full_name', quem, papel, coalesce(base, '') || '/');
    perform public.enfileirar_email(new.email, e.assunto, e.html, 'boas_vindas', e.texto, meta ->> 'full_name', new.id);
  exception when others then
    raise notice 'boas-vindas de % não enfileirado: %', new.email, sqlerrm;
  end;

  return new;
end;
$$;

-- 4. O sinal em valor fixo entra na cobrança -----------------------------------
create or replace function public.pagamento_preparar(appt uuid, cliente uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  a public.appointments%rowtype;
  s public.salons%rowtype;
  c public.contas_de_recebimento%rowtype;
  p public.pagamentos%rowtype;
  cli public.profiles%rowtype;
  prof_nome text;
  valor integer;
  pct smallint;
begin
  select * into a from public.appointments where id = appt;
  if a.id is null or a.client_id is distinct from cliente then return jsonb_build_object('ok', false, 'motivo', 'Horário não encontrado.'); end if;
  if a.status not in ('aguardando_pagamento', 'pendente', 'confirmado') then return jsonb_build_object('ok', false, 'motivo', 'Este horário não aceita pagamento.'); end if;
  if (a.date + a.start_time) < public.agora_local() then return jsonb_build_object('ok', false, 'motivo', 'Este horário já passou.'); end if;
  if a.pago_cents > 0 then return jsonb_build_object('ok', false, 'motivo', 'Este horário já está pago.'); end if;
  select * into s from public.salons where id = a.salon_id;
  select * into c from public.contas_de_recebimento where salon_id = a.salon_id;
  if c.conta_id is null or s.pagamento_modo = 'nao' then return jsonb_build_object('ok', false, 'motivo', 'Esta profissional não recebe pelo app.'); end if;
  select * into cli from public.profiles where id = cliente;
  if cli.cpf is null then return jsonb_build_object('ok', false, 'motivo', 'sem_cpf'); end if;

  -- um pagamento aguardando já existe? devolve ele
  select * into p from public.pagamentos where appointment_id = appt and status = 'aguardando' order by criado_em desc limit 1;
  if p.id is not null then
    return jsonb_build_object('ok', true, 'pagamento_id', p.id, 'existente', true, 'cobranca_id', p.cobranca_id, 'copia_cola', p.copia_cola, 'valor_cents', p.valor_cents, 'expira_em', p.expira_em, 'sinal_pct', p.sinal_pct);
  end if;

  pct := case when a.status = 'aguardando_pagamento' then s.sinal_pct else 100 end;
  -- sinal em valor fixo (onboarding): vale quando o salão escolheu 'fixo' e é o sinal (não o pagamento do total)
  if a.status = 'aguardando_pagamento' and coalesce(s.sinal_modo, 'pct') = 'fixo' and coalesce(s.sinal_fixo_cents, 0) > 0 then
    valor := least(a.price_cents, greatest(100, s.sinal_fixo_cents));
    pct := greatest(1, least(100, round(valor * 100.0 / greatest(1, a.price_cents))))::smallint;
  else
    valor := greatest(100, round(a.price_cents * pct / 100.0)::integer);
    if valor > a.price_cents then valor := a.price_cents; end if;
  end if;
  select p2.name into prof_nome from public.professionals p2 where p2.id = a.professional_id;

  insert into public.pagamentos (appointment_id, salon_id, client_id, valor_cents, total_cents, sinal_pct, expira_em)
  values (appt, a.salon_id, cliente, valor, a.price_cents, pct,
          case when a.status = 'aguardando_pagamento' then a.created_at + interval '15 minutes'
               else (a.date + a.start_time) at time zone 'America/Sao_Paulo' end)
  returning * into p;

  return jsonb_build_object(
    'ok', true, 'pagamento_id', p.id, 'existente', false,
    'valor_cents', valor, 'total_cents', a.price_cents, 'sinal_pct', pct, 'expira_em', p.expira_em,
    'salon_id', a.salon_id, 'conta_id', c.conta_id, 'wallet_id', c.wallet_id,
    'descricao', coalesce(a.service_name, 'Atendimento') || ' com ' || coalesce(prof_nome, 'a profissional') || ' · ' || to_char(a.date, 'DD/MM') || ' ' || to_char(a.start_time, 'HH24:MI')
                 || case when pct < 100 then ' (sinal de ' || pct || '%)' else '' end,
    'cliente', jsonb_build_object('nome', cli.full_name, 'cpf', cli.cpf, 'telefone', cli.phone),
    'customer_id', (select customer_id from public.pagadores where client_id = cliente and salon_id = a.salon_id));
end;
$$;

-- 5. A antecedência mínima entra nas vagas -------------------------------------
create or replace function public.horarios_livres(
  prof uuid,
  dia date,
  duracao integer
)
returns table (hora time)
language sql
stable
security definer set search_path = public
as $$
  with expediente as (
    select h.start_time as abre, h.end_time as fecha
    from public.professional_hours h
    where h.professional_id = prof
      and h.weekday = extract(dow from dia)
      and h.open
  ),
  ocupado as (
    select * from public.get_busy_slots(dia, prof)
  ),
  grade as (
    select (generate_series(
              dia + e.abre,
              dia + e.fecha - make_interval(mins => duracao),
              interval '30 minutes'))::time as t
    from expediente e
  )
  select g.t
  from grade g
  where not exists (
          select 1 from ocupado o
          where g.t < o.end_time
            and (g.t + make_interval(mins => duracao))::time > o.start_time)
    -- horário que já passou não é vaga
    and (dia + g.t) > public.agora_local() + make_interval(mins => coalesce((select s.antecedencia_min_minutos from public.professionals pp join public.salons s on s.id = pp.salon_id where pp.id = prof), 0))
  order by g.t;
$$;

-- 6. As regras do salão contam o resto ---------------------------------------------
create or replace function public.pagamento_do_salao(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'modo', case when c.conta_id is not null then s.pagamento_modo else 'nao' end,
    'sinal_pct', s.sinal_pct,
    'politica', s.politica_cancelamento,
    'estorno_horas', public.horas_da_politica(s.politica_cancelamento),
    'credito_dias', 30,
    'carencia_min', 60,
    'permite_remarcar', coalesce(s.permite_remarcar, true),
    'antecedencia_min', coalesce(s.antecedencia_min_minutos, 0),
    'sinal_modo', coalesce(s.sinal_modo, 'pct'), 'sinal_fixo_cents', s.sinal_fixo_cents)
  from public.salons s
  left join public.contas_de_recebimento c on c.salon_id = s.id
  where s.id = salao;
$$;

-- 7. Os horários da semana, de uma vez ------------------------------------------
-- o onboarding manda os 7 dias; cria o que falta e atualiza o que existe
create or replace function public.onboarding_horarios(salao uuid, horarios jsonb)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare h jsonb; n integer := 0;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão faz o cadastro.'; end if;
  for h in select * from jsonb_array_elements(horarios) loop
    if (h ->> 'open')::boolean and (h ->> 'start_time')::time >= (h ->> 'end_time')::time then
      raise exception 'O horário final precisa ser depois do inicial (dia %).', h ->> 'weekday';
    end if;
    insert into public.business_hours (salon_id, weekday, open, start_time, end_time)
    values (salao, (h ->> 'weekday')::smallint, coalesce((h ->> 'open')::boolean, false), coalesce((h ->> 'start_time')::time, time '09:00'), coalesce((h ->> 'end_time')::time, time '18:00'))
    on conflict (salon_id, weekday) do update set open = excluded.open, start_time = excluded.start_time, end_time = excluded.end_time;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'dias', n);
end;
$$;
revoke execute on function public.onboarding_horarios(uuid, jsonb) from public, anon;
grant execute on function public.onboarding_horarios(uuid, jsonb) to authenticated;
