-- 230 · Sem barbeiro (3.88)
--
-- A MIMO é de beleza (o guia já não tem barbearia desde a 154). Sai o que ainda falava de barba:
--   · a categoria global "Barba" (inativa desde a 143): os serviços e os itens do catálogo que estavam nela vão
--     para "Outros", ela sai das categorias escolhidas dos salões e das profissionais, e é apagada;
--   · o ramo "barbearia" da Mel: quem estava nele volta a ser deduzido; as frases só de barbearia são desligadas
--     e, das outras, o ramo sai da lista; ramo_do_salao não deduz mais barbearia; os checks não aceitam mais;
--   · a descrição da página /sistema-de-agendamento sem "barbearia" (só troca a frase, se ela ainda estiver lá),
--     e uma página de SEO de barbearia criada na Plataforma, se houver, volta para rascunho.
-- O que fica: o guia continua recusando barbearia ao importar (guia_importar e companhia), de propósito.

do $$
declare
  barba uuid; outros uuid; n_serv integer := 0; n_cat integer := 0;
begin
  select id into barba from public.categorias_de_servico where salon_id is null and slug = 'barba';
  select id into outros from public.categorias_de_servico where salon_id is null and slug = 'outros';
  if barba is not null then
    update public.services set categoria_id = outros where categoria_id = barba;
    get diagnostics n_serv = row_count;
    update public.catalogo_itens set categoria_id = outros where categoria_id = barba and outros is not null;
    update public.salons set categorias_escolhidas = array_remove(categorias_escolhidas, barba) where barba = any (categorias_escolhidas);
    update public.professionals set categorias = array_remove(categorias, barba) where barba = any (categorias);
    if not exists (select 1 from public.catalogo_itens where categoria_id = barba) then
      delete from public.categorias_de_servico where id = barba;
      n_cat := 1;
    end if;
  end if;
  raise notice '230: categoria Barba: % serviços para Outros, % apagada', n_serv, n_cat;
end $$;

