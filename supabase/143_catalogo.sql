-- 143: Catálogo de serviços (2.91) — a estrutura
-- Agenda Mel — 143: catálogo de serviços: categorias da plataforma com slug, Cílios e Micropigmentação, catalogo_itens (família → serviço → técnica), vínculo em services, momentos da Mel no cadastro
--
-- A MIMO passa a sugerir o que o salão oferece em vez de pedir nome,
-- categoria, preço e duração num formulário seco. A árvore oficial é
--
--   categoria (categorias_de_servico, salon_id nulo)
--     → família  (catalogo_itens.tipo = 'familia')
--       → serviço (tipo = 'servico')
--         → técnica (tipo = 'tecnica')
--
-- e o salão aponta o serviço dele para um item (services.catalogo_item_id)
-- ou cria do zero (nulo). Nada do que já existe é apagado:
--
--   - as categorias da plataforma ganham slug, descrição, aliases e ativa;
--     Rosto vira Estética facial, Corpo vira Estética corporal, Massagem e
--     bem-estar vira Bem-estar e spa, Sobrancelhas e cílios vira
--     Sobrancelhas — todas no MESMO id;
--   - nascem Cílios e Micropigmentação;
--   - Barba fica (ativa = false): quem a usa continua usando, só não
--     aparece para quem está escolhendo;
--   - os serviços de "Sobrancelhas e cílios" só vão para Cílios quando o
--     nome deixa claro (cílio, lash, volume brasileiro/russo; "fio a fio"
--     só sem sobrancelha/micro no nome). Na dúvida ficam onde estão;
--   - quem tinha "Sobrancelhas e cílios" escolhida passa a ter as duas.
--
-- O conteúdo (famílias, serviços, técnicas) é semeado pela 144, gerada
-- de supabase/catalogo/catalogo_v1.json por gerar_catalogo.py --sql e
-- aplicada por catalogo_semear(jsonb), que é idempotente (upsert pelo
-- caminho de slugs) e preserva ativa/imagem_url editados na Plataforma.

-- ---------------------------------------------------------------
-- 1. categorias da plataforma: slug, descrição, aliases, ativa
-- ---------------------------------------------------------------
alter table public.categorias_de_servico
  add column if not exists slug text,
  add column if not exists descricao text,
  add column if not exists aliases text[] not null default '{}',
  add column if not exists ativa boolean not null default true;
create unique index if not exists categorias_plataforma_slug_idx on public.categorias_de_servico (slug) where salon_id is null;

do $$
declare
  r record; alvo uuid; conflito uuid; criou_cilios boolean := false;
  sob uuid; cil uuid; movidos integer; saloes integer;
