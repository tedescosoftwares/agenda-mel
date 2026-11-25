-- 262: a Mel indica salões, lembra do pedido e avisa a cliente do "sim" do salão (4.7, pacote 2 das conversas reais)
--   1. Indicar: quem escreve sem salão definido ("quero fazer unha em Santos", "Sou de Santos", "Nail designer") recebe
--      até 3 salões da cidade para o serviço, numerados (guia_whats_indicar). A cidade sai da frase (ou do que a Mel já
--      sabia, ou do último pedido dela); o serviço vira categoria (guia_categoria_do_texto) e palavras que se procuram
--      nos serviços do cadastro. Só entra salão que recebe pedido pelo WhatsApp (ou que agenda pela MIMO), e nunca o
--      que ela já tentou nos últimos 7 dias nem o de nome inválido (261).
--   2. Lembrar (48 h): guia_whats_contexto devolve "memoria" (o último pedido dela nas últimas 48 h, com a situação:
--      enviado, visto, o voto do salão; o nome e a cidade dos últimos 60 dias). Com ela, "o salão respondeu?" recebe a
--      situação de verdade em vez de "de qual salão?", e o nome não é pedido de novo. A conversa com salões oferecidos
--      (a oferta do resgate) fica visível por 48 h, para o "2" de quem só respondeu no dia seguinte.
--   3. Avisar do "sim": o salão que vota "sim" passa a gerar um aviso à cliente (avisar_cliente_sim,
--      msg_cliente_vai_atender; ligado de fábrica). guia_whats_conversa_anotar guarda na conversa do pedido o que a Mel
--      mandou por conta própria (o aviso, a situação) e devolve as dúvidas depois do envio.
-- Idempotente (add column if not exists / create or replace).

alter table public.guia_whats_config add column if not exists avisar_cliente_sim boolean not null default true;
alter table public.guia_whats_config add column if not exists msg_cliente_vai_atender text not null
  default 'Boa notícia, {nome}! 💗 O {salao} confirmou que vai te atender e vai te chamar aqui no WhatsApp para combinar o horário.'
  check (length(msg_cliente_vai_atender) between 5 and 1500);

