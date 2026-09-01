-- =============================================================
-- Agenda Mel — 027: o botão que renderiza
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 026).
--
-- O botão "nativo" (nativeFlowMessage) não desenha em cliente
-- não-oficial. Mas o WhatsApp tem outro jeito de oferecer opções
-- tocáveis que é recurso de CONSUMIDOR, e por isso renderiza em
-- qualquer aparelho: a ENQUETE.
--
--     Amanhã tem horário marcado
--     Design de sobrancelhas com Ana Paula dia 02/09 às 10:30.
--
--      ○ Confirmar
--      ○ Preciso remarcar
--
-- A cliente toca, o voto volta descriptografado (a Evolution 2.3.7
-- faz isso, linhas ~1206-1303 do serviço Baileys), e o webhook
-- traduz para "1" ou "2" — o resto do sistema nem nota.
--
-- Cada salão escolhe o estilo. O padrão é o que comprovadamente
-- aparece.
-- =============================================================

alter table public.whatsapp_channels
  add column if not exists estilo_botao text not null default 'enquete'
    check (estilo_botao in ('enquete', 'lista', 'nativo'));

comment on column public.whatsapp_channels.estilo_botao is
  'enquete = poll do WhatsApp (renderiza em todo aparelho — testado); '
  'lista = listMessage (a Evolution 2.3.7 RECUSA com "this.isZero is '
  'not a function"; cai para texto); '
  'nativo = nativeFlow buttons (a API aceita, o aparelho não desenha, '
  'a mensagem se perde). Na cloud qualquer estilo vira botão de verdade.';

-- com a enquete funcionando, botão volta a nascer ligado
alter table public.whatsapp_channels alter column usa_botoes set default true;
update public.whatsapp_channels set usa_botoes = true where not usa_botoes;

-- A regra: manda opção tocável quando o salão quer E o canal é
-- automático. Qual estilo, quem decide é o adaptador, lendo a coluna.
create or replace function public.canal_manda_botao(salao uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select c.usa_botoes and c.canal in ('cloud', 'evolution')
     from public.whatsapp_channels c
     where c.salon_id = salao),
    false);
$$;

revoke execute on function public.canal_manda_botao(uuid)
  from public, anon, authenticated;

-- A fila entrega o estilo junto com os botões
drop function if exists public.puxar_da_fila(integer);

create or replace function public.puxar_da_fila(quantas integer default 20)
returns table (
  id uuid,
  salon_id uuid,
  canal text,
  identificador text,
  telefone text,
  titulo text,
  corpo text,
  botoes jsonb,
  estilo_botao text
)
language plpgsql
security definer set search_path = public
as $$
begin
  return query
  with escolhidas as (
    select o.id
    from public.message_outbox o
    join public.whatsapp_channels c on c.salon_id = o.salon_id
    where o.status = 'na_fila'
      and o.liberado_em <= now()
      and o.tentativas < 4
      and c.ativo
      and c.canal in ('evolution', 'cloud')
    order by o.criado_em
    limit greatest(1, least(coalesce(quantas, 20), 100))
    for update of o skip locked
  ),
  marcadas as (
    update public.message_outbox o
    set status = 'enviando', tentativas = o.tentativas + 1
    from escolhidas e
    where o.id = e.id
    returning o.id, o.salon_id, o.canal, o.telefone, o.titulo, o.corpo, o.kind
  )
  select m.id, m.salon_id, m.canal, c.identificador, m.telefone,
         m.titulo, m.corpo,
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end,
         c.estilo_botao
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- O texto da opção também é entendido, caso chegue como texto
-- (alguém digita "Confirmar" em vez de tocar)
create or replace function public.interpretar_resposta(texto text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if texto is null then
    return 'nada';
  end if;

  t := lower(btrim(texto));
  t := translate(t, 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
  t := regexp_replace(t, '[^a-z0-9 ]', '', 'g');
  t := btrim(t);

  if t in ('sair', 'parar', 'stop', 'cancelar avisos', 'nao quero mais',
           'descadastrar', 'remover') then
    return 'sair';
  end if;

  if t in ('1', 'sim', 's', 'confirmo', 'confirmado', 'ok', 'certo',
           'isso', 'confirmar', 'positivo', 'estarei la', 'vou') then
    return 'confirma';
  end if;

  if t in ('2', 'nao', 'n', 'remarcar', 'cancelar', 'desmarcar',
           'nao vou', 'nao posso', 'negativo', 'preciso remarcar') then
    return 'cancela';
  end if;

  return 'nada';
end;
$$;

revoke execute on function public.interpretar_resposta(text)
  from public, anon, authenticated;

-- Reabre as que saíram como botão nativo e não renderizaram
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';
