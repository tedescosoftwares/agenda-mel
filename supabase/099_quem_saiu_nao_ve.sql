-- 099 · Quem saiu do salão não vê mais nada dele
--
-- A 097 passou a mostrar destaques também dos salões onde a cliente já
-- marcou ou favoritou alguém. Só que isso ignorava o "saiu": ela saía da
-- agenda do salão e os destaques (e as promoções) continuavam na home,
-- porque um agendamento antigo bastava. Agora um salão de que ela saiu
-- (vínculo com saiu_em, sem outro vínculo ativo) fica de fora dos dois,
-- venha por onde vier.

create or replace function public.promocoes_visiveis_para(cliente uuid)
returns setof public.promocoes
language sql
stable
security definer set search_path = public
as $$
  with sai as (
    select v.salon_id from public.vinculos v where v.client_id = cliente and v.saiu_em is not null
      and not exists (select 1 from public.vinculos v2 where v2.client_id = cliente and v2.salon_id = v.salon_id and v2.saiu_em is null)
  ),
  minhas_profs as (
    select m.professional_id from (
      select f.professional_id from public.client_favorites f where f.client_id = cliente
      union
      select a.professional_id from public.appointments a where a.client_id = cliente and a.professional_id is not null
      union
      select v.trazida_por from public.vinculos v where v.client_id = cliente and v.saiu_em is null and v.trazida_por is not null
    ) m join public.professionals p on p.id = m.professional_id
    where p.salon_id is null or p.salon_id not in (select salon_id from sai)
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v where v.client_id = cliente and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id
  ),
  hoje as (select (public.agora_local())::date as d)
  select pr.*
  from public.promocoes pr
  cross join hoje
  left join public.professionals p on p.id = pr.professional_id
  where cliente is not null
    and pr.ativa and pr.aprovacao = 'aprovada' and pr.inicio <= hoje.d and (pr.fim is null or pr.fim >= hoje.d)
    and (p.id is null or p.active)
    and (pr.salon_id is null or pr.salon_id not in (select salon_id from sai))
    and (pr.salon_id is null
         or (pr.professional_id is not null and pr.professional_id in (select professional_id from minhas_profs))
         or (pr.professional_id is null and pr.salon_id in (select salon_id from meus_saloes)));
$$;

create or replace function public.destaques_para_mim()
returns table (id uuid, name text, price numeric, duration_minutes integer, images text[], is_combo boolean, salon_id uuid, salao text, quem jsonb)
language sql
stable
security definer set search_path = public
as $$
  with eu as (select auth.uid() as id),
  -- salões de que ela saiu (e não voltou): nada deles aparece, nem por
  -- agendamento antigo, nem por favorita
  sai as (
    select v.salon_id from public.vinculos v, eu where v.client_id = eu.id and v.saiu_em is not null
      and not exists (select 1 from public.vinculos v2 where v2.client_id = eu.id and v2.salon_id = v.salon_id and v2.saiu_em is null)
  ),
  minhas_profs as (
    select f.professional_id from public.client_favorites f, eu where f.client_id = eu.id
    union
    select a.professional_id from public.appointments a, eu where a.client_id = eu.id and a.professional_id is not null
    union
    select v.trazida_por from public.vinculos v, eu where v.client_id = eu.id and v.saiu_em is null and v.trazida_por is not null
  ),
  meus_saloes as (
    select v.salon_id from public.vinculos v, eu where v.client_id = eu.id and v.saiu_em is null
    union
    select p.salon_id from public.professionals p join minhas_profs m on m.professional_id = p.id where p.salon_id is not null
    union
    select p.salon_id from public.professionals p, eu where p.user_id = eu.id and p.salon_id is not null
    union
    select s.id from public.salons s, eu where s.owner_id = eu.id
  ),
  meus_saloes_validos as (select ms.salon_id from meus_saloes ms where ms.salon_id not in (select salon_id from sai))
  select sv.id, sv.name, sv.price, sv.duration_minutes, sv.images, sv.is_combo, sv.salon_id, s.name,
         (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
            from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active
           where ps.service_id = sv.id)
  from public.services sv
  join public.salons s on s.id = sv.salon_id and s.active
  where sv.active and sv.destaque
    and sv.salon_id in (select ms.salon_id from meus_saloes_validos ms)
    -- só o que alguém faz: sem profissional não dá para marcar
    and exists (select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
  order by s.name, sv.name
  limit 60;
$$;
revoke execute on function public.destaques_para_mim() from public, anon;
grant execute on function public.destaques_para_mim() to authenticated;
