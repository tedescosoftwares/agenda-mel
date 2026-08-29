-- =============================================================
-- Agenda Mel — 005: imagens dos serviços + horários ocupados
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 004).
-- =============================================================

-- Até 3 imagens por serviço (URLs públicas do Storage)
alter table public.services
  add column if not exists images text[] not null default '{}';

-- Bucket público para as fotos dos serviços
insert into storage.buckets (id, name, public)
values ('service-images', 'service-images', true)
on conflict (id) do nothing;

-- Qualquer pessoa vê as imagens; só admin envia/remove
drop policy if exists "imagens de servicos publicas" on storage.objects;
create policy "imagens de servicos publicas"
  on storage.objects for select
  using (bucket_id = 'service-images');

drop policy if exists "admin envia imagens de servicos" on storage.objects;
create policy "admin envia imagens de servicos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin atualiza imagens de servicos" on storage.objects;
create policy "admin atualiza imagens de servicos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

drop policy if exists "admin remove imagens de servicos" on storage.objects;
create policy "admin remove imagens de servicos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'service-images' and public.is_admin());

-- Horários ocupados de um dia, sem expor dados de outras clientes.
-- (a cliente só enxerga os próprios agendamentos pela RLS; esta função
-- devolve apenas início/fim dos horários tomados, para montar a grade)
create or replace function public.get_busy_slots(dia date)
returns table (start_time time, end_time time)
language sql
stable
security definer set search_path = public
as $$
  select a.start_time, a.end_time
  from public.appointments a
  where a.date = dia and a.status <> 'cancelado';
$$;

grant execute on function public.get_busy_slots(date) to authenticated;