begin
  for r in
    select * from (values
      (array['cabelo'], 'Cabelo', 'cabelo', 'Corte, cor, escova, tratamentos e mais', array['cabeleireiro','cabeleireira','hair','salão de cabelo'], 10, true),
      (array['unhas'], 'Unhas', 'unhas', 'Manicure, gel, alongamento e nail art', array['unha','manicure','nail','nail designer','esmalteria'], 20, true),
      (array['cílios','cilios'], 'Cílios', 'cilios', 'Extensão, volume, lifting e manutenção', array['cílio','cilios','lash','lash designer','cílios'], 30, true),
      (array['sobrancelhas e cílios','sobrancelhas'], 'Sobrancelhas', 'sobrancelhas', 'Design, henna, tintura, lamination e cuidados', array['sobrancelha','brow','designer de sobrancelhas','sobrancelhas'], 40, true),
      (array['maquiagem'], 'Maquiagem', 'maquiagem', 'Social, noiva, festa e cursos', array['make','maquiadora','maquiador','makeup'], 50, true),
      (array['depilação','depilacao'], 'Depilação', 'depilacao', 'Cera, linha, laser e luz pulsada', array['depilar','depiladora','epilação','tirar pelo'], 60, true),
      (array['rosto','estética facial'], 'Estética facial', 'estetica-facial', 'Limpeza de pele, peeling, protocolos e tecnologias', array['rosto','facial','esteticista','skincare','pele'], 70, true),
      (array['corpo','estética corporal'], 'Estética corporal', 'estetica-corporal', 'Drenagem, modeladora, gordura localizada e bronze', array['corpo','corporal','estética do corpo','emagrecimento'], 80, true),
      (array['micropigmentação','micropigmentacao'], 'Micropigmentação', 'micropigmentacao', 'Sobrancelhas, lábios, olhos, retoques e remoção', array['micro','micropigmentadora','micropigmentar','dermopigmentação','tatuagem estética','maquiagem definitiva'], 90, true),
      (array['massagem e bem-estar','bem-estar e spa'], 'Bem-estar e spa', 'bem-estar-e-spa', 'Massagens, terapias e relaxamento', array['massagem','spa','massoterapia','terapias','relaxar'], 100, true),
      (array['barba'], 'Barba', 'barba', 'Categoria antiga, mantida para os salões que já a usam', array[]::text[], 900, false),
      (array['outros'], 'Outros', 'outros', 'O que não cabe nas outras', array[]::text[], 999, true)
    ) as v (antigos, nome, slug, descricao, aliases, ordem, ativa)
  loop
    -- já tem slug? então é ela. Senão, a de nome antigo (sem slug ainda)
    select id into alvo from public.categorias_de_servico where salon_id is null and slug = r.slug;
    if alvo is null then
      select id into alvo from public.categorias_de_servico
        where salon_id is null and slug is null and lower(btrim(nome)) = any (r.antigos)
        order by ordem limit 1;
    end if;
    if alvo is null then
      insert into public.categorias_de_servico (salon_id, nome, slug, descricao, aliases, ordem, ativa)
        values (null, r.nome, r.slug, r.descricao, r.aliases, r.ordem, r.ativa) returning id into alvo;
      if r.slug = 'cilios' then criou_cilios := true; end if;
    else
      -- renomeia só se o nome novo não bater em outra categoria da plataforma
      select id into conflito from public.categorias_de_servico
        where salon_id is null and id <> alvo and lower(btrim(nome)) = lower(r.nome);
      update public.categorias_de_servico set
        nome = case when conflito is null then r.nome else nome end,
        descricao = coalesce(descricao, r.descricao),
        aliases = case when cardinality(aliases) = 0 then r.aliases else aliases end,
        ordem = r.ordem,
        -- ativa: só na primeira passagem (slug ainda nulo); depois é editorial
        ativa = case when slug is null then r.ativa else ativa end,
        slug = r.slug
      where id = alvo;
    end if;
  end loop;

  -- 2. a divisão: só na passagem em que Cílios nasceu (rodar de novo não
  --    mexe no que o salão arrumou depois)
  if criou_cilios then
    select id into sob from public.categorias_de_servico where salon_id is null and slug = 'sobrancelhas';
    select id into cil from public.categorias_de_servico where salon_id is null and slug = 'cilios';
    with n as (
      select s.id, public.sem_acento(lower(s.name)) as t from public.services s where s.categoria_id = sob
    )
    update public.services s set categoria_id = cil
    from n where n.id = s.id and (
      n.t like '%cilio%' or n.t like '%lash%' or n.t like '%volume brasileiro%' or n.t like '%volume russo%'
      or (n.t like '%fio a fio%' and n.t not like '%sobrancelha%' and n.t not like '%micro%')
    );
    get diagnostics movidos = row_count;
    update public.salons set categorias_escolhidas = categorias_escolhidas || cil
      where sob = any (categorias_escolhidas) and not (cil = any (categorias_escolhidas));
    get diagnostics saloes = row_count;
    raise notice '143: Cílios criada; % serviços movidos de Sobrancelhas, % salões passaram a ter as duas', movidos, saloes;
  end if;
end $$;