-- ---- 1. indicar ----------------------------------------------------------------------------------------------------
-- o serviço dito em palavras de cliente vira a categoria do guia (nulo quando a frase não diz serviço nenhum)
create or replace function public.guia_categoria_do_texto(t text)
returns text language sql immutable set search_path = public as $$
  select case
    when n ~ '\y(cilios?|lash|lashes|extensao de cilios|volume russo|fio a fio|lash lifting)\y' then 'cilios'
    when n ~ '\y(sobrancelhas?|brow|brows|micropigmentacao|microblading|henna|design de sobrancelhas?)\y' then 'sobrancelhas'
    when n ~ '\y(unhas?|manicure|manicures|pedicure|pedicures|nail|nails|esmaltacao|esmalteria|alongamento|fibra de vidro|blindagem|pe e mao|mao e pe|fazer (a|as|o|os) (mao|maos|pe|pes))\y' then 'unhas'
    when n ~ '\y(maquiagem|maquiadora|maquiador|make|makeup|make up)\y' then 'maquiagem'
    when n ~ '\y(cabelo|cabelos|cabeleireir[ao]s?|cabelereir[ao]s?|hair|corte|cortar|escova|progressiva|luzes|mechas|coloracao|tintura|tingir|pintar o cabelo|hidratacao|selagem|alisamento|botox capilar|tranca|trancas|box braids|mega hair|megahair|penteado|cachos|cronograma capilar|reconstrucao)\y' then 'cabelo'
    when n ~ '\y(estetica|esteticista|depilacao|depilar|cera|laser|limpeza de pele|massagem|massagens|massoterapia|drenagem|drenagem linfatica|bronze|bronzeamento|podologia|podologa|peeling|botox|harmonizacao|spa|skincare|skin care|facial|corporal|lipo|criolipolise|ventosa)\y' then 'estetica'
  end
    from (select trim(regexp_replace(translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) as n) x
$$;
comment on function public.guia_categoria_do_texto(text) is 'Guia (262): a categoria do serviço dito pela cliente ("fazer a mão" = unhas, "limpeza de pele" = estetica); nulo sem serviço.';

-- até n_ salões para a cliente sem salão definido. texto_ = a mensagem de agora; cidade_, categoria_ e servico_ = o que a
-- Mel já sabia das mensagens de antes (a cidade pelo slug, a categoria, a frase do serviço); chave_ = o número dela (para
-- a cidade do último pedido e para não repetir quem ela já tentou); fora_ = os salões já mostrados.
-- O que a mensagem de agora traz manda: cidade nova troca a cidade, serviço de outra categoria troca o serviço.
create or replace function public.guia_whats_indicar(texto_ text, cidade_ text default null, categoria_ text default null, servico_ text default null,
                                                     chave_ text default null, fora_ uuid[] default '{}', n_ integer default 3)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t_agora text := public.slug_de(left(coalesce(texto_, ''), 300));
  t_servico text;
  cidade_s text;
  cidade_n text;
  presumida boolean := false;
  cat_agora text := public.guia_categoria_do_texto(texto_);
  cat text;
  ws text[];
  bairro_ text;
  ops jsonb := '[]'::jsonb;
  achou_servico boolean := false;
  limite integer := greatest(1, least(coalesce(n_, 3), 5));
begin
  -- a cidade: a da mensagem de agora; senão a que a Mel já sabia; senão a do último pedido dela (60 dias)
  select c.cidade_slug, c.cidade into cidade_s, cidade_n
    from (select distinct l.cidade_slug, l.cidade from public.guia_lugares l where l.status = 'publicado') c
   where '-' || t_agora || '-' like '%-' || c.cidade_slug || '-%' order by length(c.cidade_slug) desc limit 1;
  if cidade_s is null and nullif(cidade_, '') is not null then
    select l.cidade_slug, l.cidade into cidade_s, cidade_n from public.guia_lugares l where l.cidade_slug = cidade_ and l.status = 'publicado' limit 1;
  end if;
  if cidade_s is null and chave_ is not null then
    select l.cidade_slug, l.cidade into cidade_s, cidade_n
      from public.guia_whats_leads ld join public.guia_lugares l on l.id = ld.lugar_id
     where ld.cliente_chave = chave_ and ld.criado_em > now() - interval '60 days' and l.status = 'publicado'
     order by ld.criado_em desc limit 1;
    presumida := cidade_s is not null;
  end if;
  -- o serviço: a categoria (a da mensagem de agora manda) e as palavras que se procuram nos serviços do cadastro. A frase
  -- de antes só entra quando a de agora não trouxe um serviço de outra categoria ("na verdade quero cabelo").
  cat := coalesce(cat_agora, nullif(categoria_, ''));
  t_servico := btrim(case when cat_agora is not null and cat_agora is distinct from nullif(categoria_, '') then t_agora
                          else public.slug_de(left(coalesce(servico_, ''), 300)) || '-' || t_agora end, '-');
  select coalesce(array_agg(distinct w), '{}'::text[]) into ws
    from unnest(string_to_array(t_servico, '-')) w
   where length(w) >= 4
     and (cidade_s is null or not (w = any (string_to_array(cidade_s, '-'))))
     and w not in ('para', 'com', 'quero', 'queria', 'gostaria', 'fazer', 'marcar', 'agendar', 'horario', 'servico', 'servicos', 'qualquer', 'algum',
                   'alguma', 'tarde', 'manha', 'noite', 'sabado', 'domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'feira', 'semana',
                   'hoje', 'amanha', 'depois', 'cedo', 'minha', 'tambem', 'salao', 'saloes', 'studio', 'estudio', 'espaco', 'indicar', 'indica',
                   'indicacao', 'preciso', 'procuro', 'procurando', 'perto', 'bairro', 'cidade', 'moro', 'onde', 'aqui', 'voce', 'voces', 'pode',
                   'saber', 'sobre', 'valor', 'valores', 'preco', 'precos', 'quanto', 'custa', 'como', 'funciona', 'obrigada', 'obrigado', 'favor',
                   'tudo', 'esta', 'estou', 'tenho', 'mais', 'outro', 'outros', 'outra', 'outras', 'nenhum', 'nenhuma', 'designer', 'design', 'beleza',
                   'verdade', 'melhor', 'muito', 'pouco', 'quando', 'porque', 'ainda', 'agora', 'entao', 'assim', 'essa', 'esse', 'isso', 'dela', 'dele');
  if cidade_s is null then
    return jsonb_build_object('cidade', null, 'presumida', false, 'categoria', cat, 'bairro', null, 'tem_servico', cat is not null,
                              'servico_agora', cat_agora is not null, 'opcoes', '[]'::jsonb);
  end if;
  -- o bairro, quando ela disse um bairro da cidade ("no Gonzaga")
  select b.bairro into bairro_
    from (select distinct l.bairro from public.guia_lugares l where l.cidade_slug = cidade_s and l.status = 'publicado' and l.bairro is not null) b
   where length(public.slug_de(b.bairro)) >= 4 and public.slug_de(b.bairro) <> cidade_s
     and '-' || t_servico || '-' like '%-' || public.slug_de(b.bairro) || '-%'
   order by length(b.bairro) desc limit 1;

  with tentados as (select distinct x.lugar_id from public.guia_whats_leads x
                     where chave_ is not null and x.cliente_chave = chave_ and x.criado_em > now() - interval '7 days' and x.lugar_id is not null),
  hist as (select x.lugar_id, count(*) as pedidos,
                  count(*) filter (where x.clicou_em is not null or x.voto = 'sim' or x.salao_respondeu_em is not null) as sinal
             from public.guia_whats_leads x
            where x.criado_em > now() - interval '60 days' and x.lugar_id is not null and x.enviado_em is not null
            group by x.lugar_id),
  c as (
    select l.id, l.nome, l.bairro, s.subdominio as agendar,
           (case when cardinality(ws) > 0 and exists (select 1 from unnest(l.servicos) sv cross join unnest(ws) w where public.slug_de(sv) like '%' || w || '%') then 2 else 0 end
            + case when cat is not null and l.categoria = cat then 1.5 else 0 end
            + case when cat is not null and l.categoria = 'beleza' and cat <> 'beleza' then 0.5 else 0 end)::numeric as afinidade,
           case when s.subdominio is not null then 0 when coalesce(h.sinal, 0) > 0 then 1 when coalesce(h.pedidos, 0) = 0 then 2 else 3 end as faixa,
           coalesce(l.pontos, 0) as pontos, (bairro_ is not null and l.bairro = bairro_) as no_bairro
      from public.guia_lugares l
      left join public.salons s on s.id = l.salon_id
      left join hist h on h.lugar_id = l.id
     where l.cidade_slug = cidade_s and l.status = 'publicado'
       and not (l.id = any (coalesce(fora_, '{}'::uuid[])))
       and not public.guia_nome_invalido(l.nome)
       and not exists (select 1 from tentados t where t.lugar_id = l.id)
       and (s.subdominio is not null
            or (l.whatsapp_invalido_em is null and public.guia_whats_do_salao(l.whatsapp, l.telefone) is not null
                and not exists (select 1 from public.guia_whats_saidas sd where sd.quem = 'salao'
                                  and sd.chave = public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone)))))
       and not (coalesce(h.pedidos, 0) >= 3 and coalesce(h.sinal, 0) = 0)
  ),
  ordem as (select c.*, row_number() over (order by c.afinidade desc, c.no_bairro desc, c.faixa, c.pontos desc, c.nome) as pos from c where c.afinidade > 0)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'bairro', bairro, 'cidade', cidade_n, 'agendar', agendar) order by pos) filter (where pos <= limite), '[]'::jsonb),
         count(*) > 0
    into ops, achou_servico
    from ordem;
  return jsonb_build_object('cidade', jsonb_build_object('slug', cidade_s, 'nome', cidade_n), 'presumida', presumida, 'categoria', cat, 'bairro', bairro_,
                            'tem_servico', cat is not null or achou_servico, 'servico_agora', cat_agora is not null, 'opcoes', ops);
