-- 207: entrar com Google na ponta da cliente (3.60)
-- A conta que nasce pelo Google chega sem WhatsApp: o Google só dá nome, e-mail e foto. O gatilho de sempre
-- (handle_new_user) cria o perfil com o nome e sem telefone; o app pede o número numa tela de "falta só o seu
-- WhatsApp" e chama completar_perfil, que faz o que o cadastro por e-mail fazia no gatilho (passo b): grava o
-- telefone (um WhatsApp, uma conta — 067), o aniversário e os aceites, copia a foto do Google quando o perfil não
-- tem, e amarra os encaixes que o salão fez por esse número. Só para cliente; idempotente para o mesmo número.
-- O vínculo pelo convite (/v/<código>) continua nascendo no app, como para quem já tinha conta (053).

create or replace function public.completar_perfil(nome_ text default null, fone_ text default null, nascimento_ date default null, aceites_ jsonb default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  eu uuid := auth.uid();
  p public.profiles%rowtype;
  fone text := nullif(btrim(coalesce(fone_, '')), '');
  nome text := nullif(btrim(coalesce(nome_, '')), '');
  e164 text;
  chave text;
  foto text;
  encaixes integer := 0;
  agendas integer := 0;
begin
  if eu is null then
    return jsonb_build_object('ok', false, 'motivo', 'Entre na conta primeiro.');
  end if;
  select * into p from public.profiles where id = eu;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'Perfil não encontrado.');
  end if;
  if p.role <> 'cliente' then
    return jsonb_build_object('ok', false, 'motivo', 'Essa conta não é de cliente.');
  end if;

  -- o WhatsApp: DDD + 9 dígitos, e um número por conta (067)
  e164 := public.telefone_e164(fone);
  chave := public.telefone_chave(fone);
  if fone is null or e164 is null or length(e164) < 12 then
    return jsonb_build_object('ok', false, 'motivo', 'Confere o WhatsApp: DDD + 9 dígitos.');
  end if;
  if p.phone is not null and public.telefone_chave(p.phone) is distinct from chave then
    return jsonb_build_object('ok', false, 'motivo', 'Esse perfil já tem WhatsApp. Para trocar, use o perfil.', 'ja_tinha', true);
  end if;
  if exists (select 1 from public.profiles x where x.phone_chave = chave and x.id <> eu) then
    return jsonb_build_object('ok', false, 'em_uso', true,
      'motivo', 'Esse WhatsApp já está em uso e não dá pra cadastrar de novo. Se a conta é sua, entre por ela.');
  end if;

  -- a foto do Google, quando o perfil não tem nenhuma
  if p.avatar_url is null then
    select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture', '')), '')
      into foto from auth.users u where u.id = eu;
    if foto is not null and foto !~* '^https?://' then foto := null; end if;
  end if;

  update public.profiles
     set full_name = coalesce(nome, full_name),
         phone = coalesce(phone, fone),
         nascimento = coalesce(nascimento_, nascimento),
         avatar_url = coalesce(avatar_url, foto)
   where id = eu;

  -- os aceites do cadastro (120): a versão de cada documento, como no cadastro por e-mail
  if jsonb_typeof(aceites_) = 'object' then
    begin
      perform public.aceitar_documentos_interno(eu, aceites_, 'cadastro');
    exception when others then
      raise notice 'aceites de % não gravados: %', eu, sqlerrm;
    end;
  end if;

  -- (b) já foi encaixada pelo telefone: os horários passam a ser dela, e o salão que a encaixou vira vínculo
  begin
    update public.appointments a
       set client_id = eu
     where a.client_id is null
       and public.telefone_e164(a.guest_phone) = e164;
    get diagnostics encaixes = row_count;

    perform public.vincular_interno(eu, a.salon_id, a.professional_id, 'encaixe')
      from (select distinct on (salon_id) salon_id, professional_id
              from public.appointments
             where client_id = eu
             order by salon_id, date) a;
  exception when others then
    raise notice 'encaixes de % não amarrados: %', e164, sqlerrm;
  end;

  select count(*) into agendas from public.vinculos v where v.client_id = eu and v.saiu_em is null;
  return jsonb_build_object('ok', true, 'phone', fone, 'encaixes', encaixes, 'agendas', agendas);
end;
$$;
revoke execute on function public.completar_perfil(text, text, date, jsonb) from public, anon;
grant execute on function public.completar_perfil(text, text, date, jsonb) to authenticated;

insert into public.migracoes_aplicadas (arquivo) values ('207_entrar_com_google.sql') on conflict (arquivo) do nothing;

do $$ begin
  raise notice '207: entrar com Google na ponta da cliente — completar_perfil (WhatsApp, aniversário, aceites, foto do Google, encaixes)';
end $$;
