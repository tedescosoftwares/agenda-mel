-- 067 · Um WhatsApp, uma conta
--
-- Sem CPF, o que identifica a pessoa é o número do WhatsApp: é por ele
-- que a profissional a conhece e por ele que os avisos chegam. Então
-- ele passa a ser único no cadastro inteiro (cliente, profissional,
-- dona), comparado pela chave normalizada (telefone_chave: DDI+DDD+
-- número, sem o 9 ambíguo, sem formatação).
--
--   profiles.phone_chave         a chave, calculada do phone
--   profiles.phone_verificado_em quando a pessoa provou que o número é dela
--   telefones_duplicados         o que já estava repetido antes desta regra
--   telefone_disponivel(fone)    o app pergunta antes de cadastrar (anon)
--   pedir/confirmar_troca_whatsapp   respeitam a unicidade e marcam verificado

alter table public.profiles
  add column if not exists phone_chave text generated always as (public.telefone_chave(phone)) stored,
  add column if not exists phone_verificado_em timestamptz;

-- 1. O que já estava duplicado: o mais antigo fica com o número -----------------
create table if not exists public.telefones_duplicados (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  phone text not null,
  ficou_com uuid not null,
  criado_em timestamptz not null default now()
);
alter table public.telefones_duplicados enable row level security;
revoke all on public.telefones_duplicados from anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.id, p.phone, first_value(p.id) over (partition by p.phone_chave order by
             case p.role when 'cliente' then 0 when 'admin' then 1 else 2 end, p.created_at) as dono
      from public.profiles p
     where p.phone_chave is not null
       and p.phone_chave in (select phone_chave from public.profiles group by phone_chave having count(*) > 1)
  loop
    if r.id <> r.dono then
      insert into public.telefones_duplicados (user_id, phone, ficou_com) values (r.id, r.phone, r.dono);
      update public.profiles set phone = null where id = r.id;
    end if;
  end loop;
end $$;

create unique index if not exists profiles_phone_chave_unico
  on public.profiles (phone_chave) where phone_chave is not null;

-- 2. O app pergunta antes ---------------------------------------------------------------
-- Devolve só o necessário para a pessoa se achar: "tem conta" e o e-mail
-- mascarado. Não devolve nome nem o e-mail inteiro.
create or replace function public.telefone_disponivel(fone text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  chave text := public.telefone_chave(fone);
  dono record;
  mascarado text;
begin
  if chave is null then
    return jsonb_build_object('disponivel', false, 'motivo', 'Confere o WhatsApp: DDD + 9 dígitos.');
  end if;
  select p.id, u.email into dono
    from public.profiles p join auth.users u on u.id = p.id
   where p.phone_chave = chave limit 1;
  if not found then return jsonb_build_object('disponivel', true); end if;
  mascarado := left(dono.email, 1) || repeat('*', greatest(2, position('@' in dono.email) - 2)) || substr(dono.email, position('@' in dono.email));
  return jsonb_build_object('disponivel', false, 'motivo', 'Esse WhatsApp já tem conta.', 'email', mascarado);
end;
$$;
revoke execute on function public.telefone_disponivel(text) from public;
grant execute on function public.telefone_disponivel(text) to anon, authenticated;

-- 3. Trocar o número respeita a regra e marca verificado -----------------------------------
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
  if public.telefone_chave(atual) = public.telefone_chave(novo) then
    raise exception 'Esse já é o seu WhatsApp.';
  end if;
  if exists (select 1 from public.profiles p where p.phone_chave = public.telefone_chave(novo) and p.id <> eu) then
    raise exception 'Esse WhatsApp já está em outra conta.';
  end if;
  if (select count(*) from public.trocas_de_contato t where t.user_id = eu and t.criado_em > now() - interval '1 hour') >= 5 then
    raise exception 'Muitas tentativas. Tente de novo daqui a uma hora.';
  end if;

  cod := lpad((floor(random() * 1000000))::int::text, 6, '0');

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
  if exists (select 1 from public.profiles p where p.phone_chave = public.telefone_chave(t.novo) and p.id <> eu) then
    raise exception 'Esse WhatsApp entrou em outra conta enquanto isso.';
  end if;
  update public.trocas_de_contato set usado_em = now() where id = t.id;
  update public.profiles set phone = t.novo, phone_verificado_em = case when t.via = 'whatsapp' then now() else phone_verificado_em end where id = eu;
  return jsonb_build_object('ok', true, 'phone', t.novo);
end;
$$;