end $$;
revoke execute on function public.guia_whats_indicar(text, text, text, text, text, uuid[], integer) from public, anon, authenticated;

-- ---- 2. lembrar ------------------------------------------------------------------------------------------------------
-- o contexto da 205, com a memória: o último pedido dela (48 h), o nome e a cidade (60 dias); e a conversa com salões
-- oferecidos visível por 48 h
create or replace function public.guia_whats_contexto(tel_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.guia_whats_chave(tel_);
  cv public.guia_whats_conversas;
  ocioso integer := greatest(1, least(coalesce((select ocioso_horas from public.guia_whats_config where id = 1), 24), 168));
  r jsonb;
begin
  if random() < 0.02 then
    delete from public.guia_whats_leads where criado_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1));
    delete from public.guia_whats_conversas where atualizada_em < now() - make_interval(days => (select retencao_dias from public.guia_whats_config where id = 1))
       or (teste and atualizada_em < now() - interval '1 day');
  end if;
  select * into cv from public.guia_whats_conversas c
   where c.chave = k and (c.atualizada_em > now() - make_interval(hours => ocioso)
                          or (c.dados ? 'opcoes' and c.atualizada_em > now() - interval '48 hours'))
   order by c.atualizada_em desc limit 1;
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'atualizado_por' from public.guia_whats_config c where c.id = 1),
    'saida', (select s.quem from public.guia_whats_saidas s where s.chave = k),
    'conversa', case when cv.id is null then null else to_jsonb(cv) - 'chave' || jsonb_build_object('lugar', case when cv.lugar_id is null then null else public.guia_whats_lugar(null, null, cv.lugar_id) end) end,
    'respostas_hoje', (select count(*) from public.guia_whats_conversas c, jsonb_array_elements(c.mensagens) m
                         where c.chave = k and c.atualizada_em > now() - interval '2 days' and m ->> 'q' = 'mel' and m ? 'em'
                           and (m ->> 'em')::timestamptz >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')),
    'lead_salao', (select jsonb_build_object('id', ld.id, 'salao_nome', ld.salao_nome, 'status', ld.status, 'ja_respondeu', ld.salao_respondeu_em is not null, 'voto', ld.voto)
                     from public.guia_whats_leads ld
                    where ld.salao_chave = k and ld.criado_em > now() - interval '30 days'
                      and ld.status in ('enviado', 'salao_respondeu', 'salao_quer_conhecer', 'salao_vai_atender', 'salao_nao_atende')
                    order by ld.clicou_em desc nulls last, ld.criado_em desc limit 1),
    -- 262: o que a Mel lembra de quem escreve (como cliente). Conversas de teste não deixam pedido, então não entram.
    'memoria', jsonb_build_object(
      'lead', (select jsonb_build_object('id', ld.id, 'conversa_id', ld.conversa_id, 'lugar_id', ld.lugar_id, 'salao_nome', ld.salao_nome, 'cidade', ld.cidade,
                                         'cliente_nome', ld.cliente_nome, 'servico', ld.servico, 'status', ld.status, 'voto', ld.voto,
                                         'viu', ld.clicou_em is not null or ld.salao_respondeu_em is not null, 'ofereceu', ld.resgate_em is not null,
                                         'minutos', (extract(epoch from now() - coalesce(ld.enviado_em, ld.criado_em)) / 60)::bigint)
                 from public.guia_whats_leads ld
                where ld.cliente_chave = k and ld.criado_em > now() - interval '48 hours'
                order by ld.criado_em desc limit 1),
      'nome', (select ld.cliente_nome from public.guia_whats_leads ld
                where ld.cliente_chave = k and ld.cliente_nome is not null and ld.criado_em > now() - interval '60 days'
                order by ld.criado_em desc limit 1))
  ) into r;
  return r;
