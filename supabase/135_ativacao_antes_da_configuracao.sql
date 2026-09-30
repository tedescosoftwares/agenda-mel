-- 135 · ativação vem antes da configuração operacional
--
-- O cadastro inicial termina, a MIMO prepara o espaço e a dona escolhe
-- 7 dias grátis OU 20% na primeira mensalidade. Serviços e equipe são
-- configurados depois, já dentro do painel, guiados pelos Primeiros Passos.
-- Portanto a decisão comercial não depende mais de serviço/profissional.

create or replace function public.ativacao_inicial_preparar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then
    raise exception 'Só a dona prepara a ativação.';
  end if;

  select * into s from public.salons where id = salao for update;
  if not found then raise exception 'Salão não encontrado.'; end if;
  if s.tipo = 'autonoma' then return public.ativacao_inicial_estado(salao); end if;
  if s.onboarding_concluido_em is null then raise exception 'Conclua o cadastro antes de ativar.'; end if;
  if s.ativado_em is not null then return public.ativacao_inicial_estado(salao); end if;

  update public.salons
     set ativacao_pendente_em = coalesce(ativacao_pendente_em, now())
   where id = salao;

  return public.ativacao_inicial_estado(salao);
end;
$$;

revoke execute on function public.ativacao_inicial_preparar(uuid) from public, anon;
grant execute on function public.ativacao_inicial_preparar(uuid) to authenticated;
