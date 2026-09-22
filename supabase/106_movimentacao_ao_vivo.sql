-- 106 · Movimentação ao vivo no PDV: os horários e os pagamentos passam a
-- sair pelo Realtime (a RLS continua valendo: cada dona só ouve o que é
-- do salão dela). `replica identity full` para o filtro por salão valer
-- também nas atualizações.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pagamentos') then
    alter publication supabase_realtime add table public.pagamentos;
  end if;
exception when undefined_object then
  -- sem a publicação (banco de teste sem Realtime): segue
  null;
end $$;
alter table public.appointments replica identity full;
alter table public.pagamentos replica identity full;
