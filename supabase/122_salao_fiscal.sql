-- 122: a identificação fiscal do negócio no cadastro. CNPJ obrigatório,
-- ou CPF de quem ainda trabalha informalmente; o endereço fiscal (o da
-- Receita) separado do endereço do salão, que pode ser outro; e os
-- contatos a mais (telefones e e-mails além do principal). O logo e as
-- fotos do espaço passam a ser gravados pelo mesmo caminho (passo 3).
alter table public.salons add column if not exists documento_tipo text not null default 'cnpj';
alter table public.salons add column if not exists nome_fantasia text;
alter table public.salons add column if not exists endereco_fiscal jsonb;
alter table public.salons add column if not exists endereco_igual boolean not null default true;
alter table public.salons add column if not exists contatos jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.salons add constraint salons_documento_tipo_conhecido check (documento_tipo in ('cnpj', 'cpf'));
exception when duplicate_object then null; end $$;
-- quem já cadastrou o CNPJ formatado passa a guardar só dígitos
update public.salons set cnpj = nullif(regexp_replace(cnpj, '\D', '', 'g'), '') where cnpj is not null and cnpj ~ '\D';
-- quem já tinha CNPJ e endereço: o endereço cadastrado passa a ser também o fiscal
update public.salons set endereco_fiscal = jsonb_build_object('address', coalesce(address, ''), 'bairro', coalesce(bairro, ''), 'city', coalesce(city, ''), 'uf', coalesce(uf, ''), 'cep', coalesce(cep, ''))
 where cnpj is not null and endereco_fiscal is null and (address is not null or city is not null);
grant select (documento_tipo, nome_fantasia, endereco_fiscal, endereco_igual, contatos) on public.salons to authenticated;
grant update (documento_tipo, nome_fantasia, endereco_fiscal, endereco_igual, contatos) on public.salons to authenticated;

create or replace function public.onboarding_salvar_interno(salao uuid, dados jsonb, passo integer default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare s public.salons%rowtype;
begin
  update public.salons set
    name = coalesce(nullif(btrim(dados ->> 'name'), ''), name),
    documento_tipo = case when dados ->> 'documento_tipo' in ('cnpj', 'cpf') then dados ->> 'documento_tipo' else documento_tipo end,
    cnpj = case when dados ? 'cnpj' then nullif(regexp_replace(coalesce(dados ->> 'cnpj', ''), '\D', '', 'g'), '') else cnpj end,
    responsavel_cpf = case when dados ? 'responsavel_cpf' then nullif(regexp_replace(coalesce(dados ->> 'responsavel_cpf', ''), '\D', '', 'g'), '') else responsavel_cpf end,
    razao_social = case when dados ? 'razao_social' then nullif(btrim(dados ->> 'razao_social'), '') else razao_social end,
    nome_fantasia = case when dados ? 'nome_fantasia' then nullif(btrim(dados ->> 'nome_fantasia'), '') else nome_fantasia end,
    endereco_fiscal = case when jsonb_typeof(dados -> 'endereco_fiscal') = 'object' then dados -> 'endereco_fiscal' when dados ? 'endereco_fiscal' then null else endereco_fiscal end,
    endereco_igual = coalesce((dados ->> 'endereco_igual')::boolean, endereco_igual),
    contatos = case when jsonb_typeof(dados -> 'contatos') = 'array' then dados -> 'contatos' else contatos end,
    whatsapp = case when dados ? 'whatsapp' then nullif(btrim(dados ->> 'whatsapp'), '') else whatsapp end,
    phone = case when dados ? 'whatsapp' then coalesce(nullif(btrim(dados ->> 'whatsapp'), ''), phone) else phone end,
    email = case when dados ? 'email' then nullif(lower(btrim(dados ->> 'email')), '') else email end,
    responsavel_nome = case when dados ? 'responsavel_nome' then nullif(btrim(dados ->> 'responsavel_nome'), '') else responsavel_nome end,
    logo_url = case when dados ? 'logo_url' then nullif(dados ->> 'logo_url', '') else logo_url end,
    fotos = case when jsonb_typeof(dados -> 'fotos') = 'array' then coalesce((select array_agg(x) from jsonb_array_elements_text(dados -> 'fotos') x), '{}'::text[]) else fotos end,
    descricao = case when dados ? 'descricao' then left(nullif(btrim(dados ->> 'descricao'), ''), 800) else descricao end,
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

-- ---- o consentimento de marketing (novidades, ofertas e dicas) ----
-- Vem marcado (ou não) no cadastro, e a pessoa muda quando quiser.
alter table public.profiles add column if not exists marketing_ok boolean not null default false;
alter table public.profiles add column if not exists marketing_em timestamptz;
grant select (marketing_ok, marketing_em) on public.profiles to authenticated;

create or replace function public.preferir_marketing(ok boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'sem sessão'; end if;
  update public.profiles set marketing_ok = coalesce(ok, false), marketing_em = now() where id = auth.uid();
  return jsonb_build_object('ok', true, 'marketing_ok', coalesce(ok, false));
end;
$$;
revoke execute on function public.preferir_marketing(boolean) from public, anon;
grant execute on function public.preferir_marketing(boolean) to authenticated;

-- o cadastro traz também o "quero receber novidades" (meta.marketing)
create or replace function public.termos_do_cadastro()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v text := nullif(btrim(coalesce(meta ->> 'termos', '')), '');
  nasc date;
  mkt boolean;
begin
  begin
    nasc := nullif(meta ->> 'nascimento', '')::date;
  exception when others then nasc := null;
  end;
  begin
    mkt := (meta ->> 'marketing')::boolean;
  exception when others then mkt := null;
  end;
  update public.profiles
     set aceitou_termos_em = case when v is not null then now() else aceitou_termos_em end,
         termos_versao = coalesce(v, termos_versao),
         nascimento = coalesce(nasc, nascimento),
         marketing_ok = coalesce(mkt, marketing_ok),
         marketing_em = case when mkt is not null then now() else marketing_em end
   where id = new.id;
  if jsonb_typeof(meta -> 'aceites') = 'object' then
    begin
      perform public.aceitar_documentos_interno(new.id, meta -> 'aceites', 'cadastro');
    exception when others then
      raise notice 'aceites de % não gravados: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

insert into public.migracoes_aplicadas (arquivo) values ('122_salao_fiscal.sql') on conflict (arquivo) do nothing;
