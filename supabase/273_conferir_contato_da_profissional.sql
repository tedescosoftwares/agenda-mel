-- 273 · Conferir o WhatsApp e o e-mail da profissional antes de salvar a ficha (4.40)
--
-- O WhatsApp é único no cadastro inteiro (067) e cada conta tem agenda em um salão só (129). Sem conferir isso na
-- hora de cadastrar, o salão salvava a ficha, mandava o convite e a profissional só descobria o problema lá na
-- ativação, com um erro que não explicava nada. Esta função responde, para a administradora do salão, se o convite
-- vai funcionar com esse par WhatsApp + e-mail:
--
--   livre          ninguém tem conta com esse número nem com esse e-mail: ela cria a senha no link
--   tem_conta      já existe conta e ela pode entrar na equipe com a senha que tem
--   fone_de_outra  o WhatsApp já é de uma conta com outro e-mail: o convite não ativaria
--   outro_salao    a conta já tem agenda em outro salão
--   dona           a conta é dona de um negócio
--
-- Não devolve nome, e-mail nem salão de ninguém: só o caso.

create or replace function public.equipe_conferir_contato(salao uuid, fone text, email text, prof uuid default null)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  chave text := public.telefone_chave(fone);
  em text := lower(btrim(coalesce(email, '')));
  do_fone uuid; do_email uuid; conta uuid; dela uuid;
begin
  if not public.is_admin_do_salao(salao) then raise exception 'Sem permissão.'; end if;
  if prof is not null then select user_id into dela from public.professionals where id = prof and salon_id = salao; end if;
  if chave is not null then select p.id into do_fone from public.profiles p where p.phone_chave = chave limit 1; end if;
  if em <> '' then select u.id into do_email from auth.users u where lower(u.email) = em limit 1; end if;
  -- a ficha já ativada conferindo os próprios dados
  if dela is not null and coalesce(do_fone, dela) = dela and coalesce(do_email, dela) = dela then return jsonb_build_object('caso', 'livre'); end if;
  if do_fone is not null and em <> '' and do_email is distinct from do_fone then return jsonb_build_object('caso', 'fone_de_outra'); end if;
  conta := coalesce(do_fone, do_email);
  if conta is null then return jsonb_build_object('caso', 'livre'); end if;
  if exists (select 1 from public.profiles p where p.id = conta and p.role in ('admin', 'plataforma'))
     or exists (select 1 from public.salons s where s.owner_id = conta) then
    return jsonb_build_object('caso', 'dona');
  end if;
  if exists (select 1 from public.professionals x where x.user_id = conta and x.id is distinct from prof) then
    return jsonb_build_object('caso', 'outro_salao');
  end if;
  return jsonb_build_object('caso', 'tem_conta');
end;
$$;
revoke execute on function public.equipe_conferir_contato(uuid, text, text, uuid) from public, anon;
grant execute on function public.equipe_conferir_contato(uuid, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
