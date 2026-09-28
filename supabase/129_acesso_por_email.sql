-- 129 · O acesso da profissional chega por e-mail
--
-- Antes o salão mandava o link pelo WhatsApp e a profissional tinha de
-- "confirmar o WhatsApp" digitando o número que o salão cadastrou: dava
-- erro com número certo e não provava nada. Agora:
--   1. o salão cadastra o e-mail dela e toca em "Enviar acesso": a MIMO
--      manda o e-mail com o link (acesso_enviar) e o salão pode avisar
--      no WhatsApp pra ela olhar o e-mail;
--   2. ela abre o link, cria a senha (ou entra) e a agenda ativa. O link
--      é o segredo; nada de digitar telefone pra conferir.

-- o e-mail dela vai junto pro link poder pré-preencher o cadastro
create or replace function public.acesso_por_token(token text)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'salao', jsonb_build_object('id', s.id, 'nome', s.name, 'logo_url', s.logo_url, 'cidade', s.city),
    'profissional', jsonb_build_object('id', p.id, 'nome', p.name, 'especialidade', p.especialidade, 'vinculo', p.vinculo, 'foto', p.photo_url,
      'email', p.email, 'telefone', p.phone,
      'telefone_final', right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 4),
      'servicos', (select count(*) from public.professional_services ps join public.services sv on sv.id = ps.service_id and sv.active where ps.professional_id = p.id),
      'dias', (select coalesce(jsonb_agg(h.weekday order by h.weekday), '[]'::jsonb) from public.professional_hours h where h.professional_id = p.id and h.open)),
    'situacao', p.situacao, 'tem_conta', p.user_id is not null, 'usado', a.usado_em is not null)
  from public.acessos_equipe a
  join public.professionals p on p.id = a.professional_id
  join public.salons s on s.id = p.salon_id
  where a.token = lower(btrim(token));
$$;
grant execute on function public.acesso_por_token(text) to anon, authenticated;

-- ativar: quem tem o link é ela. O telefone e o e-mail da conta passam a
-- valer na ficha (é por eles que os avisos chegam).
create or replace function public.ativar_acesso_interno(conta uuid, token text, fone text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare a public.acessos_equipe%rowtype; p public.professionals%rowtype; s public.salons%rowtype; papel_atual text; outra uuid; tel text; em text;
begin
  select * into a from public.acessos_equipe where acessos_equipe.token = lower(btrim(ativar_acesso_interno.token));
  if a.token is null then raise exception 'Link de acesso não encontrado.'; end if;
  select * into p from public.professionals where id = a.professional_id;
  select * into s from public.salons where id = p.salon_id;
  if p.user_id is not null and p.user_id = conta then
    return jsonb_build_object('ok', true, 'ja', true, 'salao', s.name, 'professional_id', p.id, 'situacao', p.situacao);
  end if;
  if a.usado_em is not null or p.user_id is not null then raise exception 'Esse link já foi usado. Entre com a sua conta.'; end if;
  if p.situacao = 'inativa' then raise exception 'Essa agenda está desativada. Fale com o salão.'; end if;
  select role into papel_atual from public.profiles where id = conta;
  if papel_atual in ('admin', 'plataforma') or exists (select 1 from public.salons x where x.owner_id = conta) then
    raise exception 'Essa conta já é dona de um negócio. Pra entrar numa equipe, use outra conta.';
  end if;
  select id into outra from public.professionals where user_id = conta and id <> p.id;
  if outra is not null then raise exception 'Essa conta já tem agenda em outro salão.'; end if;

  select nullif(btrim(coalesce(fone, pr.phone)), '') into tel from public.profiles pr where pr.id = conta;
  select u.email into em from auth.users u where u.id = conta;
  update public.professionals set user_id = conta, situacao = 'ativa', phone = coalesce(tel, phone), email = coalesce(em, email) where id = p.id;
  insert into public.salon_members (salon_id, user_id, papel) values (p.salon_id, conta, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = conta and role = 'cliente';
  update public.acessos_equipe set usado_em = now() where acessos_equipe.token = a.token;
  return jsonb_build_object('ok', true, 'salao', s.name, 'salao_id', s.id, 'professional_id', p.id, 'situacao', 'ativa');
end;
$$;
revoke execute on function public.ativar_acesso_interno(uuid, text, text) from public, anon, authenticated;

-- o texto do e-mail de acesso
create or replace function public.email_acesso_equipe(nome text, salao text, quem text, servicos integer, link text)
returns table (assunto text, html text, texto text)
language plpgsql
immutable
as $$
declare e record; corpo text;
begin
  corpo := format('%s configurou a sua agenda na MIMO: %s. Você não precisa escolher serviço, preço nem horário, está tudo pronto. É só abrir o link, criar a sua senha e entrar.',
    salao, case when coalesce(servicos, 0) = 1 then '1 serviço' else coalesce(servicos, 0) || ' serviços' end);
  if nullif(btrim(coalesce(quem, '')), '') is not null then corpo := corpo || format(' Quem te adicionou foi %s.', quem); end if;
  select * into e from public.email_aviso(nome, format('Sua agenda no %s está pronta', salao), corpo, 'Ativar meu acesso', link);
  return query select e.assunto, e.html, e.texto;
end;
$$;

-- o salão manda o acesso: e-mail com o link (e devolve o texto pro WhatsApp)
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
