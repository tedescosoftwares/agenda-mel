-- 216: o número do salão que não tem WhatsApp (3.72)
--
-- A regra da 201 (salão sem WhatsApp → sem_contato + aviso à equipe) só pegava o salão SEM número. Quando havia
-- número e ele não existia no WhatsApp (fixo, número errado), a Evolution recusava na hora do envio
-- ("exists": false), o pedido ficava como "Não saiu" com o erro cru e a equipe não era avisada. Agora:
--   1. fixo não é WhatsApp: a Mel só tenta celular (9 dígitos, começando com 9);
--   2. "não existe no WhatsApp" na hora do envio vira sem_contato, com o motivo em português, e o salão fica marcado
--      (guia_lugares.whatsapp_invalido_em) para a Mel não tentar de novo até alguém corrigir o número;
--   3. corrigir o número no cadastro desmarca; a Plataforma também desmarca sem editar (guia_whats_numero_ok).
-- O aviso à equipe (numero_avisos) nesses casos sai pelo motor (guia_whats.ts), como no caso sem número.

create or replace function public.guia_whats_do_salao(whatsapp text, telefone text)
returns text language sql immutable set search_path = public as $$
  select coalesce(
    (select d from (select public.telefone_e164(whatsapp) as d) x where d ~ '^55[1-9][0-9]9[0-9]{8}$'),
    (select d from (select public.telefone_e164(telefone) as d) x where d ~ '^55[1-9][0-9]9[0-9]{8}$'))
$$;

alter table public.guia_lugares add column if not exists whatsapp_invalido_em timestamptz;
alter table public.guia_lugares add column if not exists whatsapp_invalido_motivo text;

-- o número bonito: 5513999990000 → (13) 99999-0000
create or replace function public.guia_whats_bonito(tel text)
returns text language sql immutable as $$
  select case when d ~ '^55[0-9]{11}$' then format('(%s) %s-%s', substr(d, 3, 2), substr(d, 5, 5), substr(d, 10, 4))
              when d ~ '^55[0-9]{10}$' then format('(%s) %s-%s', substr(d, 3, 2), substr(d, 5, 4), substr(d, 9, 4))
              else coalesce(tel, '') end
    from (select regexp_replace(coalesce(tel, ''), '\D', '', 'g') as d) x
$$;

-- o salão para a Mel: sem número válido (ou marcado como inválido), salao_tel vem nulo e o pedido nasce sem_contato
create or replace function public.guia_whats_lugar(cidade_ text, slug_ text, id_ uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', l.id, 'nome', l.nome, 'categoria', l.categoria, 'cidade', l.cidade, 'cidade_slug', l.cidade_slug, 'slug', l.slug,
           'uf', l.uf, 'bairro', l.bairro, 'endereco', l.endereco, 'servicos', l.servicos, 'horarios', l.horarios,
           'telefone', l.telefone, 'whatsapp', l.whatsapp,
           'salao_tel', case when l.whatsapp_invalido_em is null then public.guia_whats_do_salao(l.whatsapp, l.telefone) end,
           'whatsapp_invalido', l.whatsapp_invalido_em is not null,
           'salao_saiu', exists (select 1 from public.guia_whats_saidas s where s.quem = 'salao' and s.chave = public.guia_whats_chave(public.guia_whats_do_salao(l.whatsapp, l.telefone))),
           'agendar', (select s.subdominio from public.salons s where s.id = l.salon_id))
    from public.guia_lugares l
   where l.status = 'publicado' and (case when id_ is not null then l.id = id_ else l.cidade_slug = cidade_ and l.slug = slug_ end)
   limit 1
$$;

