-- 185 (3.38.3): os pontos de cada salão guardados na linha (guia_lugares.pontos).
-- guia_pontos(l) (166) calculava a nota ajustada e o bônus da foto a cada chamada, e chamava guia_fotos(l) duas vezes
-- (com uma consulta em salons para o salão da MIMO sem foto própria). Nas listas ordenadas isso corria por linha:
-- a primeira fatia de guia_publicadas() de uma cidade com 4 mil salões no ar gastava a maior parte do tempo nisso
-- e, no Supabase, passava do tempo limite da consulta pública ("canceling statement due to statement timeout");
-- o gerador então deixava a cidade de fora (e, antes da 3.38.2, o guia inteiro).
-- Agora: a conta vira guia_pontos_calc(l); um gatilho guarda o resultado em pontos quando entra a linha ou mudam
-- nota, avaliacoes, fotos ou salon_id (e quando o salão da MIMO muda as fotos dele); guia_pontos(l) passa a devolver
-- a coluna (com a conta de reserva se estiver vazia), então tudo o que ordena por guia_pontos(l) fica barato sem mudar.
-- pontos é derivado: não anda atualizado_em (entra nos "internos" de guia_tocar).
-- Pode rodar de novo (tudo "if not exists" / "or replace", e o preenchimento só pega o que está vazio). O que pega
-- trava de tabela (a coluna nova, os gatilhos) roda num bloco só, com lock_timeout de 30 s: uma sessão presa na
-- tabela (um update antigo, um lote) não deixa isto pendurado, dá um erro que diz o que fazer. O preenchimento vai
-- em partes de 2.000 com aviso a cada parte, sem o carimbo (guia.sem_carimbo, só nesta transação), sem trava nenhuma.
do $$
begin
  perform set_config('lock_timeout', coalesce(current_setting('guia.lock_timeout', true), '30s'), true);
  execute 'alter table public.guia_lugares add column if not exists pontos numeric';
exception when lock_not_available then
  raise exception '185: a tabela guia_lugares está presa por outra sessão (um update antigo ainda rodando?). No SQL Editor: select pid, query from pg_stat_activity where state <> ''idle'' and query ilike ''%%guia_lugares%%''; select pg_terminate_backend(<pid>); e rode a migração de novo';
end $$;
comment on column public.guia_lugares.pontos is 'Guia (185): os pontos que ordenam as listas (nota ajustada + foto), guardados pelo gatilho guia_lugares_pontos; a conta é guia_pontos_calc().';

-- a conta de sempre (166), com o nome novo
create or replace function public.guia_pontos_calc(l public.guia_lugares)
returns numeric language sql stable set search_path = public as $$
  select round(
    case when l.nota is null then 4.5
         else (l.nota * greatest(coalesce(l.avaliacoes, 0), 0) + 4.5 * 8) / (greatest(coalesce(l.avaliacoes, 0), 0) + 8) end
    + case when coalesce(array_length(public.guia_fotos(l), 1), 0) = 0 then 0
           else 0.4 + 0.05 * least(array_length(public.guia_fotos(l), 1) - 1, 3) end, 3)
$$;
comment on function public.guia_pontos_calc(public.guia_lugares) is 'Guia (185): a conta dos pontos (nota ajustada + foto; era guia_pontos na 166). O gatilho guarda o resultado em guia_lugares.pontos.';
revoke execute on function public.guia_pontos_calc(public.guia_lugares) from public, anon;
grant execute on function public.guia_pontos_calc(public.guia_lugares) to authenticated;

-- guia_pontos(l): a coluna guardada (a conta só se a coluna estiver vazia). Sem "set search_path" de propósito: assim o
-- planejador pode embutir a função nas consultas, e ordenar por guia_pontos(l) vira ordenar por l.pontos
create or replace function public.guia_pontos(l public.guia_lugares)
returns numeric language sql stable as $$
  select coalesce(l.pontos, public.guia_pontos_calc(l))
$$;
comment on function public.guia_pontos(public.guia_lugares) is 'Guia (166, 185): os pontos que ordenam as listas públicas; desde a 185 lê guia_lugares.pontos (guardado pelo gatilho), com guia_pontos_calc() de reserva.';

-- o gatilho: na entrada e quando muda o que entra na conta
create or replace function public.guia_pontos_guardar()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.pontos is null
     or new.nota is distinct from old.nota or new.avaliacoes is distinct from old.avaliacoes
     or new.fotos is distinct from old.fotos or new.salon_id is distinct from old.salon_id then
    new.pontos := public.guia_pontos_calc(new);
  end if;
  return new;
