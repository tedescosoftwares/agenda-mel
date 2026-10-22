-- 200: o ocioso ATIVO da Mel (3.52)
-- Até a 199 o "ocioso" era passivo: uma conversa parada há mais de X horas simplesmente deixava de ser a mesma (a
-- cliente recomeçava). Agora a Mel age: parada há um tempo (ocioso_perguntar_min), ela manda uma mensagem perguntando
-- se pode encerrar (msg_ocioso); se continuar parada desde essa pergunta (ocioso_encerrar_min), manda o encerramento
-- (msg_encerramento) e fecha. Como a Mel só fala quando chega mensagem, quem a cutuca é um relógio: um cron na VPS
-- chama o whatsapp-webhook com ?tarefa=ociosas, que varre as conversas paradas e manda as mensagens pela Evolution.
-- A janela de horas da 199 (ocioso_horas) fica como rede de segurança (esquecer a conversa se o relógio falhar).
--
-- A marca é a coluna cutucada_em (sem estado novo): nula = ainda não perguntei; preenchida = já perguntei e espero.
-- Qualquer mensagem da cliente zera a marca (no guia_whats_conversa_salvar), então uma conversa que voltou a andar
-- pode ser cutucada de novo mais tarde. Idempotente (add column if not exists / create or replace).

alter table public.guia_whats_config add column if not exists ocioso_ativo boolean not null default false;
alter table public.guia_whats_config add column if not exists ocioso_perguntar_min integer not null default 60 check (ocioso_perguntar_min between 5 and 10080);
alter table public.guia_whats_config add column if not exists ocioso_encerrar_min integer not null default 120 check (ocioso_encerrar_min between 5 and 10080);
alter table public.guia_whats_config add column if not exists msg_ocioso text not null
  default 'Oi! Vi que a gente parou por aqui 💗 Quer que eu envie seu pedido ao salão agora, ou prefere continuar depois? Se não puder responder, eu encerro por aqui — é só me chamar quando quiser.'
  check (length(msg_ocioso) between 5 and 1000);

-- a marca da cutucada na conversa
alter table public.guia_whats_conversas add column if not exists cutucada_em timestamptz;

-- qualquer gravação vinda da cliente zera a cutucada (a conversa voltou a andar)
create or replace function public.guia_whats_conversa_salvar(id_ bigint, tel_ text, lugar_ uuid, estado_ text, dados_ jsonb, novas_ jsonb, teste_ boolean default false)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  n bigint;
  novas jsonb := case when jsonb_typeof(novas_) = 'array' then novas_ else '[]'::jsonb end;
begin
  if id_ is null then
    insert into public.guia_whats_conversas (telefone, chave, lugar_id, estado, dados, mensagens, teste)
    values (left(tel_, 60), public.guia_whats_chave(tel_), lugar_, coalesce(estado_, 'conversando'), coalesce(dados_, '{}'::jsonb), novas, coalesce(teste_, false))
    returning id into n;
    return n;
  end if;
  update public.guia_whats_conversas c set
    lugar_id = coalesce(lugar_, c.lugar_id),
    estado = coalesce(estado_, c.estado),
    dados = coalesce(dados_, c.dados),
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || novas) with ordinality as e(m, o)
                   order by o desc limit 60) t),
    cutucada_em = null,
    atualizada_em = now()
   where c.id = id_
  returning c.id into n;
  return n;
end $$;

-- a varredura das conversas paradas (só service_role, chamada pelo relógio): devolve quem cutucar e quem encerrar, com
-- os textos. Só age se o ocioso está ligado, o guia está ligado e tem número. Não cutuca o que já passou da janela de
-- esquecer (ocioso_horas) nem conversas de teste; só 'conversando' e 'confirmando'.
create or replace function public.guia_whats_ociosas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ocioso_ativo or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'perguntar', '[]'::jsonb, 'encerrar', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ativo', true,
    'instancia', cfg.instancia,
    'texto_perguntar', cfg.msg_ocioso,
    'texto_encerrar', cfg.msg_encerramento,
    'perguntar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone)), '[]'::jsonb) from (
        select id, telefone from public.guia_whats_conversas
         where not teste and estado in ('conversando', 'confirmando') and cutucada_em is null
           and atualizada_em < now() - make_interval(mins => cfg.ocioso_perguntar_min)
           and atualizada_em > now() - make_interval(hours => cfg.ocioso_horas)
         order by atualizada_em limit 50) x),
    'encerrar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone)), '[]'::jsonb) from (
        select id, telefone from public.guia_whats_conversas
         where not teste and estado in ('conversando', 'confirmando') and cutucada_em is not null
           and cutucada_em < now() - make_interval(mins => cfg.ocioso_encerrar_min)
         order by cutucada_em limit 50) x)
  );
end $$;

-- marca o que foi feito: 'perguntar' guarda a mensagem e carimba cutucada_em (começa a contar para o encerramento);
-- 'encerrar' guarda a mensagem e fecha a conversa. Os guardas (cutucada_em null/não-null) tornam seguro contra corrida
-- (se a cliente respondeu no meio, a cutucada foi zerada e o encerrar não faz nada).
create or replace function public.guia_whats_ociosa_feita(id_ bigint, tipo_ text, texto_ text)
returns void language plpgsql security definer set search_path = public as $$
declare
  msg jsonb := jsonb_build_object('q', 'mel', 't', left(coalesce(texto_, ''), 1500), 'em', now());
begin
  if tipo_ = 'perguntar' then
    update public.guia_whats_conversas c set
      mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                     select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
      cutucada_em = now(), atualizada_em = now()
     where c.id = id_ and c.estado in ('conversando', 'confirmando') and c.cutucada_em is null and not c.teste;
  elsif tipo_ = 'encerrar' then
    update public.guia_whats_conversas c set
      mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                     select m, o from jsonb_array_elements(c.mensagens || msg) with ordinality as e(m, o) order by o desc limit 60) t),
      estado = 'encerrada', atualizada_em = now()
     where c.id = id_ and c.estado in ('conversando', 'confirmando') and c.cutucada_em is not null and not c.teste;
  end if;
end $$;

revoke all on function public.guia_whats_ociosas() from public, anon, authenticated;
revoke all on function public.guia_whats_ociosa_feita(bigint, text, text) from public, anon, authenticated;

-- a configuração salva o ocioso ativo
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
      msg_ocioso = coalesce(nullif(btrim(c ->> 'msg_ocioso'), ''), g.msg_ocioso),
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
        when sqlerrm ~ 'limite_respostas' then 'respostas por número por dia: de 1 a 500'
        when sqlerrm ~ 'limite_dia' then 'limite por dia: de 1 a 1000'
        when sqlerrm ~ 'pos_envio' then 'dúvidas depois do envio: de 0 a 20'
        when sqlerrm ~ 'max_sem_avanco' then 'mensagens sem avançar antes de encerrar: de 2 a 50'
        when sqlerrm ~ 'ocioso_perguntar_min' then 'minutos parada antes de perguntar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_encerrar_min' then 'minutos desde a pergunta antes de encerrar: de 5 a 10080'
        when sqlerrm ~ 'ocioso_horas' then 'horas para esquecer a conversa parada: de 1 a 168'
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

do $$
begin
  raise notice '200: o ocioso ativo da Mel (ocioso_ativo, ocioso_perguntar_min, ocioso_encerrar_min, msg_ocioso; cutucada_em; guia_whats_ociosas/ociosa_feita)';
end $$;