-- o resultado do envio: "não existe no WhatsApp" vira sem_contato (motivo em português) e marca o salão
drop function if exists public.guia_whats_lead_resultado(bigint, boolean, text, text, text);
create or replace function public.guia_whats_lead_resultado(lead_ bigint, ok_ boolean, provider_ text, erro_ text, mensagem_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ld public.guia_whats_leads;
  inexistente boolean := coalesce(erro_, '') ~* '"exists"\s*:\s*false' or coalesce(erro_, '') ~* 'not (a |an )?(valid )?whatsapp|n[uú]mero n[aã]o existe';
  motivo_ text;
  st text;
begin
  select * into ld from public.guia_whats_leads where id = lead_;
  if ld.id is null then return jsonb_build_object('ok', false, 'motivo', 'pedido não encontrado'); end if;
  if ok_ then st := 'enviado';
  elsif inexistente then
    st := 'sem_contato';
    motivo_ := format('O número %s não tem WhatsApp. Corrija o cadastro do salão.', public.guia_whats_bonito(ld.salao_tel));
    update public.guia_lugares set whatsapp_invalido_em = now(), whatsapp_invalido_motivo = left(motivo_, 200)
     where id = ld.lugar_id;
  else st := 'falhou';
  end if;
  update public.guia_whats_leads set
    status = st,
    enviado_em = case when ok_ then now() else enviado_em end,
    provider_id = left(provider_, 120),
    erro = case when ok_ then null else left(coalesce(motivo_, erro_), 300) end,
    mensagem = left(mensagem_, 3000)
   where id = lead_;
  return jsonb_build_object('ok', true, 'status', st, 'motivo', motivo_);
end $$;
revoke execute on function public.guia_whats_lead_resultado(bigint, boolean, text, text, text) from public, anon, authenticated;

-- corrigir o número no cadastro desmarca
create or replace function public.guia_lugares_numero_mudou()
returns trigger language plpgsql as $$
begin
  if new.whatsapp is distinct from old.whatsapp or new.telefone is distinct from old.telefone then
    new.whatsapp_invalido_em := null;
    new.whatsapp_invalido_motivo := null;
  end if;
  return new;
end $$;
drop trigger if exists guia_lugares_numero_mudou on public.guia_lugares;
create trigger guia_lugares_numero_mudou before update of whatsapp, telefone on public.guia_lugares
  for each row execute function public.guia_lugares_numero_mudou();

-- a Plataforma conferiu o número (por fora) e quer que a Mel volte a tentar
create or replace function public.guia_whats_numero_ok(lugar_ uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_plataforma() then raise exception 'só a Plataforma'; end if;
  update public.guia_lugares set whatsapp_invalido_em = null, whatsapp_invalido_motivo = null where id = lugar_;
  return jsonb_build_object('ok', found);
end $$;
revoke execute on function public.guia_whats_numero_ok(uuid) from public, anon;
grant execute on function public.guia_whats_numero_ok(uuid) to authenticated;

-- a lista da Plataforma leva a marca (coluna nova no fim)
create or replace view public.guia_lista with (security_invoker = true) as
  select l.id, l.cidade, l.cidade_slug, l.uf, l.slug, l.categoria, l.nome, l.bairro, l.endereco, l.cep, l.telefone, l.whatsapp, l.instagram, l.site,
         l.horarios, l.servicos, l.atributos, l.place_id, l.cnpj, l.validado_receita, l.selecao, l.nota, l.avaliacoes, l.fontes, l.origem, l.fotos,
         l.status, l.motivo, l.salon_id, l.gerado_em, l.publicado_em, l.criado_em, l.atualizado_em,
         (l.conteudo is not null) as tem_conteudo,
         (l.rascunho is not null) as tem_rascunho,
         coalesce(l.rascunho ->> 'resumo', l.conteudo ->> 'resumo') as resumo,
         l.conteudo -> '_meta' as meta,
         l.rascunho -> '_meta' as meta_rascunho,
         (l.horarios is not null and jsonb_typeof(l.horarios) = 'array' and jsonb_array_length(l.horarios) > 0) as tem_horario,
         coalesce(array_length(l.servicos, 1), 0) as servicos_n,
         public.guia_pontos(l) as pontos,
         coalesce(array_length(l.fotos, 1), 0) as fotos_n,
         lower(translate(l.nome || ' ' || coalesce(l.bairro, ''), 'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy')) as busca,
         l.votos,
         l.contatos_app,
         l.whatsapp_invalido_em,
         l.whatsapp_invalido_motivo
    from public.guia_lugares l;

insert into public.migracoes_aplicadas (arquivo) values ('216_whatsapp_invalido.sql') on conflict (arquivo) do nothing;
do $$ begin raise notice '216: fixo não é WhatsApp; "não existe no WhatsApp" vira sem_contato e marca o salão; guia_whats_numero_ok; guia_lista com a marca'; end $$;
