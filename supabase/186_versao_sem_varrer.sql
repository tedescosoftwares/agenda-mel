-- 186 (3.38.4): a versão do conteúdo do site sem varrer o guia.
-- site_conteudo_versao() (164 … 182) contava os salões no ar e pegava o maior atualizado_em a cada chamada: uma volta
-- pela tabela guia_lugares inteira, de hora em hora, pelo acesso público (3 s de limite no Supabase). Com o guia grande,
-- ou com a tabela ocupada (uma migração, um lote, o disco do plano grátis no limite), a leitura passava do tempo e o
-- republicar-se-mudou.sh parava ("não consegui ler a versão do conteúdo ... statement timeout").
-- Agora o guia tem um contador de uma linha só (guia_versao), que três gatilhos sobem quando muda o que o site mostra:
-- um salão entra no ar, sai do ar, é apagado no ar, ou um salão no ar muda algo visível (atualizado_em anda: guia_tocar,
-- 164/170/184). Uma vez por transação basta (um lote de 200 aprovações sobe uma vez). A versão lê essa linha em vez de
-- varrer guia_lugares; as tabelas pequenas (artigos, páginas SEO, páginas do guia, categorias, regiões) seguem como antes.
-- Os mesmos cuidados da 185: o que pega trava de tabela espera 2 s por vez e tenta de novo.

create or replace function pg_temp.guia_ddl(comando text, tentativas int default 15)
returns void language plpgsql as $f$
declare i int := 0; antes text := current_setting('lock_timeout');
begin
  loop
    begin
      perform set_config('lock_timeout', '2s', true);
      execute comando;
      perform set_config('lock_timeout', antes, true);
      return;
    exception when lock_not_available then
      i := i + 1;
      if i >= tentativas then
        raise exception 'a tabela está presa por outra sessão (% tentativas de 2 s: %). No SQL Editor: select pid, state, now() - xact_start as ha, left(query, 70) from pg_stat_activity where state <> ''idle''; encerre a que segura a tabela com select pg_terminate_backend(<pid>); e rode de novo', tentativas, left(comando, 70);
      end if;
      raise notice 'tabela ocupada por outra sessão, tentando de novo em 2 s (% de %): %', i, tentativas, left(comando, 60);
      perform pg_sleep(2);
    end;
  end loop;
end $f$;

create table if not exists public.guia_versao (
  id int primary key default 1 check (id = 1),
  n bigint not null default 0,
  em timestamptz not null default now()
);
comment on table public.guia_versao is 'Guia (186): o contador que sobe quando muda o que o site mostra dos salões (gatilhos guia_lugares_versao_*); site_conteudo_versao() lê esta linha em vez de varrer guia_lugares.';
insert into public.guia_versao (id) values (1) on conflict (id) do nothing;
alter table public.guia_versao enable row level security; -- sem política: só as funções do banco mexem
revoke all on public.guia_versao from public, anon, authenticated;

-- sobe o contador uma vez por transação (a primeira linha que muda o site; as outras da mesma transação não repetem)
create or replace function public.guia_versao_tocar()
returns trigger language plpgsql security definer set search_path = public as $$
declare x text := txid_current()::text;
begin
  if current_setting('guia.versao_tocada', true) is distinct from x then
    perform set_config('guia.versao_tocada', x, true);
    update public.guia_versao set n = n + 1, em = now() where id = 1;
  end if;
  return null;
end $$;
comment on function public.guia_versao_tocar() is 'Guia (186): sobe guia_versao uma vez por transação; chamada pelos gatilhos guia_lugares_versao_* só quando muda o que o site mostra.';
revoke execute on function public.guia_versao_tocar() from public, anon, authenticated;

-- os três gatilhos: a condição (WHEN) é conferida antes de chamar a função, então o resto das mudanças (a nota, o
-- rascunho, os pontos, a importação de quem não está no ar) não custa nada
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_versao_ins on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_versao_ins after insert on public.guia_lugares for each row
  when (new.status = 'publicado' and new.conteudo is not null) execute function public.guia_versao_tocar()$c$);
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_versao_upd on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_versao_upd after update on public.guia_lugares for each row
  when (((new.status = 'publicado' and new.conteudo is not null) or (old.status = 'publicado' and old.conteudo is not null))
        and (new.atualizado_em is distinct from old.atualizado_em or new.status is distinct from old.status
             or (new.conteudo is null) is distinct from (old.conteudo is null)))
  execute function public.guia_versao_tocar()$c$);
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_versao_del on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_versao_del after delete on public.guia_lugares for each row
  when (old.status = 'publicado' and old.conteudo is not null) execute function public.guia_versao_tocar()$c$);

-- a versão: o contador do guia no lugar da volta pela tabela; o resto como na 182
create or replace function public.site_conteudo_versao()
returns text language sql stable security definer set search_path = public as $$
  select md5(concat_ws('|',
    (select concat(count(*), '/', max(updated_at)) from public.blog_posts where status = 'published'),
    (select concat(count(*), '/', max(updated_at)) from public.seo_pages where status = 'published'),
    (select concat('g', v.n, '/', v.em) from public.guia_versao v where v.id = 1),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_paginas where (status = 'publicado' and conteudo is not null) or coalesce(foto, '') <> ''),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_categorias where coalesce(foto, '') <> ''),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_regioes),
    (select concat(count(*), '/', max(atualizado_em)) from public.guia_cidades_regiao)))
$$;
comment on function public.site_conteudo_versao() is 'Site (186): carimbo do conteúdo publicado (artigos, páginas SEO, o contador dos salões no ar em guia_versao, páginas do guia com texto ou foto, imagens das categorias, regiões e o vínculo das cidades); o servidor regenera as páginas estáticas quando ele muda. Não varre guia_lugares.';
revoke execute on function public.site_conteudo_versao() from public;
grant execute on function public.site_conteudo_versao() to anon, authenticated;

do $$
begin
  raise notice '186: site_conteudo_versao() lê o contador guia_versao (gatilhos em guia_lugares) em vez de varrer o guia';
end $$;
