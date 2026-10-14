-- 154: barbearia fica fora do guia de salões (3.9.1).
--
-- O guia é de salão de beleza: manicure, cabelo, cílios, sobrancelha,
-- estética e maquiagem. Barbearia não entra (decisão da casa).
--   - guia_importar deixa de fora a linha com categoria 'barbearia' (a
--     Plataforma já filtra antes de mandar; aqui é a trava do banco) e não
--     mexe em barbearia que já esteja no banco;
--   - o CSV da Receita só confirma e completa quem veio do CSV do Google:
--     sem o salão do Google correspondente, a linha é ignorada (era por aí que
--     as barbearias validadas na Receita voltavam como "salão de beleza");
--   - barbearia que já tinha sido importada sai do ar (descartada, com o
--     motivo) e a página da categoria barbearia é apagada.
-- Idempotente: pode rodar de novo.

create or replace function public.guia_importar(itens jsonb, aplicar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
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
  campos text[] := array['nome', 'categoria', 'bairro', 'endereco', 'cep', 'telefone', 'whatsapp', 'instagram', 'site', 'horarios', 'servicos', 'latitude', 'longitude'];
  muda jsonb;
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
        horarios, servicos, latitude, longitude, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, origem)
      values (cidade_, cslug, coalesce(nullif(it ->> 'uf', ''), 'SP'), slug_, coalesce(nullif(it ->> 'categoria', ''), 'beleza'), nome_,
        nullif(it ->> 'bairro', ''), nullif(it ->> 'endereco', ''), nullif(it ->> 'cep', ''), nullif(it ->> 'telefone', ''), nullif(it ->> 'whatsapp', ''),
        nullif(it ->> 'instagram', ''), nullif(it ->> 'site', ''),
        case when jsonb_typeof(it -> 'horarios') = 'array' then it -> 'horarios' end,
        coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(it -> 'servicos') = 'array' then it -> 'servicos' else '[]'::jsonb end) x), '{}'),
        (it ->> 'latitude')::double precision, (it ->> 'longitude')::double precision,
        nullif(it ->> 'place_id', ''), nullif(it ->> 'cnpj', ''), coalesce((it ->> 'validado_receita')::boolean, false) or origem_ = 'receita',
        coalesce((it ->> 'selecao')::boolean, false), (it ->> 'nota')::numeric, (it ->> 'avaliacoes')::numeric::int,
        jsonb_build_object(origem_, coalesce(it -> 'bruto', '{}'::jsonb)));
      novos := novos + 1;
      continue;
    end if;

    -- atualizar: campo a campo
    muda := '{}'::jsonb;
    foreach campo in array campos loop
      valor := it -> campo;
      if valor is null or valor = 'null'::jsonb or valor = '""'::jsonb or (jsonb_typeof(valor) = 'array' and jsonb_array_length(valor) = 0) then continue; end if;
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
      servicos = coalesce((select array_agg(x) from jsonb_array_elements_text(muda -> 'servicos') x), servicos),
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
    atualizados := atualizados + 1;
  end loop;

  -- toda cidade e toda categoria com salão ganham a linha da página (para gerar o texto)
  if aplicar then
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select max(cidade), cidade_slug, max(uf), '' from public.guia_lugares group by cidade_slug
      on conflict (cidade_slug, categoria) do nothing;
    insert into public.guia_paginas (cidade, cidade_slug, uf, categoria)
      select max(cidade), cidade_slug, max(uf), categoria from public.guia_lugares where categoria <> 'barbearia' group by cidade_slug, categoria
      on conflict (cidade_slug, categoria) do nothing;
  end if;

  return jsonb_build_object('total', jsonb_array_length(itens), 'validos', validos, 'novos', novos, 'atualizados', atualizados,
    'ignorados', ignorados, 'barbearias', barbearias, 'sem_google', sem_google, 'problemas', problemas, 'aplicado', aplicar);
end $$;
revoke execute on function public.guia_importar(jsonb, boolean) from public, anon;
grant execute on function public.guia_importar(jsonb, boolean) to authenticated;

update public.guia_lugares
   set status = 'descartado', motivo = 'Barbearia: não entra no guia.'
 where categoria = 'barbearia' and status not in ('descartado', 'removido');
delete from public.guia_paginas where categoria = 'barbearia';

do $$
declare n int;
begin
  select count(*) into n from public.guia_lugares where categoria = 'barbearia';
  raise notice '154: barbearia fora do guia (% no banco, todas fora do ar)', n;
end $$;
