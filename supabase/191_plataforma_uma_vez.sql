-- 191 (3.43): a regra "é da Plataforma?" conferida uma vez por consulta, não salão por salão.
-- aplicar: sem-transacao
-- (a linha de cima diz ao aplicar.sh para rodar comando a comando: cada regra é trocada e gravada na hora, sem segurar
-- todas as tabelas, inclusive as de agendamento, até o fim)
--
-- As políticas de acesso (RLS) com public.eh_plataforma() chamavam a função uma vez por linha lida: a Plataforma lendo a
-- lista do guia em "todas as cidades" (20 mil salões) fazia 20 mil consultas em profiles só para descobrir, de novo e de
-- novo, que quem lê é da Plataforma. Contar os salões levava 101 ms com a regra e 1,7 ms sem ela (13 mil salões, aqui);
-- no Supabase grátis, somado ao resto, passava do tempo limite. Escrita como (select public.eh_plataforma()), o Postgres
-- calcula uma vez por consulta (é o mesmo valor para a consulta inteira: quem lê não muda no meio dela). Quem pode ver
-- o quê não muda.
--
-- E as funções do guia e do site (guia_*, site_*, em PL/pgSQL) passam a planejar cada chamada com os valores dela
-- (plan_cache_mode = force_custom_plan) e sem a compilação JIT (jit = off). Depois de 5 chamadas na mesma conexão (e o
-- Supabase reaproveita as conexões), o PL/pgSQL trocava para um plano genérico, que não sabe a cidade nem o período:
-- o Desempenho de "todas as cidades" ia de 1 s para 10,6 s aqui e passava do tempo limite, de vez em quando, conforme a
-- conexão que pegasse; a fila de abordagem ia de 0,3 s para 11 s (a 190 já corrigiu a dela). O JIT gastava segundos
-- compilando consultas que rodam em décimos. As funções só de texto (imutáveis, chamadas linha a linha) ficam como estão.

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

do $$
declare
  p record; q text; c text; feitos int := 0;
  em_partes boolean := current_setting('guia.em_partes', true) = '1';
  chamada constant text := '(public\.)?eh_plataforma\(\)';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (qual ~ chamada or with_check ~ chamada)
       -- já trocada (rodar de novo não embrulha duas vezes)
       and coalesce(qual, '') !~ 'SELECT (public\.)?eh_plataforma\(\)' and coalesce(with_check, '') !~ 'SELECT (public\.)?eh_plataforma\(\)'
     order by tablename, policyname
  loop
    q := regexp_replace(p.qual, chamada, '(select public.eh_plataforma())', 'g');
    c := regexp_replace(p.with_check, chamada, '(select public.eh_plataforma())', 'g');
    perform pg_temp.guia_ddl(format('alter policy %I on %I.%I%s%s', p.policyname, p.schemaname, p.tablename,
                                    case when q is not null then ' using (' || q || ')' else '' end,
                                    case when c is not null then ' with check (' || c || ')' else '' end));
    feitos := feitos + 1;
    if em_partes then commit; end if;
  end loop;
  raise notice '191: % regras de acesso com eh_plataforma() conferida uma vez por consulta (% já estavam)', feitos,
    (select count(*) from pg_policies where schemaname = 'public' and (coalesce(qual, '') ~ 'SELECT (public\.)?eh_plataforma\(\)' or coalesce(with_check, '') ~ 'SELECT (public\.)?eh_plataforma\(\)')) - feitos;
end $$;

do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace join pg_language lg on lg.oid = p.prolang
     where ns.nspname = 'public' and lg.lanname = 'plpgsql' and p.prokind = 'f'
       and (p.proname like 'guia\_%' or p.proname like 'site\_%')
       and p.prorettype <> 'trigger'::regtype and p.provolatile <> 'i'
       and not (coalesce(p.proconfig, '{}') @> array['plan_cache_mode=force_custom_plan', 'jit=off'])
     order by 1
  loop
    execute format('alter function %s set plan_cache_mode = force_custom_plan', f.assinatura);
    execute format('alter function %s set jit = off', f.assinatura);
    n := n + 1;
  end loop;
  raise notice '191: % funções do guia e do site com o plano de cada chamada e sem JIT', n;
end $$;
