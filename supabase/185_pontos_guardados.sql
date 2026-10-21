-- 185 (3.38.3): os pontos de cada salão guardados na linha (guia_lugares.pontos).
-- aplicar: sem-transacao
-- (a linha de cima diz ao aplicar.sh para rodar este arquivo comando a comando, e não numa transação só: numa transação
-- só, a coluna nova segurava a tabela guia_lugares do começo ao fim do preenchimento, e toda leitura do site, da
-- Plataforma e do gerador caía em "canceling statement due to statement timeout" enquanto isto rodava)
--
-- guia_pontos(l) (166) calculava a nota ajustada e o bônus da foto a cada chamada, e chamava guia_fotos(l) duas vezes
-- (com uma consulta em salons para o salão da MIMO sem foto própria). Nas listas ordenadas isso corria por linha:
-- a primeira fatia de guia_publicadas() de uma cidade com 4 mil salões no ar gastava a maior parte do tempo nisso
-- e, no Supabase, passava do tempo limite da consulta pública; o gerador então deixava a cidade de fora (e, antes da
-- 3.38.2, o guia inteiro).
-- Agora: a conta vira guia_pontos_calc(l); um gatilho guarda o resultado em pontos quando entra a linha ou mudam
-- nota, avaliacoes, fotos ou salon_id (e quando o salão da MIMO muda as fotos dele); guia_pontos(l) passa a devolver
-- a coluna (com a conta de reserva se estiver vazia), então tudo o que ordena por guia_pontos(l) fica barato sem mudar.
-- pontos é derivado: não anda atualizado_em (entra nos "internos" de guia_tocar).
--
-- Cuidados com o banco no ar: cada passo que pega trava de tabela (a coluna, o comentário, os gatilhos) espera no
-- máximo 2 s e tenta de novo, até 15 vezes (pg_temp.guia_ddl), para nunca enfileirar as leituras atrás dele por muito
-- tempo; o preenchimento vai em partes de 2.000 e, pelo aplicar.sh, grava cada parte (guia.em_partes = 1): parar no
-- meio não perde o que foi, e rodar de novo continua de onde parou. Tudo pode rodar de novo.
-- No SQL Editor (uma transação só, sem guia.em_partes) também funciona, mas segura a tabela até o fim: rode em hora calma.

-- os comandos que pegam trava de tabela: 2 s de espera por vez, até 15 vezes, e o lock_timeout de antes de volta
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

select pg_temp.guia_ddl('alter table public.guia_lugares add column if not exists pontos numeric');
select pg_temp.guia_ddl($c$comment on column public.guia_lugares.pontos is 'Guia (185): os pontos que ordenam as listas (nota ajustada + foto), guardados pelo gatilho guia_lugares_pontos; a conta é guia_pontos_calc().'$c$);

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
select pg_temp.guia_ddl('drop trigger if exists guia_lugares_pontos on public.guia_lugares');
select pg_temp.guia_ddl('create trigger guia_lugares_pontos before insert or update on public.guia_lugares for each row execute function public.guia_pontos_guardar()');

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
select pg_temp.guia_ddl('drop trigger if exists salons_guia_pontos on public.salons');
select pg_temp.guia_ddl('create trigger salons_guia_pontos after update of fotos on public.salons for each row execute function public.guia_pontos_do_salao()');

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

-- preenche em partes de 2.000, avisando a cada parte, sem o carimbo (guia_tocar serializa a linha inteira duas vezes
-- por linha para descobrir que nada visível mudou: com dezenas de milhares de salões isso é o que demorava minutos;
-- pontos é interno, então atualizado_em não andaria de qualquer jeito) e em SQL puro: a mesma conta de
-- guia_pontos_calc(), sem chamar função linha a linha. Pelo aplicar.sh (guia.em_partes = 1) cada parte é gravada na
-- hora: as leituras nunca esperam e as escritas da Plataforma esperam no máximo uma parte
do $$
declare n int; feitos int := 0; t0 timestamptz := clock_timestamp(); em_partes boolean := current_setting('guia.em_partes', true) = '1';
begin
  loop
    perform set_config('guia.sem_carimbo', '1', true); -- vale até o fim da transação: de novo a cada parte gravada
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
    if em_partes then commit; end if;
    raise notice '185: % salões com pontos guardados… (% s)', feitos, round(extract(epoch from clock_timestamp() - t0)::numeric, 1);
  end loop;
end $$;

do $$
begin
  raise notice '185: guia_lugares.pontos guardado pelo gatilho; guia_pontos(l) lê a coluna (% salões preenchidos)', (select count(*) from public.guia_lugares where pontos is not null);
end $$;
