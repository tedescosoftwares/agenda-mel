-- 116: SEO e Conteúdo. O site público (mimo.com.vc) ganha páginas por
-- intenção de busca, um blog e uma área na plataforma para cuidar de
-- title, description, Open Graph, artigos, categorias e
-- redirecionamentos. Sem virar CMS: o conteúdo das páginas SEO vive no
-- código; aqui ficam os metadados editáveis, os artigos e o que o
-- sitemap precisa saber. Qualquer um lê o que está publicado; só a
-- plataforma escreve.

-- 1. categorias do blog -----------------------------------------------------
create table if not exists public.blog_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.blog_categories enable row level security;
drop policy if exists "categorias: todo mundo ve" on public.blog_categories;
create policy "categorias: todo mundo ve" on public.blog_categories for select to anon, authenticated using (true);
drop policy if exists "categorias: plataforma escreve" on public.blog_categories;
create policy "categorias: plataforma escreve" on public.blog_categories for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select on public.blog_categories to anon, authenticated;
grant insert, update, delete on public.blog_categories to authenticated;

-- 2. páginas: home, institucionais, SEO e o índice do blog -----------------
create table if not exists public.seo_pages (
  id uuid primary key default gen_random_uuid(),
  route text not null unique,
  page_type text not null default 'SEO_LANDING' check (page_type in ('HOME', 'INSTITUTIONAL', 'SEO_LANDING', 'BLOG_INDEX', 'OTHER')),
  title text not null,
  slug text not null unique,
  seo_title text,
  meta_description text,
  canonical_url text,
  og_title text,
  og_description text,
  og_image_url text,
  robots_index boolean not null default true,
  robots_follow boolean not null default true,
  schema_type text,
  schema_json jsonb,
  status text not null default 'published' check (status in ('draft', 'published')),
  published_at timestamptz default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.seo_pages enable row level security;
drop policy if exists "paginas: publicadas sao publicas" on public.seo_pages;
create policy "paginas: publicadas sao publicas" on public.seo_pages for select to anon, authenticated using (status = 'published' or public.eh_plataforma());
drop policy if exists "paginas: plataforma escreve" on public.seo_pages;
create policy "paginas: plataforma escreve" on public.seo_pages for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select on public.seo_pages to anon, authenticated;
grant insert, update, delete on public.seo_pages to authenticated;

-- 3. artigos ---------------------------------------------------------------
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null default '',
  cover_image_url text,
  cover_alt text,
  category_id uuid references public.blog_categories(id) on delete set null,
  author_name text not null default 'Equipe MIMO',
  seo_title text,
  meta_description text,
  canonical_url text,
  og_title text,
  og_description text,
  og_image_url text,
  robots_index boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  reading_time_minutes integer not null default 1,
  -- os links internos que a spec pede: produto, artigos relacionados,
  -- a caixa prática e as perguntas frequentes do artigo
  produto_url text,
  produto_rotulo text,
  relacionados jsonb not null default '[]'::jsonb,
  caixa jsonb,
  faq jsonb not null default '[]'::jsonb
);
alter table public.blog_posts enable row level security;
drop policy if exists "artigos: publicados sao publicos" on public.blog_posts;
create policy "artigos: publicados sao publicos" on public.blog_posts for select to anon, authenticated using (status = 'published' or public.eh_plataforma());
drop policy if exists "artigos: plataforma escreve" on public.blog_posts;
create policy "artigos: plataforma escreve" on public.blog_posts for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select on public.blog_posts to anon, authenticated;
grant insert, update, delete on public.blog_posts to authenticated;
create index if not exists blog_posts_publicados on public.blog_posts (published_at desc) where status = 'published';

