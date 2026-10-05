-- 147 · A dona que também atende (2.99)
--
-- Uma profissional que é dona do próprio salão e também atende na cadeira
-- não precisa mais escolher entre "autônoma" (sem equipe) e "salão" (só
-- administradora). Dentro da licença Salão ela responde "eu também
-- atendo" e ganha a própria agenda: uma ficha em professionals ligada ao
-- login dela (user_id = owner_id), que equipe_da_casa já marca como dona.
-- Sem convite, sem segundo login. Conta como uma agenda do plano.
--
--   salons.dona_atende              null = ainda não respondeu; true/false
--   dona_atender(salao, atende)     cria/religa a ficha dela (ou a inativa)
--
-- Só a dona (owner_id) decide. Se já existia uma ficha sem conta com o
-- telefone dela (cadastrada "na mão"), a gente liga essa em vez de duplicar.

alter table public.salons add column if not exists dona_atende boolean;

create or replace function public.dona_atender(salao uuid, atende boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype; prof uuid; nome text; fone text; e164 text; base text; sl text; i integer := 0;
begin
  select * into s from public.salons where id = salao;
  if s.id is null then raise exception 'Salão não encontrado.'; end if;
  if s.owner_id is null or s.owner_id <> auth.uid() then raise exception 'Só a dona do salão decide isso.'; end if;

  select id into prof from public.professionals where salon_id = salao and user_id = s.owner_id order by created_at limit 1;

  if atende then
    if prof is null then
      select full_name, phone into nome, fone from public.profiles where id = s.owner_id;
      -- uma ficha sem conta com o telefone dela? é ela: liga em vez de duplicar
      e164 := public.telefone_e164(fone);
      if e164 is not null then
        select id into prof from public.professionals p
         where p.salon_id = salao and p.user_id is null and p.situacao <> 'inativa' and public.telefone_e164(p.phone) = e164
         order by created_at limit 1;
      end if;
      if prof is not null then
        update public.professionals
           set user_id = s.owner_id, situacao = 'ativa', ativada_em = coalesce(ativada_em, now())
         where id = prof;
      else
        base := coalesce(nullif(public.slug_de(coalesce(nome, s.name)), ''), 'profissional'); sl := base;
        while exists (select 1 from public.professionals where slug = sl) loop i := i + 1; sl := base || '-' || i; end loop;
        insert into public.professionals (salon_id, user_id, name, slug, phone, situacao, ativada_em, usa_horario_salao)
        values (salao, s.owner_id, coalesce(nullif(btrim(nome), ''), 'Você'), sl, fone, 'ativa', now(), true)
        returning id into prof;
      end if;
    else
      update public.professionals
         set situacao = case when situacao = 'inativa' then 'ativa' else situacao end,
             ativada_em = coalesce(ativada_em, now())
       where id = prof;
    end if;
  elsif prof is not null then
    update public.professionals set situacao = 'inativa' where id = prof;
  end if;

  update public.salons set dona_atende = atende where id = salao;
  return jsonb_build_object('ok', true, 'professional_id', prof, 'atende', atende);
end;
$$;
revoke execute on function public.dona_atender(uuid, boolean) from public, anon;
grant execute on function public.dona_atender(uuid, boolean) to authenticated;
