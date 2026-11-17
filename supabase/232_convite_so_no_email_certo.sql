-- 232 · O convite da equipe só ativa na conta do e-mail convidado (3.89.2)
--
-- O link /ativar/<token> era o único segredo: quem o tivesse, com qualquer conta da MIMO ("Já tenho conta"), ligava a
-- agenda daquela profissional à própria conta e entrava na equipe do salão. Agora, quando a profissional tem e-mail
-- cadastrado (o acesso chega por ele, 129), só a conta com esse mesmo e-mail ativa; a mensagem mostra o e-mail pela
-- metade. Sem e-mail cadastrado (fichas antigas), segue como antes. Vale para o "Ativar meu acesso" e para o cadastro
-- feito pelo link (handle_new_user chama esta mesma função).

CREATE OR REPLACE FUNCTION public.ativar_acesso_interno(conta uuid, token text, fone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 232: o convite é de um e-mail. Só a conta desse e-mail ativa (antes, quem tivesse o link e qualquer conta levava a agenda)
  select u.email into em from auth.users u where u.id = conta;
  if nullif(btrim(coalesce(p.email, '')), '') is not null and lower(btrim(p.email)) <> lower(btrim(coalesce(em, ''))) then
    raise exception 'Este convite é para %. Entre (ou crie a conta) com esse e-mail. Se o e-mail estiver errado, peça ao salão para corrigir e mandar o acesso de novo.',
      left(split_part(p.email, '@', 1), 2) || '•••@' || split_part(p.email, '@', 2);
  end if;
  select role into papel_atual from public.profiles where id = conta;
  if papel_atual in ('admin', 'plataforma') or exists (select 1 from public.salons x where x.owner_id = conta) then
    raise exception 'Essa conta já é dona de um negócio. Pra entrar numa equipe, use outra conta.';
  end if;
  select id into outra from public.professionals where user_id = conta and id <> p.id;
  if outra is not null then raise exception 'Essa conta já tem agenda em outro salão.'; end if;

  select nullif(btrim(coalesce(fone, pr.phone)), '') into tel from public.profiles pr where pr.id = conta;
  update public.professionals set user_id = conta, situacao = 'ativa', phone = coalesce(tel, phone), email = coalesce(em, email) where id = p.id;
  insert into public.salon_members (salon_id, user_id, papel) values (p.salon_id, conta, 'profissional') on conflict do nothing;
  update public.profiles set role = 'profissional' where id = conta and role = 'cliente';
  update public.acessos_equipe set usado_em = now() where acessos_equipe.token = a.token;
  return jsonb_build_object('ok', true, 'salao', s.name, 'salao_id', s.id, 'professional_id', p.id, 'situacao', 'ativa');
end;
$function$;

do $$ begin raise notice '232: o convite da equipe só ativa na conta do e-mail convidado'; end $$;
