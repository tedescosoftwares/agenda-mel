-- 071 · A fila do WhatsApp também acorda na hora
--
-- chutar_agora() (063) acordava o push e o e-mail assim que algo entrava
-- na fila, mas o WhatsApp ficava esperando a próxima batida do relógio
-- (até 60 s). Agora, se houver mensagem liberada na fila de um canal
-- ligado, a função de envio é chamada na mesma transação. O relógio
-- continua como rede de segurança.
--
-- Diagnóstico de "não chegou", nesta ordem:
--   select * from public.fila_whatsapp_recente();   o que aconteceu com as últimas
--   select public.relogio_status();                 o relógio está ligado?
create or replace function public.chutar_agora()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('agenda_mel.chutei', true), '') = '1' then return; end if;
  perform set_config('agenda_mel.chutei', '1', true);
  begin
    perform public.chutar_push();
  exception when others then null;
  end;
  begin
    perform public.chutar_emails();
  exception when others then null;
  end;
  begin
    if exists (select 1 from public.message_outbox o
               join public.whatsapp_channels c on c.salon_id = o.salon_id
               where o.status = 'na_fila' and o.liberado_em <= now() + interval '5 seconds'
                 and c.ativo and c.canal in ('evolution', 'cloud')) then
      perform public.chutar_fila();
    end if;
  exception when others then null;
  end;
end;
$$;
revoke execute on function public.chutar_agora() from public, anon, authenticated;

-- as últimas mensagens da fila e, ao lado, o que a função de envio
-- respondeu (pg_net guarda as respostas em net._http_response)
create or replace function public.fila_whatsapp_recente(quantas integer default 10)
returns table (criado_em timestamptz, kind text, telefone text, canal text, instancia text, canal_ativo boolean,
               status text, tentativas integer, erro text, enviado_em timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select o.criado_em, o.kind, o.telefone, o.canal, c.identificador, c.ativo,
         o.status, o.tentativas, o.erro, o.enviado_em
  from public.message_outbox o
  left join public.whatsapp_channels c on c.salon_id = o.salon_id
  where public.eh_plataforma() or auth.uid() is null
  order by o.criado_em desc
  limit greatest(1, least(coalesce(quantas, 10), 100));
$$;
revoke execute on function public.fila_whatsapp_recente(integer) from public, anon;
grant execute on function public.fila_whatsapp_recente(integer) to authenticated;
