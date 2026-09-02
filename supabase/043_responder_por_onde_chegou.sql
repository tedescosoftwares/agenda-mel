-- =============================================================
-- Agenda Mel — 043: responder pelo canal por onde a mensagem chegou
--
-- O bot criava a conversa, montava o menu de serviços e devolvia o
-- texto pronto. E a resposta não saía. Nunca.
--
-- Motivo: para descobrir por qual canal responder, o webhook chamava
-- canal_do_telefone(), que procura assim:
--
--     from message_outbox
--    where telefone = <ela>
--      and status in ('enviado', 'entregue', 'lido')
--
-- Ou seja: "só sei por onde te responder se eu JÁ tiver conseguido te
-- mandar alguma coisa antes". Para quem escreve pela primeira vez isso
-- nunca é verdade — a função devolve zero linhas, o webhook faz
-- `continue`, e a cliente fica olhando para o WhatsApp mudo. O bot fez
-- tudo certo e ninguém ficou sabendo.
--
-- Ovo e galinha: a única forma de ganhar histórico é responder, e a
-- única forma de responder era ter histórico.
--
-- O canal certo nunca foi um mistério: é O NÚMERO QUE RECEBEU A
-- MENSAGEM. A Evolution manda isso em todo evento (`instance`), e o
-- webhook já usa esse dado para o porteiro — só não usava para
-- responder. A ordem passa a ser:
--
--   1. a instância que recebeu     — é fato, não dedução
--   2. o salão que já foi resolvido — quando o evento não trouxe a
--                                     instância
--   3. o histórico de envios        — o que existia, agora como último
--                                     recurso e não como única fonte
--
-- E o segundo conserto: resposta que não conseguiu sair vira linha na
-- fila em vez de sumir. Antes, se o envio falhasse, o texto morria numa
-- variável. Silêncio é o pior desfecho possível — pior que atrasar.
-- =============================================================

-- 1. Por onde responder ----------------------------------------------------
create or replace function public.canal_para_responder(
  tel text,
  instancia text default null,
  salao uuid default null
)
returns table (canal text, identificador text, salon_id uuid)
language sql
stable
security definer set search_path = public
as $$
  -- as três origens, cada uma com sua prioridade; ganha a menor que
  -- tiver resposta. Sem o número da prioridade, o `order by` ordenaria
  -- por nome de canal e a escolha viraria sorteio.
  select x.canal, x.identificador, x.salon_id
  from (
    -- 1. a instância que recebeu: é fato, não dedução
    select 1 as prioridade, c.canal, c.identificador, c.salon_id
    from public.whatsapp_channels c
    where instancia is not null
      and c.identificador = instancia
      and c.ativo

    union all

    -- 2. o salão que o porteiro já resolveu
    select 2, c.canal, c.identificador, c.salon_id
    from public.whatsapp_channels c
    where salao is not null
      and c.salon_id = salao
      and c.ativo

    union all

    -- 3. o histórico de envios: era a única fonte, agora é a última
    select 3, u.canal, u.identificador, u.salon_id
    from (
      select c.canal, c.identificador, c.salon_id
      from public.message_outbox o
      join public.whatsapp_channels c on c.salon_id = o.salon_id
      where public.telefone_chave(o.telefone) = public.telefone_chave(tel)
        and o.status in ('enviado', 'entregue', 'lido')
      order by o.enviado_em desc nulls last
      limit 1
    ) u
  ) x
  order by x.prioridade
  limit 1;
$$;

revoke execute on function public.canal_para_responder(text, text, uuid)
  from public, anon, authenticated;

-- 2. Resposta que não saiu não some ---------------------------------------
-- Chamada pelo webhook quando o envio na hora falha. Vira linha na fila,
-- que o escoamento normal tenta de novo. Não é o ideal — resposta que
-- chega meia hora depois quase não é resposta — mas é infinitamente
-- melhor que a cliente achar que o salão a ignorou.
create or replace function public.resposta_nao_saiu(
  tel text,
  corpo text,
  salao uuid default null,
  motivo text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  fila_id uuid;
begin
  if e164 is null or corpo is null or btrim(corpo) = '' then
    return null;
  end if;

  insert into public.message_outbox
    (salon_id, telefone, kind, corpo, canal, status, client_id, erro)
  values (salao, e164, 'resposta_do_bot', corpo, 'evolution', 'na_fila',
          public.cliente_pelo_telefone(e164),
          coalesce(motivo, 'não saiu na hora'))
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function public.resposta_nao_saiu(text, text, uuid, text)
  from public, anon, authenticated;

-- a regra precisa existir para o escoamento não descartar a linha
insert into public.whatsapp_regras (kind, envia, natureza, sufixo) values
  ('resposta_do_bot', true, 'utilidade', null)
on conflict (kind) do nothing;
update public.whatsapp_regras set envia = true where kind = 'resposta_do_bot';

-- 3. O diagnóstico precisa ver isto ---------------------------------------
-- Uma resposta parada na fila com erro preenchido é o sintoma exato de
-- "o bot pensou e ninguém ouviu". Sem uma pergunta que a mostre, o
-- próximo diagnóstico volta a dizer que está tudo bem.
create or replace function public.respostas_engasgadas(salao uuid default null)
returns table (telefone text, corpo text, motivo text, quando timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select o.telefone, left(o.corpo, 80), o.erro, o.criado_em
  from public.message_outbox o
  where o.kind = 'resposta_do_bot'
    and o.status = 'na_fila'
    and (salao is null or o.salon_id = salao)
  order by o.criado_em desc
  limit 20;
$$;

revoke execute on function public.respostas_engasgadas(uuid)
  from public, anon;
grant execute on function public.respostas_engasgadas(uuid) to authenticated;
