-- 188 (3.40): a lista de cidades do guia sem contar todos os salões a cada chamada.
-- guia_cidades() (153 … 179) contava os salões no ar por cidade e por categoria a cada chamada: uma volta pela tabela
-- guia_lugares inteira. Com 13 mil salões no ar levava 2 s aqui e passava dos 3 s do acesso público no Supabase; e ela é o
-- primeiro passo do gerador: falhando, o guia inteiro ficava de fora da rodada (e, depois de um build, sumia do ar).
-- Agora um contador por cidade e categoria (guia_contagem) é mantido por gatilho: um salão entra no ar (+1), sai do ar ou
-- é apagado no ar (-1), muda de cidade ou de categoria no ar (-1 de um lado, +1 do outro). A condição (WHEN) é conferida
-- antes de chamar a função: a nota, o rascunho, os pontos e a importação de quem não está no ar não custam nada.
-- guia_cidades() lê o contador (algumas dezenas de linhas) e devolve exatamente o mesmo formato de antes.
-- guia_contagem_refazer() refaz o contador do zero, se um dia for preciso conferir.

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

create table if not exists public.guia_contagem (
  cidade_slug text not null,
  categoria text not null,
  n integer not null default 0,
  cidade text,
  uf text,
  primary key (cidade_slug, categoria)
);
comment on table public.guia_contagem is 'Guia (188): quantos salões no ar (status publicado, com texto) por cidade e categoria, mantido pelos gatilhos guia_lugares_contagem_*; guia_cidades() lê daqui.';
alter table public.guia_contagem enable row level security; -- sem política: só as funções do banco mexem
revoke all on public.guia_contagem from public, anon, authenticated;

create or replace function public.guia_contagem_mudar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'publicado' and old.conteudo is not null then
    update public.guia_contagem set n = n - 1 where cidade_slug = old.cidade_slug and categoria = old.categoria;
  end if;
  if tg_op in ('UPDATE', 'INSERT') and new.status = 'publicado' and new.conteudo is not null then
    insert into public.guia_contagem as g (cidade_slug, categoria, n, cidade, uf) values (new.cidade_slug, new.categoria, 1, new.cidade, new.uf)
    on conflict (cidade_slug, categoria) do update set n = g.n + 1, cidade = excluded.cidade, uf = excluded.uf;
  end if;
  return null;
end $$;
comment on function public.guia_contagem_mudar() is 'Guia (188): mantém guia_contagem quando um salão entra no ar, sai, é apagado ou muda de cidade ou categoria no ar.';
revoke execute on function public.guia_contagem_mudar() from public, anon, authenticated;

-- refaz do zero (a carga inicial, e para conferir um dia): só quem está no SQL Editor
create or replace function public.guia_contagem_refazer()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  lock table public.guia_contagem in exclusive mode;
  delete from public.guia_contagem;
  insert into public.guia_contagem (cidade_slug, categoria, n, cidade, uf)
    select l.cidade_slug, l.categoria, count(*), max(l.cidade), max(l.uf)
      from public.guia_lugares l where l.status = 'publicado' and l.conteudo is not null
     group by l.cidade_slug, l.categoria;
  select coalesce(sum(g.n), 0) into n from public.guia_contagem g;
  return n;
end $$;
revoke execute on function public.guia_contagem_refazer() from public, anon, authenticated;

-- os gatilhos (a trava de guia_lugares fica até o fim desta transação: ninguém grava salão entre o gatilho e a carga)
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_contagem_ins on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_contagem_ins after insert on public.guia_lugares for each row
  when (new.status = 'publicado' and new.conteudo is not null) execute function public.guia_contagem_mudar()$c$);
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_contagem_upd on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_contagem_upd after update on public.guia_lugares for each row
  when (((old.status = 'publicado' and old.conteudo is not null) is distinct from (new.status = 'publicado' and new.conteudo is not null))
        or ((new.status = 'publicado' and new.conteudo is not null)
            and (new.cidade_slug is distinct from old.cidade_slug or new.categoria is distinct from old.categoria
                 or new.cidade is distinct from old.cidade or new.uf is distinct from old.uf)))
  execute function public.guia_contagem_mudar()$c$);
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_contagem_del on public.guia_lugares');
select pg_temp.guia_ddl($c$create trigger guia_lugares_contagem_del after delete on public.guia_lugares for each row
  when (old.status = 'publicado' and old.conteudo is not null) execute function public.guia_contagem_mudar()$c$);

-- a carga inicial
do $$ begin raise notice '188: % salões no ar contados', public.guia_contagem_refazer(); end $$;

-- a lista de cidades: o mesmo formato da 179, lido do contador
create or replace function public.guia_cidades()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'cidade_slug', x.cidade_slug, 'uf', x.uf, 'total', x.n,
      'foto', (select p.foto from public.guia_paginas p where p.cidade_slug = x.cidade_slug and p.categoria = '' and coalesce(p.foto, '') <> '' limit 1),
      'categorias', x.categorias)
    order by x.n desc, x.cidade_slug), '[]'::jsonb)
  from (select g.cidade_slug, max(g.cidade) as cidade, max(g.uf) as uf, sum(g.n)::integer as n,
               jsonb_agg(jsonb_build_object('categoria', g.categoria, 'total', g.n) order by g.n desc, g.categoria) as categorias
          from public.guia_contagem g where g.n > 0 group by g.cidade_slug) x
$$;
comment on function public.guia_cidades() is 'Guia (179, 188): as cidades com salões no ar, o total, a foto e as categorias; lê guia_contagem (mantido por gatilho), sem contar a tabela de salões.';
grant execute on function public.guia_cidades() to anon, authenticated;

do $$
begin
  raise notice '188: guia_cidades() lê o contador guia_contagem (gatilhos em guia_lugares)';
end $$;
