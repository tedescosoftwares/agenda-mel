-- 064 · Termos, primeiro acesso e o Instagram da casa
--
-- LGPD: o aceite dos Termos de Uso e da Política de Privacidade fica
-- registrado com data e versão. O primeiro acesso ao app tem uma tela
-- que explica as permissões (avisos, câmera) e pede o aceite de quem
-- ainda não deu; concluída, não aparece mais.
--
--   profiles.aceitou_termos_em / termos_versao / primeiro_acesso_em
--   aceitar_termos(versao)            registra o aceite de quem está logada
--   concluir_primeiro_acesso()        marca a tela de boas-vindas como vista
--   zz_termos_do_cadastro             o cadastro já traz o aceite (meta.termos)
--   config_publica 'instagram'        o @ mostrado no login e nas páginas
--
-- Depois de rodar, aponte o Instagram de verdade:
--   select public.definir_config_publica('instagram', 'seu.usuario');

alter table public.profiles
  add column if not exists aceitou_termos_em timestamptz,
  add column if not exists termos_versao text,
  add column if not exists primeiro_acesso_em timestamptz;

create or replace function public.aceitar_termos(versao text)
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles
     set aceitou_termos_em = now(), termos_versao = nullif(btrim(coalesce(versao, '')), '')
   where id = auth.uid();
$$;
revoke execute on function public.aceitar_termos(text) from public, anon;
grant execute on function public.aceitar_termos(text) to authenticated;

create or replace function public.concluir_primeiro_acesso()
returns void
language sql
security definer set search_path = public
as $$
  update public.profiles set primeiro_acesso_em = coalesce(primeiro_acesso_em, now()) where id = auth.uid();
$$;
revoke execute on function public.concluir_primeiro_acesso() from public, anon;
grant execute on function public.concluir_primeiro_acesso() to authenticated;

-- o cadastro pelo app marca a caixinha; o servidor guarda a versão.
-- Roda depois do handle_new_user (ordem alfabética dos gatilhos).
create or replace function public.termos_do_cadastro()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare v text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'termos', '')), '');
begin
  if v is not null then
    update public.profiles set aceitou_termos_em = now(), termos_versao = v where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists zz_termos_do_cadastro on auth.users;
create trigger zz_termos_do_cadastro
  after insert on auth.users
  for each row execute function public.termos_do_cadastro();

insert into public.config_publica (chave, valor) values ('instagram', 'mimo.com.vc')
on conflict (chave) do nothing;
