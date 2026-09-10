-- 066 · Trocar WhatsApp com código; nome e e-mail fora do alcance direto
--
-- O nome é como a profissional conhece a cliente, e o WhatsApp é por
-- onde os avisos chegam: nenhum dos dois muda com um update solto.
--   - nome: só o suporte muda (ou a própria dona do negócio, pela equipe)
--   - e-mail: pelo Supabase Auth, que manda o link de confirmação
--   - WhatsApp: pedir_troca_whatsapp(novo) manda um código de 6 dígitos
--     para o NÚMERO NOVO (prova que é dela); sem canal de WhatsApp
--     ligado, o código vai para o e-mail da conta. confirmar_troca_whatsapp(codigo)
--     fecha a troca. 10 minutos de validade, 5 tentativas.

revoke update on public.profiles from authenticated;
grant update (accepts_reminders, aceita_email, nascimento, avatar_url) on public.profiles to authenticated;

create table if not exists public.trocas_de_contato (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  tipo text not null check (tipo in ('whatsapp')),
  novo text not null,
  codigo text not null,
  via text not null check (via in ('whatsapp', 'email')),
  tentativas integer not null default 0,
  expira_em timestamptz not null,
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists trocas_de_contato_user_idx on public.trocas_de_contato (user_id, criado_em desc);
alter table public.trocas_de_contato enable row level security;
revoke all on public.trocas_de_contato from anon, authenticated;

create or replace function public.pedir_troca_whatsapp(novo text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  e164 text;
  atual text;
  cod text;
  canal record;
  email_ text;
  nome_ text;
  via_ text;
  e record;
  msg text;
begin
  if eu is null then raise exception 'Entre na conta primeiro.'; end if;
  e164 := public.telefone_e164(novo);
  if e164 is null or length(e164) < 12 then
    raise exception 'Confere o WhatsApp: DDD + 9 dígitos.';
  end if;
  select p.phone, p.full_name into atual, nome_ from public.profiles p where p.id = eu;
  if public.telefone_e164(atual) = e164 then
    raise exception 'Esse já é o seu WhatsApp.';
  end if;
  if (select count(*) from public.trocas_de_contato t where t.user_id = eu and t.criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitas tentativas. Tente de novo daqui a uma hora.';
  end if;

  cod := lpad((floor(random() * 1000000))::int::text, 6, '0');

  -- por onde vai o código: um canal de WhatsApp ligado em alguma agenda dela
  select c.* into canal
    from public.whatsapp_channels c
    join public.vinculos v on v.salon_id = c.salon_id and v.client_id = eu and v.saiu_em is null
   where c.ativo and c.canal <> 'manual'
   order by v.criado_em
   limit 1;

  msg := 'Seu código para trocar o WhatsApp no MIMO é ' || cod || '. Vale por 10 minutos. Se não foi você, ignore.';

  if found then
    via_ := 'whatsapp';
    insert into public.message_outbox (salon_id, client_id, telefone, kind, titulo, corpo, canal, liberado_em)
    values (canal.salon_id, eu, e164, 'codigo_whatsapp', null, msg, canal.canal, now());
  else
    via_ := 'email';
    select u.email into email_ from auth.users u where u.id = eu;
    if email_ is null then raise exception 'Sem canal de WhatsApp nem e-mail para mandar o código.'; end if;
    select * into e from public.email_aviso(nome_, 'Seu código: ' || cod, msg, 'Abrir o MIMO', public.app_base() || '/cliente/perfil');
    perform public.enfileirar_email(email_, e.assunto, e.html, 'codigo_whatsapp', e.texto, nome_, eu);
  end if;

  insert into public.trocas_de_contato (user_id, tipo, novo, codigo, via, expira_em)
  values (eu, 'whatsapp', novo, cod, via_, now() + interval '10 minutes');

  perform public.chutar_agora();
  return jsonb_build_object('via', via_, 'para', case when via_ = 'whatsapp' then novo else email_ end, 'expira_em', now() + interval '10 minutes');
end;
$$;
revoke execute on function public.pedir_troca_whatsapp(text) from public, anon;
grant execute on function public.pedir_troca_whatsapp(text) to authenticated;

create or replace function public.confirmar_troca_whatsapp(codigo_ text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  t record;
begin
  select * into t from public.trocas_de_contato
   where user_id = eu and tipo = 'whatsapp' and usado_em is null
   order by criado_em desc limit 1;
  if not found then raise exception 'Nenhuma troca pendente. Peça o código de novo.'; end if;
  if t.expira_em < now() then raise exception 'Esse código venceu. Peça outro.'; end if;
  if t.tentativas >= 5 then raise exception 'Muitas tentativas erradas. Peça outro código.'; end if;
  if btrim(coalesce(codigo_, '')) <> t.codigo then
    update public.trocas_de_contato set tentativas = tentativas + 1 where id = t.id;
    raise exception 'Código errado. Faltam % tentativas.', 4 - t.tentativas;
  end if;
  update public.trocas_de_contato set usado_em = now() where id = t.id;
  update public.profiles set phone = t.novo where id = eu;
  return jsonb_build_object('ok', true, 'phone', t.novo);
end;
$$;
revoke execute on function public.confirmar_troca_whatsapp(text) from public, anon;
grant execute on function public.confirmar_troca_whatsapp(text) to authenticated;

insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values ('codigo_whatsapp', true, 'utilidade', null)
on conflict (kind) do nothing;
