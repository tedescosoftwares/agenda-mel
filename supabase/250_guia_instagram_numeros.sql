-- 250 · Os números do Instagram da MIMO no guia, na aba Instagram (3.99.2)
--
-- A 249 passou a gravar os toques insta_convite, insta_seguir e insta_direto, mas o Desempenho do guia só desenha os
-- toques de contato com o salão: os do Instagram ficavam guardados sem aparecer em lugar nenhum. Esta função entrega
-- os números para a aba Plataforma › Guia › Instagram: quantas vezes o convite apareceu, quantos toques e quantas
-- pessoas tocaram em Seguir (visitante é o código do dia, que não identifica ninguém: uma pessoa em dois dias conta
-- duas), de onde veio o Seguir (a área), quantos foram direto ao salão e, para comparar, os toques em WhatsApp e Ligar
-- das páginas dos salões no mesmo período. Só a Plataforma vê.

create or replace function public.guia_instagram_numeros(dias_ integer default 30)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  n integer := greatest(1, least(coalesce(dias_, 30), 365));
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)));
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê os números do guia'; end if;
  select jsonb_build_object(
    'dias', n,
    'convites', count(*) filter (where e.tipo = 'insta_convite'),
    'seguir', count(*) filter (where e.tipo = 'insta_seguir'),
    'seguir_pessoas', count(distinct ((e.em at time zone 'America/Sao_Paulo')::date, e.visitante)) filter (where e.tipo = 'insta_seguir'),
    'seguir_do_convite', count(*) filter (where e.tipo = 'insta_seguir' and e.area = 'insta_modal'),
    'direto', count(*) filter (where e.tipo = 'insta_direto'),
    'contatos', count(*) filter (where e.tipo in ('whatsapp', 'ligar')),
    'por_area', coalesce((
      select jsonb_object_agg(x.area, x.c)
        from (select coalesce(s.area, 'outra') as area, count(*) as c from public.site_eventos s
               where s.tipo = 'insta_seguir' and s.em >= desde group by 1) x), '{}'::jsonb),
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', x.dia, 'seguir', x.c) order by x.dia)
        from (select (s.em at time zone 'America/Sao_Paulo')::date as dia, count(*) as c from public.site_eventos s
               where s.tipo = 'insta_seguir' and s.em >= desde group by 1) x), '[]'::jsonb))
  into r
  from public.site_eventos e
  where e.em >= desde and e.tipo in ('insta_convite', 'insta_seguir', 'insta_direto', 'whatsapp', 'ligar');
  return r;
end;
$$;
revoke execute on function public.guia_instagram_numeros(integer) from public, anon;
grant execute on function public.guia_instagram_numeros(integer) to authenticated;

do $$ begin
  raise notice '250: os números do Instagram da MIMO no guia (guia_instagram_numeros, só a Plataforma).';
end $$;
