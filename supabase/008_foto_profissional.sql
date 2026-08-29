-- =============================================================
-- Agenda Mel — 008: foto da profissional
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 007).
--
-- A coluna professionals.photo_url já existe desde o 007; aqui
-- criamos o lugar onde a imagem fica guardada.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('professional-photos', 'professional-photos', true)
on conflict (id) do nothing;

-- A foto aparece no link público, então a leitura é aberta
drop policy if exists "fotos de profissionais publicas" on storage.objects;
create policy "fotos de profissionais publicas"
  on storage.objects for select
  using (bucket_id = 'professional-photos');

-- Envio/remoção: o salão ou a própria profissional
drop policy if exists "equipe envia foto de profissional" on storage.objects;
create policy "equipe envia foto de profissional"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );

drop policy if exists "equipe atualiza foto de profissional" on storage.objects;
create policy "equipe atualiza foto de profissional"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );

drop policy if exists "equipe remove foto de profissional" on storage.objects;
create policy "equipe remove foto de profissional"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'professional-photos'
    and (public.is_admin() or public.my_professional_id() is not null)
  );