-- o chute pelo nome (082) procura pelo slug agora; barba vai para Outros
-- porque a categoria está inativa (quem quiser escolhe à mão)
create or replace function public.categoria_sugerida(nome text)
returns uuid
language sql
stable
as $$
  with n as (select public.sem_acento(lower(coalesce(nome, ''))) as t)
  select c.id from public.categorias_de_servico c, n
  where c.salon_id is null and c.slug = (
    case
      when n.t ~ '(micropigmenta|microblading|powder brows|dermopigmenta)' then 'micropigmentacao'
      when n.t ~ '(cilio|lash)' then 'cilios'
      when n.t ~ '(sobrancelha|brow|henna)' then 'sobrancelhas'
      when n.t ~ '(manicure|pedicure|unha|esmalt|gel|alongamento de unha|fibra|spa dos pes|\mpes\M|\mmaos\M)' then 'unhas'
      when n.t ~ '(cabelo|corte|escova|hidrata|progressiva|colora|mecha|luzes|tintura|penteado|tranca|botox capilar|cauteriza|reconstru|selagem|alisamento|franja|ondula|cachos|mega hair)' then 'cabelo'
      when n.t ~ '(depila|laser|cera)' then 'depilacao'
      when n.t ~ '(maquiagem|make)' then 'maquiagem'
      when n.t ~ '(massagem|relaxante|reflexo|\mspa\M|bem-estar|ventosa|pedras|reiki|shiatsu)' then 'bem-estar-e-spa'
      when n.t ~ '(limpeza de pele|facial|peeling|pele|rosto|dermaplan|microagulh|skincare|acne)' then 'estetica-facial'
      when n.t ~ '(corporal|corpo|modeladora|gordura|celulite|bronze|estria|flacidez|drenagem)' then 'estetica-corporal'
      else 'outros'
    end)
  limit 1;
$$;

-- ---------------------------------------------------------------
-- 3. a árvore: catalogo_itens
-- ---------------------------------------------------------------
create table if not exists public.catalogo_itens (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('familia', 'servico', 'tecnica')),
  categoria_id uuid not null references public.categorias_de_servico (id),
  pai_id uuid references public.catalogo_itens (id) on delete restrict,
  nome text not null check (btrim(nome) <> '' and length(nome) <= 80),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  descricao text,
  aliases text[] not null default '{}',
  tags text[] not null default '{}',
  duracao_sugerida integer check (duracao_sugerida is null or duracao_sugerida > 0),
  imagem_url text,
  ordem integer not null default 0,
  prioridade_sugestao integer not null default 0 check (prioridade_sugestao >= 0),
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- unicidade em dois índices porque pai_id nulo escapa de uma UNIQUE comum
create unique index if not exists catalogo_familia_slug_unique on public.catalogo_itens (categoria_id, slug) where pai_id is null;
create unique index if not exists catalogo_filhos_slug_unique on public.catalogo_itens (categoria_id, pai_id, slug) where pai_id is not null;
create index if not exists catalogo_itens_pai_idx on public.catalogo_itens (pai_id);
create index if not exists catalogo_itens_categoria_idx on public.catalogo_itens (categoria_id, tipo);

-- a hierarquia: família sem pai; serviço filho de família; técnica filha
-- de serviço; tudo na mesma categoria, e a categoria é da plataforma
create or replace function public.catalogo_itens_checar()
returns trigger
language plpgsql
as $$
declare
  pai public.catalogo_itens%rowtype;
