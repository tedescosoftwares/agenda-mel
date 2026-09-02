-- =============================================================
-- Agenda Mel — diagnóstico: por que o bot não respondeu?
--
-- Cole no SQL Editor do Supabase e Run. Não muda nada, só olha.
-- Troque os dois telefones abaixo pelos que você está testando.
--
-- Cada linha responde UMA pergunta, e a primeira que vier errada é a
-- causa — não adianta olhar as de baixo antes de consertar a de cima.
-- =============================================================

with quem as (
  select '+54 9 11 3619-7412'::text as tel_cliente,   -- de onde você manda
         '11'::text                 as instancia      -- nome da instância na Evolution
),
tel as (select *, public.telefone_e164(tel_cliente) as e164 from quem)

select 1 as n, 'migração 040 aplicada?' as pergunta,
       case when exists (select 1 from pg_proc where proname = 'quem_age_e')
            then 'SIM' else 'NÃO — telefone de fora do Brasil vira nulo' end as resposta
from tel
union all
select 2, 'migração 041 aplicada?',
       case when exists (select 1 from pg_proc where proname = 'como_ficou')
            then 'SIM' else 'NÃO — marcar pelo app não pede aceite' end
from tel
union all
select 3, 'o telefone vira E.164?',
       coalesce(e164, 'NULO — o porteiro recusa antes de tudo') from tel
union all
select 4, 'esse telefone acha uma cliente?',
       coalesce((select p.full_name || ' (' || p.role || ')'
                   from public.profiles p
                  where public.telefone_e164(p.phone) = t.e164
                  order by case p.role when 'cliente' then 0
                                       when 'admin'   then 1 else 2 end,
                           p.created_at
                  limit 1),
                'NENHUMA — cadastre o telefone no perfil')
from tel t
union all
select 5, 'bot e IA ligados no canal?',
       coalesce((select 'bot=' || c.usa_bot || ' · ia=' || c.usa_ia
                   from public.whatsapp_channels c
                  where c.identificador = t.instancia limit 1),
                'CANAL NÃO EXISTE com essa instância')
from tel t
union all
select 6, 'o porteiro deixa passar?',
       coalesce(public.ia_permitida(t.tel_cliente,
                                    'quero marcar um horário',
                                    t.instancia)->>'motivo',
                'sem resposta')
from tel t
union all
select 7, 'conversa aberta agora',
       coalesce((select c.estado || ' (mexida ' ||
                        to_char(c.atualizada_em, 'DD/MM HH24:MI') || ')'
                   from public.conversas c
                  where c.telefone = t.e164
                  order by c.atualizada_em desc limit 1),
                'nenhuma')
from tel t
union all
select 8, 'últimas 5 recebidas',
       coalesce((select string_agg(x.linha, ' | ')
                   from (select coalesce(i.texto, '(vazio)') || ' -> ' ||
                                coalesce(i.intencao_ia, i.via, '?') as linha
                           from public.whatsapp_inbox i
                          order by i.recebido_em desc limit 5) x),
                'nada chegou ainda')
from tel
order by n;
