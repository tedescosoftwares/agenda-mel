-- 080 · O banco sabe quais migrações já rodou
--
-- Acabou o SQL gigante colado no editor. A tabela abaixo guarda o nome
-- de cada migração aplicada; o supabase/aplicar.sh (na VPS, opção B do
-- .bat) roda só o que falta, na ordem, cada uma numa transação, e
-- anota aqui. Os arquivos gerados (setup_completo, atualizacao_*)
-- também anotam, para quem ainda colar no editor.
create table if not exists public.migracoes_aplicadas (
  arquivo text primary key,
  aplicada_em timestamptz not null default now()
);
alter table public.migracoes_aplicadas enable row level security;
revoke all on public.migracoes_aplicadas from anon, authenticated;

-- a plataforma vê o que já rodou (Configurações)
create or replace function public.plataforma_migracoes()
returns table (arquivo text, aplicada_em timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select m.arquivo, m.aplicada_em from public.migracoes_aplicadas m
  where public.eh_plataforma() order by m.arquivo desc;
$$;
revoke execute on function public.plataforma_migracoes() from public, anon;
grant execute on function public.plataforma_migracoes() to authenticated;
