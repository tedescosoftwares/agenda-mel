-- 196 (3.49): a cidade de quem visita (pelo IP ou pelo GPS, sem guardar nada) e o site ao vivo por período.
--
-- site_minha_cidade(): o site pergunta, ao entrar no guia, "de onde eu pareço estar?". Sem GPS, a cidade aproximada do
-- IP da conexão (geo_ip_br, a mesma base do site ao vivo); com lat/lng (quem autorizou a localização), a cidade do ponto.
-- A tela diz de onde veio ("Peruíbe, SP · pela sua conexão"): quem vê a cidade errada entende por que vale liberar a
-- localização exata. Nada é gravado: o IP nem sai da função.
--
-- site_ao_vivo(horas_): o painel deixa de esquecer quem passou. "recentes" vira quem passou no período (1, 6, 12 ou 24
-- horas; até 500, os mais recentes), com as ações e o desfecho de cada visita, e as origens, aparelhos, cidades e toques
-- seguem o período. "no site agora" e o minuto a minuto continuam os mesmos (75 s e 30 min). A assinatura antiga sai
-- (duas versões confundiriam o PostgREST); chamar sem argumento vale 1 hora.

create or replace function public.site_minha_cidade(lat_ double precision default null, lng_ double precision default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cab jsonb; ip_txt text; ip_ inet; cid integer; c public.geo_cidades; tem_gps boolean;
begin
  tem_gps := coalesce(lat_ between -34 and 6 and lng_ between -75 and -28, false);
  if tem_gps then
    cid := public.geo_cidade_do_ponto(lat_, lng_);
  else
    begin cab := current_setting('request.headers', true)::jsonb; exception when others then cab := null; end;
    ip_txt := coalesce(nullif(cab ->> 'cf-connecting-ip', ''), nullif(cab ->> 'x-real-ip', ''), nullif(btrim(split_part(coalesce(cab ->> 'x-forwarded-for', ''), ',', 1)), ''), '');
    begin ip_ := ip_txt::inet; exception when others then ip_ := null; end;
    if ip_ is not null then cid := public.geo_cidade_do_ip(ip_); end if;
  end if;
  if cid is null then return jsonb_build_object('fonte', case when tem_gps then 'gps' else 'ip' end); end if;
  select * into c from public.geo_cidades where id = cid;
  return jsonb_build_object('cidade', c.cidade, 'uf', c.uf,
    'lat', case when tem_gps then round(lat_::numeric, 3)::double precision else c.lat end,
    'lng', case when tem_gps then round(lng_::numeric, 3)::double precision else c.lng end,
    'fonte', case when tem_gps then 'gps' else 'ip' end);
end $$;
comment on function public.site_minha_cidade(double precision, double precision) is 'Site (196): a cidade de quem pergunta, pelo IP da conexão (aproximada) ou pelo ponto do GPS; nada é guardado.';
revoke execute on function public.site_minha_cidade(double precision, double precision) from public;
grant execute on function public.site_minha_cidade(double precision, double precision) to anon, authenticated;

-- ---- o WhatsApp do guia (195), ajuste: a Mel sempre anota o pedido e tenta o número que o salão tem ----------------------
-- Antes, salão sem WhatsApp no cadastro (só telefone fixo) fazia a Mel passar o telefone à cliente. Nunca mais: o número
-- do salão é o WhatsApp do cadastro ou, sem ele, o telefone (fixo também tem WhatsApp Business, muitas vezes); o envio
-- é tentado, e se não sair o pedido fica na Plataforma para a equipe. A orientação da Mel ganha a regra.
create or replace function public.guia_whats_do_salao(whatsapp text, telefone text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    (select d from (select public.telefone_e164(whatsapp) as d) x where d ~ '^55[1-9][0-9][0-9]{8,9}$'),
    (select d from (select public.telefone_e164(telefone) as d) x where d ~ '^55[1-9][0-9][0-9]{8,9}$'))
$$;
update public.guia_whats_config set orientacao = orientacao || E'\n- Nunca passe o telefone do salão nem mande a cliente ligar ou procurar o salão por conta própria: o seu papel é anotar o pedido e enviar.'
 where orientacao not like '%Nunca passe o telefone do salão%';

drop function if exists public.site_ao_vivo();
create or replace function public.site_ao_vivo(horas_ integer default 1)
returns jsonb language plpgsql stable security definer set search_path = public set plan_cache_mode = force_custom_plan set jit = off as $$
declare
  hoje_ini timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  janela interval := make_interval(hours => greatest(1, least(coalesce(horas_, 1), 24)));
  r jsonb;
begin
  if not public.eh_plataforma() then raise exception 'só a plataforma vê o site ao vivo'; end if;
  with
  periodo as materialized (select * from public.site_presencas where visto_em > now() - janela),
  trinta as materialized (select * from periodo where visto_em > now() - interval '30 minutes'),
  agora_ as materialized (select * from trinta where visto_em > now() - interval '75 seconds' and saiu_em is null),
  hoje as materialized (select * from public.site_presencas where inicio_em >= hoje_ini),
  visitas as materialized (select * from public.site_presencas where inicio_em >= hoje_ini or visto_em > now() - janela),
  -- as ações (tudo menos a visita de página) de quem visitou hoje ou na última meia hora
  ev as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= least(hoje_ini, now() - janela) - interval '1 minute' and e.tipo <> 'visita'
       and e.visitante in (select visitante from visitas)
  ),
  -- cada visita com as ações dela: do mesmo visitante, de um minuto antes da entrada até dois depois da última batida
  acoes_v as materialized (
    select v.id,
           jsonb_agg(jsonb_build_object('tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'em', e.em, 'pagina', e.pagina, 'lugar', l.nome,
                                        't', greatest(0, round(extract(epoch from e.em - v.inicio_em)))::int) order by e.em) as acoes,
           (array_agg(e.tipo order by e.em desc) filter (where e.contato))[1] as ult_tipo,
           max(e.em) filter (where e.contato) as ult_em,
           count(*) filter (where e.contato) as contatos
      from visitas v
      join ev e on e.visitante = v.visitante and e.em between v.inicio_em - interval '1 minute' and v.visto_em + interval '2 minutes'
      left join public.guia_lugares l on l.id = e.lugar_id
     group by v.id
  ),
  -- o desfecho de cada visita
  vis as materialized (
    select v.*, coalesce(a.acoes, '[]'::jsonb) as acoes, coalesce(a.contatos, 0) as contatos,
           (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds') as terminou,
           case when not (v.saiu_em is not null or v.visto_em <= now() - interval '75 seconds')
                  then case when a.ult_tipo is not null then 'contatou' else 'navegando' end
                when a.ult_tipo is not null and a.ult_em >= coalesce(v.saiu_em, v.visto_em) - interval '2 minutes' then 'saiu_' || a.ult_tipo
                when a.ult_tipo is not null then 'contatou_e_saiu'
                else 'sem_contato' end as desfecho
      from visitas v left join acoes_v a on a.id = v.id
  ),
  -- os toques da última meia hora, de todo mundo (também de quem não tem visita registrada: presença barrada ou de antes)
  ev30 as materialized (
    select e.visitante, e.em, e.tipo, e.pagina, e.lugar_id, t.rotulo, t.grupo
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em > now() - janela and e.tipo not in ('visita', 'localizacao')
  ),
  minutos as (
    select m, (select count(*) from trinta t where t.inicio_em < m + interval '1 minute' and t.visto_em >= m) as n
      from generate_series(date_trunc('minute', now()) - interval '29 minutes', date_trunc('minute', now()), interval '1 minute') m
  ),
  ev_hoje as materialized (
    select e.em, e.tipo, e.visitante, e.lugar_id, e.pagina, t.rotulo, t.grupo, (t.grupo = 'contato' or e.tipo in ('quero_marcar', 'pedido_enviado')) as contato
      from public.site_eventos e join public.site_eventos_tipos t using (tipo)
     where e.em >= hoje_ini and e.tipo not in ('visita', 'localizacao')
  )
  select jsonb_build_object(
    'agora', now(),
    'no_site', (select count(*) from agora_),
    'ultimos_30', (select count(*) from trinta),
    'horas', (extract(epoch from janela) / 3600)::int,
    'no_periodo', (select count(*) from periodo),
    'minutos', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]'::jsonb) from minutos),
    'ativos', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                 from (select * from vis where id in (select id from agora_) order by visto_em desc limit 200) a),
    'recentes', (select coalesce(jsonb_agg(to_jsonb(a) - 'visitante' - 'terminou' order by a.visto_em desc), '[]'::jsonb)
                   from (select * from vis where id in (select id from periodo) and id not in (select id from agora_)
                          order by visto_em desc limit 500) a),
    'paginas_agora', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc, x.pagina), '[]'::jsonb)
                        from (select pagina, max(titulo) as titulo, count(*) as n from agora_ group by pagina order by count(*) desc limit 10) x),
    'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select coalesce(origem, 'outro') as origem, count(*) as n from periodo group by 1) x),
    'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                       from (select coalesce(dispositivo, 'outro') as d, count(*) as n from periodo group by 1) x),
    'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n, 'gps', x.gps) order by x.n desc), '[]'::jsonb)
                  from (select cidade, uf, count(*) as n, count(*) filter (where local_fonte = 'gps') as gps from periodo where cidade is not null
                         group by cidade, uf order by count(*) desc limit 12) x),
    -- 193: as últimas ações (ao vivo), com o aparelho e a cidade da visita, e as da última meia hora por tipo
    'acoes_recentes', (select coalesce(jsonb_agg(x.o order by x.em desc), '[]'::jsonb) from (
        select e.em, jsonb_build_object('em', e.em, 'tipo', e.tipo, 'rotulo', e.rotulo, 'grupo', e.grupo, 'pagina', e.pagina, 'lugar', l.nome,
                                        'dispositivo', p.dispositivo, 'cidade', p.cidade, 'uf', p.uf, 'local_fonte', p.local_fonte, 'visita', p.id) as o
          from (select * from ev30 order by em desc limit 100) e
          left join public.guia_lugares l on l.id = e.lugar_id
          left join lateral (select s.id, s.dispositivo, s.cidade, s.uf, s.local_fonte from public.site_presencas s
                              where s.visitante = e.visitante and s.visto_em >= e.em - interval '2 minutes' and s.inicio_em <= e.em + interval '1 minute'
                              order by s.visto_em desc limit 1) p on true) x),
    'acoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'rotulo', x.rotulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                from (select tipo, max(rotulo) as rotulo, count(*) as n from ev30 group by tipo) x),
    'hoje', jsonb_build_object(
      'visitas', (select count(*) from hoje),
      'paginas', (select coalesce(sum(paginas), 0) from hoje),
      'tempo_medio_s', (select coalesce(round(avg(extract(epoch from visto_em - inicio_em)))::int, 0) from hoje),
      'por_hora', (select jsonb_agg(jsonb_build_object('h', h, 'n', coalesce(c.n, 0)) order by h)
                     from generate_series(0, 23) h
                     left join (select extract(hour from inicio_em at time zone 'America/Sao_Paulo')::int as hh, count(*) as n from hoje group by 1) c on c.hh = h),
      'origens', (select coalesce(jsonb_agg(jsonb_build_object('origem', x.origem, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select coalesce(origem, 'outro') as origem, count(*) as n from hoje group by 1) x),
      'dispositivos', (select coalesce(jsonb_agg(jsonb_build_object('dispositivo', x.d, 'n', x.n) order by x.n desc), '[]'::jsonb)
                         from (select coalesce(dispositivo, 'outro') as d, count(*) as n from hoje group by 1) x),
      'navegadores', (select coalesce(jsonb_agg(jsonb_build_object('navegador', x.b, 'n', x.n) order by x.n desc), '[]'::jsonb)
                        from (select coalesce(navegador, 'outro') as b, count(*) as n from hoje group by 1 order by count(*) desc limit 8) x),
      'cidades', (select coalesce(jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf, 'n', x.n) order by x.n desc), '[]'::jsonb)
                    from (select cidade, uf, count(*) as n from hoje where cidade is not null group by cidade, uf order by count(*) desc limit 12) x),
      'entradas', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.entrada, 'n', x.n) order by x.n desc), '[]'::jsonb)
                     from (select entrada, count(*) as n from hoje group by entrada order by count(*) desc limit 10) x),
      -- 193: as ações de hoje (todas, também de quem visitou antes do site ao vivo existir), as visitas que tocaram em
      -- contato, como terminaram as visitas e as páginas de onde se sai sem contatar. Nos salões, o pedido enviado conta à
      -- parte (o "Quero marcar" que veio antes dele já contou)
      'acoes', (select coalesce(jsonb_agg(jsonb_build_object('tipo', x.tipo, 'rotulo', x.rotulo, 'grupo', x.grupo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                  from (select tipo, max(rotulo) as rotulo, max(grupo) as grupo, count(*) as n from ev_hoje group by tipo) x),
      'saloes', (select coalesce(jsonb_agg(jsonb_build_object('lugar', x.nome, 'n', x.n, 'whatsapp', x.w, 'pedidos', x.p) order by x.n desc), '[]'::jsonb)
                   from (select l.nome, count(*) filter (where e.tipo <> 'pedido_enviado') as n, count(*) filter (where e.tipo = 'whatsapp') as w,
                                count(*) filter (where e.tipo = 'pedido_enviado') as p
                           from ev_hoje e join public.guia_lugares l on l.id = e.lugar_id
                          where e.contato group by l.nome order by 2 desc limit 10) x),
      'com_contato', (select count(*) from vis where inicio_em >= hoje_ini and contatos > 0),
      'terminadas', (select count(*) from vis where inicio_em >= hoje_ini and terminou),
      'desfechos', (select coalesce(jsonb_agg(jsonb_build_object('desfecho', x.desfecho, 'n', x.n) order by x.n desc), '[]'::jsonb)
                      from (select desfecho, count(*) as n from vis where inicio_em >= hoje_ini and terminou group by desfecho) x),
      'saidas_sem_contato', (select coalesce(jsonb_agg(jsonb_build_object('pagina', x.pagina, 'titulo', x.titulo, 'n', x.n) order by x.n desc), '[]'::jsonb)
                            from (select pagina, max(titulo) as titulo, count(*) as n from vis where inicio_em >= hoje_ini and desfecho = 'sem_contato'
                                   group by pagina order by count(*) desc limit 8) x)),
    'geo', (select jsonb_build_object('carregado_em', g.carregado_em, 'versao', g.versao, 'faixas', g.faixas) from public.geo_ip_carga g where g.id = 1)
  ) into r;
  return r;
end $$;
comment on function public.site_ao_vivo(integer) is 'Site (192, 193, 196): quem está no site agora, quem passou no período (1 a 24 horas, com as ações e o desfecho de cada visita), as últimas ações, os últimos 30 minutos e o resumo de hoje. Só a Plataforma.';
revoke execute on function public.site_ao_vivo(integer) from public, anon;
grant execute on function public.site_ao_vivo(integer) to authenticated;

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

do $$
begin
  raise notice '196: a conversa de volta do salão amarrada ao pedido (guia_whats_lead_do_salao, salao_mensagens); o link rastreável do pedido (guia_whats_clique, token por pedido, abriram no painel); a Mel acha o salão pelo slug, cidade/slug ou nome em frase (guia_whats_buscar), limite_respostas por número por dia, respostas_hoje no contexto; site_minha_cidade (pelo IP ou pelo GPS, sem guardar), site_ao_vivo(horas_) com quem passou no período, a Mel sempre anota e tenta o número do salão';
end $$;