begin
  if not exists (select 1 from public.categorias_de_servico c where c.id = new.categoria_id and c.salon_id is null) then
    raise exception 'A categoria do catálogo precisa ser uma categoria da plataforma.' using errcode = 'check_violation';
  end if;
  if new.tipo = 'familia' then
    if new.pai_id is not null then
      raise exception 'Família não tem pai: ela é o topo da categoria.' using errcode = 'check_violation';
    end if;
  else
    if new.pai_id is null then
      raise exception '% precisa de um pai (%).', case when new.tipo = 'servico' then 'Serviço' else 'Técnica' end,
        case when new.tipo = 'servico' then 'uma família' else 'um serviço' end using errcode = 'check_violation';
    end if;
    select * into pai from public.catalogo_itens where id = new.pai_id;
    if not found then raise exception 'Pai não encontrado.' using errcode = 'check_violation'; end if;
    if new.tipo = 'servico' and pai.tipo <> 'familia' then
      raise exception 'Serviço só pode ser filho de família (o pai "%" é %).', pai.nome, pai.tipo using errcode = 'check_violation';
    end if;
    if new.tipo = 'tecnica' and pai.tipo <> 'servico' then
      raise exception 'Técnica só pode ser filha de serviço (o pai "%" é %).', pai.nome, pai.tipo using errcode = 'check_violation';
    end if;
    if pai.categoria_id <> new.categoria_id then
      raise exception 'O item precisa estar na mesma categoria do pai "%".', pai.nome using errcode = 'check_violation';
    end if;
  end if;
  -- mudar a categoria ou o tipo de quem já tem filhos quebraria a árvore
  if tg_op = 'UPDATE' and (new.categoria_id <> old.categoria_id or new.tipo <> old.tipo)
     and exists (select 1 from public.catalogo_itens f where f.pai_id = new.id) then
    raise exception 'Este item tem filhos: mova ou apague os filhos antes de mudar categoria ou tipo.' using errcode = 'check_violation';
  end if;
  if new.tipo <> 'servico' then new.prioridade_sugestao := 0; end if;
  new.nome := btrim(new.nome);
  new.aliases := coalesce(new.aliases, '{}');
  new.tags := coalesce(new.tags, '{}');
  if tg_op = 'UPDATE' then new.updated_at := clock_timestamp(); end if;
  return new;
end;
$$;
drop trigger if exists catalogo_itens_checar on public.catalogo_itens;
create trigger catalogo_itens_checar before insert or update on public.catalogo_itens for each row execute function public.catalogo_itens_checar();

-- ninguém apaga o que um serviço de salão usa (a FK já é restrict; aqui a mensagem fica humana)
create or replace function public.catalogo_itens_proteger()
returns trigger
language plpgsql
security definer set search_path = public   -- a Plataforma não lê services; o trigger precisa
as $$
declare n integer;
begin
  select count(*) into n from public.services s where s.catalogo_item_id = old.id;
  if n > 0 then
    raise exception '"%" é usado por % serviço(s) de salão. Desative em vez de apagar.', old.nome, n using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

alter table public.catalogo_itens enable row level security;
drop policy if exists "catalogo todos leem" on public.catalogo_itens;
create policy "catalogo todos leem" on public.catalogo_itens for select to authenticated using (true);
drop policy if exists "catalogo plataforma escreve" on public.catalogo_itens;
create policy "catalogo plataforma escreve" on public.catalogo_itens for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select on public.catalogo_itens to authenticated;
grant insert, update, delete on public.catalogo_itens to authenticated;

-- ---------------------------------------------------------------
-- 4. o vínculo do serviço do salão com o catálogo (opcional, restrict)
-- ---------------------------------------------------------------
alter table public.services add column if not exists catalogo_item_id uuid references public.catalogo_itens (id) on delete restrict;
create index if not exists services_catalogo_item_idx on public.services (catalogo_item_id);
drop trigger if exists catalogo_itens_proteger on public.catalogo_itens;
create trigger catalogo_itens_proteger before delete on public.catalogo_itens for each row execute function public.catalogo_itens_proteger();