-- o ramo da Mel
update public.salons set ramo = null where ramo = 'barbearia';
update public.mel_frases set ativa = false, ramos = null where ramos = array['barbearia']::text[];
update public.mel_frases set ramos = nullif(array_remove(ramos, 'barbearia'), '{}') where 'barbearia' = any (ramos);
alter table public.salons drop constraint if exists salons_ramo_conhecido;
alter table public.salons add constraint salons_ramo_conhecido check (ramo is null or ramo in ('beleza', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem'));
alter table public.mel_frases drop constraint if exists mel_frases_ramos_check;
alter table public.mel_frases add constraint mel_frases_ramos_check check (ramos is null or ramos <@ array['beleza', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem']::text[]);

CREATE OR REPLACE FUNCTION public.mel_frase_validar(item jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  m public.mel_momentos%rowtype;
  chave_ text := item ->> 'chave';
  sup text := item ->> 'superficie';
  txt text := item ->> 'texto';
  ph text; lista text[]; v text;
  sobra text;
begin
  if item is null or jsonb_typeof(item) <> 'object' then return 'não é um objeto'; end if;
  if coalesce(chave_, '') = '' then return 'falta o moment (chave)'; end if;
  select * into m from public.mel_momentos where chave = chave_;
  if not found then return format('moment "%s" não existe', chave_); end if;
  if coalesce(sup, '') = '' then return 'falta a superfície'; end if;
  if sup not in ('mel_bubble', 'weather_card') then return format('superfície "%s" inválida', sup); end if;
  if not (sup = any (m.superficies)) then return format('o moment %s não usa a superfície %s', chave_, sup); end if;
  if length(btrim(coalesce(txt, ''))) = 0 then return 'texto vazio'; end if;

  -- placeholders: só os que o moment declara; chave aberta sem fechar também é erro
  foreach ph in array public.mel_placeholders_de(txt) loop
    if ph = '' then return 'placeholder vazio {}'; end if;
    if not (ph = any (m.placeholders)) then return format('placeholder {%s} não permitido em %s', ph, chave_); end if;
  end loop;
  sobra := regexp_replace(txt, '\{[^{}]*\}', '', 'g');
  if position('{' in sobra) > 0 or position('}' in sobra) > 0 then return 'chave { } sem fechar'; end if;

  -- listas opcionais: cada valor precisa ser conhecido
  if item ? 'ramos' and jsonb_typeof(item -> 'ramos') not in ('null', 'array') then return 'ramos precisa ser lista ou null'; end if;
  if item ? 'tipos' and jsonb_typeof(item -> 'tipos') not in ('null', 'array') then return 'tipos precisa ser lista ou null'; end if;
  if item ? 'contextos_clima' and jsonb_typeof(item -> 'contextos_clima') not in ('null', 'array') then return 'contextos_clima precisa ser lista ou null'; end if;
  if item ? 'periodos' and jsonb_typeof(item -> 'periodos') not in ('null', 'array') then return 'periodos precisa ser lista ou null'; end if;
  if jsonb_typeof(item -> 'ramos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'ramos') loop
      if v not in ('beleza', 'unhas', 'estetica', 'cabelo', 'sobrancelhas_cilios', 'depilacao', 'maquiagem') then return format('ramo "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'tipos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'tipos') loop
      if v not in ('salao', 'autonoma') then return format('tipo "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'contextos_clima') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'contextos_clima') loop
      if v not in ('ensolarado', 'nublado', 'chuva', 'trovoada', 'frio', 'calor') then return format('contexto de clima "%s" desconhecido', v); end if;
    end loop;
  end if;
  if jsonb_typeof(item -> 'periodos') = 'array' then
    for v in select jsonb_array_elements_text(item -> 'periodos') loop
      if v not in ('manha', 'tarde', 'noite') then return format('período "%s" desconhecido', v); end if;
    end loop;
  end if;
  if item ? 'tom' and jsonb_typeof(item -> 'tom') <> 'null' and (item ->> 'tom') not in ('feliz', 'atenta', 'alerta', 'comemorando', 'cansada', 'neutra') then
    return format('tom "%s" desconhecido', item ->> 'tom');
  end if;
  if item ? 'peso' and jsonb_typeof(item -> 'peso') <> 'null' then
    if jsonb_typeof(item -> 'peso') <> 'number' or (item ->> 'peso')::numeric <> floor((item ->> 'peso')::numeric) or (item ->> 'peso')::numeric not between 1 and 10 then
      return 'peso precisa ser inteiro de 1 a 10';
    end if;
  end if;
  if item ? 'ativa' and jsonb_typeof(item -> 'ativa') not in ('null', 'boolean') then return 'ativa precisa ser true ou false'; end if;
  return null;
end;
$function$;

create or replace function public.ramo_do_salao(salao uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  nomes text[];
  tem_barba boolean; tem_cabelo boolean; tem_unha boolean; tem_estetica boolean; tem_sobr boolean; tem_dep boolean; tem_maq boolean;
begin
  select * into s from public.salons where id = salao;
  if not found then return 'beleza'; end if;
  if s.ramo is not null then return s.ramo; end if;
  -- as categorias do salão (globais escolhidas + próprias) e os nomes dos serviços
  select coalesce(array_agg(lower(x)), '{}') into nomes from (
    select c.nome as x from public.categorias_de_servico c where c.id = any (s.categorias_escolhidas) or c.salon_id = salao
    union all
    select sv.name from public.services sv where sv.salon_id = salao and sv.active
  ) t;
  tem_barba := exists (select 1 from unnest(nomes) n where n like '%barba%');
  tem_cabelo := exists (select 1 from unnest(nomes) n where n like '%cabelo%' or n like '%corte%' or n like '%escova%' or n like '%progressiva%' or n like '%colora%' or n like '%mecha%');
  tem_unha := exists (select 1 from unnest(nomes) n where n like '%unha%' or n like '%manicure%' or n like '%pedicure%' or n like '%esmalt%');
  tem_estetica := exists (select 1 from unnest(nomes) n where n like '%rosto%' or n like '%corpo%' or n like '%estética%' or n like '%estetica%' or n like '%limpeza de pele%' or n like '%massagem%' or n like '%drenagem%');
  tem_sobr := exists (select 1 from unnest(nomes) n where n like '%sobrancelha%' or n like '%cílio%' or n like '%cilio%');
  tem_dep := exists (select 1 from unnest(nomes) n where n like '%depila%');
  tem_maq := exists (select 1 from unnest(nomes) n where n like '%maquiagem%' or n like '%make%');
  if cardinality(nomes) = 0 then return 'beleza'; end if;
  if tem_unha and not tem_cabelo and not tem_barba and not tem_estetica and not tem_dep and not tem_maq then return 'unhas'; end if;
  if tem_sobr and not tem_cabelo and not tem_barba and not tem_unha and not tem_estetica and not tem_dep then return 'sobrancelhas_cilios'; end if;
  if tem_dep and not tem_cabelo and not tem_barba and not tem_unha and not tem_sobr and not tem_maq then return 'depilacao'; end if;
  if tem_maq and not tem_cabelo and not tem_barba and not tem_unha and not tem_estetica and not tem_dep then return 'maquiagem'; end if;
  if tem_estetica and not tem_cabelo and not tem_barba and not tem_unha then return 'estetica'; end if;
  if tem_cabelo and not tem_unha and not tem_estetica and not tem_sobr and not tem_dep and not tem_maq then return 'cabelo'; end if;
  return 'beleza';
end;
$$;

-- a página do sistema de agendamento
update public.seo_pages
   set meta_description = replace(meta_description, 'salão de beleza, estúdio, barbearia e clínica de estética', 'salão de beleza, estúdio e clínica de estética'),
       og_description = replace(og_description, 'salão de beleza, estúdio, barbearia e clínica de estética', 'salão de beleza, estúdio e clínica de estética')
 where route = '/sistema-de-agendamento' and (meta_description like '%barbearia%' or og_description like '%barbearia%');

-- página de SEO criada para barbearia/barbeiro na Plataforma (se houver): volta para rascunho, nada é apagado
update public.seo_pages set status = 'draft' where status = 'published' and (route ~* 'barb' or coalesce(title, '') ~* 'barb');

do $$ begin raise notice '230: sem barbeiro (categoria Barba, ramo barbearia da Mel, texto da página)'; end $$;
