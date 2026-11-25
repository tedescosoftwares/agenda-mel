-- 261: a Mel sem tropeços (4.6, pacote 1 das conversas reais)
-- Tirado de 507 conversas da Mel (22/10 a 24/11):
--   1. Nome que não é nome ("Não funciona mais", "mão tem empresa", "É sobre estética", "m", ".") não entra na busca
--      por nome: "como funciona" mandava o pedido para o "Não funciona mais". E a busca ficou mais exigente: uma palavra
--      só do nome, solta numa frase longa, não basta. O bairro volta junto, para a Mel confirmar o salão com a cliente.
--   2. A resposta automática do WhatsApp Business ("fora do horário", "seja bem-vinda") não é resposta do salão:
--      guia_whats_salao_respondeu ganha auto_ e, com ele, só guarda o texto na conversa do salão (marcado "auto"), sem
--      salao_respondeu_em. Antes, ela desligava o resgate e a cliente ficava esperando um salão que não respondeu.
--   3. O lembrete "parou por aqui" conforme a etapa: guia_whats_ociosas devolve, por conversa, a etapa, o salão e o que
--      já foi anotado (o texto é montado na função), e só cutuca quem já tem salão. Conversa parada SEM salão fecha
--      quieta: era ela que recebia "Quer que eu envie seu pedido?" e, no "pode enviar", voltava para "De qual salão?".
--   4. A cliente que pediu para parar ("parar", "encerrar", "para de mandar mensagem") entra em guia_whats_saidas como
--      'cliente': o resgate não oferece mais salões para ela, e a função sabe (guia_whats_cliente_saiu) antes de avisar
--      do voto do salão. Ela sai da lista quando escrever de novo.
-- Idempotente (create or replace; a troca de assinatura de guia_whats_salao_respondeu derruba a antiga antes).

