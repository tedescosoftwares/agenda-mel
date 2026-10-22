-- 199: o ciclo da conversa da Mel, configurável pela Plataforma (3.51)
-- Até aqui alguns números do comportamento da Mel eram fixos no código (3 dúvidas depois do envio, 24 h para a conversa
-- "esquecer", e nada que encerrasse um vai-e-vem sem avançar). Agora tudo isso é configurável na aba WhatsApp:
--   pos_envio          — depois de enviar o pedido, quantas dúvidas a Mel ainda responde (antes era fixo 3)
--   max_sem_avanco     — quantas mensagens a Mel responde sem a conversa andar (sem dado novo) antes de encerrar
--   ocioso_horas       — depois de quantas horas em silêncio a conversa é dada por encerrada (a cliente recomeça)
--   msg_encerramento   — a mensagem com que a Mel encerra (por não andar) e se despede
--   exigir_preferencia — se precisa da preferência de dia/horário para enviar, ou se basta nome e serviço
-- Tudo idempotente (add column if not exists / create or replace). Não mexe no texto da orientação (campo livre).

alter table public.guia_whats_config add column if not exists pos_envio integer not null default 3 check (pos_envio between 0 and 20);
alter table public.guia_whats_config add column if not exists max_sem_avanco integer not null default 6 check (max_sem_avanco between 2 and 50);
alter table public.guia_whats_config add column if not exists ocioso_horas integer not null default 24 check (ocioso_horas between 1 and 168);
alter table public.guia_whats_config add column if not exists exigir_preferencia boolean not null default false;
alter table public.guia_whats_config add column if not exists msg_encerramento text not null default 'Tudo bem! 💗 Quando quiser marcar, é só me chamar aqui que eu te ajudo. Até logo!' check (length(msg_encerramento) between 5 and 1000);

-- a configuração passa a salvar os campos do ciclo da conversa
create or replace function public.guia_whats_salvar(c jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  num text;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma configura o WhatsApp do guia'; end if;
  if c ? 'numero' then
    num := nullif(regexp_replace(coalesce(c ->> 'numero', ''), '\D', '', 'g'), '');
    if num is not null and length(num) in (10, 11) then num := '55' || num; end if;
    if num is not null and num !~ '^[1-9][0-9]{9,14}$' then raise exception 'número inválido: use DDD e número (com 55 na frente, se quiser)'; end if;
  end if;
  begin
    update public.guia_whats_config g set
      ligado = coalesce((c ->> 'ligado')::boolean, g.ligado),
      numero = case when c ? 'numero' then num else g.numero end,
      instancia = coalesce(nullif(lower(btrim(c ->> 'instancia')), ''), g.instancia),
      botoes = case when c ? 'botoes' then array(select distinct x from jsonb_array_elements_text(c -> 'botoes') x order by 1) else g.botoes end,
      provedor = coalesce(nullif(c ->> 'provedor', ''), g.provedor),
      modelo = case when c ? 'modelo' then nullif(btrim(c ->> 'modelo'), '') else g.modelo end,
      orientacao = coalesce(nullif(btrim(c ->> 'orientacao'), ''), g.orientacao),
      msg_cliente = coalesce(nullif(btrim(c ->> 'msg_cliente'), ''), g.msg_cliente),
      msg_salao = coalesce(nullif(btrim(c ->> 'msg_salao'), ''), g.msg_salao),
      msg_salao_resposta = coalesce(nullif(btrim(c ->> 'msg_salao_resposta'), ''), g.msg_salao_resposta),
      msg_encerramento = coalesce(nullif(btrim(c ->> 'msg_encerramento'), ''), g.msg_encerramento),
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      exigir_preferencia = coalesce((c ->> 'exigir_preferencia')::boolean, g.exigir_preferencia),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
      pos_envio = coalesce((c ->> 'pos_envio')::integer, g.pos_envio),
      max_sem_avanco = coalesce((c ->> 'max_sem_avanco')::integer, g.max_sem_avanco),
      ocioso_horas = coalesce((c ->> 'ocioso_horas')::integer, g.ocioso_horas),
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
        when sqlerrm ~ 'limite_respostas' then 'respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'pos_envio' then 'dúvidas depois do envio: de 0 a 20'
        when sqlerrm ~ 'max_sem_avanco' then 'mensagens sem avançar antes de encerrar: de 2 a 50'
        when sqlerrm ~ 'ocioso_horas' then 'horas em silêncio para encerrar: de 1 a 168'
        when sqlerrm ~ 'retencao_dias' then 'guardar as conversas: de 7 a 730 dias'
        when sqlerrm ~ 'orientacao' then 'a orientação da Mel: de 20 a 6000 letras'
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

-- a janela em que a conversa ainda é a "mesma" passa a ser configurável (ocioso_horas); fora dela, a cliente recomeça
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  ocioso integer := greatest(1, least(coalesce((select ocioso_horas from public.guia_whats_config where id = 1), 24), 168));
  r jsonb;
begin
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c where c.chave = k and c.atualizada_em > now() - make_interval(hours => ocioso) order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'respostas_hoje', (select count(*) from public.guia_whats_conversas c, jsonb_array_elements(c.mensagens) m
                         where c.chave = k and c.atualizada_em > now() - interval '2 days' and m ->> 'q' = 'mel' and m ? 'em'
                           and (m ->> 'em')::timestamptz >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days' and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer')
                    order by ld.clicou_em desc nulls last, ld.criado_em desc limit 1)
  ) into r;
  return r;
end $$;

do $$
begin
  raise notice '199: o ciclo da conversa da Mel configurável (pos_envio, max_sem_avanco, ocioso_horas, msg_encerramento, exigir_preferencia)';
end $$;
