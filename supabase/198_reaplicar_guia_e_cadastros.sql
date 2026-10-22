-- 198: reaplica o que foi acrescentado dentro da 196/197 depois de elas ja terem rodado (3.50.3)
-- Por que: o aplicar.sh guarda em migracoes_aplicadas o que ja rodou e pula o arquivo. Como os ajustes do WhatsApp
-- do guia (3.49.2/6/7) foram escritos DENTRO da 196, e os dados do cadastro DENTRO da 197, quem rodou a 196/197 numa
-- versao anterior nao recebeu o resto. Tudo aqui e idempotente (add column if not exists / create or replace).

-- ===== a Mel, o link rastreavel e a conversa de volta do salao (estavam na 196) =====
-- ---- a Mel reconhece o salão no que a cliente escreveu e gasta menos (3.49.2) ---------------------------------------
-- o teto de respostas da Mel por número por dia (a conversa à toa não vira token): configurável na Plataforma
alter table public.guia_whats_config add column if not exists limite_respostas integer not null default 30 check (limite_respostas between 1 and 500);

-- as palavras de um nome (ou de um texto) que dizem qual salão é: tira as genéricas (studio, salão, beleza, cabelo…)
create or replace function public.guia_whats_palavras(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(w), '{}'::text[]) from unnest(string_to_array(public.slug_de(left(coalesce(t, ''), 300)), '-')) w
   where length(w) >= 3 and w not in (
     'studio', 'estudio', 'salao', 'salon', 'espaco', 'beleza', 'cabelo', 'cabelos', 'cabeleireiro', 'cabeleireira', 'cabeleireiros',
     'estetica', 'estetico', 'unhas', 'unha', 'nails', 'nail', 'hair', 'beauty', 'centro', 'spa', 'clinica', 'design', 'designer',
     'sobrancelha', 'sobrancelhas', 'cilios', 'make', 'makeup', 'maquiagem', 'barbearia', 'barber', 'manicure', 'pedicure', 'esmalteria',
     'lash', 'lashes', 'brow', 'brows', 'the', 'and', 'com', 'pra', 'para', 'quero', 'queria', 'marcar', 'agendar', 'agendamento', 'horario',
     'hora', 'ola', 'bom', 'dia', 'boa', 'tarde', 'noite', 'gostaria', 'preciso', 'por', 'favor', 'uma', 'umas', 'meu', 'minha', 'nome',
     'como', 'aparece', 'guia', 'mimo', 'link', 'pagina', 'sou', 'voce', 'vcs', 'eles', 'ela', 'ele', 'que', 'isso', 'mais', 'ainda', 'nao',
     'sim', 'tem', 'vai', 'ser', 'esta', 'estou', 'dos', 'das', 'gente', 'aqui', 'ali', 'esse', 'essa', 'este', 'dela', 'dele', 'pelo',
     'pela', 'mel', 'tudo', 'bem', 'obrigada', 'obrigado', 'quer', 'posso', 'pode', 'fazer', 'servico', 'servicos', 'atendimento')
$$;

-- a busca do salão no texto: o slug ou o nome inteiro dentro do texto (3), o texto dentro do nome (2), ou palavras
-- do nome que não sejam genéricas presentes no texto (1: ao menos uma, e duas ou metade do nome). Só os melhores, até 3;
-- texto só de palavras genéricas ("quero marcar cabelo") não acha nada
create or replace function public.guia_whats_buscar(texto_ text)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select public.slug_de(left(coalesce(texto_, ''), 300)) as t, public.guia_whats_palavras(texto_) as pw),
  c as (
    select l.id, l.nome, l.cidade,
           case when length(l.slug) >= 4 and '-' || q.t || '-' like '%-' || l.slug || '-%' then 3
                when length(public.slug_de(l.nome)) >= 4 and '-' || q.t || '-' like '%-' || public.slug_de(l.nome) || '-%' then 3
                when length(q.t) >= 4 and public.slug_de(l.nome) like '%' || q.t || '%' then 2
                else 0 end as direto,
           (select count(*) from unnest(public.guia_whats_palavras(l.slug)) w where w = any(q.pw))::int as comuns,
           cardinality(public.guia_whats_palavras(l.slug)) as total
      from public.guia_lugares l, q
     where l.status = 'publicado' and cardinality(q.pw) > 0 and string_to_array(l.slug, '-') && q.pw
  ),
  p as (
    select *, case when direto > 0 then direto + comuns::numeric / 10
                   when total > 0 and comuns >= 1 and (comuns >= 2 or comuns * 2 >= total) then 1 + comuns::numeric / 10
                   else 0 end as pontos
      from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'cidade', x.cidade) order by x.pontos desc, length(x.nome)), '[]'::jsonb)
    from (select * from p where pontos > 0 and pontos = (select max(pontos) from p) order by pontos desc, length(nome) limit 3) x
