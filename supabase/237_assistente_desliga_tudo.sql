-- 237 · A chave da assistente desliga tudo (3.95.2)
--
-- Antes, a chave da tela Assistente do WhatsApp (whatsapp_channels.usa_ia) só desligava a IA: as respostas por regra
-- continuavam saindo sozinhas (o menu de marcar, o "não entendi", o link para quem não tem cadastro). Agora, com a
-- assistente desligada (ou sem o WhatsApp do salão conectado), nada responde sozinho à cliente: a mensagem fica
-- registrada (whatsapp_inbox, acao 'assistente_desligada') e a equipe responde pelo celular. Continuam valendo só as
-- respostas a perguntas que nós mesmos mandamos: o 1/2 do lembrete (confirma ou cancela o horário), o SAIR (parar de
-- receber, que precisa valer sempre) e o aceite da profissional (1/2 ao pedido de horário).

create or replace function public.receber_mensagem(
  tel text, texto text, id_provedor text default null, id_enquete text default null,
  intencao_do_modelo text default null, salao uuid default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  pedido uuid; acao text; r jsonb; avisou boolean; extra text; base text;
begin
  if e164 is null then return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido'); end if;
  if id_provedor is not null and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select ac.appointment_id into pedido from public.aceites ac
   where ac.telefone_prof = e164 and ac.resultado is null and ac.expira_em > now()
   order by ac.pedido_em limit 1;

  if pedido is not null then
    acao := public.interpretar_resposta(texto);
    if acao = 'nada' and intencao_do_modelo is not null then acao := public.acao_da_intencao(intencao_do_modelo); end if;
    if acao in ('confirma', 'cancela', 'remarca') then
      r := public.resolver_aceite(pedido, acao = 'confirma');
      avisou := coalesce((r ->> 'avisou_cliente')::boolean, false);
      insert into public.whatsapp_inbox (telefone, texto, provider_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, 'aceite:' || coalesce(r ->> 'resultado','?'), pedido, 'regra', intencao_do_modelo);
      return jsonb_build_object('acao', 'aceite_' || coalesce(r ->> 'resultado','?'), 'appointment_id', pedido,
        'responder', public.texto_modelo('resposta.aceite_' || case when acao = 'confirma' then 'confirma' else 'recusa' end
                                          || case when avisou then '_avisou' else '_sem_aviso' end));
    end if;
  end if;

  -- 237 (3.95.2): a assistente desligada é desligada de verdade. Nenhum atendimento automático à cliente: nem a IA,
  -- nem o menu de marcar, nem o "não entendi". A mensagem fica registrada para a equipe responder pelo celular. Só vale o
  -- que responde a uma pergunta nossa: o 1/2 do lembrete e o SAIR (este sempre; o aceite da profissional, acima, também).
  if salao is not null and not coalesce((select c.usa_ia and c.numero_proprio from public.whatsapp_channels c where c.salon_id = salao), false) then
    acao := public.interpretar_resposta(texto);
    if acao in ('sair', 'confirma', 'cancela', 'remarca') then
      r := public.receber_resposta_whatsapp(e164, texto, id_provedor, id_enquete, null, salao);
      if (r ->> 'acao') in ('sair', 'confirmado', 'cancelado', 'remarcado', 'voto_repetido') then return r; end if;
      return r - 'responder';   -- não era resposta a um lembrete: fica registrada, sem resposta
    end if;
    insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id, via)
    values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'assistente_desligada', id_enquete, 'regra');
    return jsonb_build_object('acao', 'assistente_desligada');
  end if;

  select c.usa_bot into bot_ligado from public.whatsapp_channels c where c.salon_id = salao;
  select exists (select 1 from public.conversas where telefone = e164 and expira_em > now()) into tem_conversa;

  if tem_conversa or (coalesce(bot_ligado, false) and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);
    if (r ->> 'acao') <> 'sem_cadastro' then
      insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'bot:' || coalesce(r ->> 'acao', '?'),
              nullif(r ->> 'appointment_id', '')::uuid, case when tem_conversa then 'bot' else 'ia' end, intencao_do_modelo);
      return r;
    end if;
  end if;

  r := public.receber_resposta_whatsapp(e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);

  -- os dois silêncios viram resposta se a plataforma escreveu uma
  if (r ->> 'responder') is null and (r ->> 'acao') in ('sem_cadastro', 'nada') then
    base := public.app_base();
    extra := public.texto_modelo(case when (r ->> 'acao') = 'sem_cadastro' then 'bot.sem_cadastro' else 'bot.nao_entendi' end,
      jsonb_build_object('link_app', base || '/',
        'nome', (select nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') from public.profiles p where p.id = public.cliente_pelo_telefone(e164))));
    if extra is not null and btrim(extra) <> '' then r := r || jsonb_build_object('responder', extra); end if;
  end if;
  return r;
end;
$$;
revoke execute on function public.receber_mensagem(text, text, text, text, text, uuid) from public, anon, authenticated;
