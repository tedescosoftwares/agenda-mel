-- 213: o contato pelo WhatsApp a partir do app fica registrado (3.68)
--
-- Antes de mandar a cliente para o WhatsApp (a Mel ou o próprio salão, num salão do guia que não
-- agenda pela MIMO), o app avisa que ela vai para o WhatsApp e que o contato fica registrado no
-- app. O registro (guia_contatos) é a base da pesquisa de atendimento: "o atendimento em X
-- aconteceu? que nota você dá?", respondida no app (guia_responder_contato) e, depois, puxada por
-- push. Conta por salão em guia_lugares.contatos_app (sinal de demanda na Abordagem). Nada vai
-- para o salão: o registro é da cliente, no app dela.

create table if not exists public.guia_contatos (
  id uuid primary key default gen_random_uuid(),
  lugar_id uuid not null references public.guia_lugares (id) on delete cascade,
  client_id uuid not null references public.profiles (id) on delete cascade,
  canal text not null check (canal in ('mel', 'salao')),
  criado_em timestamptz not null default now(),
  pesquisa_em timestamptz,          -- quando o app perguntou (push), para a próxima etapa
  respondido_em timestamptz,
  concluido boolean,                -- o atendimento aconteceu?
  nota smallint check (nota between 1 and 5),
  comentario text check (length(comentario) <= 400)
);
create index if not exists guia_contatos_cliente on public.guia_contatos (client_id, criado_em desc);
create index if not exists guia_contatos_lugar on public.guia_contatos (lugar_id);
alter table public.guia_contatos enable row level security;
comment on table public.guia_contatos is 'Guia (213): o contato pelo WhatsApp a partir do app (Mel ou salão) e a resposta da pesquisa de atendimento. Só pelas funções guia_registrar_contato, guia_meus_contatos e guia_responder_contato.';

alter table public.guia_lugares add column if not exists contatos_app integer not null default 0;

create or replace function public.guia_contatos_contar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  alvo uuid := coalesce(new.lugar_id, old.lugar_id);
begin
  update public.guia_lugares set contatos_app = (select count(*) from public.guia_contatos c where c.lugar_id = alvo) where id = alvo;
  return null;
end;
$$;
drop trigger if exists guia_contatos_contar on public.guia_contatos;
create trigger guia_contatos_contar after insert or delete on public.guia_contatos
  for each row execute function public.guia_contatos_contar();

-- o app registra o contato na hora em que ela vai para o WhatsApp (o mesmo toque repetido em 10 minutos não vira outro)
create or replace function public.guia_registrar_contato(lugar_ uuid, canal_ text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
  ja uuid;
  novo uuid;
begin
  if eu is null then return jsonb_build_object('ok', false, 'motivo', 'Entre na conta para o app guardar o contato.'); end if;
  if canal_ not in ('mel', 'salao') then return jsonb_build_object('ok', false, 'motivo', 'Canal inválido.'); end if;
  if not exists (select 1 from public.guia_lugares where id = lugar_) then return jsonb_build_object('ok', false, 'motivo', 'Salão não encontrado.'); end if;
  select id into ja from public.guia_contatos
   where client_id = eu and lugar_id = lugar_ and canal = canal_ and criado_em > now() - interval '10 minutes'
   order by criado_em desc limit 1;
  if ja is not null then return jsonb_build_object('ok', true, 'id', ja, 'novo', false); end if;
  insert into public.guia_contatos (lugar_id, client_id, canal) values (lugar_, eu, canal_) returning id into novo;
  return jsonb_build_object('ok', true, 'id', novo, 'novo', true);
end;
$$;
revoke execute on function public.guia_registrar_contato(uuid, text) from public, anon;
grant execute on function public.guia_registrar_contato(uuid, text) to authenticated;

-- os contatos dela (os 50 últimos), com o salão do guia
create or replace function public.guia_meus_contatos()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'canal', x.canal, 'criado_em', x.criado_em, 'respondido_em', x.respondido_em, 'concluido', x.concluido, 'nota', x.nota,
           'lugar', jsonb_build_object('id', l.id, 'nome', l.nome, 'cidade_slug', l.cidade_slug, 'slug', l.slug, 'categoria', l.categoria, 'bairro', l.bairro,
                                       'foto', l.fotos[1], 'na_mimo', l.salon_id is not null))
           order by x.criado_em desc), '[]'::jsonb)
    from (select * from public.guia_contatos c where c.client_id = auth.uid() order by c.criado_em desc limit 50) x
    join public.guia_lugares l on l.id = x.lugar_id;
$$;
revoke execute on function public.guia_meus_contatos() from public, anon;
grant execute on function public.guia_meus_contatos() to authenticated;

-- a pesquisa: o atendimento aconteceu? que nota? (a cliente, no app; o push vem depois)
create or replace function public.guia_responder_contato(contato_ uuid, concluido_ boolean, nota_ integer default null, comentario_ text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  eu uuid := auth.uid();
begin
  if eu is null then return jsonb_build_object('ok', false, 'motivo', 'Entre na conta.'); end if;
  if concluido_ and (nota_ is null or nota_ < 1 or nota_ > 5) then return jsonb_build_object('ok', false, 'motivo', 'Dê uma nota de 1 a 5.'); end if;
  update public.guia_contatos
     set concluido = concluido_, nota = case when concluido_ then nota_ else null end,
         comentario = left(nullif(btrim(coalesce(comentario_, '')), ''), 400), respondido_em = now()
   where id = contato_ and client_id = eu;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'Contato não encontrado.'); end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.guia_responder_contato(uuid, boolean, integer, text) from public, anon;
grant execute on function public.guia_responder_contato(uuid, boolean, integer, text) to authenticated;

-- a lista da Plataforma leva a contagem (coluna nova no fim)
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
         l.contatos_app
    from public.guia_lugares l;

insert into public.migracoes_aplicadas (arquivo) values ('213_contatos_pelo_app.sql') on conflict (arquivo) do nothing;

do $$ begin
  raise notice '213: guia_contatos + guia_registrar_contato/guia_meus_contatos/guia_responder_contato, guia_lugares.contatos_app (gatilho), guia_lista com contatos_app';
end $$;
