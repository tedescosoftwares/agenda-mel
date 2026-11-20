-- 255 · Importar salões sem passar do tempo do banco (4.4.1)
--
-- "canceling statement due to statement timeout" ao importar São Bernardo: a cada lote de linhas, guia_importar terminava
-- com dois group by na tabela inteira de salões (só para criar as linhas das páginas de cidade e de categoria que faltam).
-- Com 20 mil salões, no plano gratuito, isso sozinho estourava o tempo que o Supabase dá a uma chamada da Plataforma
-- (uns 8 s), e piorava a cada cidade importada. Agora a função guarda as cidades e categorias do próprio lote e cria só
-- essas linhas. O resto é a mesma função da 155 (as regras de quem entra, de atualizar campo a campo e de recusar
-- barbearia não mudam). Na Plataforma, a importação passa a ir em lotes que encolhem quando o banco demora (4.4.1).

CREATE OR REPLACE FUNCTION public.guia_importar(itens jsonb, aplicar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET plan_cache_mode TO 'force_custom_plan'
 SET jit TO 'off'
AS $function$
declare
  it jsonb;
  idx bigint;
  ex public.guia_lugares;
  achou boolean;
  origem_ text;
  cidade_ text;
  cslug text;
  nome_ text;
  base text;
  slug_ text;
  n int;
  campo text;
  valor jsonb;
  novos int := 0; atualizados int := 0; ignorados int := 0; validos int := 0;
  barbearias int := 0; sem_google int := 0;
  problemas jsonb := '[]'::jsonb;
  vistos text[] := '{}';
  chave text;
  cats_ text[] := array['beleza', 'cabelo', 'unhas', 'cilios', 'sobrancelhas', 'barbearia', 'estetica', 'maquiagem'];
  campos text[] := array['nome', 'categoria', 'bairro', 'endereco', 'cep', 'telefone', 'whatsapp', 'instagram', 'site', 'horarios', 'servicos', 'latitude', 'longitude', 'atributos'];
  muda jsonb;
  -- 255: as cidades e categorias deste lote, para as linhas das páginas (antes, um group by na tabela inteira a cada lote)
  paginas_ jsonb := '[]'::jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma importa o guia'; end if;
  if jsonb_typeof(itens) <> 'array' then raise exception 'itens precisa ser uma lista'; end if;

  for it, idx in select value, ordinality from jsonb_array_elements(itens) with ordinality loop
    origem_ := coalesce(nullif(it ->> 'origem', ''), 'manual');
    cidade_ := nullif(btrim(coalesce(it ->> 'cidade', '')), '');
    nome_ := nullif(btrim(coalesce(it ->> 'nome', '')), '');
    if origem_ not in ('google', 'receita', 'manual') then
      problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'origem desconhecida'); continue;
    end if;
    if nome_ is null then problemas := problemas || jsonb_build_object('indice', idx, 'nome', null, 'erro', 'sem nome'); continue; end if;
    if cidade_ is null then problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'sem cidade'); continue; end if;
    if coalesce(it ->> 'categoria', '') <> '' and not ((it ->> 'categoria') = any (cats_)) then
      problemas := problemas || jsonb_build_object('indice', idx, 'nome', nome_, 'erro', 'categoria desconhecida: ' || (it ->> 'categoria')); continue;
    end if;
    -- barbearia não entra no guia (154)
    if coalesce(it ->> 'categoria', '') = 'barbearia' then ignorados := ignorados + 1; barbearias := barbearias + 1; continue; end if;
    cslug := public.guia_slug(cidade_);
    validos := validos + 1;

    -- o mesmo salão: place_id, depois CNPJ, depois nome na cidade
    achou := false;
    if coalesce(it ->> 'place_id', '') <> '' then
      select * into ex from public.guia_lugares where place_id = it ->> 'place_id'; achou := found;
    end if;
    if not achou and coalesce(it ->> 'cnpj', '') <> '' then
      select * into ex from public.guia_lugares where cnpj = it ->> 'cnpj' order by criado_em limit 1; achou := found;
    end if;
    if not achou then
      select * into ex from public.guia_lugares where cidade_slug = cslug and slug = public.guia_slug(nome_); achou := found;
    end if;
    -- repetido dentro do próprio arquivo: conta uma vez só
    chave := coalesce(nullif(it ->> 'place_id', ''), nullif(it ->> 'cnpj', ''), cslug || '/' || public.guia_slug(nome_));
    if chave = any (vistos) then ignorados := ignorados + 1; validos := validos - 1; continue; end if;
    vistos := vistos || chave;

    if achou and ex.status = 'removido' then ignorados := ignorados + 1; continue; end if;
    if achou and ex.categoria = 'barbearia' then ignorados := ignorados + 1; barbearias := barbearias + 1; continue; end if;
    -- a Receita só confirma e completa quem veio do Google; não cria salão (154)
    if not achou and origem_ = 'receita' then ignorados := ignorados + 1; sem_google := sem_google + 1; continue; end if;

    if not aplicar then
      if achou then atualizados := atualizados + 1; else novos := novos + 1; end if;
      continue;
    end if;

    if not achou then
      base := public.guia_slug(nome_);
      if base = '' then base := 'salao'; end if;
      if base = any (cats_) then base := base || '-' || cslug; end if;
      slug_ := base;
      if exists (select 1 from public.guia_lugares where cidade_slug = cslug and slug = slug_) and coalesce(it ->> 'bairro', '') <> '' then
        slug_ := left(base || '-' || public.guia_slug(it ->> 'bairro'), 60);
      end if;
      n := 2;
      while exists (select 1 from public.guia_lugares where cidade_slug = cslug and slug = slug_) loop
        slug_ := left(base, 56) || '-' || n; n := n + 1;
      end loop;
      insert into public.guia_lugares (cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site,
        horarios, servicos, latitude, longitude, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, origem, atributos)
      values (cidade_, cslug, coalesce(nullif(it ->> 'uf', ''), 'SP'), slug_, coalesce(nullif(it ->> 'categoria', ''), 'beleza'), nome_,
        nullif(it ->> 'bairro', ''), nullif(it ->> 'endereco', ''), nullif(it ->> 'cep', ''), nullif(it ->> 'telefone', ''), nullif(it ->> 'whatsapp', ''),
        nullif(it ->> 'instagram', ''), nullif(it ->> 'site', ''),
        case when jsonb_typeof(it -> 'horarios') = 'array' then it -> 'horarios' end,
        coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(it -> 'servicos') = 'array' then it -> 'servicos' else '[]'::jsonb end) x), '{}'),
        (it ->> 'latitude')::double precision, (it ->> 'longitude')::double precision,
        nullif(it ->> 'place_id', ''), nullif(it ->> 'cnpj', ''), coalesce((it ->> 'validado_receita')::boolean, false) or origem_ = 'receita',
        coalesce((it ->> 'selecao')::boolean, false), (it ->> 'nota')::numeric, (it ->> 'avaliacoes')::numeric::int,
        jsonb_build_object(origem_, coalesce(it -> 'bruto', '{}'::jsonb)),
        case when jsonb_typeof(it -> 'atributos') = 'object' then it -> 'atributos' else '{}'::jsonb end);
      paginas_ := paginas_ || jsonb_build_object('cidade', cidade_, 'cidade_slug', cslug, 'uf', coalesce(nullif(it ->> 'uf', ''), 'SP'), 'categoria', coalesce(nullif(it ->> 'categoria', ''), 'beleza'));
      novos := novos + 1;
      continue;
    end if;

    -- atualizar: campo a campo
    muda := '{}'::jsonb;
    foreach campo in array campos loop
      valor := it -> campo;
      -- serviços do Google substituem os antigos mesmo vazios: os de antes saíam das palavras da busca (155)
      if campo = 'servicos' and origem_ = 'google' and jsonb_typeof(valor) = 'array' then
        if ex.fontes ->> campo is distinct from 'manual' then muda := muda || jsonb_build_object(campo, valor); end if;
        continue;
      end if;
      if valor is null or valor = 'null'::jsonb or valor = '""'::jsonb or valor = '{}'::jsonb
         or (jsonb_typeof(valor) = 'array' and jsonb_array_length(valor) = 0) then continue; end if;
      if ex.fontes ->> campo = 'manual' then continue; end if;
      -- a Receita só preenche o que está vazio
      if origem_ = 'receita' and coalesce(to_jsonb(ex) -> campo, 'null'::jsonb) not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb) then continue; end if;
      muda := muda || jsonb_build_object(campo, valor);
    end loop;
    update public.guia_lugares set
      nome = coalesce(muda ->> 'nome', nome),
      categoria = coalesce(muda ->> 'categoria', categoria),
      bairro = coalesce(muda ->> 'bairro', bairro),
      endereco = coalesce(muda ->> 'endereco', endereco),
      cep = coalesce(muda ->> 'cep', cep),
      telefone = coalesce(muda ->> 'telefone', telefone),
      whatsapp = coalesce(muda ->> 'whatsapp', whatsapp),
      instagram = coalesce(muda ->> 'instagram', instagram),
      site = coalesce(muda ->> 'site', site),
      horarios = coalesce(muda -> 'horarios', horarios),
      servicos = case when muda ? 'servicos' then coalesce((select array_agg(x) from jsonb_array_elements_text(muda -> 'servicos') x), '{}') else servicos end,
      atributos = case when jsonb_typeof(muda -> 'atributos') = 'object' then muda -> 'atributos' else atributos end,
      latitude = coalesce((muda ->> 'latitude')::double precision, latitude),
      longitude = coalesce((muda ->> 'longitude')::double precision, longitude),
      place_id = coalesce(place_id, nullif(it ->> 'place_id', '')),
      cnpj = coalesce(cnpj, nullif(it ->> 'cnpj', '')),
      validado_receita = validado_receita or origem_ = 'receita' or coalesce((it ->> 'validado_receita')::boolean, false),
      selecao = case when it ? 'selecao' and it ->> 'selecao' is not null and coalesce(fontes ->> 'selecao', '') <> 'manual' then (it ->> 'selecao')::boolean else selecao end,
      nota = case when origem_ = 'google' then coalesce((it ->> 'nota')::numeric, nota) else nota end,
      avaliacoes = case when origem_ = 'google' then coalesce((it ->> 'avaliacoes')::numeric::int, avaliacoes) else avaliacoes end,
      origem = origem || jsonb_build_object(origem_, coalesce(it -> 'bruto', '{}'::jsonb))
    where id = ex.id;
    paginas_ := paginas_ || jsonb_build_object('cidade', ex.cidade, 'cidade_slug', ex.cidade_slug, 'uf', ex.uf, 'categoria', coalesce(muda ->> 'categoria', ex.categoria));
    atualizados := atualizados + 1;
  end loop;

  -- toda cidade e toda categoria com salão ganham a linha da página (para gerar o texto). 255: só as deste lote: as
  -- outras já ganharam no lote em que entraram (e a 153 criou as de antes)
  if aplicar and jsonb_array_length(paginas_) > 0 then
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select distinct on (p ->> 'cidade_slug') p ->> 'cidade', p ->> 'cidade_slug', p ->> 'uf', ''
        from jsonb_array_elements(paginas_) p order by p ->> 'cidade_slug'
      on conflict (cidade_slug, categoria) do nothing;
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select distinct on (p ->> 'cidade_slug', p ->> 'categoria') p ->> 'cidade', p ->> 'cidade_slug', p ->> 'uf', p ->> 'categoria'
        from jsonb_array_elements(paginas_) p where p ->> 'categoria' <> 'barbearia' order by p ->> 'cidade_slug', p ->> 'categoria'
      on conflict (cidade_slug, categoria) do nothing;
  end if;

  return jsonb_build_object('total', jsonb_array_length(itens), 'validos', validos, 'novos', novos, 'atualizados', atualizados,
    'ignorados', ignorados, 'barbearias', barbearias, 'sem_google', sem_google, 'problemas', problemas, 'aplicado', aplicar);
end $function$;
