-- 121: o cadastro do salão guarda a razão social que veio da Receita
-- (busca pelo CNPJ no passo 2). A coluna já existia (101, contrato de
-- parceria); só faltava o onboarding gravar nela.
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
    razao_social = case when dados ? 'razao_social' then nullif(btrim(dados ->> 'razao_social'), '') else razao_social end,
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
grant select (razao_social) on public.salons to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('121_onboarding_razao_social.sql') on conflict (arquivo) do nothing;
