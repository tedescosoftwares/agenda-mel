-- 278 · As agendas liberadas voltam ao que foi pago a cada mensalidade (4.46)
--
-- A regra, como ficou combinada:
--   • mês já pago e o salão adiciona uma profissional: paga só o adicional (o Pix da diferença, 265). Nada de gerar
--     a mensalidade do mês seguinte por causa disso;
--   • tirou uma profissional: não tem reembolso; só a próxima mensalidade sai menor (a que ainda vai ser gerada, ou
--     a que já está aberta e não foi paga: 276);
--   • adicionou de novo no meio do caminho: dentro do mês que ela já pagou por essa agenda, entra sem pagar outra
--     vez, e a mensalidade aberta volta a subir.
--
-- O furo que sobrava: as agendas liberadas (salons.equipe_prevista) só subiam, nunca desciam. Quem pagou por 4,
-- tirou uma e pagou o mês seguinte por 3 continuava com 4 liberadas: recolocava a quarta no mês novo sem pagar o
-- adicional. Agora, quando uma mensalidade é paga, as liberadas passam a ser as agendas daquela cobrança (nunca
-- menos de 3, nem menos do que as que estão no ar agora).

create or replace function public.tg_liberadas_seguem_o_pago()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare ativas integer;
begin
  begin
    if new.agendas is null then return null; end if;
    select count(*) into ativas from public.professionals p where p.salon_id = new.salon_id and p.active;
    update public.salons s set equipe_prevista = greatest(3, new.agendas, ativas)
     where s.id = new.salon_id and s.tipo <> 'autonoma'
       and coalesce(s.equipe_prevista, 0) is distinct from greatest(3, new.agendas, ativas);
  exception when others then
    raise notice 'agendas liberadas de % não acompanharam o pagamento: %', new.salon_id, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function public.tg_liberadas_seguem_o_pago() from public, anon, authenticated;

drop trigger if exists cobrancas_mimo_zz_liberadas on public.cobrancas_mimo;
create trigger cobrancas_mimo_zz_liberadas after update of status on public.cobrancas_mimo
  for each row when (new.status = 'pago' and old.status is distinct from 'pago') execute function public.tg_liberadas_seguem_o_pago();
