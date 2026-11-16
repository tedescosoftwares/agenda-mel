-- 226 · O robô do salão fala "a partir de" (3.80)
--
-- O cadastro de serviço ganhou a opção "a partir de" em todos os formulários (o campo services.a_partir existe
-- desde a 119; só o Onboarding marcava). A cliente vê "a partir de R$ X" na vitrine, na marcação e no app; aqui,
-- o robô do WhatsApp do salão (o agente, 069) recebe o a_partir em listar_servicos e diz "a partir de" em vez de
-- dar o preço como fechado. O resto é o da 069, igual.

create or replace function public.bot_servicos(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'servico_id', s.id, 'nome', s.name, 'preco', s.price, 'a_partir', coalesce(s.a_partir, false), 'minutos', s.duration_minutes,
           'profissionais', (select coalesce(jsonb_agg(jsonb_build_object('profissional_id', p.id, 'nome', p.name)), '[]'::jsonb)
                              from public.professional_services ps join public.professionals p on p.id = ps.professional_id
                             where ps.service_id = s.id and p.active)) order by s.name), '[]'::jsonb)
  from public.services s where s.salon_id = salao and s.active;
$$;
revoke execute on function public.bot_servicos(uuid) from public, anon, authenticated;

do $$ begin raise notice '226: o robô do salão fala "a partir de" (bot_servicos com a_partir)'; end $$;
