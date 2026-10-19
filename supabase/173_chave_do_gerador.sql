-- 173 (3.24): a chave do gerador e as funções pesadas fora do alcance da chave pública.
--
-- Qualquer um com a chave pública do site (ela está no JavaScript) podia chamar guia_publicadas,
-- guia_cidade e guia_colecoes em loop e queimar a saída do plano gratuito. O visitante normal não
-- as chama mais desde a 3.23 (o site lê os JSON do VPS), então:
--   - guia_publicadas passa a exigir chave_, conferida em guia_segredos (tabela sem acesso pela API);
--     o gerador lê a chave de GUIA_CHAVE_GERADOR no .env da Evolution;
--   - guia_cidade e guia_colecoes saem do anon (continuam para quem está logado): a reserva do site
--     para uma cidade publicada há menos de uma hora deixa de existir para visitante anônimo;
--   - guia_pagina (6 KB) e guia_cidades (pequena) continuam públicas: são a reserva do site para
--     salão publicado há menos de uma hora.
-- A chave: select valor from public.guia_segredos where nome = 'gerador';

create table if not exists public.guia_segredos (
  nome text primary key,
  valor text not null,
  criado_em timestamptz not null default now()
);
comment on table public.guia_segredos is 'Guia (173): segredos que só as funções security definer leem. "gerador": a chave que guia_publicadas exige (GUIA_CHAVE_GERADOR no .env da Evolution).';
alter table public.guia_segredos enable row level security;
revoke all on public.guia_segredos from public, anon, authenticated;
insert into public.guia_segredos (nome, valor) values ('gerador', md5(random()::text || clock_timestamp()::text || random()::text))
  on conflict (nome) do nothing;

drop function if exists public.guia_publicadas(text, timestamptz, text, int);
create or replace function public.guia_publicadas(cidade_ text default '', desde_ timestamptz default null, depois_ text default '', limite_ int default 200, chave_ text default '')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  c text := lower(btrim(coalesce(cidade_, '')));
  dep text := coalesce(depois_, '');
  lim int := least(greatest(coalesce(limite_, 200), 1), 500);
  base record;
  primeira boolean := dep = '';
begin
  if coalesce(chave_, '') = '' or chave_ is distinct from (select s.valor from public.guia_segredos s where s.nome = 'gerador') then
    raise exception 'chave do gerador inválida: leia em guia_segredos (nome = gerador) e ponha em GUIA_CHAVE_GERADOR no .env da Evolution' using errcode = '28000';
  end if;
  if c = '' then
    return jsonb_build_object(
      'agora', now(),
      'lugares', coalesce((select jsonb_agg(public.guia_publico(l) order by l.cidade_slug, l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome)
          from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null), '[]'::jsonb),
      'paginas', coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
          from public.guia_paginas p where p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb),
      'cidades', public.guia_cidades());
  end if;
  select l.cidade, l.uf into base from public.guia_lugares l
   where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
   group by l.cidade, l.uf order by count(*) desc limit 1;
  if not found then
    return jsonb_build_object('cidade_slug', c, 'agora', now(), 'slugs', '[]'::jsonb, 'lugares', '[]'::jsonb, 'paginas', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'cidade', base.cidade, 'cidade_slug', c, 'uf', base.uf, 'agora', now(), 'limite', lim,
    'slugs', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('slug', x.slug, 'atualizado_em', x.atualizado_em) order by x.ordem)
        from (select l.slug, l.atualizado_em,
                     row_number() over (order by l.salon_id is null, not l.selecao, public.guia_pontos(l) desc, l.avaliacoes desc nulls last, l.nome) as ordem
                from public.guia_lugares l where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null) x), '[]'::jsonb) else null end,
    'paginas', case when primeira then coalesce((select jsonb_agg(jsonb_build_object('cidade_slug', p.cidade_slug, 'categoria', p.categoria, 'conteudo', p.conteudo, 'atualizado_em', p.atualizado_em))
        from public.guia_paginas p where p.cidade_slug = c and p.status = 'publicado' and p.conteudo is not null), '[]'::jsonb) else null end,
    'lugares', coalesce((select jsonb_agg(x.p order by x.slug) from (
        select l.slug, public.guia_publico(l) as p from public.guia_lugares l
         where l.cidade_slug = c and l.status = 'publicado' and l.conteudo is not null
           and (desde_ is null or l.atualizado_em > desde_) and l.slug > dep
         order by l.slug limit lim) x), '[]'::jsonb));
end $$;
comment on function public.guia_publicadas(text, timestamptz, text, int, text) is 'Guia (173): a cidade em fatias para o gerador, só com a chave do gerador (guia_segredos). Ver 172.';
grant execute on function public.guia_publicadas(text, timestamptz, text, int, text) to anon, authenticated;

-- as funções pesadas saem do alcance da chave pública (o site lê os JSON do VPS desde a 3.23). O Postgres dá
-- execute a PUBLIC por padrão, então tirar só do anon não basta: tira de todos e devolve a quem está logado
revoke execute on function public.guia_cidade(text, text) from public, anon;
grant execute on function public.guia_cidade(text, text) to authenticated;
revoke execute on function public.guia_colecoes(text) from public, anon;
grant execute on function public.guia_colecoes(text) to authenticated;

do $$
begin
  raise notice '173: guia_publicadas exige a chave do gerador (guia_segredos); guia_cidade e guia_colecoes fora do anon. Chave: select valor from public.guia_segredos where nome = ''gerador'';';
end $$;