$$;

-- o contexto ganha quantas respostas a Mel já deu a esse número hoje (dia de Brasília)
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  r jsonb;
begin
  -- a limpeza (de vez em quando): o que passou da retenção; as de teste, depois de um dia
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c where c.chave = k and c.atualizada_em > now() - interval '24 hours' order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'respostas_hoje', (select count(*) from public.guia_whats_conversas c, jsonb_array_elements(c.mensagens) m
                         where c.chave = k and c.atualizada_em > now() - interval '2 days' and m ->> 'q' = 'mel' and m ? 'em'
                           and (m ->> 'em')::timestamptz >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days' and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer')
                    order by ld.criado_em desc limit 1)
  ) into r;
  return r;
end $$;

-- a configuração salva o teto de respostas
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
      mostrar_contato_salao = coalesce((c ->> 'mostrar_contato_salao')::boolean, g.mostrar_contato_salao),
      limite_dia = coalesce((c ->> 'limite_dia')::integer, g.limite_dia),
      limite_respostas = coalesce((c ->> 'limite_respostas')::integer, g.limite_respostas),
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

-- ---- o link rastreável do pedido ao salão (3.49.6): sabe-se quando o salão abriu aquele pedido -------------------
-- cada pedido nasce com um token único e curto; o {link} da mensagem ao salão passa a apontar para mimo.com.vc/r/<token>,
-- que registra o clique e leva o salão para a conversa com a cliente. O token só serve para aquele pedido e some com ele.
alter table public.guia_whats_leads add column if not exists token text;
alter table public.guia_whats_leads add column if not exists clicou_em timestamptz;
alter table public.guia_whats_leads add column if not exists cliques integer not null default 0;
alter table public.guia_whats_leads alter column token set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
update public.guia_whats_leads set token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 16) where token is null;
create unique index if not exists guia_whats_leads_token on public.guia_whats_leads (token);

-- o clique do salão no link do pedido (anônimo: quem tem o link é o salão): conta o clique, marca a primeira vez e
-- devolve o contato da cliente para o site abrir a conversa. Não expõe nada que o salão já não receba na mensagem.
create or replace function public.guia_whats_clique(token_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ld public.guia_whats_leads;
begin
  if token_ is null or length(token_) not between 8 and 40 then return jsonb_build_object('ok', false); end if;
  update public.guia_whats_leads
     set cliques = cliques + 1, clicou_em = coalesce(clicou_em, now())
   where token = token_
   returning * into ld;
  if ld.id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'cliente_tel', ld.cliente_tel, 'cliente_nome', ld.cliente_nome, 'salao', ld.salao_nome, 'servico', ld.servico);
end $$;
revoke all on function public.guia_whats_clique(text) from public;
grant execute on function public.guia_whats_clique(text) to anon, authenticated;

-- o painel ganha quem abriu a conversa (clicou no link) e o clicou_em/cliques por pedido
create or replace function public.guia_whats_painel(dias_ integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 7), 90)));
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o WhatsApp do guia'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.guia_whats_config c where c.id = 1),
    'totais', jsonb_build_object(
      'conversas', (select count(*) from public.guia_whats_conversas where not teste and criada_em >= desde),
      'pedidos', (select count(*) from public.guia_whats_leads where criado_em >= desde),
      'enviados', (select count(*) from public.guia_whats_leads where criado_em >= desde and enviado_em is not null),
      'falhas', (select count(*) from public.guia_whats_leads where criado_em >= desde and status in ('falhou', 'fora_do_limite')),
      'sem_contato', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'sem_contato'),
      'responderam', (select count(*) from public.guia_whats_leads where criado_em >= desde and salao_respondeu_em is not null),
      'querem', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'salao_quer_conhecer'),
      'abriram', (select count(*) from public.guia_whats_leads where criado_em >= desde and clicou_em is not null),
      'enviados_hoje', (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou'),
      'saloes_sairam', (select count(*) from public.guia_whats_saidas where quem = 'salao')),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
                  select id, conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, observacao, salao_tel, status,
                         erro, enviado_em, salao_respondeu_em, resposta_salao, atendido, clicou_em, cliques, criado_em
                    from public.guia_whats_leads where criado_em >= desde order by criado_em desc limit 300) x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                    select c.id, c.telefone, c.estado, c.atualizada_em, c.criada_em, c.lead_id, l.nome as salao, l.cidade,
                           jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima
                      from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id
                     where not c.teste and c.atualizada_em >= desde order by c.atualizada_em desc limit 100) x));
