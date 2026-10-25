-- 211: o e-mail de boas-vindas só depois de confirmar o e-mail (3.66)
--
-- No cadastro com e-mail e senha chegavam dois e-mails de uma vez: o "confirme
-- seu e-mail" do Supabase e as boas-vindas da MIMO (handle_new_user, 137). A
-- pessoa se perdia. Agora as boas-vindas entram na fila "aguardando" e só vão
-- quando o e-mail é confirmado (auth.users.email_confirmed_at). Quem já chega
-- confirmada (Google) recebe na hora, como antes. Nada muda no handle_new_user.

alter table public.email_outbox drop constraint if exists email_outbox_status_check;
alter table public.email_outbox add constraint email_outbox_status_check
  check (status in ('na_fila', 'enviando', 'enviado', 'falhou', 'cancelado', 'aguarda_confirmacao'));

-- ao enfileirar boas-vindas para uma conta ainda não confirmada: espera
create or replace function public.email_outbox_segurar_boas_vindas()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind = 'boas_vindas' and new.user_id is not null and new.status = 'na_fila'
     and exists (select 1 from auth.users u where u.id = new.user_id and u.email_confirmed_at is null) then
    new.status := 'aguarda_confirmacao';
  end if;
  return new;
end;
$$;

drop trigger if exists segurar_boas_vindas on public.email_outbox;
create trigger segurar_boas_vindas
  before insert on public.email_outbox
  for each row execute function public.email_outbox_segurar_boas_vindas();

-- confirmou o e-mail: o que estava esperando volta para a fila
create or replace function public.liberar_emails_ao_confirmar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    update public.email_outbox
    set status = 'na_fila', liberado_em = now()
    where user_id = new.id and status = 'aguarda_confirmacao';
  end if;
  return new;
end;
$$;

drop trigger if exists liberar_emails_ao_confirmar on auth.users;
create trigger liberar_emails_ao_confirmar
  after update of email_confirmed_at on auth.users
  for each row execute function public.liberar_emails_ao_confirmar();

insert into public.migracoes_aplicadas (arquivo) values ('211_boas_vindas_depois_de_confirmar.sql') on conflict (arquivo) do nothing;

do $$ begin
  raise notice '211: boas-vindas só depois de confirmar o e-mail (aguarda_confirmacao na fila; libera ao confirmar)';
end $$;
