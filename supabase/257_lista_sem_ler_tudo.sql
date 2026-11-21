-- 257 · A lista "Todas as cidades" da Plataforma sem ler a tabela inteira (4.4.2)
-- aplicar: sem-transacao
-- (a linha de cima diz ao aplicar.sh para rodar comando a comando: cada índice fica gravado assim que termina)
--
-- Com 39 mil salões, Plataforma › Guia › Revisar em "Todas as cidades" dava "canceling statement due to statement
-- timeout" (até na fase "Sem página", com 12 salões). A página da lista (consultaGlobal: os ids da página, com os filtros
-- e a ordem da aba) não tinha índice que servisse: o banco lia a tabela inteira de salões a cada página, uns 185 MB, com
-- o texto de cada um, e o plano gratuito não tem memória para guardar isso. O total ao lado já vinha de um índice.
-- Agora:
--   guia_lugares_lista: a fase e a ordem padrão (Seleção 1º) no índice, mais as colunas que os filtros e as outras
--     ordens usam (cidade, bairro, categoria, Receita, nota, datas). "No ar", "Todos", "Publicadas", a busca por nome ou
--     bairro e os filtros saem só do índice (uns 6 MB), sem abrir os salões. Num banco local com 59 mil salões, a página
--     "No ar" foi de 11.900 blocos lidos para 15.
--   guia_lugares_fora_do_ar: os que não estão no ar (Sem página, Para revisar, Descartados, Removidos), que são poucos.
--   guia_lugares_versao_nova: os que têm versão nova esperando (rascunho).
-- Ficam de fora as ordens por fotos e a "Ordem do site" (contas sobre a lista de fotos), que seguem lendo os salões.
--
-- Criar um índice segura as gravações em guia_lugares (as leituras seguem) enquanto ele é montado: uns segundos no
-- banco local, mais no plano gratuito. Cada um espera no máximo 2 s pela tabela livre e tenta de novo (pg_temp.guia_ddl,
-- como na 185). Pode rodar de novo. No SQL Editor (uma transação só) também funciona.

set statement_timeout = '15min';

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

select pg_temp.guia_ddl('create index if not exists guia_lugares_lista on public.guia_lugares
  (status, selecao desc nulls last, avaliacoes desc nulls last, nome, id)
  include (publicado_em, bairro, categoria, cidade_slug, validado_receita, nota, gerado_em, atualizado_em, salon_id)');

select pg_temp.guia_ddl('create index if not exists guia_lugares_fora_do_ar on public.guia_lugares (status, id) where status <> ''publicado''');

select pg_temp.guia_ddl('create index if not exists guia_lugares_versao_nova on public.guia_lugares (id) where rascunho is not null');

analyze public.guia_lugares;

do $$
begin
  raise notice '257: índices da lista prontos (lista %, fora do ar %, versão nova %)',
    pg_size_pretty(pg_relation_size('public.guia_lugares_lista')), pg_size_pretty(pg_relation_size('public.guia_lugares_fora_do_ar')),
    pg_size_pretty(pg_relation_size('public.guia_lugares_versao_nova'));
end $$;
