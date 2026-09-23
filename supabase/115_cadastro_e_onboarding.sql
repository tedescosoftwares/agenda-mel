-- 115: o cadastro É o onboarding. Os passos 1 e 2 rodam antes de existir
-- conta; ao criar a conta, os dados do salão vêm nos metadados e o
-- servidor grava tudo no nascimento (e a conta já acorda no passo 3).

create or replace function public.onboarding_salvar_interno(salao uuid, dados jsonb, passo integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
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
revoke execute on function public.onboarding_salvar_interno(uuid, jsonb, integer) from public, anon, authenticated;

create or replace function public.onboarding_salvar(salao uuid, dados jsonb, passo integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Só a dona do salão faz o cadastro.'; end if;
  return public.onboarding_salvar_interno(salao, dados, passo);
end;
$$;

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
