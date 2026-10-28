-- 221_mel_sobre_a_agenda.sql
-- 3.76 — O número da Mel é das clientes. Quem escreve para ela querendo saber da MIMO Agenda (a dona ou a profissional
-- que viu o guia, quem quer contratar ou colocar o salão na MIMO) recebe o link do WhatsApp comercial (218), já com a
-- frase "Vim pela Mel" (a assistente marca a origem "mel"); com o comercial desligado, o site. A Mel percebe pelas frases
-- que não deixam dúvida e, no meio de uma conversa de salão, pela IA (o campo sobre_agenda). A conversa não fecha: se era
-- uma cliente, ela segue marcando. A equipe não é avisada (o comercial cuida).
-- Os gatilhos do agente de onboarding (203), com o comercial ligado, também vão para o comercial; o agente volta a atender
-- quando o comercial é desligado (e as conversas de onboarding já abertas seguem até o fim); o guia_onboarding_contexto
-- passa a levar o interruptor (mel.sobre_agenda), para o agente saber se os gatilhos vão para o comercial.
--   sobre_agenda            liga/desliga o encaminhamento (ligado por padrão)
--   msg_sobre_agenda        o texto com o comercial ligado: {nome} (a assistente), {link} (o WhatsApp comercial), {marcar}
--   msg_sobre_agenda_site   o texto com o comercial desligado: {link} (o site), {marcar}
-- {marcar} é a volta para a cliente: "se você queria marcar um horário…" (com o salão da conversa, quando há).
-- Depois: publicar whatsapp-webhook, guia-whats e comercial (bat 9) e o site (bat 2).

alter table public.guia_whats_config add column if not exists sobre_agenda boolean not null default true;
alter table public.guia_whats_config add column if not exists msg_sobre_agenda text not null
  default $m$Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), quem atende é a {nome}, no WhatsApp comercial da MIMO: {link}

{marcar}$m$
  check (length(msg_sobre_agenda) between 10 and 2000 and position('{link}' in msg_sobre_agenda) > 0);
alter table public.guia_whats_config add column if not exists msg_sobre_agenda_site text not null
  default $m$Esse número é o da Mel, para clientes que marcam horário pelos salões do guia 💗 Para saber da MIMO Agenda (como funciona, os planos, como colocar o seu salão), é por aqui: {link}

{marcar}$m$
  check (length(msg_sobre_agenda_site) between 10 and 2000 and position('{link}' in msg_sobre_agenda_site) > 0);

comment on column public.guia_whats_config.sobre_agenda is 'Mel (221): quem pergunta da MIMO Agenda recebe o link do WhatsApp comercial (ou do site, com o comercial desligado).';
comment on column public.guia_whats_config.msg_sobre_agenda is 'Mel (221): o texto para quem pergunta da MIMO Agenda, com o comercial ligado ({nome}, {link}, {marcar}).';
comment on column public.guia_whats_config.msg_sobre_agenda_site is 'Mel (221): o texto para quem pergunta da MIMO Agenda, com o comercial desligado ({link} = o site, {marcar}).';

