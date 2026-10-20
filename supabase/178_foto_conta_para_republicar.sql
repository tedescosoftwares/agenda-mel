-- 178 (3.32.2): a foto da cidade conta para republicar o site.
--
-- site_conteudo_versao() (164) é o carimbo que o VPS compara de hora em hora para regenerar as páginas.
-- Ele só olhava as páginas de cidade com texto aprovado: uma cidade sem texto no ar que ganhava a foto
-- (177) não mudava o carimbo, e a foto só aparecia quando alguém editava e aprovava o texto. Agora a
-- página com foto conta também, com texto ou sem.
create or replace function public.site_conteudo_versao()
returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat(count(*), '/', max(updated_at)) from public.blog_posts where status = 'published'),
    (select concat(count(*), '/', max(updated_at)) from public.seo_pages where status = 'published'),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_lugares where status = 'publicado' and conteudo is not null),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_paginas where (status = 'publicado' and conteudo is not null) or coalesce(foto, '') <> '')))
$$;
comment on function public.site_conteudo_versao() is 'Site (178): carimbo do conteúdo publicado (artigos, páginas SEO, salões e páginas do guia, inclusive a cidade só com foto); o servidor regenera as páginas estáticas quando ele muda.';
revoke execute on function public.site_conteudo_versao() from public;
grant execute on function public.site_conteudo_versao() to anon, authenticated;

do $$
begin
  raise notice '178: a foto da cidade muda o carimbo do site (site_conteudo_versao)';
end $$;
