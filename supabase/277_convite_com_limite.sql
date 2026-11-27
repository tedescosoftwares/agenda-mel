-- 277 · Limite no envio do convite da profissional (4.45)
--
-- O convite da equipe sai dos canais da MIMO: o e-mail pelo remetente da MIMO e o WhatsApp pela instância da casa
-- (config_publica.whatsapp_instancia_casa), nunca pelo número do salão; não depende de o salão ter WhatsApp conectado.
-- Por isso precisa de trava: sem ela, um salão podia disparar e-mail e WhatsApp à vontade em nome da MIMO.
--
--   e-mail (acesso_enviar)             3 por hora por profissional (não tinha limite nenhum)
--   WhatsApp (acesso_convite_whats)    3 por dia por número de destino (a função `acesso` já segura 3 por hora por profissional)
--   os dois juntos                     20 por hora por salão
--
-- Copiar o link e "Abrir no meu WhatsApp" continuam livres: aí quem manda é a própria pessoa.

create or replace function public.acesso_enviar(prof uuid, email_ text default null, base text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; s public.salons%rowtype; t text; link text; e record; dona text; b text;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.is_admin_do_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  if p.situacao <> 'configurada' or p.user_id is not null then raise exception 'Essa profissional não está esperando ativação.'; end if;
  if nullif(btrim(coalesce(email_, '')), '') is not null then
    if email_ !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Confere o e-mail dela.'; end if;
    update public.professionals set email = lower(btrim(email_)) where id = prof;
    p.email := lower(btrim(email_));
  end if;
  if p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Cadastre o e-mail dela: é por ele que o acesso chega.'; end if;
  -- 277: limite de envio (o e-mail sai do remetente da MIMO)
  if not public.acesso_tentativa('convite_email:' || p.id::text, 3, 60) then raise exception 'Você já mandou o acesso dela por e-mail 3 vezes na última hora. Espere um pouco ou copie o link.'; end if;
  if not public.acesso_tentativa('convite_salao:' || p.salon_id::text, 20, 60) then raise exception 'Muitos convites enviados na última hora. Espere um pouco ou copie o link e mande você mesma.'; end if;
  select * into s from public.salons where id = p.salon_id;
  t := public.token_da_profissional(p.id);
  -- o link aponta pro app da profissional; só domínios nossos (ou local)
  b := rtrim(coalesce(base, ''), '/');
  if b !~ '^https://(pro\.)?mimo\.com\.vc$' and b !~ '^http://localhost(:[0-9]+)?$' and b !~ '^http://127\.0\.0\.1(:[0-9]+)?$' then b := 'https://pro.mimo.com.vc'; end if;
  link := b || '/ativar/' || t;
  select pr.full_name into dona from public.profiles pr where pr.id = s.owner_id;
  select * into e from public.email_acesso_equipe(p.name, s.name, dona,
    (select count(*)::int from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id), link);
  perform public.enfileirar_email(p.email, e.assunto, e.html, 'acesso_equipe', e.texto, p.name, null);
  update public.acessos_equipe set enviado_em = now() where token = t;
  begin perform public.chutar_agora(); exception when others then null; end;
  return jsonb_build_object('ok', true, 'email', p.email, 'link', link, 'token', t,
    'whats', format('Oi, %s! Te mandei o acesso da sua agenda no %s por e-mail (%s). Dá uma olhada lá, é só abrir o link e criar a senha 💗 Se não achar, confere o spam.',
      split_part(p.name, ' ', 1), s.name, p.email));
end;
$$;
revoke execute on function public.acesso_enviar(uuid, text, text) from public, anon;
grant execute on function public.acesso_enviar(uuid, text, text) to authenticated;

create or replace function public.acesso_convite_whats(prof uuid, base text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare p public.professionals%rowtype; s public.salons%rowtype; t text; link text; b text;
begin
  select * into p from public.professionals where id = prof;
  if p.id is null or not public.is_admin_do_salao(p.salon_id) then raise exception 'Profissional não encontrada.'; end if;
  if p.situacao <> 'configurada' or p.user_id is not null then raise exception 'Essa profissional não está esperando ativação.'; end if;
  if p.email is null or p.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Cadastre o e-mail dela: é com ele que ela entra.'; end if;
  if length(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')) < 10 then raise exception 'Cadastre o WhatsApp dela com DDD.'; end if;
  -- 277: limites de envio. O convite sai do WhatsApp da MIMO (a instância da casa), nunca do número do salão
  if not public.acesso_tentativa('convite_num:' || coalesce(public.telefone_chave(p.phone), p.phone), 3, 1440) then raise exception 'Esse número já recebeu 3 convites hoje. Copie o link e mande você mesma, ou tente amanhã.'; end if;
  if not public.acesso_tentativa('convite_salao:' || p.salon_id::text, 20, 60) then raise exception 'Muitos convites enviados na última hora. Espere um pouco ou copie o link e mande você mesma.'; end if;
  select * into s from public.salons where id = p.salon_id;
  t := public.token_da_profissional(p.id);
  b := rtrim(coalesce(base, ''), '/');
  if b !~ '^https://(pro\.)?mimo\.com\.vc$' and b !~ '^http://localhost(:[0-9]+)?$' and b !~ '^http://127\.0\.0\.1(:[0-9]+)?$' then b := 'https://pro.mimo.com.vc'; end if;
  link := b || '/ativar/' || t;
  update public.acessos_equipe set enviado_em = now() where token = t;
  return jsonb_build_object('ok', true, 'telefone', p.phone, 'nome', p.name, 'link', link,
    'texto', format(E'Oi, %s! Aqui é a MIMO, o sistema de agenda do %s.\n\nO salão já deixou a sua agenda pronta. Para ativar, abra o link e crie a sua senha:\n%s\n\nVocê entra com o e-mail %s.',
      split_part(p.name, ' ', 1), s.name, link, p.email));
end;
$$;
revoke execute on function public.acesso_convite_whats(uuid, text) from public, anon;
grant execute on function public.acesso_convite_whats(uuid, text) to authenticated;

notify pgrst, 'reload schema';
