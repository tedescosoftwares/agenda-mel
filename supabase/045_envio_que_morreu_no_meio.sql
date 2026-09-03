-- =============================================================
-- Agenda Mel — 045: envio que morreu no meio não fica preso para sempre
--
-- puxar_da_fila() marca as linhas como 'enviando' na mesma transação em
-- que as devolve — é assim que duas execuções ao mesmo tempo não pegam a
-- mesma mensagem, e está certo.
--
-- O que falta é o outro lado. Se a Edge Function morrer depois de marcar
-- e antes de confirmar — tempo esgotado, deploy no meio, erro de rede na
-- volta — a linha fica em 'enviando' e NUNCA MAIS sai de lá: a busca só
-- olha 'na_fila'. A mensagem não falhou, não foi enviada, e não aparece
-- em lugar nenhum como problema. Some.
--
-- Dez minutos é tempo de sobra para um lote de 20 com pausa de 900ms
-- entre cada. Passou disso, aquele envio não existe mais.
--
-- Vai dentro do próprio puxar_da_fila(), de propósito: assim não depende
-- de ninguém lembrar de chamar, e não exige republicar Edge Function.
-- =============================================================

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
  -- primeiro, resgatar o que ficou para trás de uma execução que morreu.
  -- A tentativa já foi contada, então o teto de 4 continua valendo e
  -- isto não vira laço infinito.
  update public.message_outbox
  set status = 'na_fila',
      erro = coalesce(erro, 'envio interrompido; devolvido para a fila')
  where status = 'enviando'
    and criado_em < now() - interval '10 minutes';

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

-- resgatar agora o que já está preso, sem esperar a próxima passada
update public.message_outbox
set status = 'na_fila',
    erro = coalesce(erro, 'envio interrompido; devolvido para a fila')
where status = 'enviando'
  and criado_em < now() - interval '10 minutes';

-- e soltar o que a 044 não alcançou: ela só mexeu em 'na_fila', e uma
-- linha travada em 'enviando' continuava com liberado_em de manhã
update public.message_outbox o
set liberado_em = now()
from public.whatsapp_regras r
where r.kind = o.kind
  and not r.respeita_silencio
  and o.status = 'na_fila'
  and o.liberado_em > now();
