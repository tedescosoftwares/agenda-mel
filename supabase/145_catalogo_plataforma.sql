-- 145: Catálogo na Plataforma (2.92) — imagens e uso
-- Agenda Mel — 145: bucket público "catalogo" para as imagens de categorias, famílias e serviços (só a Plataforma envia) e catalogo_uso() com quantos serviços de salão usam cada item
--
-- A tela Plataforma → Catálogo edita categorias_de_servico (as da
-- plataforma) e catalogo_itens direto pelas RLS da 082/143. O que faltava:
--   - um lugar para as imagens: bucket público `catalogo`, caminhos
--     categorias/<id>.jpg, familias/<id>.jpg, servicos/<id>.jpg;
--   - saber quanto cada item é usado (services.catalogo_item_id), que a
--     Plataforma não lê direto.

insert into storage.buckets (id, name, public)
values ('catalogo', 'catalogo', true)
on conflict (id) do nothing;

drop policy if exists "catalogo: imagens publicas" on storage.objects;
create policy "catalogo: imagens publicas" on storage.objects for select
  using (bucket_id = 'catalogo');
drop policy if exists "catalogo: plataforma envia" on storage.objects;
create policy "catalogo: plataforma envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogo' and public.eh_plataforma());
drop policy if exists "catalogo: plataforma troca" on storage.objects;
create policy "catalogo: plataforma troca" on storage.objects for update to authenticated
  using (bucket_id = 'catalogo' and public.eh_plataforma());
drop policy if exists "catalogo: plataforma remove" on storage.objects;
create policy "catalogo: plataforma remove" on storage.objects for delete to authenticated
  using (bucket_id = 'catalogo' and public.eh_plataforma());

-- quantos serviços de salão apontam para cada item (e para cada categoria)
create or replace function public.catalogo_uso()
returns table (item_id uuid, categoria_id uuid, n bigint)
language sql
stable
security definer set search_path = public
as $$
  select s.catalogo_item_id, s.categoria_id, count(*)
  from public.services s
  where public.eh_plataforma() and (s.catalogo_item_id is not null or s.categoria_id is not null)
  group by s.catalogo_item_id, s.categoria_id
$$;
revoke execute on function public.catalogo_uso() from public, anon;
grant execute on function public.catalogo_uso() to authenticated;
