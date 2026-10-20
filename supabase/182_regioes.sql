-- 182 (3.37): as regiões do guia. Toda cidade do guia pertence a uma região (Baixada Santista, Litoral Norte, Vale do
-- Ribeira e litoral sul, Vale do Paraíba e Serra da Mantiqueira); cidade nova é vinculada na Plataforma, e região que não
-- existe se cria lá. No site, a região tem página (/saloes/regiao/<slug>) acima das cidades, com foto, chamada e as
-- cidades dela; o índice /saloes agrupa por região. guia_regioes() é a função pública (o gerador e o site leem).
create table if not exists public.guia_regioes (
  slug text primary key,
  nome text not null,
  uf text not null default 'SP',
  ordem int not null default 100,
  foto text,
  chamada text,
  texto text,
  atualizado_em timestamptz not null default now()
);
comment on table public.guia_regioes is 'Guia (182): as regiões do guia, com a foto, a chamada e o texto da página de região.';
create table if not exists public.guia_cidades_regiao (
  cidade_slug text primary key,
  regiao_slug text not null references public.guia_regioes(slug) on delete cascade,
  atualizado_em timestamptz not null default now()
);
comment on table public.guia_cidades_regiao is 'Guia (182): a região de cada cidade (uma só). Cidade sem linha aqui aparece como "sem região" na Plataforma e em "Outras cidades" no site.';
create index if not exists guia_cidades_regiao_regiao on public.guia_cidades_regiao (regiao_slug);
drop trigger if exists guia_regioes_tocar on public.guia_regioes;
create trigger guia_regioes_tocar before update on public.guia_regioes for each row execute function public.guia_tocar();
drop trigger if exists guia_cidades_regiao_tocar on public.guia_cidades_regiao;
create trigger guia_cidades_regiao_tocar before update on public.guia_cidades_regiao for each row execute function public.guia_tocar();
alter table public.guia_regioes enable row level security;
alter table public.guia_cidades_regiao enable row level security;
drop policy if exists guia_regioes_plataforma on public.guia_regioes;
create policy guia_regioes_plataforma on public.guia_regioes for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
drop policy if exists guia_cidades_regiao_plataforma on public.guia_cidades_regiao;
create policy guia_cidades_regiao_plataforma on public.guia_cidades_regiao for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select, insert, update, delete on public.guia_regioes to authenticated;
grant select, insert, update, delete on public.guia_cidades_regiao to authenticated;

-- a semente: as quatro regiões e as cidades conhecidas de cada uma (as que ainda não estão no guia ficam prontas para quando entrarem)
insert into public.guia_regioes (slug, nome, uf, ordem) values
  ('baixada-santista', 'Baixada Santista', 'SP', 1),
  ('litoral-norte', 'Litoral Norte', 'SP', 2),
  ('vale-do-ribeira', 'Vale do Ribeira e litoral sul', 'SP', 3),
  ('vale-do-paraiba', 'Vale do Paraíba e Serra da Mantiqueira', 'SP', 4)
