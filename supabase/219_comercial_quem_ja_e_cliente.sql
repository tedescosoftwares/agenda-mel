-- 219: a assistente comercial reconhece quem já tem agenda na MIMO pelo nome do salão e pela cidade (3.74.1)
--
-- A cidade e o nome do salão que a assistente pergunta servem, antes de tudo, para saber se quem escreve JÁ É CLIENTE:
-- o número de quem escreve nem sempre é o cadastrado (a dona escreve do celular pessoal, de outro chip). Então a busca
-- (comercial_buscar_salao) passa a olhar primeiro os salões da MIMO (salons: nome e cidade) e devolve "mimo" quando acha
-- — o motor responde o texto de suporte e marca a conversa como cliente, sem vender de novo. O guia continua como antes
-- (a página grátis, as fotos), e um salão do guia que já tem agenda (salon_id) também conta como cliente.

create or replace function public.comercial_buscar_salao(cidade_ text, nome_ text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cs text := public.slug_de(left(coalesce(cidade_, ''), 80));
  nome_cidade text;
  pw text[] := public.guia_whats_palavras(coalesce(nome_, ''));
  -- o texto inteiro como slug, para o nome feito só de palavras genéricas ou curtas ("Salão da Rô", "Studio M")
  tx text := public.slug_de(left(coalesce(nome_, ''), 120));
  lugares jsonb;
  mimo jsonb;
begin
  if cs is null or cs = '' then return jsonb_build_object('cidade_coberta', false, 'lugares', '[]'::jsonb, 'mimo', null); end if;
  -- 1. quem já tem agenda na MIMO com esse nome nessa cidade (o nome do salão, pelas palavras que não são genéricas)
  if cardinality(pw) > 0 or length(tx) >= 4 then
    with c as (
      select s.id, s.name, s.city, public.slug_de(s.name) as sl,
             (select count(*) from unnest(public.guia_whats_palavras(s.name)) w where w = any (pw))::int as comuns,
             cardinality(public.guia_whats_palavras(s.name)) as total
        from public.salons s
       where s.active and public.slug_de(coalesce(s.city, '')) = cs
    ),
    p as (
      select *, case when length(sl) >= 4 and ('-' || tx || '-' like '%-' || sl || '-%' or (length(tx) >= 4 and sl like '%' || tx || '%')) then 3 + comuns::numeric / 10
                     when comuns >= 2 or (comuns >= 1 and comuns * 2 >= total) then comuns + comuns::numeric / greatest(total, 1)
                     else 0 end as pontos
        from c
    )
    select jsonb_build_object('id', p.id, 'nome', p.name, 'cidade', p.city) into mimo
      from p where p.pontos > 0 order by p.pontos desc, length(p.name) limit 1;
  end if;
  -- 2. o guia
  select min(l.cidade) into nome_cidade from public.guia_lugares l where l.status = 'publicado' and l.cidade_slug = cs;
  if nome_cidade is null then return jsonb_build_object('cidade_coberta', false, 'cidade_slug', cs, 'lugares', '[]'::jsonb, 'mimo', mimo); end if;
  with c as (
    select l.id, l.nome, l.slug, l.bairro, l.cidade_slug, l.salon_id, l.fotos,
           (select count(*) from unnest(public.guia_whats_palavras(l.slug)) w where w = any (pw))::int as comuns,
           cardinality(public.guia_whats_palavras(l.slug)) as total
      from public.guia_lugares l
     where l.status = 'publicado' and l.cidade_slug = cs and (cardinality(pw) > 0 or length(tx) >= 4)
  ),
  p as (
    select *, case when length(slug) >= 4 and ('-' || tx || '-' like '%-' || slug || '-%' or (length(tx) >= 4 and slug like '%' || tx || '%')) then 3 + comuns::numeric / 10
                   when comuns >= 2 or (comuns >= 1 and comuns * 2 >= total) then comuns + comuns::numeric / greatest(total, 1)
                   else 0 end as pontos
      from c
  ),
  m as (select * from p where pontos > 0 order by pontos desc, length(nome) limit 3)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'nome', m.nome, 'slug', m.slug, 'bairro', m.bairro, 'cidade_slug', m.cidade_slug,
           'link', public.app_base() || '/saloes/' || m.cidade_slug || '/' || m.slug,
           'na_mimo', m.salon_id is not null, 'fotos_n', coalesce(array_length(m.fotos, 1), 0)) order by m.pontos desc, length(m.nome)), '[]'::jsonb)
    into lugares from m;
  -- o melhor do guia já tem agenda: é cliente também (mesmo que o nome na MIMO seja um pouco diferente)
  if mimo is null and jsonb_array_length(lugares) > 0 and (lugares -> 0 ->> 'na_mimo')::boolean then
    select jsonb_build_object('id', s.id, 'nome', s.name, 'cidade', s.city) into mimo
      from public.guia_lugares l join public.salons s on s.id = l.salon_id
     where l.id = (lugares -> 0 ->> 'id')::uuid;
  end if;
  return jsonb_build_object('cidade_coberta', true, 'cidade_slug', cs, 'cidade', nome_cidade, 'lugares', lugares, 'mimo', mimo);
end $$;
revoke execute on function public.comercial_buscar_salao(text, text) from public, anon, authenticated;

do $$ begin raise notice '219: a assistente comercial reconhece quem já tem agenda na MIMO pelo nome do salão e pela cidade'; end $$;