end $$;

-- ---- a conversa de volta do salão, amarrada ao pedido certo (3.49.7) ----------------------------------------------
-- o salão que recebeu o pedido responde pelo nosso número. A gente identifica a qual pedido (agendamento) a resposta
-- se refere e guarda o vai e vem, para a Plataforma mostrar a continuação. Qual pedido: a mensagem citada (quando o
-- salão responde citando a nossa, com o link/token dentro) manda; senão o pedido cujo link o salão tocou por último
-- (clicou_em); senão o mais recente. As mensagens do salão ficam numa thread no próprio pedido.
alter table public.guia_whats_leads add column if not exists salao_mensagens jsonb not null default '[]'::jsonb;

-- resolve o pedido deste salão por um token (o da mensagem citada): só se for um pedido enviado a este número
create or replace function public.guia_whats_lead_do_salao(tel_ text, token_ text)
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.guia_whats_leads
   where token = token_ and token_ is not null
     and salao_chave = public.guia_whats_chave(tel_)
     and criado_em > now() - interval '60 days'
   order by criado_em desc limit 1
$$;

-- o salão respondeu: guarda a mensagem na thread do pedido (até 60), mantém o resumo e marca o status/a hora
create or replace function public.guia_whats_salao_respondeu(lead_ bigint, texto_ text, quer_ boolean)
returns void language plpgsql security definer set search_path = public as $$
declare t text := left(btrim(coalesce(texto_, '')), 1000); novas jsonb;
begin
  select case when t = '' then salao_mensagens
              else salao_mensagens || jsonb_build_object('em', now(), 'texto', t) end
    into novas from public.guia_whats_leads where id = lead_;
  if novas is null then return; end if;
  while jsonb_array_length(novas) > 60 loop novas := novas - 0; end loop;
  update public.guia_whats_leads set
    status = case when quer_ then 'salao_quer_conhecer' when status = 'salao_quer_conhecer' then status else 'salao_respondeu' end,
    salao_respondeu_em = coalesce(salao_respondeu_em, now()),
    resposta_salao = left(coalesce(resposta_salao || E'\n', '') || t, 1000),
    salao_mensagens = novas
   where id = lead_;
end $$;

-- o contexto do número escolhe o pedido do salão preferindo o que ele tocou por último (clicou_em), depois o mais recente;
-- e o painel traz a thread (salao_mensagens) de cada pedido
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  r jsonb;
begin
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c where c.chave = k and c.atualizada_em > now() - interval '24 hours' order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'respostas_hoje', (select count(*) from public.guia_whats_conversas c, jsonb_array_elements(c.mensagens) m
                         where c.chave = k and c.atualizada_em > now() - interval '2 days' and m ->> 'q' = 'mel' and m ? 'em'
                           and (m ->> 'em')::timestamptz >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days' and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer')
                    order by ld.clicou_em desc nulls last, ld.criado_em desc limit 1)
  ) into r;
  return r;
end $$;

-- o painel traz a thread do salão (salao_mensagens) em cada pedido
create or replace function public.guia_whats_painel(dias_ integer default 7)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan as $$
declare
  desde timestamptz := now() - make_interval(days => greatest(1, least(coalesce(dias_, 7), 90)));
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o WhatsApp do guia'; end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.guia_whats_config c where c.id = 1),
    'totais', jsonb_build_object(
      'conversas', (select count(*) from public.guia_whats_conversas where not teste and criada_em >= desde),
      'pedidos', (select count(*) from public.guia_whats_leads where criado_em >= desde),
      'enviados', (select count(*) from public.guia_whats_leads where criado_em >= desde and enviado_em is not null),
      'falhas', (select count(*) from public.guia_whats_leads where criado_em >= desde and status in ('falhou', 'fora_do_limite')),
      'sem_contato', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'sem_contato'),
      'responderam', (select count(*) from public.guia_whats_leads where criado_em >= desde and salao_respondeu_em is not null),
      'querem', (select count(*) from public.guia_whats_leads where criado_em >= desde and status = 'salao_quer_conhecer'),
      'abriram', (select count(*) from public.guia_whats_leads where criado_em >= desde and clicou_em is not null),
      'enviados_hoje', (select count(*) from public.guia_whats_leads where enviado_em >= hoje_ini and status <> 'falhou'),
      'saloes_sairam', (select count(*) from public.guia_whats_saidas where quem = 'salao')),
    'pedidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb) from (
                  select id, conversa_id, lugar_id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, observacao, salao_tel, status,
                         erro, enviado_em, salao_respondeu_em, resposta_salao, salao_mensagens, atendido, clicou_em, cliques, criado_em
                    from public.guia_whats_leads where criado_em >= desde order by criado_em desc limit 300) x),
    'conversas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.atualizada_em desc), '[]'::jsonb) from (
                    select c.id, c.telefone, c.estado, c.atualizada_em, c.criada_em, c.lead_id, l.nome as salao, l.cidade,
                           jsonb_array_length(c.mensagens) as n, c.mensagens -> -1 ->> 't' as ultima
                      from public.guia_whats_conversas c left join public.guia_lugares l on l.id = c.lugar_id
                     where not c.teste and c.atualizada_em >= desde order by c.atualizada_em desc limit 100) x));
