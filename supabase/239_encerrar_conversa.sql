-- 239 · A assistente encerra conversa ofensiva ou fora do assunto (3.95.4)
--
-- Conversa sadia (onde fica, que horas abre, quanto custa, marcar) segue normal. Fora do assunto, ela diz com gentileza
-- que só ajuda com o salão; se a pessoa insistir, encerra. Ofensiva, assédio, ameaça, golpe, conteúdo sexual ou pedido
-- para ela ignorar as regras: encerra na hora, com uma despedida educada. Encerrar (bot_encerrar) é uma pausa em
-- bot_pausas com motivo 'encerrada: ...': fora do assunto, 6 horas; o resto, 24 horas. Durante a pausa nada responde
-- sozinho (nem a IA, nem as regras): a mensagem fica registrada como 'conversa_encerrada' e nenhum token é gasto. Só
-- passam o SAIR e o 1/2 do lembrete, como com a assistente desligada (237).

create or replace function public.bot_encerrar(salao uuid, tel text, motivo text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  m text := case when motivo in ('ofensiva', 'fora_do_assunto', 'politica') then motivo else 'ofensiva' end;
  ate_ timestamptz := now() + case when m = 'fora_do_assunto' then interval '6 hours' else interval '24 hours' end;
begin
  if e164 is null then return jsonb_build_object('erro', 'telefone inválido'); end if;
  insert into public.bot_pausas (telefone, salon_id, ate, motivo)
  values (e164, salao, ate_, 'encerrada: ' || m)
  on conflict (telefone, salon_id) do update set ate = greatest(public.bot_pausas.ate, excluded.ate), motivo = excluded.motivo;
  delete from public.assistente_esperas e where e.salon_id = salao and e.telefone = e164;
  return jsonb_build_object('ok', true, 'motivo', m, 'ate', ate_);
end;
$$;
revoke execute on function public.bot_encerrar(uuid, text, text) from public, anon, authenticated;

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
  -- 239: a conversa que a assistente encerrou (ofensiva, fora do assunto) também fica em silêncio até a pausa acabar
  if salao is not null and (
       not coalesce((select c.usa_ia and c.numero_proprio from public.whatsapp_channels c where c.salon_id = salao), false)
       or exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now() and p.motivo like 'encerrada%')) then
    acao := public.interpretar_resposta(texto);
    if acao in ('sair', 'confirma', 'cancela', 'remarca') then
      r := public.receber_resposta_whatsapp(e164, texto, id_provedor, id_enquete, null, salao);
      if (r ->> 'acao') in ('sair', 'confirmado', 'cancelado', 'remarcado', 'voto_repetido') then return r; end if;
      return r - 'responder';   -- não era resposta a um lembrete: fica registrada, sem resposta
    end if;
    if exists (select 1 from public.bot_pausas p where p.telefone = e164 and p.salon_id = salao and p.ate > now() and p.motivo like 'encerrada%') then
      insert into public.whatsapp_inbox (telefone, texto, provider_id, client_id, acao, enquete_id, via)
      values (e164, texto, id_provedor, public.cliente_pelo_telefone(e164), 'conversa_encerrada', id_enquete, 'regra');
      return jsonb_build_object('acao', 'conversa_encerrada');
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

create or replace function public.assistente_numeros(salao uuid, dias integer default 30)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare r jsonb; desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias, 30), 365)));
begin
  if not public.is_admin_do_salao(salao) and not public.eh_plataforma() then raise exception 'só quem administra o salão'; end if;
  select jsonb_build_object(
    'dias', greatest(1, least(coalesce(dias, 30), 365)),
    'conversas', count(distinct i.telefone) filter (where i.erro is null),
    'respostas', count(*) filter (where i.erro is null and coalesce(i.respondeu, true)),
    'marcou', coalesce(sum((i.acoes ->> 'marcou')::int), 0),
    'remarcou', coalesce(sum((i.acoes ->> 'remarcou')::int), 0),
    'cancelou', coalesce(sum((i.acoes ->> 'cancelou')::int), 0),
    'chamou', coalesce(sum((i.acoes ->> 'chamou')::int), 0),
    'encerrou', coalesce(sum((i.acoes ->> 'encerrou')::int), 0),
    'falhas', count(*) filter (where i.erro is not null),
    'custo_usd', coalesce(sum(i.custo_usd), 0),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d.dia, 'n', d.n) order by d.dia)
                           from (select (x.criado_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
                                   from public.ia_chamadas x
                                  where x.salon_id = salao and not x.ensaio and x.erro is null and x.criado_em >= desde
                                  group by 1) d), '[]'::jsonb))
    into r
  from public.ia_chamadas i
  where i.salon_id = salao and not i.ensaio and i.criado_em >= desde;
  return r;
end;
$$;
revoke execute on function public.assistente_numeros(uuid, integer) from public, anon;
grant execute on function public.assistente_numeros(uuid, integer) to authenticated;