-- a Plataforma salva os três campos novos (o resto é a 205, igual)
create or replace function public.guia_whats_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text;
  avisos text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o WhatsApp do guia'; end if;
  if c ? 'numero' then
    num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), '');
    if num is not null and length(num) in (10, 11) then num := '55' || num; end if;
    if num is not null and num !~ '^[1-9][0-9]{9,14}$' then raise exception 'número inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  if c ? 'numero_avisos' then
    avisos := nullif(regexp_replace(coalesce(c ->> 'numero_avisos', ''), '\D', '', 'g'), '');
    if avisos is not null and length(avisos) in (10, 11) then avisos := '55' || avisos; end if;
    if avisos is not null and avisos !~ '^[1-9][0-9]{9,14}$' then raise exception 'número de avisos inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_whats_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      numero = case when c ? 'numero' then num else g.numero end,
      numero_avisos = case when c ? 'numero_avisos' then avisos else g.numero_avisos end,
      instancia = coalesce(nullif(lower(btrim(c ->> 'instancia')), ''), g.instancia),
      botoes = case when c ? 'botoes' then array(select distinct x from jsonb_array_elements_text(c -> 'botoes') x order by 1) else g.botoes end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      msg_cliente = coalesce(nullif(btrim(c ->> 'msg_cliente'), ''), g.msg_cliente),
      msg_salao = coalesce(nullif(btrim(c ->> 'msg_salao'), ''), g.msg_salao),
      msg_salao_resposta = coalesce(nullif(btrim(c ->> 'msg_salao_resposta'), ''), g.msg_salao_resposta),
      msg_encerramento = coalesce(nullif(btrim(c ->> 'msg_encerramento'), ''), g.msg_encerramento),
      msg_ocioso = coalesce(nullif(btrim(c ->> 'msg_ocioso'), ''), g.msg_ocioso),
      msg_dona = coalesce(nullif(btrim(c ->> 'msg_dona'), ''), g.msg_dona),
      sobre_agenda = coalesce((c ->> 'sobre_agenda')::boolean, g.sobre_agenda),
      msg_sobre_agenda = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda'), ''), g.msg_sobre_agenda),
      msg_sobre_agenda_site = coalesce(nullif(btrim(c ->> 'msg_sobre_agenda_site'), ''), g.msg_sobre_agenda_site),
      enquete_ativa = coalesce((c ->> 'enquete_ativa')::boolean, g.enquete_ativa),
      enquete_pergunta = coalesce(nullif(btrim(c ->> 'enquete_pergunta'), ''), g.enquete_pergunta),
      enquete_sim = coalesce(nullif(btrim(c ->> 'enquete_sim'), ''), g.enquete_sim),
      enquete_nao = coalesce(nullif(btrim(c ->> 'enquete_nao'), ''), g.enquete_nao),
      msg_salao_vai_atender = coalesce(nullif(btrim(c ->> 'msg_salao_vai_atender'), ''), g.msg_salao_vai_atender),
      msg_salao_nao_atende = coalesce(nullif(btrim(c ->> 'msg_salao_nao_atende'), ''), g.msg_salao_nao_atende),
      avisar_cliente_nao = coalesce((c ->> 'avisar_cliente_nao')::boolean, g.avisar_cliente_nao),
      msg_cliente_nao_atende = coalesce(nullif(btrim(c ->> 'msg_cliente_nao_atende'), ''), g.msg_cliente_nao_atende),
      aviso_nao_atende = coalesce((c ->> 'aviso_nao_atende')::boolean, g.aviso_nao_atende),
      msg_aviso_nao_atende = coalesce(nullif(btrim(c ->> 'msg_aviso_nao_atende'), ''), g.msg_aviso_nao_atende),
      aviso_demora_min = coalesce((c ->> 'aviso_demora_min')::integer, g.aviso_demora_min),
      msg_aviso_demora = coalesce(nullif(btrim(c ->> 'msg_aviso_demora'), ''), g.msg_aviso_demora),
      cutucar_salao_min = coalesce((c ->> 'cutucar_salao_min')::integer, g.cutucar_salao_min),
      msg_cutucar_salao = coalesce(nullif(btrim(c ->> 'msg_cutucar_salao'), ''), g.msg_cutucar_salao),
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      exigir_preferencia = coalesce((c ->> 'exigir_preferencia')::boolean, g.exigir_preferencia),
      ocioso_ativo = coalesce((c ->> 'ocioso_ativo')::boolean, g.ocioso_ativo),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
      pos_envio = coalesce((c ->> 'pos_envio')::integer, g.pos_envio),
      max_sem_avanco = coalesce((c ->> 'max_sem_avanco')::integer, g.max_sem_avanco),
      ocioso_horas = coalesce((c ->> 'ocioso_horas')::integer, g.ocioso_horas),
      ocioso_perguntar_min = coalesce((c ->> 'ocioso_perguntar_min')::integer, g.ocioso_perguntar_min),
      ocioso_encerrar_min = coalesce((c ->> 'ocioso_encerrar_min')::integer, g.ocioso_encerrar_min),
      retencao_dias = coalesce((c ->> 'retencao_dias')::integer, g.retencao_dias),
      atualizado_em = now(), atualizado_por = auth.uid()
     where g.id = 1;
  exception
    when check_violation then
      raise exception '%', case
        when sqlerrm ~ 'instancia' then 'instância inválida: letras minúsculas, números, - e _ (2 a 40)'
        when sqlerrm ~ 'botoes' then 'botões: whatsapp, ligar ou quero_marcar'
        when sqlerrm ~ 'provedor' then 'IA: groq ou claude'
        when sqlerrm ~ 'modelo' then 'modelo inválido'
        when sqlerrm ~ 'numero_avisos' then 'número de avisos inválido: use DDD e número'
        when sqlerrm ~ 'enquete_pergunta' then 'a pergunta da enquete: de 3 a 200 letras'
        when sqlerrm ~ 'enquete_(sim|nao)' then 'cada opção da enquete: de 2 a 60 letras'
        when sqlerrm ~ 'aviso_demora_min' then 'avisar a equipe da demora: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'cutucar_salao_min' then 'cutucar o salão: 0 (desligado) ou de 5 a 10080 minutos'
        when sqlerrm ~ 'limite_respostas' then 'respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'pos_envio' then 'dúvidas depois do envio: de 0 a 20'
        when sqlerrm ~ 'max_sem_avanco' then 'mensagens sem avançar antes de encerrar: de 2 a 50'
        when sqlerrm ~ 'ocioso_perguntar_min' then 'minutos parada antes de perguntar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_encerrar_min' then 'minutos desde a pergunta antes de encerrar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_horas' then 'horas para esquecer a conversa parada: de 1 a 168'
        when sqlerrm ~ 'retencao_dias' then 'guardar as conversas: de 7 a 730 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação da Mel: de 20 a 6000 letras'
        when sqlerrm ~ 'msg_dona' then 'a mensagem da dona: de 10 a 4000 letras'
        when sqlerrm ~ 'msg_sobre_agenda_site' then 'a mensagem da MIMO Agenda com o comercial desligado: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_sobre_agenda' then 'a mensagem da MIMO Agenda: de 10 a 2000 letras, com {link}'
        when sqlerrm ~ 'msg_' then 'mensagem curta ou longa demais'
        else sqlerrm end;
    when invalid_text_representation then raise exception 'valor inválido num campo de número ou sim/não';
  end;
  if (select ligado and numero is null from public.guia_whats_config where id = 1) then
    update public.guia_whats_config set ligado = false where id = 1;
    raise exception 'para ligar, informe o número do WhatsApp do guia';
  end if;
  return (select to_jsonb(g) from public.guia_whats_config g where g.id = 1);
end $$;

-- o contexto do agente de onboarding leva o interruptor: com ele desligado, os gatilhos voltam para o agente mesmo com o
-- comercial ligado (o resto é a 203, igual)
create or replace function public.guia_onboarding_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_onboarding_leads;
begin
  if random() < 0.02 then
    delete from public.guia_onboarding_leads where (teste and atualizada_em < now() - interval '1 day')
       or (estado in ('encerrada', 'concluido') and atualizada_em < now() - interval '180 days');
  end if;
  select * into cv from public.guia_onboarding_leads c
   where c.chave = k and c.estado not in ('encerrada', 'concluido') and c.atualizada_em > now() - interval '48 hours'
   order by c.atualizada_em desc limit 1;
  return jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_onboarding_config c where c.id = 1),
    'mel', (select jsonb_build_object('ligado', w.ligado, 'numero', w.numero, 'instancia', w.instancia, 'numero_avisos', w.numero_avisos, 'sobre_agenda', w.sobre_agenda) from public.guia_whats_config w where w.id = 1),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' end);
end $$;

do $$ begin raise notice '221: a Mel manda para o comercial quem pergunta da MIMO Agenda (sobre_agenda, msg_sobre_agenda, msg_sobre_agenda_site)'; end $$;
