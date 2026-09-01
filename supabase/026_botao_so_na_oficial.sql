-- =============================================================
-- Agenda Mel — 026: botão só na API oficial
-- Rode este arquivo no SQL Editor do Supabase (DEPOIS do 025).
--
-- O 025 mandou botão pela Evolution. Resultado no aparelho:
--
--     "Não foi possível carregar a mensagem.
--      Use seu celular para acessá-la."
--
-- E no celular também não aparecia. A mensagem se perdeu.
--
-- O que aconteceu: o WhatsApp restringiu mensagem interativa vinda
-- de cliente não-oficial. A Evolution monta o pacote, o servidor do
-- WhatsApp aceita e entrega — e o aplicativo de quem recebe não sabe
-- desenhar aquilo. A API devolve 200, o banco marca "enviado", e a
-- cliente não vê nada. O plano B do 025 não salva porque ele só age
-- quando a API RECUSA; aqui ela aprovou.
--
-- Não dá para detectar isso do lado de cá. Então botão passa a sair
-- só no canal 'cloud', a API oficial da Meta, onde mensagem
-- interativa é de primeira classe e sempre renderiza.
--
-- No canal 'evolution' volta o texto com "Responda 1 para confirmar
-- ou 2 se precisar remarcar" — que é feio, e funciona.
--
-- Não é porta trancada: usa_botoes continua ligável na Evolution para
-- quem quiser tentar. Duas coisas mudam a chance de renderizar, e as
-- duas dependem do número, não do código:
--
--   • o chip ser conta WhatsApp BUSINESS (o app verde escuro, grátis)
--     em vez de WhatsApp comum
--   • a cliente ter escrito para você nas últimas 24h
--
-- Se for tentar: ligue, mande UMA mensagem, confira no aparelho, e
-- desligue se não aparecer. Cada tentativa que não renderiza é uma
-- mensagem que a cliente nunca vê.
-- =============================================================

-- 1. Desliga onde já estava ligado ---------------------------------------
update public.whatsapp_channels set usa_botoes = false where usa_botoes;

alter table public.whatsapp_channels alter column usa_botoes set default false;

comment on column public.whatsapp_channels.usa_botoes is
  'Botão de resposta. Na cloud funciona sempre. Na Evolution o WhatsApp '
  'costuma entregar sem o aparelho conseguir desenhar, e a mensagem se '
  'perde sem erro — por isso nasce desligado. Vale tentar de novo se o '
  'número virar conta WhatsApp Business.';

-- 2. Uma regra só, em um lugar só ----------------------------------------
-- Duas funções precisavam decidir a mesma coisa (mandar botão?) e
-- precisam decidir igual: se divergirem, o sufixo "responda 1" some
-- de uma mensagem que vai sair sem botão nenhum.
--
-- A porta continua destrancada: quem quiser experimentar botão na
-- Evolution é só ligar usa_botoes de novo. O padrão é desligado
-- porque é o que comprovadamente chega.
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

-- 3. O sufixo volta quando não há botão ----------------------------------
create or replace function public.enfileirar_whatsapp(
  aviso_id uuid,
  destinatario uuid,
  tipo text,
  texto text,
  prof uuid default null,
  appt uuid default null,
  cabecalho text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  regra public.whatsapp_regras%rowtype;
  cliente public.profiles%rowtype;
  canal public.whatsapp_channels%rowtype;
  salao uuid;
  tel text;
  agora timestamp := public.agora_local();
  libera timestamptz := now();
  hoje_local date := public.agora_local()::date;
  ja_hoje integer;
  fila_id uuid;
begin
  if texto is null or btrim(texto) = '' then
    return null;
  end if;

  select * into regra from public.whatsapp_regras where kind = tipo;
  if not found or not regra.envia then
    return null;
  end if;

  select * into cliente from public.profiles where id = destinatario;
  if not found or not cliente.accepts_reminders then
    return null;
  end if;

  tel := public.telefone_e164(cliente.phone);
  if tel is null then
    return null;
  end if;

  if prof is not null then
    select p.salon_id into salao from public.professionals p where p.id = prof;
  end if;
  if salao is null and appt is not null then
    select a.salon_id, a.professional_id into salao, prof
    from public.appointments a where a.id = appt;
  end if;
  if salao is null then
    return null;
  end if;

  select * into canal from public.whatsapp_channels where salon_id = salao;
  if not found or not canal.ativo then
    return null;
  end if;

  select count(*) into ja_hoje
  from public.message_outbox o
  where o.salon_id = salao
    and o.status <> 'cancelado'
    and (o.criado_em at time zone 'America/Sao_Paulo')::date = hoje_local;

  if ja_hoje >= canal.teto_diario then
    return null;
  end if;

  if canal.canal = 'manual' then
    libera := now();
  elsif canal.silencio_inicio < canal.silencio_fim then
    if agora::time >= canal.silencio_inicio and agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  else
    if agora::time >= canal.silencio_inicio then
      libera := ((agora::date + 1 + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    elsif agora::time < canal.silencio_fim then
      libera := ((agora::date + canal.silencio_fim) at time zone 'America/Sao_Paulo');
    end if;
  end if;

  -- só cai fora quando o botão realmente vai junto e vai renderizar
  if regra.sufixo is not null
     and not (regra.botoes is not null and public.canal_manda_botao(salao)) then
    texto := texto || E'\n\n' || regra.sufixo;
  end if;

  insert into public.message_outbox
    (salon_id, professional_id, client_id, notification_id, appointment_id,
     telefone, kind, titulo, corpo, canal, liberado_em)
  values
    (salao, prof, destinatario, aviso_id, appt,
     tel, tipo, cabecalho, texto, canal.canal, libera)
  on conflict do nothing
  returning id into fila_id;

  return fila_id;
end;
$$;

revoke execute on function
  public.enfileirar_whatsapp(uuid, uuid, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- 4. A fila só entrega botão para o canal que sabe usar ------------------
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
  botoes jsonb
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
         case when public.canal_manda_botao(m.salon_id) then r.botoes else null end
  from marcadas m
  join public.whatsapp_channels c on c.salon_id = m.salon_id
  left join public.whatsapp_regras r on r.kind = m.kind;
end;
$$;

revoke execute on function public.puxar_da_fila(integer)
  from public, anon, authenticated;

-- 5. Reabre o que se perdeu ----------------------------------------------
-- Mensagem marcada "enviado" que na verdade não renderizou volta para a
-- fila, agora como texto. Só as de hoje, e só as que levaram botão.
update public.message_outbox o
set status = 'na_fila', provider_id = null, tentativas = 0
from public.whatsapp_regras r
where r.kind = o.kind
  and r.botoes is not null
  and o.canal = 'evolution'
  and o.status in ('enviado', 'entregue')
  and o.enviado_em > now() - interval '6 hours';