-- ---- 1. nome que não é nome, e a busca por nome -------------------------------------------------------------------
-- As mesmas regras do "nome inválido" da conferência do guia (comercios_invalidos.sql): menos de 3 letras, ou o nome diz
-- que o lugar não existe, fechou, mudou. "Teste" fica de fora: o salão de teste da equipe se chama assim.
create or replace function public.guia_nome_invalido(nome text)
returns boolean language sql immutable set search_path = public as $$
  select length(regexp_replace(t, '[^a-z]', '', 'g')) < 3
      or t ~ '(\y(nao|mao) (funciona|existe|existem|tem empresa|atende|trabalh)|\yfechad[oa]s?\y|\yfechou\y|desativad|encerrad|\yinativ|\ymudou\y|^e sobre\y|\yxxxx|^(sem nome|nome|empresa|null|undefined)$)'
    from (select trim(regexp_replace(translate(lower(coalesce(nome, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) as t) n
$$;
comment on function public.guia_nome_invalido(text) is 'Guia (261): o nome não é nome de lugar (menos de 3 letras, "não funciona mais", "fechado"...). Fica fora da busca da Mel.';

-- a busca da Mel por nome (198), mais exigente:
--   - nome inválido fica fora;
--   - cidade citada na frase ("sou de Santos", "massagem em Caçapava") restringe a busca àquela cidade, e nome de cidade
--     não conta como palavra do salão (o "Studio Santos" não aparece para quem só disse de onde é);
--   - uma palavra só em comum vale apenas quando a frase é quase só o nome (até 2 palavras que contam, sem as de
--     conversa: "saber", "valores", "amanhã"...) e o nome tem uma palavra só que conta. Com mais palavras no nome, são
--     precisas 2 em comum, cobrindo metade dele;
--   - o nome feito só de palavras comuns ("Studio RH") é achado quando aparece inteiro na frase;
--   - o bairro volta junto: a Mel confirma o salão com a cliente antes de seguir.
create or replace function public.guia_whats_buscar(texto_ text)
returns jsonb language sql stable security definer set search_path = public as $$
  with cid as (select coalesce(array_agg(distinct cidade_slug), '{}'::text[]) as slugs from public.guia_lugares where status = 'publicado'),
  q0 as (select public.slug_de(left(coalesce(texto_, ''), 300)) as t, public.guia_whats_palavras(texto_) as pw),
  q as (
    select q0.t, q0.pw,
           array(select s from unnest(cid.slugs) s where '-' || q0.t || '-' like '%-' || s || '-%') as cidades,
           array(select w from unnest(q0.pw) w
                  where not exists (select 1 from unnest(cid.slugs) s where w = any (string_to_array(s, '-')))
                    and w not in ('saber', 'sobre', 'valor', 'valores', 'preco', 'precos', 'quanto', 'custa', 'funciona', 'hoje', 'amanha',
                                  'semana', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo', 'manha', 'depois', 'agora',
                                  'vaga', 'vagas', 'consigo', 'consegue', 'faz', 'tambem', 'oii', 'oie', 'marca', 'marcado', 'combinar')) as pw2
      from q0, cid
  ),
  -- os candidatos, pelo que é barato (as palavras em comum, ou o endereço do salão inteiro na frase); o resto só neles
  c0 as materialized (
    select l.id, l.nome, l.cidade, l.cidade_slug, l.bairro, l.slug
      from public.guia_lugares l, q
     where l.status = 'publicado'
       and ((cardinality(q.pw) > 0 and string_to_array(l.slug, '-') && q.pw)
            or (length(l.slug) >= 6 and strpos(l.slug, '-') > 0 and '-' || q.t || '-' like '%-' || l.slug || '-%'))
  ),
  c as (
    select c0.id, c0.nome, c0.cidade, c0.bairro,
           case when length(c0.slug) >= 4 and '-' || q.t || '-' like '%-' || c0.slug || '-%' then 3
                when length(public.slug_de(c0.nome)) >= 4 and '-' || q.t || '-' like '%-' || public.slug_de(c0.nome) || '-%' then 3
                when length(q.t) >= 4 and public.slug_de(c0.nome) like '%' || q.t || '%' then 2
                else 0 end as direto,
           (select count(*) from unnest(public.guia_whats_palavras(c0.slug)) w where w = any (q.pw2))::int as comuns,
           cardinality(public.guia_whats_palavras(c0.slug)) as total,
           cardinality(q.pw2) as da_frase
      from c0, q
     where not public.guia_nome_invalido(c0.nome)
       -- a cidade citada restringe, a não ser que ela faça parte do próprio nome ("Lorena Nails" em Jacareí)
       and (cardinality(q.cidades) = 0 or c0.cidade_slug = any (q.cidades)
            or exists (select 1 from unnest(q.cidades) s where '-' || c0.slug || '-' like '%-' || s || '-%'))
       -- o nome só de palavras comuns ("Studio RH") vale inteiro na frase, se tiver alguma palavra que não é de todo salão
       and (string_to_array(c0.slug, '-') && q.pw
            or exists (select 1 from unnest(string_to_array(c0.slug, '-')) w
                        where w !~ '^[0-9]+$' and w not in ('de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'no', 'na', 'studio', 'estudio',
                          'salao', 'espaco', 'beleza', 'cabelo', 'hair', 'beauty', 'estetica', 'unhas', 'nails', 'nail', 'spa', 'clinica',
                          'centro', 'instituto', 'atelie', 'manicure', 'esmalteria', 'cabeleireiro', 'cabeleireira', 'cabeleireiros')))
  ),
  p as (
    select *, case when direto > 0 then direto + comuns::numeric / 10
                   when total > 0 and comuns >= 2 and comuns * 2 >= total then 1 + comuns::numeric / 10
                   when total = 1 and comuns = 1 and da_frase <= 2 then 1.1
                   else 0 end as pontos
      from c
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'cidade', x.cidade, 'bairro', x.bairro) order by x.pontos desc, length(x.nome)), '[]'::jsonb)
    from (select * from p where pontos > 0 and pontos = (select max(pontos) from p) order by pontos desc, length(nome) limit 3) x
$$;

-- ---- 2. a resposta automática do salão ---------------------------------------------------------------------------
drop function if exists public.guia_whats_salao_respondeu(bigint, text, boolean);
create or replace function public.guia_whats_salao_respondeu(lead_ bigint, texto_ text, quer_ boolean, auto_ boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  t text := left(btrim(coalesce(texto_, '')), 1000);
  novas jsonb;
  lg uuid;
  a public.guia_abordagens;
  novo text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select case when t = '' then salao_mensagens
              else salao_mensagens || (jsonb_build_object('em', now(), 'texto', t) || case when coalesce(auto_, false) then jsonb_build_object('auto', true) else '{}'::jsonb end) end
    into novas from public.guia_whats_leads where id = lead_;
  if novas is null then return; end if;
  while jsonb_array_length(novas) > 60 loop novas := novas - 0; end loop;
  -- 261: a resposta automática fica na conversa do salão para a equipe ver, mas não é resposta (nem desliga o resgate)
  if coalesce(auto_, false) then
    update public.guia_whats_leads set salao_mensagens = novas where id = lead_;
    return;
  end if;
  update public.guia_whats_leads set
    status = case when quer_ then 'salao_quer_conhecer'
                  when status in ('salao_quer_conhecer', 'salao_vai_atender', 'salao_nao_atende') then status
                  else 'salao_respondeu' end,
    salao_respondeu_em = coalesce(salao_respondeu_em, now()),
    resposta_salao = left(coalesce(resposta_salao || E'\n', '') || t, 1000),
    salao_mensagens = novas
   where id = lead_;
  if coalesce(quer_, false) then
    select ld.lugar_id into lg from public.guia_whats_leads ld join public.guia_lugares l on l.id = ld.lugar_id
     where ld.id = lead_ and l.salon_id is null and l.status <> 'removido';
    if lg is not null and not exists (select 1 from public.guia_abordagem_acoes h where h.lugar_id = lg and h.dados ->> 'lead' = lead_::text) then
      insert into public.guia_abordagens (lugar_id) values (lg) on conflict (lugar_id) do nothing;
      select * into a from public.guia_abordagens where lugar_id = lg for update;
      novo := case when a.status in ('negociando', 'cliente') then a.status else 'respondeu' end;
      update public.guia_abordagens set
        status = novo,
        proximo_contato = case when novo = 'cliente' then proximo_contato else least(coalesce(proximo_contato, hoje), hoje) end,
        atualizado_em = now()
       where lugar_id = lg;
      insert into public.guia_abordagem_acoes (lugar_id, tipo, de_status, para_status, texto, proximo_contato, dados)
      values (lg, 'nota', a.status, case when novo is distinct from a.status then novo end,
              'Respondeu QUERO ao pedido da Mel: quer conhecer a MIMO. Chamar hoje.',
              case when novo <> 'cliente' then hoje end,
              jsonb_build_object('origem', 'mel', 'lead', lead_::text));
    end if;
  end if;
end $$;
revoke execute on function public.guia_whats_salao_respondeu(bigint, text, boolean, boolean) from public, anon, authenticated;

-- ---- 3. o lembrete conforme a etapa --------------------------------------------------------------------------------
create or replace function public.guia_whats_ociosas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
  fechadas integer := 0;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ocioso_ativo or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'perguntar', '[]'::jsonb, 'encerrar', '[]'::jsonb);
  end if;
  -- 261: sem salão não há pedido para lembrar: a conversa parada fecha sem mensagem (quem escrever de novo recomeça)
  with f as (
    update public.guia_whats_conversas c set estado = 'encerrada'
     where not c.teste and c.estado = 'conversando' and c.lugar_id is null and not (c.dados ? 'opcoes')
       and c.cutucada_em is null and c.atualizada_em < now() - make_interval(mins => cfg.ocioso_perguntar_min)
    returning 1)
  select count(*) into fechadas from f;
  return jsonb_build_object(
    'ativo', true,
    'instancia', cfg.instancia,
    'texto_perguntar', cfg.msg_ocioso,
    'texto_encerrar', cfg.msg_encerramento,
    'exigir_preferencia', cfg.exigir_preferencia,
    'fechadas_sem_salao', fechadas,
    'perguntar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone, 'estado', x.estado, 'salao', x.salao,
                                                               'nome', x.nome, 'servico', x.servico, 'preferencia', x.preferencia)), '[]'::jsonb) from (
        select c.id, c.telefone, c.estado, l.nome as salao,
               nullif(c.dados ->> 'nome', '') as nome, nullif(c.dados ->> 'servico', '') as servico, nullif(c.dados ->> 'preferencia', '') as preferencia
          from public.guia_whats_conversas c
          join public.guia_lugares l on l.id = c.lugar_id
         where not c.teste and c.estado in ('conversando', 'confirmando') and c.cutucada_em is null and not (c.dados ? 'opcoes')
           and c.atualizada_em < now() - make_interval(mins => cfg.ocioso_perguntar_min)
           and c.atualizada_em > now() - make_interval(hours => cfg.ocioso_horas)
         order by c.atualizada_em limit 50) x),
    'encerrar', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'telefone', x.telefone)), '[]'::jsonb) from (
        select id, telefone from public.guia_whats_conversas
         where not teste and estado in ('conversando', 'confirmando') and cutucada_em is not null and not (dados ? 'opcoes')
           and cutucada_em < now() - make_interval(mins => cfg.ocioso_encerrar_min)
         order by cutucada_em limit 50) x)
  );
