-- 272 · O convite da equipe também por WhatsApp, e a senha criada no próprio link (4.38)
--
-- 1. acesso_convite_whats(prof, base): o salão escolhe mandar o acesso da profissional pelo WhatsApp. Esta função só
--    confere (é administradora do salão, a ficha está esperando ativação, tem e-mail e WhatsApp), marca o envio e
--    devolve o número e o texto; quem manda é a função do servidor `acesso` (ação convite_whats), pelo WhatsApp da MIMO.
-- 2. Nada muda nas regras de ativar: a conta continua sendo a do e-mail que o salão cadastrou (232). O que muda é no
--    servidor (`acesso`, ação convite_criar): abrir o link já prova que o convite chegou nela, então a conta nasce com
--    o e-mail confirmado e ela cria a senha na mesma tela, sem o segundo e-mail de confirmação.

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