end $$;
do $$
begin
  perform set_config('lock_timeout', coalesce(current_setting('guia.lock_timeout', true), '30s'), true);
  execute 'drop trigger if exists guia_lugares_pontos on public.guia_lugares';
  execute 'create trigger guia_lugares_pontos before insert or update on public.guia_lugares for each row execute function public.guia_pontos_guardar()';
exception when lock_not_available then
  raise exception '185: a tabela guia_lugares está presa por outra sessão; veja pg_stat_activity, encerre com pg_terminate_backend(pid) e rode de novo';
end $$;

-- o salão da MIMO que muda as fotos dele: os salões do guia ligados a ele e sem foto própria recontam
create or replace function public.guia_pontos_do_salao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fotos is distinct from old.fotos then
    update public.guia_lugares l set pontos = public.guia_pontos_calc(l)
     where l.salon_id = new.id and coalesce(array_length(l.fotos, 1), 0) = 0;
  end if;
  return new;
end $$;
do $$
begin
  perform set_config('lock_timeout', coalesce(current_setting('guia.lock_timeout', true), '30s'), true);
  execute 'drop trigger if exists salons_guia_pontos on public.salons';
  execute 'create trigger salons_guia_pontos after update of fotos on public.salons for each row execute function public.guia_pontos_do_salao()';
exception when lock_not_available then
  raise exception '185: a tabela salons está presa por outra sessão; veja pg_stat_activity, encerre com pg_terminate_backend(pid) e rode de novo';
end $$;

-- o carimbo de atualização (164, 170, 184): pontos é derivado, não é atualização da página
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em', 'contexto', 'pontos'];
begin
  -- 185: o preenchimento de pontos (e qualquer carga interna) pede para não carimbar: set_config('guia.sem_carimbo', '1', true)
  if current_setting('guia.sem_carimbo', true) = '1' then return new; end if;
  if tg_op = 'UPDATE' then
    if tg_table_name = 'guia_lugares' then
      -- o caminho rápido (184): o que aprovar, tirar do ar, descartar e as fotos mudam
      if new.status is distinct from old.status or new.conteudo is distinct from old.conteudo or new.fotos is distinct from old.fotos then
        new.atualizado_em := now();
        return new;
      end if;
    end if;
    if (to_jsonb(new) - internos) = (to_jsonb(old) - internos) then
      return new; -- nada visível mudou: fica a data que estava (ou a que o update mandou de propósito)
    end if;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
comment on function public.guia_tocar() is 'Guia (164, 170, 184, 185): atualizado_em só anda quando muda algo que a página mostra; em guia_lugares, status, conteudo ou fotos mudados já bastam, sem serializar a linha; pontos é derivado e não conta.';

-- preenche em partes de 2.000, avisando a cada parte (o aviso vai para o log do aplicar.sh: tail -f /tmp/aplicar.log),
-- sem o carimbo (guia_tocar serializa a linha inteira duas vezes por linha para descobrir que nada visível mudou: com
-- dezenas de milhares de salões isso é o que demorava minutos; pontos é interno, então atualizado_em não andaria de
-- qualquer jeito) e em SQL puro: a mesma conta de guia_pontos_calc(), sem chamar função linha a linha. Sem trava de
-- tabela: a Plataforma e o gerador seguem enquanto isto roda
do $$
declare n int; feitos int := 0; t0 timestamptz := clock_timestamp();
begin
  perform set_config('guia.sem_carimbo', '1', true);
  loop
    with base as (
      select l.id,
             case when l.nota is null then 4.5
                  else (l.nota * greatest(coalesce(l.avaliacoes, 0), 0) + 4.5 * 8) / (greatest(coalesce(l.avaliacoes, 0), 0) + 8) end as nota_aj,
             -- guia_fotos(l): as 8 primeiras fotos próprias; sem elas, as do salão da MIMO
             case when coalesce(array_length(l.fotos, 1), 0) > 0 then least(array_length(l.fotos, 1), 8)
                  when l.salon_id is not null then least(coalesce(array_length(s.fotos, 1), 0), 8)
                  else 0 end as nf
        from public.guia_lugares l left join public.salons s on s.id = l.salon_id
       where l.pontos is null
       limit 2000)
    update public.guia_lugares g
       set pontos = round(b.nota_aj + case when b.nf = 0 then 0 else 0.4 + 0.05 * least(b.nf - 1, 3) end, 3)
      from base b where g.id = b.id;
    get diagnostics n = row_count;
    exit when n = 0;
    feitos := feitos + n;
    raise notice '185: % salões com pontos guardados… (% s)', feitos, round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
  end loop;
end $$;

do $$
begin
  raise notice '185: guia_lugares.pontos guardado pelo gatilho; guia_pontos(l) lê a coluna (% salões preenchidos)', (select count(*) from public.guia_lugares where pontos is not null);
end $$;