end $$;

revoke execute on function public.guia_whats_lead_do_salao(text, text) from public, anon, authenticated;

-- ===== os dados do cadastro na aba Cadastros (estava na 197) =====
-- a função já existe na produção com o tipo de retorno antigo (sem 'cadastro'); create or replace não troca o
-- tipo de retorno, então derruba antes. drop if exists é seguro mesmo quando ela ainda não existe.
drop function if exists public.plataforma_cadastros(integer);
create or replace function public.plataforma_cadastros(dias_ integer default 30)
returns table (
  id uuid, nome text, tipo text, slug text, cidade text, ativo boolean, criado_em timestamptz,
  dona text, dona_email text, dona_telefone text,
  plano text, teste_ate timestamptz,
  servicos jsonb, servicos_n integer, profissionais integer, horarios integer, clientes integer, atendimentos integer,
  cadastro jsonb
)
language sql stable security definer set search_path = public as $$
  select
    s.id, s.name, s.tipo, s.slug, s.city, s.active, s.created_at,
    (select full_name from public.profiles where id = s.owner_id),
    (select email from auth.users where id = s.owner_id),
    coalesce(s.phone, (select phone from public.profiles where id = s.owner_id)),
    (select situacao from public.assinaturas a where a.salon_id = s.id),
    (select teste_ate from public.assinaturas a where a.salon_id = s.id),
    (select coalesce(jsonb_agg(jsonb_build_object('nome', sv.name, 'preco', sv.price, 'minutos', sv.duration_minutes) order by sv.created_at), '[]'::jsonb)
       from public.services sv where sv.salon_id = s.id and sv.active),
    (select count(*)::integer from public.services sv where sv.salon_id = s.id and sv.active),
    (select count(*)::integer from public.professionals p where p.salon_id = s.id and p.active),
    (select count(*)::integer from public.business_hours b where b.salon_id = s.id and b.open),
    (select count(*)::integer from public.vinculos v where v.salon_id = s.id and v.saiu_em is null),
    (select count(*)::integer from public.appointments ap where ap.salon_id = s.id and ap.status = 'concluido'),
    -- os dados informados no cadastro/ativação (documento, CPF/CNPJ, nascimento, RG, endereço e endereço fiscal).
    -- Dado sensível: só a Plataforma lê (eh_plataforma abaixo). O número do CPF/CNPJ é o que o salão informou.
    jsonb_strip_nulls(jsonb_build_object(
      'documento_tipo', s.documento_tipo,
      'cnpj', nullif(s.cnpj, ''),
      'razao_social', nullif(s.razao_social, ''),
      'nome_fantasia', nullif(s.nome_fantasia, ''),
      'responsavel', nullif(s.responsavel_nome, ''),
      'cpf', coalesce(nullif(s.responsavel_cpf, ''), (select nullif(cpf, '') from public.profiles where id = s.owner_id)),
      'rg', nullif(s.responsavel_rg, ''),
      'nascimento', coalesce(s.responsavel_nascimento, (select nascimento from public.profiles where id = s.owner_id)),
      'endereco', nullif(trim(both ', ' from concat_ws(', ', nullif(s.address, ''), nullif(s.bairro, ''),
                    nullif(concat_ws('/', nullif(s.city, ''), nullif(s.uf, '')), ''), nullif(s.cep, ''))), ''),
      'endereco_fiscal', case when s.endereco_igual is false then s.endereco_fiscal else null end
    ))
  from public.salons s
  where public.eh_plataforma()
    and s.created_at >= now() - make_interval(days => greatest(1, least(coalesce(dias_, 30), 365)))
  order by s.created_at desc
$$;

revoke execute on function public.plataforma_cadastros(integer) from public, anon;
grant execute on function public.plataforma_cadastros(integer) to authenticated;

do $$
begin
  raise notice '198: reaplicadas as funcoes do WhatsApp do guia e a plataforma_cadastros com os dados do cadastro';
end $$;
