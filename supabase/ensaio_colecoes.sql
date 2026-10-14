-- Ensaio da 157: páginas por bairro e por horário. Numa cópia do banco com o guia importado, põe todos no ar, confere guia_colecoes (sem nota), guia_pagina (bairro_total), o slug reservado e site_evento nas coleções. Desfaz no fim.
\set ON_ERROR_STOP 1
begin;
-- põe no ar todos os importados (só nesta cópia de teste)
update public.guia_lugares set status = 'publicado', conteudo = jsonb_build_object('resumo', 'Resumo de ' || nome), publicado_em = now()
 where status = 'importado';
select count(*) as no_ar from public.guia_lugares where status = 'publicado';

-- 1. guia_colecoes como o site (anon)
set role anon;
select set_config('request.headers', '{"user-agent":"Mozilla/5.0 Chrome/129","cf-connecting-ip":"1.2.3.4"}', false);
select jsonb_array_length(public.guia_colecoes('itanhaem') -> 'lugares') as lugares,
       public.guia_colecoes('Itanhaem ') ->> 'cidade' as cidade,
       public.guia_colecoes('nao-existe') is null as cidade_inexistente_nula;
-- nunca nota, avaliações, cnpj, coordenadas, place_id
select count(*) filter (where l ? 'nota' or l ? 'avaliacoes' or l ? 'cnpj' or l ? 'latitude' or l ? 'longitude' or l ? 'place_id' or l ? 'origem') as campos_proibidos,
       count(*) filter (where l ? 'horarios' and l ? 'atributos' and l ? 'servicos' and l ? 'bairro') as com_campos
  from jsonb_array_elements(public.guia_colecoes('itanhaem') -> 'lugares') l;
-- anon não lê a tabela direto
do $$ begin perform count(*) from public.guia_lugares; raise notice 'ERRO: anon leu a tabela'; exception when insufficient_privilege then raise notice 'ok: anon não lê guia_lugares'; end $$;
reset role;

-- 2. guia_pagina: bairro_slug e bairro_total
set role anon;
select x.slug, x.bairro, p -> 'lugar' ->> 'bairro_slug' as bairro_slug, p -> 'lugar' ->> 'bairro_total' as bairro_total, p ? 'vizinhos' as tem_vizinhos
  from (select slug, bairro from public.guia_colecoes('itanhaem') c, jsonb_to_recordset(c -> 'lugares') as r(slug text, bairro text) where bairro ilike '%centro%' limit 3) x,
       lateral public.guia_pagina('itanhaem', x.slug) p;
reset role;
select public.guia_bairro_slug(bairro) as chave, count(*) from public.guia_lugares where status = 'publicado' group by 1 order by 2 desc limit 8;

-- 3. slug reservado
insert into public.guia_lugares (cidade, cidade_slug, slug, nome) values ('Itanhaém', 'itanhaem', 'bairro', 'Salão Bairro');
insert into public.guia_lugares (cidade, cidade_slug, slug, nome) values ('Itanhaém', 'itanhaem', 'bairro', 'Outro Salão Bairro');
select slug, nome from public.guia_lugares where nome in ('Salão Bairro', 'Outro Salão Bairro') order by nome;
update public.guia_lugares set slug = 'horario' where nome = 'Salão Bairro';
select slug from public.guia_lugares where nome = 'Salão Bairro';
-- a trava continua (direto no check, sem o gatilho, não passa)
alter table public.guia_lugares disable trigger guia_lugares_slug_reservado;
do $$ begin
  begin
    insert into public.guia_lugares (cidade, cidade_slug, slug, nome) values ('Itanhaém', 'itanhaem', 'horario', 'Teste');
    raise notice 'ERRO: a trava deixou passar';
  exception when check_violation then raise notice 'ok: a trava segura slug reservado';
  end;
end $$;
alter table public.guia_lugares enable trigger guia_lugares_slug_reservado;

-- 4. site_evento nas coleções (como o site)
set role anon;
select set_config('request.headers', '{"user-agent":"Mozilla/5.0 Chrome/129","cf-connecting-ip":"5.6.7.8"}', false);
select public.site_evento('visita', '/saloes/itanhaem/bairro/centro');
select public.site_evento('visita', '/saloes/itanhaem/bairro/belas-artes/');
select public.site_evento('visita', '/saloes/itanhaem/horario/domingo');
select public.site_evento('visita', '/saloes/itanhaem/horario/cedo/unhas');
select public.site_evento('whatsapp', '/saloes/itanhaem/horario/noite?x=1');
-- estes não contam
select public.site_evento('visita', '/saloes/itanhaem/bairro/nao-existe');
select public.site_evento('visita', '/saloes/itanhaem/bairro/itanhaem');
select public.site_evento('visita', '/saloes/itanhaem/horario/madrugada');
select public.site_evento('visita', '/saloes/itanhaem/horario/domingo/beleza');
select public.site_evento('visita', '/saloes/itanhaem/horario/sabado-o-dia-todo/unhas');
select public.site_evento('visita', '/saloes/itanhaem/horario/domingo/barbearia');
select public.site_evento('visita', '/saloes/itanhaem/bairro/centro/unhas');
select public.site_evento('visita', '/saloes/itanhaem/horario/domingo/unhas/x');
select public.site_evento('visita', '/saloes/outra-cidade/bairro/centro');
select public.site_evento('visita', '/saloes/itanhaem/bairro');
select public.site_evento('visita', '/saloes/itanhaem/outra/coisa');
-- dedupe: a mesma visita de novo não conta
select public.site_evento('visita', '/saloes/itanhaem/bairro/centro');
reset role;
select pagina, tipo, cidade_slug, categoria, lugar_id is null as sem_lugar from public.site_eventos where rede is not null order by id;
-- robô não conta
set role anon;
select set_config('request.headers', '{"user-agent":"Googlebot/2.1 (+http://www.google.com/bot.html)","cf-connecting-ip":"9.9.9.9"}', false);
select public.site_evento('visita', '/saloes/itanhaem/bairro/gaivota');
reset role;
select count(*) as eventos_do_robo from public.site_eventos where pagina = '/saloes/itanhaem/bairro/gaivota';
-- as páginas de antes continuam
set role anon;
select set_config('request.headers', '{"user-agent":"Mozilla/5.0 Chrome/129","cf-connecting-ip":"5.6.7.9"}', false);
select public.site_evento('visita', '/saloes');
select public.site_evento('visita', '/saloes/itanhaem');
select public.site_evento('visita', '/saloes/itanhaem/unhas');
reset role;
select pagina, categoria from public.site_eventos where pagina in ('/saloes', '/saloes/itanhaem', '/saloes/itanhaem/unhas') order by id;
-- a Plataforma vê as coleções no desempenho
select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email = 'admin@exemplo.com'), 'role', 'authenticated')::text, false);
set role authenticated;
select p ->> 'pagina' as pagina, p ->> 'visitas' as visitas from jsonb_array_elements(public.guia_desempenho(30, '') -> 'paginas') p where p ->> 'pagina' like '%/bairro/%' or p ->> 'pagina' like '%/horario/%';
reset role;
rollback;
