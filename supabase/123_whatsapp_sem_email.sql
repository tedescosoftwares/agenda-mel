-- 123: a conferência do WhatsApp não conta mais de quem é o número. Antes
-- devolvia o e-mail mascarado; agora só diz que está em uso, e quem for
-- a dona fala com o suporte.
create or replace function public.telefone_disponivel(fone text)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  chave text := public.telefone_chave(fone);
begin
  if chave is null then
    return jsonb_build_object('disponivel', false, 'motivo', 'Confere o WhatsApp: DDD + 9 dígitos.');
  end if;
  if exists (select 1 from public.profiles p where p.phone_chave = chave) then
    return jsonb_build_object('disponivel', false, 'em_uso', true, 'motivo', 'Esse WhatsApp já está em uso e não dá pra cadastrar de novo. Se o número é seu, fale com o suporte.');
  end if;
  return jsonb_build_object('disponivel', true);
end;
$$;
revoke execute on function public.telefone_disponivel(text) from public;
grant execute on function public.telefone_disponivel(text) to anon, authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('123_whatsapp_sem_email.sql') on conflict (arquivo) do nothing;
