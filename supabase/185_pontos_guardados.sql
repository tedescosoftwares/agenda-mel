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
alter table public.guia_lugares add column if not exists pontos numeric;
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
drop trigger if exists guia_lugares_pontos on public.guia_lugares;
create trigger guia_lugares_pontos before insert or update on public.guia_lugares for each row execute function public.guia_pontos_guardar();

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
drop trigger if exists salons_guia_pontos on public.salons;
create trigger salons_guia_pontos after update of fotos on public.salons for each row execute function public.guia_pontos_do_salao();

-- o carimbo de atualização (164, 170, 184): pontos é derivado, não é atualização da página
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em', 'contexto', 'pontos'];
begin
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

-- preenche de uma vez (os gatilhos de cima já valem; atualizado_em não anda: pontos é interno)
update public.guia_lugares set pontos = public.guia_pontos_calc(guia_lugares) where pontos is null;

do $$
begin
  raise notice '185: guia_lugares.pontos guardado pelo gatilho; guia_pontos(l) lê a coluna (% salões preenchidos)', (select count(*) from public.guia_lugares where pontos is not null);
end $$;
