-- =============================================================
-- Agenda Mel — 046: ensaiar a conversa sem gastar um telefone
--
-- Testar o bot exige dois números de WhatsApp: um fazendo de cliente,
-- outro de profissional. Quem está construindo raramente tem dois à
-- mão, e quando tem, um deles cai — número novo, chip que expira,
-- WhatsApp que desconecta. A construção inteira para por causa disso.
--
-- Esta função roda a MESMA conversa que o webhook rodaria, com o mesmo
-- receber_mensagem(), tocando as mesmas tabelas. A única diferença é o
-- último centímetro: as mensagens que iriam para o WhatsApp são
-- marcadas como 'cancelado' com o motivo anotado, e devolvidas na
-- resposta para você LER o que teria sido enviado, para quem.
--
-- O que é de verdade continua de verdade: o horário marcado aparece na
-- agenda, o pedido de aceite existe, a conversa avança de estado. É
-- ensaio da entrega, não do sistema — testar contra uma imitação é
-- testar a imitação.
--
-- Só admin do salão. Um simulador de mensagens recebidas na mão de
-- qualquer um logado seria uma forma elegante de marcar horário no nome
-- dos outros.
-- =============================================================

create or replace function public.simular_recebida(
  salao uuid,
  tel text,
  texto text,
  intencao text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  -- Os ids que JÁ existiam, não um horário de corte. A primeira versão
  -- comparava criado_em >= clock_timestamp() e não pegava nada: o
  -- criado_em das linhas novas é now(), que numa transação é o instante
  -- em que ela COMEÇOU — sempre anterior. Errei nisso e a bancada
  -- devolvia lista vazia enquanto as mensagens saíam de verdade.
  ja_existiam uuid[];
  r jsonb;
  saidas jsonb;
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'esse salão não é seu';
  end if;

  if public.telefone_e164(tel) is null then
    return jsonb_build_object('erro', 'telefone inválido: ' || coalesce(tel, '(vazio)'));
  end if;

  select coalesce(array_agg(id), '{}') into ja_existiam
  from public.message_outbox where salon_id = salao;

  -- Apagar QUEM está chamando, pelo resto desta transação.
  --
  -- Quem usa a bancada é a dona do salão, logada. Quem chama isto na
  -- vida real é o webhook, com a chave de serviço e sem usuário nenhum.
  -- E há regras que olham auth.uid() para decidir — o gatilho do
  -- agendamento, por exemplo, não pede aceite quando quem marcou foi a
  -- casa. Sem apagar o ator aqui, a bancada testaria um caminho que
  -- nenhuma cliente percorre, e diria que está tudo bem.
  --
  -- Foi assim que ela mentiu no primeiro teste: nenhum pedido de aceite
  -- nasceu, porque o banco achou que a dona é que estava marcando.
  -- 'true' = só nesta transação; ao terminar, volta ao normal.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  -- o caminho de verdade, sem atalho
  r := public.receber_mensagem(tel, texto, null, null, intencao, salao);

  -- e agora o único fingimento: nada disto vai para o WhatsApp
  update public.message_outbox
  set status = 'cancelado',
      erro = 'bancada de testes — não foi enviado'
  where salon_id = salao
    and not (id = any (ja_existiam))
    and status in ('na_fila', 'enviando');

  select jsonb_agg(jsonb_build_object(
           'telefone', o.telefone,
           'tipo', o.kind,
           'corpo', o.corpo,
           'para', coalesce(pf.name, p.full_name, '(desconhecido)')
         ) order by o.criado_em)
    into saidas
  from public.message_outbox o
  left join public.profiles p on p.id = o.client_id
  left join public.professionals pf on pf.id = o.professional_id
  where o.salon_id = salao and not (o.id = any (ja_existiam));

  -- o 'avisar' é o aviso que o webhook mandaria na hora, fora da fila;
  -- na bancada ele também é só texto para ler
  return jsonb_build_object(
    'acao',      r ->> 'acao',
    'responder', r ->> 'responder',
    'avisar',    r -> 'avisar',
    'appointment_id', r ->> 'appointment_id',
    'motivo',    r ->> 'motivo',
    'mensagens', coalesce(saidas, '[]'::jsonb));
end;
$$;

revoke execute on function public.simular_recebida(uuid, text, text, text)
  from public, anon;
grant execute on function public.simular_recebida(uuid, text, text, text) to authenticated;

-- Limpar o ensaio -----------------------------------------------------------
-- Um teste que suja a agenda de verdade e não tem como desfazer vira
-- medo de testar. Isto apaga o que a bancada criou para um telefone:
-- conversa aberta, pedido de aceite, agendamento e mensagens.
create or replace function public.limpar_ensaio(salao uuid, tel text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  cliente uuid;
  quantos_ap integer := 0;
  quantas_msg integer := 0;
begin
  if not public.is_admin_do_salao(salao) then
    raise exception 'esse salão não é seu';
  end if;
  if e164 is null then
    return jsonb_build_object('erro', 'telefone inválido');
  end if;

  delete from public.conversas where telefone = e164 and salon_id = salao;

  cliente := public.cliente_pelo_telefone(e164);
  if cliente is not null then
    -- só o que está por vir: histórico de verdade não se apaga por engano
    with alvos as (
      select a.id from public.appointments a
      where a.salon_id = salao
        and a.client_id = cliente
        and (a.date + a.start_time) > public.agora_local()
        and a.status in ('pendente', 'confirmado')
        -- só o que nasceu no ensaio. Sem este limite, limpar um teste
        -- apagaria um horário de verdade que a cliente marcou semana
        -- passada — e apagar agenda alheia não se desfaz
        and a.created_at > now() - interval '24 hours'
    ),
    fora_aceite as (
      delete from public.aceites where appointment_id in (select id from alvos)
    ),
    fora_fila as (
      delete from public.message_outbox where appointment_id in (select id from alvos)
    )
    delete from public.appointments where id in (select id from alvos);
    get diagnostics quantos_ap = row_count;
  end if;

  delete from public.message_outbox
  where salon_id = salao
    and telefone = e164
    and status in ('na_fila', 'enviando', 'cancelado');
  get diagnostics quantas_msg = row_count;

  return jsonb_build_object('ok', true,
    'agendamentos_apagados', quantos_ap,
    'mensagens_apagadas', quantas_msg);
end;
$$;

revoke execute on function public.limpar_ensaio(uuid, text) from public, anon;
grant execute on function public.limpar_ensaio(uuid, text) to authenticated;
