-- 267 (4.12): o WhatsApp de um salão visto pela Plataforma: tudo o que passou, por conversa.
--
-- A aba WhatsApp do salão (Plataforma) mostrava duas listas soltas: "o que chegou" e a "fila de saída". A primeira
-- (leituras_recentes) trazia junto toda mensagem lida pela IA, de qualquer salão: parecia misturado porque estava.
-- Aqui a conversa é montada só com o que é DESTE salão: o que chegou (whatsapp_inbox, pelo salon_id) e o que saiu
-- (message_outbox: avisos, lembretes e as respostas da assistente), em ordem, por número.
--
-- O que não aparece: o que a equipe digita direto no celular do salão. A MIMO só confere que saiu, não guarda o texto.
--
-- Só a Plataforma chama (eh_plataforma). Não muda dado nenhum.

-- as mensagens deste salão, dos dois lados, numa forma só
create or replace function public.whats_do_salao(salao uuid)
returns table (id text, telefone text, quando timestamptz, lado text, texto text, tipo text, status text, erro text,
               via text, entendeu text, client_id uuid)
language sql
stable
security definer set search_path = public
as $$
  select 'e' || i.id::text, coalesce(public.telefone_e164(i.telefone), i.telefone), i.recebido_em, 'chegou', i.texto,
         null::text, null::text, null::text, i.via,
         nullif(concat_ws(' · ', nullif(i.acao, ''), nullif(i.intencao_ia, '')), ''), i.client_id
    from public.whatsapp_inbox i
   where i.salon_id = salao
  union all
  select 's' || o.id::text, coalesce(public.telefone_e164(o.telefone), o.telefone), coalesce(o.enviado_em, o.criado_em), 'saiu',
         o.corpo, o.kind, o.status, o.erro, null::text, null::text, o.client_id
    from public.message_outbox o
   where o.salon_id = salao;
$$;
revoke execute on function public.whats_do_salao(uuid) from public, anon, authenticated;

-- a lista de conversas: um número por linha, a mais recente primeiro
create or replace function public.plataforma_whats_conversas(salao uuid, busca text default null, so_falhas boolean default false,
                                                             quantas integer default 60)
returns table (telefone text, nome text, ultima timestamptz, ultimo_texto text, ultimo_lado text,
               chegaram integer, sairam integer, falharam integer)
language sql
stable
security definer set search_path = public
as $$
  with m as (
    select * from public.whats_do_salao(salao) where public.eh_plataforma()
  ), g as (
    select m.telefone,
           max(m.quando) as ultima,
           (array_agg(m.texto order by m.quando desc))[1] as ultimo_texto,
           (array_agg(m.lado order by m.quando desc))[1] as ultimo_lado,
           (array_agg(m.client_id order by m.quando desc) filter (where m.client_id is not null))[1] as cliente,
           count(*) filter (where m.lado = 'chegou')::integer as chegaram,
           count(*) filter (where m.lado = 'saiu')::integer as sairam,
           count(*) filter (where m.status = 'falhou')::integer as falharam
      from m group by m.telefone
  )
  select g.telefone, nullif(btrim(pf.full_name), ''), g.ultima, left(g.ultimo_texto, 140), g.ultimo_lado,
         g.chegaram, g.sairam, g.falharam
    from g
    left join public.profiles pf on pf.id = g.cliente
   where (not coalesce(so_falhas, false) or g.falharam > 0)
     and (nullif(btrim(coalesce(busca, '')), '') is null
          or pf.full_name ilike '%' || btrim(busca) || '%'
          or (regexp_replace(busca, '\D', '', 'g') <> ''
              and regexp_replace(g.telefone, '\D', '', 'g') like '%' || regexp_replace(busca, '\D', '', 'g') || '%'))
   order by g.ultima desc
   limit greatest(1, least(coalesce(quantas, 60), 300));
$$;
revoke execute on function public.plataforma_whats_conversas(uuid, text, boolean, integer) from public, anon;
grant execute on function public.plataforma_whats_conversas(uuid, text, boolean, integer) to authenticated;

-- uma conversa: as mensagens daquele número com este salão, as mais recentes (a tela inverte para ler de cima para baixo)
create or replace function public.plataforma_whats_mensagens(salao uuid, tel text, antes timestamptz default null,
                                                             quantas integer default 80)
returns table (id text, quando timestamptz, lado text, texto text, tipo text, status text, erro text, via text, entendeu text)
language sql
stable
security definer set search_path = public
as $$
  select m.id, m.quando, m.lado, m.texto, m.tipo, m.status, m.erro, m.via, m.entendeu
    from public.whats_do_salao(salao) m
   where public.eh_plataforma()
     and m.telefone = coalesce(public.telefone_e164(tel), tel)
     and (antes is null or m.quando < antes)
   order by m.quando desc
   limit greatest(1, least(coalesce(quantas, 80), 300));
$$;
revoke execute on function public.plataforma_whats_mensagens(uuid, text, timestamptz, integer) from public, anon;
grant execute on function public.plataforma_whats_mensagens(uuid, text, timestamptz, integer) to authenticated;

-- os números do período, para o topo da aba
create or replace function public.plataforma_whats_resumo(salao uuid)
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select case when not public.eh_plataforma() then null else jsonb_build_object(
    'conversas_30d', count(distinct m.telefone) filter (where m.quando > now() - interval '30 days'),
    'chegaram_30d', count(*) filter (where m.lado = 'chegou' and m.quando > now() - interval '30 days'),
    'sairam_30d', count(*) filter (where m.lado = 'saiu' and m.status <> 'falhou' and m.quando > now() - interval '30 days'),
    'falharam_30d', count(*) filter (where m.status = 'falhou' and m.quando > now() - interval '30 days'),
    'na_fila', count(*) filter (where m.status = 'na_fila')
  ) end
  from public.whats_do_salao(salao) m;
$$;
revoke execute on function public.plataforma_whats_resumo(uuid) from public, anon;
grant execute on function public.plataforma_whats_resumo(uuid) to authenticated;
