-- 259 · A lista do Disparo sem converter o telefone de todos os salões (4.4.2)
--
-- Com 39 mil salões, WhatsApp › Disparo › "Para quem" dava "canceling statement due to statement timeout". Para tirar
-- da lista os salões e as donas, disparo_pessoas() (254) convertia o WhatsApp e o telefone de todos os salões do guia
-- (guia_whats_chave, salão a salão) a cada abertura, lendo a tabela inteira. Agora as duas chaves de cada salão ficam
-- guardadas em guia_lugares_zap (256), mantidas pelo mesmo gatilho, e cada pessoa da lista é procurada nelas por índice.
-- Quem fica de fora é o mesmo de antes (as mesmas chaves: a do WhatsApp e a do telefone, de qualquer salão).

alter table public.guia_lugares_zap add column if not exists chave_zap text;
alter table public.guia_lugares_zap add column if not exists chave_tel text;

create or replace function public.guia_lugares_zap_guardar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  z boolean := public.guia_tem_zap(new.whatsapp, new.telefone);
  c text := public.guia_whats_chave(public.guia_whats_do_salao(new.whatsapp, new.telefone));
  cz text := case when coalesce(new.whatsapp, '') <> '' then public.guia_whats_chave(new.whatsapp) end;
  ct text := case when coalesce(new.telefone, '') <> '' then public.guia_whats_chave(new.telefone) end;
begin
  insert into public.guia_lugares_zap (lugar_id, tem_zap, chave, chave_zap, chave_tel) values (new.id, z, c, cz, ct)
  on conflict (lugar_id) do update set tem_zap = excluded.tem_zap, chave = excluded.chave, chave_zap = excluded.chave_zap, chave_tel = excluded.chave_tel
    where (guia_lugares_zap.tem_zap, guia_lugares_zap.chave, guia_lugares_zap.chave_zap, guia_lugares_zap.chave_tel)
          is distinct from (excluded.tem_zap, excluded.chave, excluded.chave_zap, excluded.chave_tel);
  return null;
end $$;

-- os de agora (de novo não refaz o que já está igual)
insert into public.guia_lugares_zap (lugar_id, tem_zap, chave, chave_zap, chave_tel)
select l.id, public.guia_tem_zap(l.whatsapp, l.telefone), public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone)),
       case when coalesce(l.whatsapp, '') <> '' then public.guia_whats_chave(l.whatsapp) end,
       case when coalesce(l.telefone, '') <> '' then public.guia_whats_chave(l.telefone) end
  from public.guia_lugares l
on conflict (lugar_id) do update set tem_zap = excluded.tem_zap, chave = excluded.chave, chave_zap = excluded.chave_zap, chave_tel = excluded.chave_tel
  where (guia_lugares_zap.tem_zap, guia_lugares_zap.chave, guia_lugares_zap.chave_zap, guia_lugares_zap.chave_tel)
        is distinct from (excluded.tem_zap, excluded.chave, excluded.chave_zap, excluded.chave_tel);

create index if not exists guia_lugares_zap_chave_zap on public.guia_lugares_zap (chave_zap) where chave_zap is not null;
create index if not exists guia_lugares_zap_chave_tel on public.guia_lugares_zap (chave_tel) where chave_tel is not null;

