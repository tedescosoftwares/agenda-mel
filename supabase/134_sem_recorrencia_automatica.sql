-- 134 · trava de segurança: nenhuma cobrança recorrente automática (2.81)
--
-- A infraestrutura antiga de recorrência fica preservada para uma evolução
-- futura, mas esta versão não pode disparar cartão/Pix sozinha. A única forma
-- de criar cobrança da MIMO é a dona apertar Pix ou Cartão nas telas manuais.

create or replace function public.chutar_assinaturas()
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object('ok', true, 'desativado', true, 'motivo', 'pagamentos da MIMO são manuais nesta versão');
$$;
revoke execute on function public.chutar_assinaturas() from public, anon, authenticated;

create or replace function public.cobranca_mimo_falhou(cobranca uuid, motivo text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare c public.cobrancas_mimo%rowtype; s public.salons%rowtype;
begin
  if auth.uid() is not null and not public.eh_plataforma() then raise exception 'Só a plataforma.'; end if;
  select * into c from public.cobrancas_mimo where id = cobranca;
  if c.id is null or c.status = 'pago' then return; end if;

  update public.cobrancas_mimo
     set status = 'falhou', erro = left(motivo, 300),
         tentativas = tentativas + 1, atualizado_em = now()
   where id = cobranca;

  select * into s from public.salons where id = c.salon_id;
  if s.owner_id is not null then
    begin
      perform public.notificar(
        s.owner_id,
        'cobranca_falhou',
        'Não deu para concluir o pagamento',
        format('%s: o pagamento não foi confirmado. Tente novamente ou escolha outra forma de pagamento.', s.name),
        case when c.tipo = 'inicial' then '/admin/configurar?etapa=ativacao' else '/admin/assinatura' end,
        jsonb_build_object('salon_id', s.id, 'cobranca', c.id)
      );
    exception when others then null;
    end;
  end if;
end;
$$;
revoke execute on function public.cobranca_mimo_falhou(uuid, text) from public, anon, authenticated;