-- 4. redirecionamentos -----------------------------------------------------
create table if not exists public.redirects (
  id uuid primary key default gen_random_uuid(),
  from_path text not null unique,
  to_path text not null,
  http_status integer not null default 301 check (http_status in (301, 302, 307, 308)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.redirects enable row level security;
drop policy if exists "redirects: ativos sao publicos" on public.redirects;
create policy "redirects: ativos sao publicos" on public.redirects for select to anon, authenticated using (active or public.eh_plataforma());
drop policy if exists "redirects: plataforma escreve" on public.redirects;
create policy "redirects: plataforma escreve" on public.redirects for all to authenticated using (public.eh_plataforma()) with check (public.eh_plataforma());
grant select on public.redirects to anon, authenticated;
grant insert, update, delete on public.redirects to authenticated;

-- 5. gatilhos: updated_at anda sozinho; o tempo de leitura sai do texto ---
create or replace function public.seo_atualizado()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists seo_pages_atualizado on public.seo_pages;
create trigger seo_pages_atualizado before update on public.seo_pages for each row execute function public.seo_atualizado();

create or replace function public.blog_post_preparar()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  -- 200 palavras por minuto, mínimo 1
  new.reading_time_minutes := greatest(1, round(array_length(regexp_split_to_array(btrim(coalesce(new.content, '')), '\s+'), 1) / 200.0)::integer);
  if new.status = 'published' and new.published_at is null then new.published_at := now(); end if;
  if new.slug is not null then new.slug := regexp_replace(lower(new.slug), '[^a-z0-9-]', '-', 'g'); end if;
  return new;
end;
$$;
drop trigger if exists blog_posts_preparar on public.blog_posts;
create trigger blog_posts_preparar before insert or update on public.blog_posts for each row execute function public.blog_post_preparar();

-- 6. o que o sitemap precisa: só o público, canônico, indexável e publicado
create or replace function public.seo_sitemap()
returns table (caminho text, atualizado_em timestamptz)
language sql
stable
security definer set search_path = public
as $$
  select route, updated_at from public.seo_pages where status = 'published' and robots_index
  union all
  select '/blog/' || slug, coalesce(updated_at, published_at) from public.blog_posts where status = 'published' and robots_index
  union all
  select '/blog/categoria/' || c.slug, max(p.updated_at) from public.blog_categories c join public.blog_posts p on p.category_id = c.id and p.status = 'published' group by c.slug
  order by 1;
$$;
grant execute on function public.seo_sitemap() to anon, authenticated;

-- 7. a semente: o que já está no código entra no banco (e nunca sobrescreve
--    o que a plataforma editou: on conflict do nothing) ---------------------
-- categorias
insert into public.blog_categories (name, slug, description, ordem) values ('Agenda', 'agenda', 'Horários, bloqueios, encaixes e lista de espera.', 10) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('Clientes', 'clientes', 'Histórico, retorno e relacionamento.', 20) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('Gestão do salão', 'gestao-do-salao', 'A operação do dia a dia, do balcão ao caixa.', 30) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('Equipe', 'equipe', 'Profissionais, vínculos, horários e permissões.', 40) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('WhatsApp', 'whatsapp', 'Confirmação, lembrete e conversa ligada à agenda.', 50) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('Financeiro', 'financeiro', 'Sinal, pagamentos, comanda e repasses.', 60) on conflict (slug) do nothing;
insert into public.blog_categories (name, slug, description, ordem) values ('Crescimento', 'crescimento', 'Mais clientes, mais agenda, mais salão.', 70) on conflict (slug) do nothing;

-- páginas: home, institucionais e SEO
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/', 'HOME', 'Home', 'home', 'MIMO | Sistema para Salão de Beleza e Agenda Online', 'Organize agenda, clientes, equipe, WhatsApp, retorno e pagamentos com a MIMO. Sistema para salão de beleza e profissional autônoma. Plano grátis para autônomas.', 'MIMO | Sistema para Salão de Beleza e Agenda Online', 'Organize agenda, clientes, equipe, WhatsApp, retorno e pagamentos com a MIMO. Sistema para salão de beleza e profissional autônoma. Plano grátis para autônomas.', 'https://mimo.com.vc/og-mimo.png', 'SoftwareApplication') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/planos', 'INSTITUTIONAL', 'Planos', 'planos', 'Planos e preços | MIMO', 'Autônoma grátis. Salão por R$ 49,90/mês mais R$ 9,90 por profissional ativa na agenda. Sem orçamento, sem surpresa.', 'Planos e preços | MIMO', 'Autônoma grátis. Salão por R$ 49,90/mês mais R$ 9,90 por profissional ativa na agenda. Sem orçamento, sem surpresa.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/sobre', 'INSTITUTIONAL', 'Sobre a MIMO', 'sobre', 'Sobre a MIMO | Beleza, organização e relacionamento', 'A MIMO é um sistema de agenda e relacionamento para salões e profissionais de beleza, construído junto à rotina real de quem vive da beleza.', 'Sobre a MIMO | Beleza, organização e relacionamento', 'A MIMO é um sistema de agenda e relacionamento para salões e profissionais de beleza, construído junto à rotina real de quem vive da beleza.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/contato', 'INSTITUTIONAL', 'Contato', 'contato', 'Contato | MIMO', 'Fale com a equipe da MIMO: dúvidas sobre o sistema para salão, a conta de autônoma ou parcerias.', 'Contato | MIMO', 'Fale com a equipe da MIMO: dúvidas sobre o sistema para salão, a conta de autônoma ou parcerias.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/blog', 'BLOG_INDEX', 'Blog', 'blog', 'Blog da MIMO | Agenda, clientes e gestão de salão', 'Guias curtos e práticos para quem vive da beleza: agenda, clientes, equipe, WhatsApp e financeiro do salão.', 'Blog da MIMO | Agenda, clientes e gestão de salão', 'Guias curtos e práticos para quem vive da beleza: agenda, clientes, equipe, WhatsApp e financeiro do salão.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/termos', 'INSTITUTIONAL', 'Termos de uso', 'termos', 'Termos de uso | MIMO', 'Termos de uso da MIMO.', 'Termos de uso | MIMO', 'Termos de uso da MIMO.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/privacidade', 'INSTITUTIONAL', 'Privacidade', 'privacidade', 'Política de privacidade | MIMO', 'Política de privacidade da MIMO, pensada para a LGPD.', 'Política de privacidade | MIMO', 'Política de privacidade da MIMO, pensada para a LGPD.', 'https://mimo.com.vc/og-mimo.png', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/sistema-para-salao-de-beleza', 'SEO_LANDING', 'Toda a operação do seu salão em um só lugar.', 'sistema-para-salao-de-beleza', 'Sistema para Salão de Beleza | MIMO', 'Sistema para salão de beleza com agenda multi-profissional, equipe, clientes, WhatsApp, lista de espera, sinal e comanda. Organize a operação inteira com a MIMO.', 'Sistema para Salão de Beleza | MIMO', 'Sistema para salão de beleza com agenda multi-profissional, equipe, clientes, WhatsApp, lista de espera, sinal e comanda. Organize a operação inteira com a MIMO.', 'https://mimo.com.vc/imagens/profissional-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-online-para-salao-de-beleza', 'SEO_LANDING', 'Uma agenda que entende como o salão realmente funciona.', 'agenda-online-para-salao-de-beleza', 'Agenda Online para Salão de Beleza | MIMO', 'Agenda online para salão de beleza: a cliente marca pelo seu QR ou link, o salão vê todas as profissionais, confirma pelo WhatsApp e preenche vagas com a lista de espera.', 'Agenda Online para Salão de Beleza | MIMO', 'Agenda online para salão de beleza: a cliente marca pelo seu QR ou link, o salão vê todas as profissionais, confirma pelo WhatsApp e preenche vagas com a lista de espera.', 'https://mimo.com.vc/imagens/agenda-celular-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/app-para-profissional-de-beleza', 'SEO_LANDING', 'Sua agenda, seus clientes, no seu celular.', 'app-para-profissional-de-beleza', 'App para Profissional de Beleza Autônoma (Grátis) | MIMO', 'App grátis para profissional de beleza autônoma: agenda online, serviços e preços, clientes com histórico, QR e link próprios e retorno de clientes. Sem mensalidade.', 'App para Profissional de Beleza Autônoma (Grátis) | MIMO', 'App grátis para profissional de beleza autônoma: agenda online, serviços e preços, clientes com histórico, QR e link próprios e retorno de clientes. Sem mensalidade.', 'https://mimo.com.vc/imagens/profissional-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-para-manicure', 'SEO_LANDING', 'Sua agenda de manicure mais simples e completa.', 'agenda-para-manicure', 'Agenda para Manicure: online e grátis | MIMO', 'Agenda online para manicure: manutenção em dia, clientes recorrentes com histórico, serviços e preços, horários e link próprio para a cliente marcar sozinha. Grátis.', 'Agenda para Manicure: online e grátis | MIMO', 'Agenda online para manicure: manutenção em dia, clientes recorrentes com histórico, serviços e preços, horários e link próprio para a cliente marcar sozinha. Grátis.', 'https://mimo.com.vc/imagens/lifestyle-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-para-cabeleireira', 'SEO_LANDING', 'Corte, escova, química: uma agenda que cabe tudo.', 'agenda-para-cabeleireira', 'Agenda para Cabeleireira: serviços longos e retorno | MIMO', 'Agenda online para cabeleireira: corte, escova, coloração e progressiva com duração real, combinações de serviços, retorno de clientes e agenda por profissional. Grátis para autônoma.', 'Agenda para Cabeleireira: serviços longos e retorno | MIMO', 'Agenda online para cabeleireira: corte, escova, coloração e progressiva com duração real, combinações de serviços, retorno de clientes e agenda por profissional. Grátis para autônoma.', 'https://mimo.com.vc/imagens/salao-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-para-lash-designer', 'SEO_LANDING', 'Aplicação e manutenção de cílios no prazo certo.', 'agenda-para-lash-designer', 'Agenda para Lash Designer: manutenção e recorrência | MIMO', 'Agenda online para lash designer: aplicação e manutenção de cílios com tempo real, retorno automático no ciclo certo, sinal por Pix para segurar o horário e link próprio. Grátis.', 'Agenda para Lash Designer: manutenção e recorrência | MIMO', 'Agenda online para lash designer: aplicação e manutenção de cílios com tempo real, retorno automático no ciclo certo, sinal por Pix para segurar o horário e link próprio. Grátis.', 'https://mimo.com.vc/imagens/cliente-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-para-designer-de-sobrancelhas', 'SEO_LANDING', 'Design, henna e brow lamination na agenda certa.', 'agenda-para-designer-de-sobrancelhas', 'Agenda para Designer de Sobrancelhas | MIMO', 'Agenda online para designer de sobrancelhas: design, henna e brow lamination com tempos próprios, retorno de clientes a cada ciclo, encaixes e link próprio para marcar. Grátis.', 'Agenda para Designer de Sobrancelhas | MIMO', 'Agenda online para designer de sobrancelhas: design, henna e brow lamination com tempos próprios, retorno de clientes a cada ciclo, encaixes e link próprio para marcar. Grátis.', 'https://mimo.com.vc/imagens/profissional-1400.webp', 'WebPage') on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type) values ('/agenda-para-esteticista', 'SEO_LANDING', 'Protocolos, sessões e pacotes numa agenda só.', 'agenda-para-esteticista', 'Agenda para Esteticista: sessões, pacotes e retorno | MIMO', 'Agenda online para esteticista: sessões longas com duração real, retorno por protocolo, sinal por Pix para horários longos, histórico de cada cliente e link próprio para marcar. Grátis.', 'Agenda para Esteticista: sessões, pacotes e retorno | MIMO', 'Agenda online para esteticista: sessões longas com duração real, retorno por protocolo, sinal por Pix para horários longos, histórico de cada cliente e link próprio para marcar. Grátis.', 'https://mimo.com.vc/imagens/lifestyle-1400.webp', 'WebPage') on conflict (route) do nothing;

-- artigos
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como organizar a agenda de um salão de beleza sem transformar o dia em confusão', 'como-organizar-agenda-salao-de-beleza', 'Aprenda a organizar a agenda do salão, horários da equipe, serviços, encaixes e cancelamentos sem depender de memória, papel e mensagens soltas.', 'Uma agenda de salão parece simples enquanto existem poucos horários para controlar.

O problema começa quando entram várias profissionais, serviços com durações diferentes, pausas, encaixes, clientes que atrasam, cancelamentos e mensagens chegando ao mesmo tempo pelo WhatsApp.

Nessa hora, a agenda deixa de ser apenas uma lista de nomes e passa a ser parte da operação do salão.

Organizar bem não significa criar regras demais. Significa deixar claro quem atende, o que atende, em qual horário e o que acontece quando alguma coisa muda.

Neste guia, você vai ver uma forma prática de organizar essa rotina.

## 1. Comece pelos horários reais da equipe

O primeiro erro é montar a agenda com base apenas no horário de funcionamento do salão.

Se o salão abre das 9h às 19h, isso não significa que todas as profissionais estão disponíveis nesse mesmo período.

Cada profissional pode ter:

- dias diferentes;
- horário de entrada e saída;
- intervalo;
- folga;
- bloqueios;
- serviços específicos.

Por isso, a agenda precisa nascer da disponibilidade real de cada pessoa.

Uma forma simples é cadastrar primeiro o horário padrão do salão e depois ajustar apenas as profissionais que fogem desse padrão.

Isso reduz trabalho e mantém a agenda coerente.

## 2. Cadastre duração real dos serviços

Se uma escova leva 45 minutos, não trate como 30.

Se uma progressiva ocupa três horas, esse tempo precisa estar reservado.

Quando a duração está errada, o salão cria atrasos em cascata.

A profissional termina um atendimento depois do previsto, a próxima cliente espera, a recepção tenta reorganizar tudo e o restante do dia começa a escorregar.

Para cada serviço, registre pelo menos:

- nome;
- duração;
- preço;
- profissionais que realizam.

Se determinadas profissionais levam tempos diferentes no mesmo serviço, a agenda deve permitir essa configuração individual.

## 3. Separe horário livre de horário disponível

Um espaço vazio no calendário não significa necessariamente que ele pode receber qualquer atendimento.

Imagine um intervalo de 50 minutos.

Ele pode servir para uma manicure de 45 minutos, mas não para uma coloração de duas horas.

A disponibilidade precisa considerar:

- duração do serviço;
- profissional escolhida;
- bloqueios;
- pausas;
- outros atendimentos.

É isso que impede a agenda de oferecer um horário que, na prática, não existe.

## 4. Use bloqueios para tudo que não é atendimento

Almoço, reunião, compromisso pessoal, treinamento e folga não devem ficar “na cabeça” da equipe.

Bloqueie na agenda.

Quanto mais informação importante fica fora do sistema, mais a recepção depende de perguntar.

Uma agenda organizada responde sozinha:

“Ela pode atender nesse horário?”

## 5. Tenha uma regra clara para encaixes

Encaixe não precisa significar bagunça.

Antes de aceitar, confira:

1. qual serviço será realizado;
2. quanto tempo ele exige;
3. quem está disponível;
4. se existe margem antes do próximo atendimento.

O melhor encaixe é aquele que ocupa um espaço real sem empurrar atraso para as próximas clientes.

## 6. Trate cancelamento como oportunidade

Quando alguém cancela, aparece um novo problema: um horário que estava vendido agora está vazio.

Se o salão possui lista de espera, essa vaga pode voltar a ser útil.

Uma boa lista de espera registra:

- serviço desejado;
- profissional preferida;
- dias possíveis;
- faixa de horário.

Assim, quando uma vaga surge, fica mais fácil encontrar uma cliente compatível.

## 7. Centralize a informação

O pior cenário é este:

- agenda no papel;
- confirmação no WhatsApp;
- folga num grupo;
- pagamento em outro lugar;
- retorno anotado em uma planilha.

O objetivo de um sistema não deveria ser apenas digitalizar o caderno.

Ele deveria conectar essas informações.

Quando a cliente agenda, o salão já deveria saber:

- serviço;
- profissional;
- duração;
- valor;
- status;
- origem;
- necessidade de sinal;
- histórico da cliente.

Isso reduz perguntas e retrabalho.

## 8. Revise a agenda todos os dias

Não precisa de uma reunião.

Cinco minutos no começo do dia já ajudam.

Olhe:

- atendimentos confirmados;
- pendentes;
- horários livres;
- cancelamentos;
- clientes em espera.

A ideia é descobrir os problemas antes que eles aconteçam.

## Conclusão

Organizar a agenda não é colocar mais regra no salão.

É tirar informação da memória das pessoas e colocar num fluxo que todo mundo entende.

Quando horários, serviços, profissionais e clientes estão conectados, a recepção trabalha melhor, a profissional recebe uma agenda mais clara e a cliente encontra menos atrito para marcar.

A MIMO foi construída exatamente em torno dessa lógica: a agenda é o ponto de partida, mas ela precisa conversar com o restante da operação.', '/imagens/salao-1400.webp', 'profissional de beleza organizando horários em um tablet no salão', c.id, 'Equipe MIMO', 'Como organizar a agenda de um salão de beleza | MIMO', 'Aprenda a organizar a agenda do salão, horários da equipe, serviços, encaixes e cancelamentos sem depender de memória, papel e mensagens soltas.', 'Como organizar a agenda de um salão de beleza | MIMO', 'Aprenda a organizar a agenda do salão, horários da equipe, serviços, encaixes e cancelamentos sem depender de memória, papel e mensagens soltas.', 'https://mimo.com.vc/imagens/salao-1400.webp', 'published', '2026-09-10T12:00:00-03:00', 4, '/agenda-online-para-salao-de-beleza', 'Conheça a agenda da MIMO para salões', '["como-reduzir-horarios-vagos-salao","agenda-multi-profissional-salao"]'::jsonb, '{"titulo":"Na prática","texto":"Cadastre primeiro o horário padrão do salão, depois ajuste só quem trabalha diferente. Duração real em cada serviço e bloqueio para tudo que não é atendimento."}'::jsonb, '[]'::jsonb
  from public.blog_categories c where c.slug = 'agenda' on conflict (slug) do nothing;
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como reduzir horários vagos no salão de beleza', 'como-reduzir-horarios-vagos-salao', 'Veja estratégias práticas para reduzir horários vazios no salão usando lista de espera, retorno, confirmação e organização da agenda.', 'Uma cadeira vazia custa mais do que parece.

O salão continua pagando aluguel, energia e estrutura. A profissional reservou aquele período. E uma cliente que poderia estar ali talvez nem saiba que o horário ficou disponível.

Nenhum salão consegue eliminar totalmente os espaços vagos, mas dá para reduzir bastante o desperdício de agenda quando a operação reage rápido.

## 1. Descubra de onde os vazios vêm

Antes de tentar preencher, entenda a causa.

Os espaços normalmente aparecem por:

- cancelamento;
- falta;
- horários difíceis;
- serviços mal distribuídos;
- agenda aberta sem estratégia;
- intervalos que não comportam os serviços disponíveis.

Observe durante algumas semanas.

Quais dias têm mais buracos?

Quais profissionais?

Quais horários?

Quais serviços cancelam mais?

Sem isso, o salão tenta resolver tudo com promoção.

## 2. Confirme os atendimentos

Muita falta acontece porque o compromisso simplesmente saiu da cabeça da cliente.

Uma confirmação próxima ao atendimento reduz esse risco e ainda abre tempo para agir caso ela precise cancelar.

A mensagem deve ser curta.

Exemplo:

“Oi, Camila. Seu horário no Studio Essenza é amanhã às 14h para escova com a Melissa. Pode confirmar?”

Se a cliente disser que não consegue ir, o salão ganha algumas horas para procurar substituta.

## 3. Crie uma lista de espera útil

Uma lista com apenas nomes não resolve muita coisa.

Registre também:

- serviço;
- profissional;
- dias disponíveis;
- período preferido;
- contato.

Quando aparece uma vaga de manicure às 16h, o salão não precisa mandar mensagem para vinte pessoas.

Ele procura quem realmente combina com aquele horário.

## 4. Trabalhe o retorno antes da agenda esvaziar

Nem todo horário precisa ser preenchido por cliente nova.

Muitas vezes existe uma cliente antiga que já deveria ter voltado.

Exemplos:

- manutenção de unha;
- retoque;
- cílios;
- coloração;
- tratamento;
- sobrancelha.

O salão pode acompanhar quem está chegando no período normal de retorno e fazer contato antes que essa cliente desapareça.

## 5. Facilite o reagendamento

Cancelar e remarcar são coisas diferentes.

Se remarcar for difícil, a cliente cancela e “depois vê”.

Se houver uma forma simples de escolher outro horário, aumenta a chance de o atendimento continuar dentro da agenda.

## 6. Evite criar buracos impossíveis

Um espaço de 20 minutos entre dois atendimentos dificilmente vende.

Às vezes isso acontece porque os serviços foram encaixados sem considerar duração e sequência.

Observe se a distribuição da agenda está criando muitos intervalos pequenos.

Sempre que possível, priorize combinações que preservem blocos utilizáveis.

## 7. Use sinal quando fizer sentido

Para serviços mais longos ou horários muito disputados, um sinal pode aumentar o compromisso da reserva.

A política precisa estar clara antes do pagamento.

Explique:

- valor;
- condições de cancelamento;
- como funciona o reagendamento;
- quando existe estorno ou crédito.

Não transforme o sinal em punição.

Ele deve ajudar a dar previsibilidade para os dois lados.

## 8. Meça o que está acontecendo

Alguns números simples já ajudam:

- horários disponíveis;
- agendamentos;
- cancelamentos;
- faltas;
- vagas recuperadas;
- clientes que retornaram.

O salão não precisa de cinquenta gráficos.

Precisa enxergar onde a agenda está vazando.

## Conclusão

Horário vazio não se resolve só com desconto.

A solução costuma ser uma combinação de organização, confirmação, lista de espera e relacionamento com clientes que já conhecem o salão.

A MIMO conecta essas partes para que uma vaga liberada não seja apenas um buraco no calendário, mas uma oportunidade de ação.', '/imagens/agenda-celular-1400.webp', 'agenda do salão no celular com um horário livre destacado', c.id, 'Equipe MIMO', 'Como reduzir horários vagos no salão de beleza | MIMO', 'Veja estratégias práticas para reduzir horários vazios no salão usando lista de espera, retorno, confirmação e organização da agenda.', 'Como reduzir horários vagos no salão de beleza | MIMO', 'Veja estratégias práticas para reduzir horários vazios no salão usando lista de espera, retorno, confirmação e organização da agenda.', 'https://mimo.com.vc/imagens/agenda-celular-1400.webp', 'published', '2026-09-12T12:00:00-03:00', 3, '/agenda-online-para-salao-de-beleza', 'Veja como a lista de espera funciona na MIMO', '["como-fazer-clientes-voltarem-salao","sinal-no-agendamento-salao"]'::jsonb, '{"titulo":"Na prática","texto":"Confirme na véspera, registre serviço e período na lista de espera e olhe primeiro quem já deveria ter voltado. Desconto é o último recurso."}'::jsonb, '[["A lista de espera realmente ajuda a reduzir horários vagos?","Ajuda quando registra mais do que o nome: serviço, profissional, dias e período. Assim, quando abre uma vaga, o salão procura quem combina com ela em vez de mandar mensagem para todo mundo."],["Posso oferecer só alguns serviços para encaixe?","Pode. O encaixe faz sentido quando o serviço cabe no espaço que sobrou. Uma manicure de 45 minutos entra num intervalo de 50; uma coloração de duas horas, não."],["Como a MIMO avisa quando um horário fica disponível?","Quando um atendimento é cancelado, o quadro do salão mostra a vaga e quem da lista de espera combina com ela. A partir daí o salão decide quem chamar."],["Preciso pagar mais por isso?","Não. Lista de espera faz parte da agenda, tanto no plano de salão quanto na conta gratuita de autônoma."]]'::jsonb
  from public.blog_categories c where c.slug = 'gestao-do-salao' on conflict (slug) do nothing;
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como fazer clientes voltarem ao salão sem depender da memória', 'como-fazer-clientes-voltarem-salao', 'Aprenda a organizar retornos de clientes, histórico de serviços e contatos sem depender da memória da equipe.', 'A cliente sai satisfeita, diz que volta e o salão acredita que vai lembrar dela.

Só que chegam outras mensagens, novos atendimentos, problemas do dia e, algumas semanas depois, ninguém lembra exatamente quem deveria ter voltado.

Retenção não começa com uma campanha sofisticada.

Começa com memória organizada.

## 1. Cada serviço tem um ritmo

Nem toda cliente volta no mesmo intervalo.

Manutenção de unhas pode ter um ciclo.

Cílios, outro.

Cabelo e tratamentos também.

Por isso, o primeiro passo é entender quais serviços têm retorno previsível.

O salão não precisa impor uma data exata, mas pode trabalhar com uma janela aproximada.

## 2. Registre o último atendimento

O mínimo necessário:

- data;
- serviço;
- profissional;
- observações relevantes.

Com isso, já é possível identificar clientes que estão chegando na época de voltar.

## 3. Faça contato com contexto

Evite mensagem genérica:

“Oi, estamos com horários disponíveis.”

Prefira contexto:

“Oi, Mariana. Vi que já faz algumas semanas desde sua manutenção em gel. A Ana abriu alguns horários essa semana. Quer que eu te mande?”

A mensagem parece atendimento, não disparo.

## 4. Não mande para todo mundo

Nem toda cliente precisa receber mensagem toda semana.

Crie grupos simples:

- retorno próximo;
- atrasada no retorno;
- aniversário;
- sem atendimento há muito tempo.

Isso evita cansar a base.

## 5. Preserve a relação com a profissional

Em muitos salões, a cliente possui vínculo forte com quem atende.

Essa informação importa.

Se a cliente costuma fazer determinado serviço com determinada profissional, o sistema deve preservar esse contexto.

Assim, o salão não trata toda a carteira como uma lista anônima.

## 6. Dê caminho fácil para marcar

A mensagem de retorno deveria terminar com um próximo passo.

Por exemplo:

- link do salão;
- link da profissional;
- resposta pelo WhatsApp;
- opções de horários.

Quanto mais etapas, maior a chance de a cliente deixar para depois.

## 7. Observe quem realmente voltou

O salão precisa diferenciar:

“mensagem enviada”

de:

“cliente voltou”.

O objetivo não é disparar contato.

É recuperar relacionamento.

## Conclusão

Fidelização não precisa nascer de pontos, cupom ou clube.

Ela pode começar com algo muito simples: lembrar da cliente no momento certo.

A MIMO organiza histórico e retorno justamente para transformar uma informação esquecida numa ação concreta.', '/imagens/cliente-1400.webp', 'cliente sorrindo enquanto marca o próximo horário com a profissional no balcão', c.id, 'Equipe MIMO', 'Como fazer clientes voltarem ao salão de beleza | MIMO', 'Aprenda a organizar retornos de clientes, histórico de serviços e contatos sem depender da memória da equipe.', 'Como fazer clientes voltarem ao salão de beleza | MIMO', 'Aprenda a organizar retornos de clientes, histórico de serviços e contatos sem depender da memória da equipe.', 'https://mimo.com.vc/imagens/cliente-1400.webp', 'published', '2026-09-14T12:00:00-03:00', 2, '/sistema-para-salao-de-beleza', 'Veja o retorno de clientes na MIMO', '["como-organizar-agenda-salao-de-beleza","como-reduzir-horarios-vagos-salao"]'::jsonb, '{"titulo":"Na prática","texto":"Registre data, serviço e profissional de cada atendimento. Quando a janela de retorno chegar, mande uma mensagem com contexto e um caminho fácil para marcar."}'::jsonb, '[]'::jsonb
  from public.blog_categories c where c.slug = 'clientes' on conflict (slug) do nothing;
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como organizar a agenda de várias profissionais no mesmo salão', 'agenda-multi-profissional-salao', 'Veja como organizar horários, serviços, folgas e agendas de várias profissionais sem perder a visão geral do salão.', 'Quando apenas uma pessoa atende, qualquer agenda simples pode funcionar.

Quando entram quatro, seis ou dez profissionais, a lógica muda.

Agora existem agendas paralelas, serviços diferentes, horários individuais, folgas, clientes preferenciais e regras específicas.

O salão precisa enxergar o todo sem apagar a individualidade de cada profissional.

## 1. Uma agenda por profissional, uma visão para o salão

Cada profissional precisa ter seu calendário.

Ao mesmo tempo, a gestão precisa enxergar todas elas juntas.

São duas visões da mesma operação:

- individual;
- geral.

A recepção usa a visão geral para procurar disponibilidade.

A profissional usa sua agenda para entender o próprio dia.

## 2. Defina quem realiza cada serviço

Nem todas fazem tudo.

Ao cadastrar um serviço, relacione quem pode executá-lo.

Isso evita oferecer manicure para uma profissional de cabelo ou colocar uma química com alguém que não realiza aquele procedimento.

## 3. Permita tempo individual por serviço

Duas profissionais podem fazer o mesmo serviço em tempos diferentes.

Uma pode levar 45 minutos.

Outra, uma hora.

Quando necessário, permita que o tempo padrão do salão seja substituído por um tempo individual.

## 4. Configure horários sem repetir trabalho

Use o horário do salão como base.

Depois altere apenas quem trabalha diferente.

Exemplo:

Salão:
terça a sábado, 9h às 19h.

Profissional A:
segue padrão.

Profissional B:
quarta a sábado.

Profissional C:
terça a sexta, até 17h.

É mais rápido do que configurar tudo do zero para cada pessoa.

## 5. Use bloqueios individuais

Folga, almoço, evento e compromisso pessoal precisam ser aplicados na agenda correta.

Um bloqueio da Ana não pode fechar a agenda da Bruna.

## 6. Defina permissões

Nem toda profissional precisa gerenciar tudo.

Algumas podem:

- visualizar agenda;
- confirmar atendimento;
- bloquear horário.

Outras talvez não devam:

- alterar preço;
- mudar regra financeira;
- editar serviço;
- mexer em outra agenda.

Permissão deve acompanhar a responsabilidade real.

## 7. Registre o tipo de vínculo operacional

O salão pode trabalhar com profissionais em modelos diferentes.

Por exemplo:

- parceira;
- funcionária;
- autônoma vinculada;
- aluguel de espaço;
- temporária.

Na MIMO, o tipo de vínculo pode funcionar como um preset operacional.

Depois o salão ajusta serviços, horários e permissões individualmente.

## Conclusão

Uma agenda multi-profissional boa não é apenas um calendário com várias colunas.

Ela precisa entender quem trabalha, quando trabalha e o que pode fazer.

A gestão ganha visão geral e cada profissional continua com uma rotina clara.', '/imagens/equipe-1400.webp', 'dona do salão e duas profissionais olhando a agenda no tablet', c.id, 'Equipe MIMO', 'Como organizar agenda de várias profissionais no salão | MIMO', 'Veja como organizar horários, serviços, folgas e agendas de várias profissionais sem perder a visão geral do salão.', 'Como organizar agenda de várias profissionais no salão | MIMO', 'Veja como organizar horários, serviços, folgas e agendas de várias profissionais sem perder a visão geral do salão.', 'https://mimo.com.vc/imagens/equipe-1400.webp', 'published', '2026-09-16T12:00:00-03:00', 2, '/sistema-para-salao-de-beleza', 'Veja a agenda geral e por profissional na MIMO', '["como-organizar-agenda-salao-de-beleza","como-escolher-sistema-para-salao-de-beleza"]'::jsonb, '{"titulo":"Na prática","texto":"Uma agenda por profissional, uma visão para o salão. Horário do salão como base, ajuste individual só para quem foge dele, bloqueio na agenda certa."}'::jsonb, '[]'::jsonb
  from public.blog_categories c where c.slug = 'equipe' on conflict (slug) do nothing;
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Sinal no agendamento: como usar sem criar atrito com a cliente', 'sinal-no-agendamento-salao', 'Entenda como usar sinal no agendamento, definir regras claras e reduzir cancelamentos sem criar uma experiência ruim para a cliente.', 'O sinal pode ajudar o salão a proteger horários longos e muito disputados.

Mas, se for aplicado sem clareza, também pode criar desconforto.

O segredo está menos no valor e mais na regra.

A cliente precisa entender o que está pagando e o que acontece se precisar mudar o horário.

## 1. Quando o sinal faz mais sentido

Ele costuma ser mais útil em:

- procedimentos longos;
- serviços com materiais preparados antecipadamente;
- horários muito disputados;
- agendas com alto índice de cancelamento.

Não é obrigatório cobrar sinal de todo serviço.

## 2. Explique antes do pagamento

Mostre:

- valor do serviço;
- valor do sinal;
- valor restante;
- política de cancelamento;
- regra de reagendamento.

A cliente não deve descobrir as regras depois de pagar.

## 3. Sinal não precisa ser o pagamento completo

Exemplo:

Serviço: R$ 180  
Sinal: R$ 50  
Restante: R$ 130

Isso já cria compromisso sem exigir pagamento integral antecipado.

## 4. Tenha política de reagendamento

Imprevistos existem.

Uma política equilibrada pode permitir reagendamento dentro de determinado prazo.

O importante é ser simples e previsível.

## 5. Registre tudo junto do agendamento

Não deixe o sinal solto em conversa.

O atendimento deveria mostrar:

- valor;
- status;
- data;
- pagamento;
- eventual estorno ou crédito.

Assim a recepção não precisa reconstruir a história pelo WhatsApp.

## 6. Valide sua política

Regras financeiras e de cancelamento precisam ser compatíveis com a realidade jurídica e comercial do negócio.

A MIMO pode organizar a configuração e o registro, mas o salão deve validar sua política com orientação adequada quando necessário.

## Conclusão

O melhor sinal é aquele que aumenta compromisso sem criar sensação de armadilha.

Transparência, valor razoável e regra clara são mais importantes que rigidez.', '/imagens/painel-1400.webp', 'painel do salão no notebook mostrando um atendimento com sinal pago', c.id, 'Equipe MIMO', 'Sinal no agendamento de salão: como funciona | MIMO', 'Entenda como usar sinal no agendamento, definir regras claras e reduzir cancelamentos sem criar uma experiência ruim para a cliente.', 'Sinal no agendamento de salão: como funciona | MIMO', 'Entenda como usar sinal no agendamento, definir regras claras e reduzir cancelamentos sem criar uma experiência ruim para a cliente.', 'https://mimo.com.vc/imagens/painel-1400.webp', 'published', '2026-09-18T12:00:00-03:00', 1, '/sistema-para-salao-de-beleza', 'Veja sinal e pagamento ligados ao atendimento na MIMO', '["como-reduzir-horarios-vagos-salao","como-escolher-sistema-para-salao-de-beleza"]'::jsonb, '{"titulo":"Na prática","texto":"Serviço R$ 180, sinal R$ 50, restante R$ 130 no salão. Regra de reagendamento escrita antes do pagamento, e tudo registrado no próprio atendimento."}'::jsonb, '[["Sinal é obrigatório para todos os serviços?","Não. O salão escolhe onde faz sentido: serviços longos, materiais preparados com antecedência ou horários muito disputados."],["O que acontece se a cliente precisar remarcar?","Depende da política do salão. Uma regra equilibrada permite remarcar dentro de um prazo e mantém o sinal como crédito para o novo horário."]]'::jsonb
  from public.blog_categories c where c.slug = 'financeiro' on conflict (slug) do nothing;
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como escolher um sistema para salão de beleza', 'como-escolher-sistema-para-salao-de-beleza', 'Veja o que avaliar em agenda, equipe, clientes, WhatsApp, pagamentos, suporte e preço antes de escolher um sistema para salão.', 'Existem sistemas de salão cheios de funcionalidades.

Isso não significa que todos servem para o seu negócio.

O melhor sistema não é necessariamente o que possui mais menus.

É o que resolve sua rotina sem criar um novo trabalho para ser administrado.

Antes de escolher, observe alguns pontos.

## 1. A agenda funciona do jeito que sua equipe trabalha?

Veja se é possível configurar:

- horários por profissional;
- serviços diferentes;
- duração;
- bloqueios;
- folgas;
- encaixes;
- reagendamento.

Se a agenda não representa a rotina real, o salão volta para o WhatsApp.

## 2. A recepção enxerga o salão inteiro?

Um salão com equipe precisa de visão geral.

Procure saber se existe:

- agenda geral;
- agenda por profissional;
- filtro de status;
- busca de cliente;
- disponibilidade.

## 3. O sistema ajuda depois do atendimento?

Cadastrar cliente é básico.

Pergunte se o sistema ajuda a entender:

- histórico;
- último atendimento;
- profissional;
- retorno;
- preferências;
- cancelamentos.

É aqui que cadastro começa a virar relacionamento.

## 4. WhatsApp está ligado à agenda?

Lembrete isolado é útil.

Mas é melhor quando comunicação acompanha eventos reais:

- confirmação;
- cancelamento;
- reagendamento;
- retorno.

## 5. Como funciona a equipe?

Se há profissionais com formas diferentes de trabalho, veja se o sistema permite configurar:

- serviços;
- agenda;
- horários;
- permissões;
- comissões;
- vínculo operacional.

## 6. O financeiro é proporcional à sua necessidade?

Um salão pequeno talvez não precise de um ERP completo.

Mas pode precisar de:

- sinal;
- pagamento;
- comanda;
- caixa;
- comissão.

Escolha profundidade compatível com a operação.

## 7. O preço é fácil de entender?

Desconfie quando você não consegue descobrir nem aproximadamente quanto vai pagar.

Avalie:

- mensalidade;
- cobrança por profissional;
- taxas de pagamento;
- funcionalidades extras;
- custo de implantação.

## 8. É fácil começar?

Um software pode ser excelente e ainda fracassar na implantação.

Veja quanto tempo leva para:

- cadastrar serviços;
- adicionar profissionais;
- configurar horários;
- colocar a primeira agenda para funcionar.

## 9. O sistema preserva seu relacionamento com clientes?

Essa pergunta é especialmente importante quando a plataforma também possui marketplace.

Entenda:

- como o cliente encontra seu negócio;
- quem controla a relação;
- como a origem é registrada;
- se seus dados são usados para direcionar o cliente para concorrentes.

## 10. Teste com a rotina real

Não avalie apenas uma demonstração bonita.

Use durante alguns dias.

Cadastre profissionais reais.

Marque horários.

Cancele.

Reagende.

Bloqueie um almoço.

Veja se a ferramenta continua simples quando a rotina fica menos perfeita.

## Conclusão

Escolher sistema para salão não é comparar uma lista de cinquenta funcionalidades.

É entender qual ferramenta representa melhor a sua operação.

A MIMO segue essa filosofia: agenda, equipe, clientes e relacionamento conectados em uma experiência que tenta reduzir trabalho, não criar mais um painel para administrar.', '/imagens/profissional-1400.webp', 'profissional de beleza mostrando o aplicativo do salão no celular', c.id, 'Equipe MIMO', 'Como escolher um sistema para salão de beleza | MIMO', 'Veja o que avaliar em agenda, equipe, clientes, WhatsApp, pagamentos, suporte e preço antes de escolher um sistema para salão.', 'Como escolher um sistema para salão de beleza | MIMO', 'Veja o que avaliar em agenda, equipe, clientes, WhatsApp, pagamentos, suporte e preço antes de escolher um sistema para salão.', 'https://mimo.com.vc/imagens/profissional-1400.webp', 'published', '2026-09-20T12:00:00-03:00', 2, '/sistema-para-salao-de-beleza', 'Conheça o sistema da MIMO para salões', '["agenda-multi-profissional-salao","como-organizar-agenda-salao-de-beleza"]'::jsonb, '{"titulo":"Na prática","texto":"Teste com a rotina real por alguns dias: profissionais de verdade, um almoço bloqueado, um cancelamento e uma remarcação. Se continuar simples, é o sistema certo."}'::jsonb, '[]'::jsonb
  from public.blog_categories c where c.slug = 'gestao-do-salao' on conflict (slug) do nothing;