create or replace function public.disparo_pessoas(dias_ int default 90)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  desde timestamptz := case when dias_ is null or dias_ <= 0 then '-infinity'::timestamptz else now() - make_interval(days => least(dias_, 3650)) end;
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma vê a lista do disparo'; end if;
  with conv as (
    select c.chave,
           (array_agg(c.telefone order by c.atualizada_em desc))[1] as telefone,
           max(c.atualizada_em) as ultimo,
           (array_agg(nullif(btrim(c.dados ->> 'nome'), '') order by c.atualizada_em desc) filter (where nullif(btrim(c.dados ->> 'nome'), '') is not null))[1] as nome,
           (array_agg(c.lugar_id order by c.atualizada_em desc) filter (where c.lugar_id is not null))[1] as lugar_id,
           bool_or(c.teste or c.telefone like 'teste-%') as teste,
           bool_or(coalesce(c.dados ->> 'dona', '') = 'true') as dona
      from public.guia_whats_conversas c
     where c.atualizada_em >= desde and c.chave is not null
     group by c.chave),
  ped as (
    select l.cliente_chave as chave,
           (array_agg(l.cliente_tel order by l.criado_em desc))[1] as telefone,
           max(l.criado_em) as ultimo,
           (array_agg(nullif(btrim(l.cliente_nome), '') order by l.criado_em desc) filter (where nullif(btrim(l.cliente_nome), '') is not null))[1] as nome,
           (array_agg(l.cidade order by l.criado_em desc) filter (where l.cidade is not null))[1] as cidade,
           (array_agg(l.salao_nome order by l.criado_em desc) filter (where l.salao_nome is not null))[1] as salao
      from public.guia_whats_leads l
     where l.criado_em >= desde and l.cliente_chave is not null
     group by l.cliente_chave),
  perf as (select p.chave, p.telefone, p.nome, p.em from public.guia_whats_perfis p where p.em >= desde),
  todos as (select chave from conv union select chave from ped union select chave from perf),
  junto as (
    select t.chave,
           coalesce(ped.telefone, conv.telefone, perf.telefone) as telefone,
           coalesce(ped.nome, conv.nome) as nome,
           perf.nome as nome_whats,
           coalesce(ped.cidade, gl.cidade) as cidade,
           coalesce(ped.salao, gl.nome) as salao,
           greatest(ped.ultimo, conv.ultimo, perf.em) as ultimo,
           ped.chave is not null as pedido,
           coalesce(conv.teste, false) as teste,
           coalesce(conv.dona, false) as dona
      from todos t
      left join conv on conv.chave = t.chave
      left join ped on ped.chave = t.chave
      left join perf on perf.chave = t.chave
      left join public.guia_lugares gl on gl.id = conv.lugar_id),
  -- 259: os números dos salões do guia não são mais convertidos aqui, salão a salão: cada pessoa é procurada nas chaves
  -- guardadas em guia_lugares_zap (abaixo, em classe). Aqui só os salões que já receberam pedido.
  saloes as (
    select salao_chave as chave from public.guia_whats_leads where salao_chave is not null),
  nossos as (
    select public.guia_whats_chave(numero) as chave from public.guia_whats_config where coalesce(numero, '') <> ''
    union select public.guia_whats_chave(numero) from public.comercial_config where coalesce(numero, '') <> ''
    union select public.guia_whats_chave(numero) from public.disparo_numeros where coalesce(numero, '') <> ''),
  ja as (
    select e.chave, count(*) as n, max(e.enviado_em) as ultimo
      from public.disparo_envios e where not e.teste and e.status = 'enviado' group by e.chave),
  classe as (
    select j.*, case when j.teste or j.telefone like 'teste-%' then 'teste'
                     when j.chave in (select chave from nossos where chave is not null) then 'nossos'
                     when j.dona or j.chave in (select chave from saloes where chave is not null)
                          or exists (select 1 from public.guia_lugares_zap z where z.chave_zap = j.chave)
                          or exists (select 1 from public.guia_lugares_zap z where z.chave_tel = j.chave) then 'salao' end as fora
      from junto j)
  select jsonb_build_object(
    'pessoas', coalesce((
      select jsonb_agg(jsonb_build_object('chave', c.chave, 'telefone', c.telefone, 'nome', c.nome, 'nome_whats', c.nome_whats,
               'cidade', c.cidade, 'salao', c.salao, 'ultimo', c.ultimo, 'pedido', c.pedido,
               'disparos', coalesce(ja.n, 0), 'ultimo_disparo', ja.ultimo) order by c.ultimo desc nulls last)
        from classe c left join ja on ja.chave = c.chave
       where c.fora is null and c.telefone is not null), '[]'::jsonb),
    'fora', jsonb_build_object('salao', (select count(*) from classe where fora = 'salao'),
                               'teste', (select count(*) from classe where fora = 'teste'),
                               'nossos', (select count(*) from classe where fora = 'nossos')),
    'dias', dias_)
  into r;
  return r;
end $$;

revoke execute on function public.disparo_pessoas(int) from public, anon;
grant execute on function public.disparo_pessoas(int) to authenticated;

do $$
declare n bigint;
begin
  select count(*) into n from public.guia_lugares_zap where chave_zap is not null or chave_tel is not null;
  raise notice '259: % salões com o número guardado para a lista do disparo', n;
end $$;
