-- 070 · Números de teste da plataforma
--
-- O "Testar no meu WhatsApp" de Plataforma › Mensagens mandava para o
-- telefone do perfil de quem está logada. Só que a conta da plataforma
-- normalmente não tem telefone: é uma conta de trabalho. Agora a
-- plataforma guarda uma lista de números de teste (o seu, o da sócia,
-- o do aparelho velho da gaveta) e o teste vai para todos eles de uma
-- vez. Se a lista estiver vazia, cai no telefone do perfil, como antes.
--
--   telefones_de_teste                       a lista (só a plataforma vê, via RPC)
--   plataforma_telefones_teste()             lê a lista
--   plataforma_salvar_telefones_teste(text[]) substitui a lista
--   plataforma_testar_modelo(texto, para[])  manda o teste; para[] vazio = a lista

create table if not exists public.telefones_de_teste (
  telefone   text primary key,
  apelido    text,
  criado_por uuid references public.profiles (id) on delete set null,
  criado_em  timestamptz not null default now()
);
alter table public.telefones_de_teste enable row level security;
-- sem política nenhuma: o app só chega aqui pelas funções abaixo

create or replace function public.plataforma_telefones_teste()
returns table (telefone text, apelido text, criado_em timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select t.telefone, t.apelido, t.criado_em
  from public.telefones_de_teste t
  where public.eh_plataforma()
  order by t.criado_em;
$$;
revoke execute on function public.plataforma_telefones_teste() from public, anon;
grant execute on function public.plataforma_telefones_teste() to authenticated;

-- cada item pode ser só o número ("13 99999-0000") ou "Apelido: número"
create or replace function public.plataforma_salvar_telefones_teste(fones_ text[])
returns table (telefone text, apelido text, criado_em timestamptz)
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare item text; nome text; bruto text; limpo text; novos text[] := '{}';
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  foreach item in array coalesce(fones_, '{}') loop
    if position(':' in item) > 0 then
      nome := nullif(btrim(split_part(item, ':', 1)), '');
      bruto := split_part(item, ':', 2);
    else
      nome := null; bruto := item;
    end if;
    limpo := public.telefone_e164(bruto);
    if limpo is null then
      if btrim(item) = '' then continue; end if;
      raise exception 'Número inválido: "%". Use DDD + número, ex.: 13 99999-0000.', btrim(item);
    end if;
    insert into public.telefones_de_teste (telefone, apelido, criado_por)
    values (limpo, nome, auth.uid())
    on conflict on constraint telefones_de_teste_pkey do update set apelido = coalesce(excluded.apelido, telefones_de_teste.apelido);
    novos := array_append(novos, limpo);
  end loop;
  delete from public.telefones_de_teste t where not (t.telefone = any (novos));
  return query select t.telefone, t.apelido, t.criado_em from public.telefones_de_teste t order by t.criado_em;
end;
$$;
revoke execute on function public.plataforma_salvar_telefones_teste(text[]) from public, anon;
grant execute on function public.plataforma_salvar_telefones_teste(text[]) to authenticated;

-- o teste vai para para_[] (se vier), senão para a lista, senão para o
-- telefone do perfil. Uma mensagem por número, todas na mesma leva.
drop function if exists public.plataforma_testar_modelo(text);
create or replace function public.plataforma_testar_modelo(texto_ text, para_ text[] default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
#variable_conflict use_variable
declare fones text[]; f text; bruto text; c record; corpo text; enviados text[] := '{}';
begin
  if not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;

  if para_ is not null and array_length(para_, 1) > 0 then
    foreach bruto in array para_ loop
      f := public.telefone_e164(bruto);
      if f is null then raise exception 'Número inválido: "%".', btrim(bruto); end if;
      fones := array_append(fones, f);
    end loop;
  end if;
  if fones is null then
    select array_agg(t.telefone order by t.criado_em) into fones from public.telefones_de_teste t;
  end if;
  if fones is null then
    select array[public.telefone_e164(p.phone)] into fones from public.profiles p where p.id = auth.uid() and public.telefone_e164(p.phone) is not null;
  end if;
  if fones is null or array_length(fones, 1) is null then
    raise exception 'Cadastre pelo menos um número de teste (ou um WhatsApp no seu perfil).';
  end if;

  select * into c from public.whatsapp_channels where ativo and canal <> 'manual' order by salon_id limit 1;
  if not found then raise exception 'Nenhum canal de WhatsApp ligado.'; end if;
  corpo := public.plataforma_previa(texto_);

  foreach f in array fones loop
    if f = any (enviados) then continue; end if;
    insert into public.message_outbox (salon_id, client_id, telefone, kind, titulo, corpo, canal, liberado_em)
    values (c.salon_id, auth.uid(), f, 'teste_modelo', null, coalesce(corpo, ''), c.canal, now());
    enviados := array_append(enviados, f);
  end loop;
  perform public.chutar_agora();
  return jsonb_build_object('ok', true, 'para', to_jsonb(enviados), 'quantos', coalesce(array_length(enviados, 1), 0));
end;
$$;
revoke execute on function public.plataforma_testar_modelo(text, text[]) from public, anon;
grant execute on function public.plataforma_testar_modelo(text, text[]) to authenticated;