end $$;
revoke execute on function public.guia_whats_ociosas() from public, anon, authenticated;

-- ---- 4. a cliente que pediu para parar ----------------------------------------------------------------------------
create or replace function public.guia_whats_cliente_saiu(tel_ text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guia_whats_saidas s where s.chave = public.guia_whats_chave(tel_) and s.quem = 'cliente')
$$;
revoke execute on function public.guia_whats_cliente_saiu(text) from public, anon, authenticated;

-- o relógio dos pedidos (222) sem o resgate para quem pediu para parar
create or replace function public.guia_whats_pendentes()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.guia_whats_config;
  agora_sp time := (now() at time zone 'America/Sao_Paulo')::time;
begin
  select * into cfg from public.guia_whats_config where id = 1;
  if cfg.id is null or not cfg.ligado or cfg.numero is null then
    return jsonb_build_object('ativo', false, 'instancia', coalesce(cfg.instancia, ''), 'demora', '[]'::jsonb, 'cutucar', '[]'::jsonb, 'resgate', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'ativo', (cfg.aviso_demora_min > 0 and cfg.numero_avisos is not null) or cfg.cutucar_salao_min > 0 or cfg.resgate_min > 0,
    'instancia', cfg.instancia,
    'numero_avisos', cfg.numero_avisos,
    'texto_demora', cfg.msg_aviso_demora,
    'texto_cutucar', cfg.msg_cutucar_salao,
    'texto_resgate', cfg.msg_resgate,
    'resgate_opcoes', cfg.resgate_opcoes,
    'resgate_janela', cfg.resgate_min > 0 and agora_sp between cfg.resgate_inicio and cfg.resgate_fim,
    'demora', case when cfg.aviso_demora_min > 0 and cfg.numero_avisos is not null then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, token, salao_tel, enviado_em,
               extract(epoch from now() - enviado_em)::bigint / 60 as minutos
          from public.guia_whats_leads
         where status = 'enviado' and enviado_em is not null and clicou_em is null and voto is null and salao_respondeu_em is null and aviso_demora_em is null
           and enviado_em < now() - make_interval(mins => cfg.aviso_demora_min)
           and enviado_em > now() - make_interval(mins => cfg.aviso_demora_min) - interval '2 days'
         order by enviado_em limit 50) x) else '[]'::jsonb end,
    'cutucar', case when cfg.cutucar_salao_min > 0 then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select id, salao_nome, cidade, cliente_nome, cliente_tel, servico, preferencia, token, salao_tel, enviado_em,
               extract(epoch from now() - enviado_em)::bigint / 60 as minutos
          from public.guia_whats_leads
         where status = 'enviado' and enviado_em is not null and clicou_em is null and voto is null and salao_respondeu_em is null and cutucado_em is null
           and salao_tel is not null
           and enviado_em < now() - make_interval(mins => cfg.cutucar_salao_min)
           and enviado_em > now() - make_interval(mins => cfg.cutucar_salao_min) - interval '2 days'
         order by enviado_em limit 50) x) else '[]'::jsonb end,
    -- 222: o resgate. Sem sinal do salão (ou o pedido nem chegou), dentro da janela, só uma vez, até 20 h depois; nunca
    -- para quem já seguiu (um pedido mais novo dela, ou outra conversa dela aberta mais nova) nem conversa de teste.
    -- 261: nem para quem pediu para parar.
    'resgate', case when cfg.resgate_min > 0 and agora_sp between cfg.resgate_inicio and cfg.resgate_fim then (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
        select ld.id, ld.salao_nome, ld.cidade, ld.cliente_nome, ld.cliente_tel, ld.servico, ld.preferencia, ld.status,
               extract(epoch from now() - coalesce(ld.enviado_em, ld.criado_em))::bigint / 60 as minutos
          from public.guia_whats_leads ld
          join public.guia_whats_conversas cv on cv.id = ld.conversa_id and not cv.teste
         where ld.resgate_em is null
           and ((ld.status = 'enviado' and ld.clicou_em is null and ld.voto is null and ld.salao_respondeu_em is null)
                or ld.status in ('sem_contato', 'falhou', 'fora_do_limite'))
           and coalesce(ld.enviado_em, ld.criado_em) < now() - make_interval(mins => cfg.resgate_min)
           and coalesce(ld.enviado_em, ld.criado_em) > now() - interval '20 hours'
           and not exists (select 1 from public.guia_whats_leads x where x.cliente_chave = ld.cliente_chave and x.id <> ld.id and x.criado_em > ld.criado_em)
           and not exists (select 1 from public.guia_whats_conversas y where y.chave = cv.chave and y.id <> cv.id and not y.teste
                             and y.estado in ('conversando', 'confirmando') and y.atualizada_em > ld.criado_em)
           and not exists (select 1 from public.guia_whats_saidas s where s.chave = ld.cliente_chave and s.quem = 'cliente')
         order by ld.criado_em limit 30) x) else '[]'::jsonb end);
end $$;
revoke execute on function public.guia_whats_pendentes() from public, anon, authenticated;

do $$
begin
  raise notice '261: a Mel sem tropeços (guia_nome_invalido, guia_whats_buscar com bairro, resposta automática do salão, lembrete por etapa, cliente que pediu para parar)';
end $$;