-- ---------------------------------------------------------------
-- 5. o que o app vê: só o que está ativo com todos os ancestrais ativos
--    e a categoria ativa. caminho/caminho_slugs vão da categoria ao item. Inativar uma família esconde os filhos sem
--    mexer no estado deles; reativar devolve tudo como estava.
-- ---------------------------------------------------------------
create or replace view public.catalogo_visivel with (security_invoker = true) as
with recursive arv as (
  select i.id, i.tipo, i.categoria_id, i.pai_id, i.nome, i.slug, i.descricao, i.aliases, i.tags, i.duracao_sugerida, i.imagem_url, i.ordem, i.prioridade_sugestao,
         i.id as familia_id, null::uuid as servico_id, 1 as nivel, array[c.slug, i.slug] as caminho_slugs, array[c.nome, i.nome] as caminho
  from public.catalogo_itens i
  join public.categorias_de_servico c on c.id = i.categoria_id and c.salon_id is null and c.ativa
  where i.pai_id is null and i.tipo = 'familia' and i.ativa
  union all
  select f.id, f.tipo, f.categoria_id, f.pai_id, f.nome, f.slug, f.descricao, f.aliases, f.tags, f.duracao_sugerida, f.imagem_url, f.ordem, f.prioridade_sugestao,
         a.familia_id, case when f.tipo = 'servico' then f.id else a.servico_id end, a.nivel + 1, a.caminho_slugs || f.slug, a.caminho || f.nome
  from public.catalogo_itens f
  join arv a on f.pai_id = a.id
  where f.ativa
)
select * from arv;
grant select on public.catalogo_visivel to authenticated;

-- ---------------------------------------------------------------
-- 6. a semente: catalogo_semear(arvore) recebe o catalogo_v1.json e faz
--    upsert pelo caminho de slugs. Campos editoriais (nome, descrição,
--    aliases, tags, duração, ordem, prioridade) acompanham o JSON; ativa e
--    imagem_url ficam como a Plataforma deixou. Só o dono do banco chama.
-- ---------------------------------------------------------------
create or replace function public.catalogo_semear(arvore jsonb)
returns jsonb
language plpgsql
as $$
declare
  cat jsonb; fam jsonb; sv jsonb; tc jsonb;
  cat_id uuid; fam_id uuid; sv_id uuid;
  n_cat integer := 0; n_fam integer := 0; n_sv integer := 0; n_tc integer := 0;
  arr text[];
begin
  for cat in select * from jsonb_array_elements(arvore -> 'categorias') loop
    select id into cat_id from public.categorias_de_servico where salon_id is null and slug = cat ->> 'slug';
    if cat_id is null then raise exception 'catalogo_semear: categoria "%" não existe na plataforma', cat ->> 'slug'; end if;
    n_cat := n_cat + 1;
    for fam in select * from jsonb_array_elements(cat -> 'familias') loop
      select coalesce(array_agg(x), '{}') into arr from jsonb_array_elements_text(coalesce(fam -> 'aliases', '[]')) x;
      insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug, descricao, aliases, ordem, ativa)
        values ('familia', cat_id, null, fam ->> 'nome', fam ->> 'slug', fam ->> 'descricao', arr, coalesce((fam ->> 'ordem')::integer, 0), coalesce((fam ->> 'ativa')::boolean, true))
      on conflict (categoria_id, slug) where pai_id is null do update
        set nome = excluded.nome, descricao = excluded.descricao, aliases = excluded.aliases, ordem = excluded.ordem
      returning id into fam_id;
      n_fam := n_fam + 1;
      for sv in select * from jsonb_array_elements(fam -> 'servicos') loop
        insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug, descricao, aliases, tags, duracao_sugerida, ordem, prioridade_sugestao, ativa)
          values ('servico', cat_id, fam_id, sv ->> 'nome', sv ->> 'slug', sv ->> 'descricao',
                  (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(sv -> 'aliases', '[]')) x),
                  (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(sv -> 'tags', '[]')) x),
                  (sv ->> 'duracao_sugerida')::integer, coalesce((sv ->> 'ordem')::integer, 0), coalesce((sv ->> 'prioridade_sugestao')::integer, 0), coalesce((sv ->> 'ativa')::boolean, true))
        on conflict (categoria_id, pai_id, slug) where pai_id is not null do update
          set nome = excluded.nome, descricao = excluded.descricao, aliases = excluded.aliases, tags = excluded.tags,
              duracao_sugerida = excluded.duracao_sugerida, ordem = excluded.ordem, prioridade_sugestao = excluded.prioridade_sugestao
        returning id into sv_id;
        n_sv := n_sv + 1;
        for tc in select * from jsonb_array_elements(coalesce(sv -> 'tecnicas', '[]')) loop
          insert into public.catalogo_itens (tipo, categoria_id, pai_id, nome, slug, aliases, duracao_sugerida, ordem, ativa)
            values ('tecnica', cat_id, sv_id, tc ->> 'nome', tc ->> 'slug',
                    (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(coalesce(tc -> 'aliases', '[]')) x),
                    (tc ->> 'duracao_sugerida')::integer, coalesce((tc ->> 'ordem')::integer, 0), coalesce((tc ->> 'ativa')::boolean, true))
          on conflict (categoria_id, pai_id, slug) where pai_id is not null do update
            set nome = excluded.nome, aliases = excluded.aliases, duracao_sugerida = excluded.duracao_sugerida, ordem = excluded.ordem;
          n_tc := n_tc + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('categorias', n_cat, 'familias', n_fam, 'servicos', n_sv, 'tecnicas', n_tc);
