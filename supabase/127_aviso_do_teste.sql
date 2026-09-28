-- 127 · Quando o teste começa, a dona fica sabendo
--
-- `salao_ativar` (126) passa a avisar no app, no push e no WhatsApp que os
-- 7 dias grátis começaram e quando acabam, com o link pra ver o plano.

insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values ('teste_comecou', true, 'utilidade', null)
on conflict (kind) do nothing;

create or replace function public.salao_ativar(salao uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  s public.salons%rowtype;
  r jsonb := public.regras_da_assinatura();
  nova boolean := false;
  ate timestamptz;
begin
  if not (public.is_admin_do_salao(salao) or public.eh_plataforma()) then raise exception 'Só a dona ativa o salão.'; end if;
  select * into s from public.salons where id = salao;
  if not found then raise exception 'Salão não encontrado.'; end if;
  update public.salons set ativado_em = coalesce(ativado_em, now()) where id = salao;
  if s.tipo <> 'autonoma' then
    ate := now() + make_interval(days => (r ->> 'teste_dias')::int);
    insert into public.assinaturas (salon_id, situacao, teste_ate, avisos)
    values (salao, 'teste', ate, jsonb_build_object('comecou', now()))
    on conflict (salon_id) do nothing;
    nova := found;
    if nova and s.owner_id is not null then
      begin
        perform public.notificar(s.owner_id, 'teste_comecou', 'Seu teste grátis começou',
          format('%s está ativo com %s dias grátis, até %s. Sem cartão: você só assina se quiser continuar.', s.name, r ->> 'teste_dias', to_char(ate, 'DD/MM')),
          '/admin/assinatura', jsonb_build_object('salon_id', salao));
      exception when others then null;
      end;
    end if;
  end if;
  return public.acesso_do_salao(salao);
end;
$$;
revoke execute on function public.salao_ativar(uuid) from public, anon;
grant execute on function public.salao_ativar(uuid) to authenticated;
