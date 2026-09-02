-- =============================================================
-- Agenda Mel — 037: quem não tem cadastro não pode sumir
--
-- O receber_mensagem() grava a mensagem no inbox e, quando o bot
-- responde 'sem_cadastro', repassa para o caminho antigo — que manda o
-- link e avisa a profissional.
--
-- Só que o repasse leva o mesmo provider_id, e o caminho antigo tem uma
-- trava contra evento repetido: "esse id já está no inbox, então já
-- agi". A trava está certa; o problema é que quem colocou o id lá foi o
-- próprio bot, dois passos antes. Resultado: a pessoa sem cadastro —
-- justamente a que mais precisa de resposta — não recebia nada.
--
-- Bug de ordem, não de lógica: gravar antes de decidir se ia repassar.
-- Agora o registro só acontece quando o bot realmente responde; no
-- repasse, quem grava é quem responde.
-- =============================================================

create or replace function public.receber_mensagem(
  tel text,
  texto text,
  id_provedor text default null,
  id_enquete text default null,
  intencao_do_modelo text default null,
  salao uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  e164 text := public.telefone_e164(tel);
  bot_ligado boolean := false;
  tem_conversa boolean := false;
  r jsonb;
begin
  if e164 is null then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'telefone invalido');
  end if;

  if id_provedor is not null
     and exists (select 1 from public.whatsapp_inbox where provider_id = id_provedor) then
    return jsonb_build_object('acao', 'ignorado', 'motivo', 'repetida');
  end if;

  select c.usa_bot into bot_ligado
  from public.whatsapp_channels c where c.salon_id = salao;

  select exists (
    select 1 from public.conversas
    where telefone = e164 and expira_em > now()
  ) into tem_conversa;

  -- Conversa aberta ganha de tudo: no meio de um menu, "2" quer dizer
  -- "a segunda opção", nunca "cancele meu horário".
  if tem_conversa or (coalesce(bot_ligado, false)
                      and public.acao_da_intencao(intencao_do_modelo) = 'quer_agendar') then
    r := public.avancar_conversa(e164, texto, salao);

    -- só registra se o bot está mesmo respondendo. Registrar antes de
    -- saber disso é o que fazia o repasse abaixo se enxergar como
    -- mensagem repetida e devolver silêncio.
    if (r ->> 'acao') <> 'sem_cadastro' then
      insert into public.whatsapp_inbox
        (telefone, texto, provider_id, client_id, acao, appointment_id, via, intencao_ia)
      values (e164, texto, id_provedor,
              public.cliente_pelo_telefone(e164),
              'bot:' || coalesce(r ->> 'acao', '?'),
              nullif(r ->> 'appointment_id', '')::uuid,
              case when tem_conversa then 'bot' else 'ia' end,
              intencao_do_modelo);
      return r;
    end if;
  end if;

  return public.receber_resposta_whatsapp(
    e164, texto, id_provedor, id_enquete, intencao_do_modelo, salao);
end;
$$;

revoke execute on function
  public.receber_mensagem(text, text, text, text, text, uuid)
  from public, anon, authenticated;

-- Diagnóstico do bot ------------------------------------------------------
-- "chegou o menu mas não marcou nada" pode ser cinco coisas, e caçar em
-- quatro tabelas cada vez é caro. Isto responde de uma vez.
drop function if exists public.diagnostico_bot(uuid);
create or replace function public.diagnostico_bot(salao uuid)
returns table (item text, resposta text)
language plpgsql
stable
security definer set search_path = public
as $fn$
begin
  if not public.is_admin_do_salao(salao) then
    return;
  end if;

  return query
  select 'Bot ligado?',
         coalesce((select case when usa_bot then 'sim' else 'NÃO' end
                   from public.whatsapp_channels where salon_id = salao), '?')
  union all
  select 'Conversa aberta agora',
         coalesce((select string_agg(telefone || ' parou em "' || estado || '"'
                          || ' (expira ' || to_char(expira_em at time zone 'America/Sao_Paulo','HH24:MI') || ')', ' | ')
                   from public.conversas where salon_id = salao), 'nenhuma')
  union all
  select 'Últimos passos do bot',
         coalesce((select string_agg(replace(acao,'bot:','') || ' <- "' || left(texto,22) || '"', '  →  '
                          order by recebido_em)
                   from (select * from public.whatsapp_inbox
                         where acao like 'bot:%' order by recebido_em desc limit 8) u),
                  'o bot ainda não respondeu nada')
  union all
  select 'Horários marcados pelo bot',
         coalesce((select count(*)::text || ' (último: ' ||
                          to_char(max(recebido_em) at time zone 'America/Sao_Paulo','DD/MM HH24:MI') || ')'
                   from public.whatsapp_inbox
                   where acao = 'bot:marcou' and appointment_id is not null), '0')
  union all
  select 'Avisos gerados para a equipe',
         coalesce((select count(*)::text from public.message_outbox
                   where salon_id = salao and kind in ('novo_agendamento','pedido_pelo_whatsapp')
                     and criado_em > now() - interval '2 hours'), '0')
         || ' nas últimas 2h'
  union all
  select 'Saíram mesmo?',
         coalesce((select string_agg(distinct status, ', ') from public.message_outbox
                   where salon_id = salao and kind in ('novo_agendamento','pedido_pelo_whatsapp')
                     and criado_em > now() - interval '2 hours'), 'nada para enviar')
  union all
  select 'Telefone da equipe',
         coalesce((select string_agg(p.name || '=' ||
                    coalesce(public.telefone_e164(pf.phone), 'SEM TELEFONE NO PERFIL'), ' | ')
                   from public.professionals p
                   left join public.profiles pf on pf.id = p.user_id
                   where p.salon_id = salao and p.active), 'nenhuma');
end;
$fn$;

revoke execute on function public.diagnostico_bot(uuid) from public, anon;
grant execute on function public.diagnostico_bot(uuid) to authenticated;
