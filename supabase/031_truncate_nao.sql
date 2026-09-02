-- =============================================================
-- Agenda Mel — 031: tirar TRUNCATE das mãos de quem só deveria ler
--
-- O Supabase, ao criar o projeto, roda:
--     alter default privileges in schema public
--       grant all on tables to anon, authenticated, service_role;
--
-- "all" inclui TRUNCATE. E TRUNCATE é a única forma de apagar dados que
-- NÃO passa por Row Level Security: as políticas que protegem cada linha
-- simplesmente não são consultadas. Um `truncate appointments` apagaria a
-- agenda inteira de todos os salões, com RLS ligada e tudo.
--
-- Isso é alcançável hoje? Pela API, não: o PostgREST só emite select,
-- insert, update e delete, nunca truncate. Então não é um buraco aberto,
-- é um andaime esquecido. Mas fechar não custa nada e muda o tamanho do
-- estrago de qualquer descuido futuro — uma função SECURITY INVOKER mal
-- escrita, um SQL montado com concatenação, uma extensão nova.
--
-- REFERENCES e TRIGGER vão junto pelo mesmo motivo: ninguém precisa deles
-- pelo caminho da aplicação, e TRIGGER permite pendurar código próprio
-- numa tabela alheia.
--
-- O que NÃO é mexido: select, insert, update e delete continuam como
-- estavam. Quem protege esses quatro é a RLS, e ela está fazendo o
-- trabalho dela.
-- =============================================================

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format(
      'revoke truncate, references, trigger on public.%I from anon, authenticated',
      t.tablename);
  end loop;
end $$;

-- E para as tabelas que ainda vão nascer: sem isto, a próxima migração
-- que criar uma tabela recebe o "all" de novo e o conserto dura até a
-- semana que vem.
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
