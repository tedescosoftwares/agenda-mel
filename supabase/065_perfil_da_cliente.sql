-- 065 · O cadastro e o perfil da cliente, repaginados
--
--   profiles.nascimento           aniversário (opcional; o salão usa para lembrar)
--   profiles.avatar_url           foto da cliente (bucket avatars, pasta = seu id)
--   dados_do_cadastro             o cadastro já traz aniversário e o aceite dos termos
--   meu_perfil_resumo()           "cliente desde", atendimentos, próximos, agendas, créditos

alter table public.profiles
  add column if not exists nascimento date,
  add column if not exists avatar_url text;

grant update (full_name, phone, accepts_reminders, aceita_email, nascimento, avatar_url) on public.profiles to authenticated;

-- 1. Foto: bucket público, cada pessoa escreve só na própria pasta ------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars publicos" on storage.objects;
create policy "avatars publicos"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "cada um envia seu avatar" on storage.objects;
create policy "cada um envia seu avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cada um troca seu avatar" on storage.objects;
create policy "cada um troca seu avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "cada um remove seu avatar" on storage.objects;
create policy "cada um remove seu avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. O cadastro traz mais coisa (substitui o gatilho de 064) ----------------------------
create or replace function public.termos_do_cadastro()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v text := nullif(btrim(coalesce(meta ->> 'termos', '')), '');
  nasc date;
begin
  begin
    nasc := nullif(meta ->> 'nascimento', '')::date;
  exception when others then nasc := null;
  end;
  update public.profiles
     set aceitou_termos_em = case when v is not null then now() else aceitou_termos_em end,
         termos_versao = coalesce(v, termos_versao),
         nascimento = coalesce(nasc, nascimento)
   where id = new.id;
  return new;
end;
$$;

-- 3. O resumo do perfil ---------------------------------------------------------------
create or replace function public.meu_perfil_resumo()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'desde', (select p.created_at from public.profiles p where p.id = auth.uid()),
    'atendimentos', (select count(*) from public.appointments a where a.client_id = auth.uid() and a.status = 'concluido'),
    'proximos', (select count(*) from public.appointments a where a.client_id = auth.uid()
                  and a.status in ('pendente', 'confirmado') and (a.date + a.start_time) >= now()),
    'agendas', (select count(*) from public.vinculos v where v.client_id = auth.uid() and v.saiu_em is null),
    'favoritas', (select count(*) from public.client_favorites f where f.client_id = auth.uid()),
    'saldo_cents', coalesce((select public.saldo_creditos()), 0)
  );
$$;
revoke execute on function public.meu_perfil_resumo() from public, anon;
grant execute on function public.meu_perfil_resumo() to authenticated;