on conflict (slug) do nothing;
insert into public.guia_cidades_regiao (cidade_slug, regiao_slug) values
  ('bertioga', 'baixada-santista'),
  ('cubatao', 'baixada-santista'),
  ('guaruja', 'baixada-santista'),
  ('itanhaem', 'baixada-santista'),
  ('mongagua', 'baixada-santista'),
  ('peruibe', 'baixada-santista'),
  ('praia-grande', 'baixada-santista'),
  ('santos', 'baixada-santista'),
  ('sao-vicente', 'baixada-santista'),
  ('caraguatatuba', 'litoral-norte'),
  ('ilhabela', 'litoral-norte'),
  ('sao-sebastiao', 'litoral-norte'),
  ('ubatuba', 'litoral-norte'),
  ('cananeia', 'vale-do-ribeira'),
  ('iguape', 'vale-do-ribeira'),
  ('ilha-comprida', 'vale-do-ribeira'),
  ('itariri', 'vale-do-ribeira'),
  ('miracatu', 'vale-do-ribeira'),
  ('pedro-de-toledo', 'vale-do-ribeira'),
  ('juquia', 'vale-do-ribeira'),
  ('registro', 'vale-do-ribeira'),
  ('pariquera-acu', 'vale-do-ribeira'),
  ('jacupiranga', 'vale-do-ribeira'),
  ('cajati', 'vale-do-ribeira'),
  ('eldorado', 'vale-do-ribeira'),
  ('sete-barras', 'vale-do-ribeira'),
  ('aparecida', 'vale-do-paraiba'),
  ('cacapava', 'vale-do-paraiba'),
  ('cachoeira-paulista', 'vale-do-paraiba'),
  ('campos-do-jordao', 'vale-do-paraiba'),
  ('canas', 'vale-do-paraiba'),
  ('cruzeiro', 'vale-do-paraiba'),
  ('guaratingueta', 'vale-do-paraiba'),
  ('igarata', 'vale-do-paraiba'),
  ('jacarei', 'vale-do-paraiba'),
  ('jambeiro', 'vale-do-paraiba'),
  ('lorena', 'vale-do-paraiba'),
  ('monteiro-lobato', 'vale-do-paraiba'),
  ('paraibuna', 'vale-do-paraiba'),
  ('pindamonhangaba', 'vale-do-paraiba'),
  ('piquete', 'vale-do-paraiba'),
  ('potim', 'vale-do-paraiba'),
  ('roseira', 'vale-do-paraiba'),
  ('santa-branca', 'vale-do-paraiba'),
  ('santo-antonio-do-pinhal', 'vale-do-paraiba'),
  ('sao-bento-do-sapucai', 'vale-do-paraiba'),
  ('sao-jose-dos-campos', 'vale-do-paraiba'),
  ('sao-luiz-do-paraitinga', 'vale-do-paraiba'),
  ('taubate', 'vale-do-paraiba'),
  ('tremembe', 'vale-do-paraiba')
on conflict (cidade_slug) do nothing;

-- a função pública: as regiões com as cidades de cada uma (o site e o gerador leem; a Plataforma lê as tabelas)
create or replace function public.guia_regioes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_agg(jsonb_build_object(
      'slug', r.slug, 'nome', r.nome, 'uf', r.uf, 'ordem', r.ordem, 'foto', r.foto, 'chamada', r.chamada, 'texto', r.texto,
      'cidades', coalesce((select jsonb_agg(c.cidade_slug order by c.cidade_slug) from public.guia_cidades_regiao c where c.regiao_slug = r.slug), '[]'::jsonb))
    order by r.ordem, r.nome) from public.guia_regioes r), '[]'::jsonb)
$$;
comment on function public.guia_regioes() is 'Guia (182): as regiões do guia com as cidades de cada uma, para o site e o gerador.';
revoke execute on function public.guia_regioes() from public;
grant execute on function public.guia_regioes() to anon, authenticated;

-- o carimbo de republicação (164, 178, 180): a região (foto, chamada, texto) e o vínculo das cidades também regeneram o site
create or replace function public.site_conteudo_versao()
returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat(count(*), '/', max(updated_at)) from public.blog_posts where status = 'published'),
    (select concat(count(*), '/', max(updated_at)) from public.seo_pages where status = 'published'),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_lugares where status = 'publicado' and conteudo is not null),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_paginas where (status = 'publicado' and conteudo is not null) or coalesce(foto, '') <> ''),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_categorias where coalesce(foto, '') <> ''),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_regioes),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_cidades_regiao)))
$$;
comment on function public.site_conteudo_versao() is 'Site (182): carimbo do conteúdo publicado (artigos, páginas SEO, salões, páginas do guia com texto ou foto, imagens das categorias, regiões e o vínculo das cidades); o servidor regenera as páginas estáticas quando ele muda.';
revoke execute on function public.site_conteudo_versao() from public;
grant execute on function public.site_conteudo_versao() to anon, authenticated;

do $$
begin
  raise notice '182: guia_regioes e guia_cidades_regiao (semente das quatro regiões), guia_regioes() e o carimbo do site';
end $$;