end $$;

-- guarda na conversa do pedido o que a Mel mandou por conta própria (o aviso do "sim", a situação do pedido) e a pergunta
-- da cliente que puxou isso. A conversa volta a contar as dúvidas depois do envio do zero. Não muda o estado.
create or replace function public.guia_whats_conversa_anotar(lead_ bigint, novas_ jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  novas jsonb := case when jsonb_typeof(novas_) = 'array' then novas_ else '[]'::jsonb end;
  n bigint;
begin
  select * into ld from public.guia_whats_leads where id = lead_;
  if ld.id is null or ld.conversa_id is null then return null; end if;
  update public.guia_whats_conversas c set
    mensagens = (select coalesce(jsonb_agg(m order by o), '[]'::jsonb) from (
                   select m, o from jsonb_array_elements(c.mensagens || novas) with ordinality as e(m, o) order by o desc limit 60) t),
    dados = case when c.estado = 'enviado' then c.dados || jsonb_build_object('pos_envio', 0) else c.dados end,
    cutucada_em = null, atualizada_em = now()
   where c.id = ld.conversa_id and not c.teste
  returning c.id into n;
  return n;
end $$;
revoke execute on function public.guia_whats_conversa_anotar(bigint, jsonb) from public, anon, authenticated;

do $$
begin
  raise notice '262: a Mel indica e lembra (guia_categoria_do_texto, guia_whats_indicar, memoria no guia_whats_contexto, guia_whats_conversa_anotar, avisar_cliente_sim)';
end $$;