end;
$$;
revoke execute on function public.catalogo_semear(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 7. a Mel acompanha o cadastro: os momentos do cardápio. Sem frase
--    cadastrada para o momento, a Mel simplesmente não aparece no passo.
-- ---------------------------------------------------------------
insert into public.mel_momentos (chave, categoria, rotulo, descricao, superficies, placeholders, exemplo, ordem) values
  ('cardapio_inicio', 'configuracao', 'Cardápio: abriu o cadastro', 'A pessoa abriu "Adicionar serviço": busca, sugestões e categorias.', '{mel_bubble}', '{nome,n}', '{"nome":"Carla","n":"0"}', 380),
  ('cardapio_categoria', 'configuracao', 'Cardápio: escolheu a categoria', 'A pessoa escolheu uma categoria e está vendo as famílias.', '{mel_bubble}', '{nome,categoria,n}', '{"nome":"Carla","categoria":"Cabelo","n":"10"}', 381),
  ('cardapio_familia', 'configuracao', 'Cardápio: escolheu a família', 'A pessoa escolheu uma família e está vendo os serviços.', '{mel_bubble}', '{nome,categoria,familia,n}', '{"nome":"Carla","categoria":"Cabelo","familia":"Alisamento e alinhamento","n":"7"}', 382),
  ('cardapio_sugestoes', 'configuracao', 'Cardápio: olhando as sugestões', 'A pessoa está nas sugestões para o salão dela.', '{mel_bubble}', '{nome,n}', '{"nome":"Carla","n":"8"}', 383),
  ('cardapio_nao_achou', 'configuracao', 'Cardápio: busca sem resultado', 'A busca não achou nada; a saída é criar do próprio jeito.', '{mel_bubble}', '{nome,servico}', '{"nome":"Carla","servico":"banho de lua"}', 384),
  ('cardapio_forma', 'configuracao', 'Cardápio: chegou no formulário', 'Serviço escolhido; agora nome, duração, preço e quem faz.', '{mel_bubble}', '{nome,categoria,familia,servico}', '{"nome":"Carla","categoria":"Cabelo","familia":"Alisamento e alinhamento","servico":"Progressiva"}', 385),
  ('cardapio_salvo', 'configuracao', 'Cardápio: serviço salvo', 'Acabou de salvar um serviço vindo do catálogo.', '{mel_bubble}', '{nome,servico,n}', '{"nome":"Carla","servico":"Progressiva","n":"1"}', 386)
on conflict (chave) do update set
  categoria = excluded.categoria, rotulo = excluded.rotulo, descricao = excluded.descricao,
  superficies = excluded.superficies, placeholders = excluded.placeholders, exemplo = excluded.exemplo, ordem = excluded.ordem;
