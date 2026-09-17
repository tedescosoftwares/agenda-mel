-- 098 · Destaque só do que alguém faz
--
-- Um serviço em destaque que nenhuma profissional faz levava a cliente
-- a uma página sem com quem marcar. A vitrine do salão e a categoria já
-- escondem esses; a home passa a esconder também. Mesma função da 097,
-- com o filtro a mais.
create or replace function public.destaques_para_mim()
returns table (id uuid, name text, price numeric, duration_minutes integer, images text[], is_combo boolean, salon_id uuid, salao text, quem jsonb)
language sql
stable
security definer set search_path = public
as $$
  with eu as (select auth.uid() as id),
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
  )
  select sv.id, sv.name, sv.price, sv.duration_minutes, sv.images, sv.is_combo, sv.salon_id, s.name,
         (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
            from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active
           where ps.service_id = sv.id)
  from public.services sv
  join public.salons s on s.id = sv.salon_id and s.active
  where sv.active and sv.destaque
    and sv.salon_id in (select ms.salon_id from meus_saloes ms)
    -- só o que alguém faz: sem profissional não dá para marcar
    and exists (select 1 from public.professional_services ps join public.professionals p on p.id = ps.professional_id and p.active where ps.service_id = sv.id)
  order by s.name, sv.name
  limit 60;
$$;
revoke execute on function public.destaques_para_mim() from public, anon;
grant execute on function public.destaques_para_mim() to authenticated;
