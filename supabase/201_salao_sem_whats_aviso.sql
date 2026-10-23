-- 201: salão sem WhatsApp (ou com o número da própria cliente) → sem_contato + aviso à equipe (3.53)
-- Regra: se o salão não tem WhatsApp para receber o pedido, a cliente segue normal (a Mel anota e confirma), mas o
-- pedido NÃO é mandado "no vazio" — fica como sem_contato (já aparece na Plataforma e conta na métrica) e a Mel avisa
-- a EQUIPE no nosso próprio WhatsApp (numero_avisos), dizendo que aquele salão não tem WhatsApp. Também cobre o caso em
-- que o número do salão no cadastro é o MESMO da cliente (comum em teste): aí a mensagem do salão iria para a própria
-- cliente — então tratamos como sem_contato e não mandamos para esse número.

alter table public.guia_whats_config add column if not exists numero_avisos text
  check (numero_avisos is null or numero_avisos ~ '^[1-9][0-9]{9,14}$');

-- o pedido nasce sem_contato quando o salão não tem WhatsApp OU quando o número do salão é o da própria cliente
create or replace function public.guia_whats_lead_criar(conversa_ bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cv public.guia_whats_conversas;
  lg jsonb;
  ld public.guia_whats_leads;
  st text;
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  select * into cv from public.guia_whats_conversas where id = conversa_ for update;
  if cv.id is null or cv.lugar_id is null then return jsonb_build_object('erro', 'conversa sem salão'); end if;
  if cv.lead_id is not null then
    select * into ld from public.guia_whats_leads where id = cv.lead_id;
    if ld.id is not null then return to_jsonb(ld) || jsonb_build_object('repetido', true); end if;
  end if;
  lg := public.guia_whats_lugar(null, null, cv.lugar_id);
  if lg is null then return jsonb_build_object('erro', 'salão fora do ar'); end if;
  st := case when (lg ->> 'salao_saiu')::boolean then 'salao_saiu'
             when lg ->> 'salao_tel' is null then 'sem_contato'
             -- o número do salão é o da própria cliente: não dá para mandar o pedido (iria para a cliente)
             when public.guia_whats_chave(lg ->> 'salao_tel') = cv.chave then 'sem_contato'
             when (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou')
                  >= (select limite_dia from public.guia_whats_config where id = 1) then 'fora_do_limite'
             else 'pendente' end;
  insert into public.guia_whats_leads (conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, cliente_chave, servico, preferencia, observacao, salao_tel, salao_chave, status)
  values (cv.id, cv.lugar_id, lg ->> 'nome', lg ->> 'cidade', nullif(left(cv.dados ->> 'nome', 80), ''), cv.telefone, cv.chave,
          nullif(left(cv.dados ->> 'servico', 200), ''), nullif(left(cv.dados ->> 'preferencia', 200), ''), nullif(left(cv.dados ->> 'observacao', 400), ''),
          lg ->> 'salao_tel', public.guia_whats_chave(lg ->> 'salao_tel'), st)
  returning * into ld;
  update public.guia_whats_conversas set lead_id = ld.id where id = cv.id;
  return to_jsonb(ld) || jsonb_build_object('repetido', false);
end $$;

-- a configuração salva o WhatsApp da equipe para avisos
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
  raise notice '201: salão sem WhatsApp (ou com o número da cliente) vira sem_contato; numero_avisos para a Mel avisar a equipe';
end $$;
