# Catálogo de Serviços — proposta técnica da V1

Estado: **proposta para revisão**. Nada disto está em migration ainda. A semente
(`catalogo_v1.json`) só vira migration depois de aprovada.

## 1. Modelo de dados

### 1.1 `categorias_de_servico` (existente, ganha colunas)

```sql
alter table public.categorias_de_servico
  add column if not exists slug      text,          -- 'cabelo', 'estetica-facial' (único entre as da plataforma)
  add column if not exists descricao text,          -- 'Corte, cor, escova, tratamentos e mais'
  add column if not exists aliases   text[] not null default '{}',
  add column if not exists ativa     boolean not null default true;
create unique index categorias_plataforma_slug on public.categorias_de_servico (slug) where salon_id is null;
```

Renomeações (IDs preservados, agendamentos e capas intactos):

| hoje                    | V1                 |
|-------------------------|--------------------|
| Barba                   | Barbearia          |
| Rosto                   | Estética facial    |
| Corpo                   | Estética corporal  |
| Massagem e bem-estar    | Bem-estar e spa    |
| Sobrancelhas e cílios   | Sobrancelhas (mesmo id) + **Cílios** (nova, ordem 35) |

Divisão "Sobrancelhas e cílios": serviços existentes migram para **Cílios** só
quando o nome bate, sem acento e sem caixa, com uma destas expressões:
`cílio`, `cilio`, `lash`, `extensão de cílios`, `fio a fio`, `volume brasileiro`,
`volume russo`, `lash lifting`. Qualquer outro fica em Sobrancelhas (não há
regex ampla). "Fio a fio" sozinho é ambíguo com micropigmentação: só migra se
o nome **não** contiver `sobrancelha`/`micro`.

`salons.categorias_escolhidas` dos salões que tinham "Sobrancelhas e cílios"
ganha também o id de Cílios (quem escolheu a junta deve continuar vendo as
duas). `capas_de_categoria` fica como está (a capa da antiga segue em
Sobrancelhas; Cílios usa o fallback).

### 1.2 `catalogo_itens` (nova, uma tabela para a árvore)

```sql
create table public.catalogo_itens (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('familia','servico','tecnica')),
  categoria_id  uuid not null references public.categorias_de_servico (id),
  pai_id        uuid references public.catalogo_itens (id) on delete restrict,
  nome          text not null,
  slug          text not null,                 -- único por (categoria, pai)
  descricao     text,
  aliases       text[] not null default '{}',  -- termos de busca ('luzes', 'balaiagem')
  tags          text[] not null default '{}',  -- facetas ('cor','loiro','habilitacao','combo','noivas','masculino','infantil')
  duracao_sugerida int,                        -- minutos; técnica herda do serviço quando null
  imagem_url    text,                          -- null → /imagens/catalogo/<categoria>/<slug>.webp → capa da categoria
  ordem         int not null default 0,
  ativa         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (categoria_id, pai_id, slug)
);
```

Validação de hierarquia (trigger `catalogo_itens_checar`, before insert/update):

- `familia` → `pai_id` nulo.
- `servico` → pai obrigatório, `tipo = 'familia'`, mesma `categoria_id`.
- `tecnica` → pai obrigatório, `tipo = 'servico'`, mesma `categoria_id`.
- `categoria_id` precisa ser da plataforma (`salon_id is null`).
- Combinação inválida levanta exceção com mensagem em português.
- Não deixa desativar um serviço sem desativar as técnicas (ou avisa). Simples:
  `ativa = false` em um item esconde a subárvore nas consultas (filtro no app).

RLS: `select` para qualquer autenticado (o salão navega no catálogo);
`insert/update/delete` só `eh_plataforma()`. Delete só permitido se nenhum
`services.catalogo_item_id` aponta para o item (trigger `catalogo_itens_proteger`,
igual à proteção de `mel_frases`).

### 1.3 `services` (ganha o vínculo, opcional)

```sql
alter table public.services
  add column if not exists catalogo_item_id uuid references public.catalogo_itens (id) on delete set null;
create index services_catalogo_item on public.services (catalogo_item_id);
```

Regras:
- Serviço personalizado: `catalogo_item_id` nulo, `categoria_id` obrigatória
  (já é hoje via `classifica_servico`), família não existe como coluna — a
  família vem do item do catálogo quando há vínculo.
- Serviços antigos **não** são vinculados automaticamente. Um botão "Ligar ao
  catálogo" na ficha do serviço vem depois.
- Variações (`servico_variacoes`: tamanho do cabelo, área, etc.) ficam fora da
  V1. A tabela é prevista com `service_id`, `nome`, `duracao_minutos`,
  `preco_cents`, `ordem`; o `appointment_services` já tira snapshot, então o
  vínculo futuro é só um `variacao_id` opcional no snapshot.

### 1.4 Semente

`catalogo_v1.json` → migration `143_catalogo.sql` gerada por script
(`gerar_catalogo.py --sql`), inserindo por slug com `on conflict (categoria_id,
pai_id, slug) do update` nos campos editoriais (nome, aliases, tags, duração,
ordem). Reaplicar é idempotente; o que a Plataforma editar à mão depois sobre-
vive porque a próxima versão do JSON só muda o que mudou nele (diff no script,
não "update tudo").

Imagens: `imagem_url` nulo na semente. Convenção de arquivo
`public/imagens/catalogo/<categoria-slug>/<familia-slug>.webp` (famílias) e
`.../<familia-slug>/<servico-slug>.webp` (serviços), 1400×900, `object-fit: cover`.
O app tenta o arquivo pelo slug; se não houver, cai na capa da categoria
(`capaPadrao`, gradiente). Nada quebra sem imagem.

## 2. Busca inteligente

Sem `pg_trgm`/`unaccent` no projeto, a V1 busca **no app**, sobre o catálogo em
cache (uma leitura de `catalogo_itens` ativa por sessão, ~500 linhas, ~60 KB):

1. Normaliza (`sem acento`, minúsculas, sem pontuação) a consulta e os campos
   `nome` + `aliases` de cada item e dos ancestrais.
2. Pontua: nome começa com a consulta (100) > alias igual (90) > nome contém
   (70) > alias contém (60) > tag igual (40) > família/categoria contém (20).
3. Agrupa o resultado por categoria › família e mostra o caminho (breadcrumb)
   em cada card, com a opção "Criar '<texto digitado>' como serviço
   personalizado" sempre no fim da lista.
4. Ambiguidades conhecidas no JSON (a busca mostra os dois, é desejado):
   `queratina` (reconstrução × alisamento), `unha de gel` (esmaltação em gel ×
   alongamento), `gel na unha natural`, `lábios`/`olheiras` (tratamento ×
   injetável), `esfoliação` (pré-bronze × corporal), `lavagem` (barbearia).

Quando o volume crescer (ou quiser busca no cliente final), a mesma função
vira `catalogo_buscar(texto)` em SQL com `pg_trgm` — a estrutura não muda.

## 3. Fluxo de cadastro (resumo do que foi aprovado)

Experiência contínua, um único componente `CadastroDeServico` com estados:

`inicio` (busca + "Sugestões para você" + categorias) → `categoria` (famílias)
→ `familia` (serviços) → `servico` (técnicas, opcional) → `forma`
(nome pré-preenchido, duração sugerida, preço, quem faz, foto) → salvo.

- Breadcrumb clicável preserva as escolhas; voltar não limpa a forma.
- "Serviço personalizado" acessível em todo estado (busca sem resultado, rodapé
  da lista, botão na forma).
- Desktop: modal largo trocando o conteúdo por estado. Celular: folha quase
  tela cheia, lista rolável, breadcrumb fixo no topo.
- "Sugestões para você" na V1: por `salons.ramo` + `categorias_escolhidas`,
  pegando os serviços com tag `combo` ou os 6 primeiros por `ordem` das
  famílias principais do ramo. Dados reais ("mais usados") depois.
- Ao salvar com `catalogo_item_id`: nome = nome do item (ou "Serviço — Técnica"
  quando técnica escolhida), `duration_minutes` = `duracao_sugerida` da técnica
  ou do serviço, `categoria_id` = do item.

## 4. Mel por etapa

Não há seletor de frase em SQL (só `escolherFrase` na Edge Function `mel`),
então **não** vale criar `mel_frase_direta` em SQL. Em vez disso a função `mel`
ganha um modo direto:

```
POST /functions/v1/mel  { salao, momento: 'cardapio_categoria', dados: { categoria: 'Cabelo' } }
→ { bubble: { texto, tom, avatar_key, exibicao } }
```

O modo direto pula `avaliar()` (não disputa prioridade com os outros momentos),
usa a mesma `escolherFrase` (ramo, tipo, clima, período, peso, sem repetir as 3
últimas) e registra em `mel_exibicoes` como sempre. Momentos novos (categoria
`configuracao`, superfície `mel_bubble`, placeholders `{nome,categoria,familia,servico,n}`):

| chave                 | quando                                  |
|-----------------------|-----------------------------------------|
| `cardapio_inicio`     | abriu o cadastro                        |
| `cardapio_categoria`  | escolheu a categoria                    |
| `cardapio_familia`    | escolheu a família                      |
| `cardapio_sugestoes`  | olhou as sugestões do ramo              |
| `cardapio_nao_achou`  | busca sem resultado → personalizado     |
| `cardapio_forma`      | chegou na forma (nome, duração, preço)  |
| `cardapio_salvo`      | salvou o primeiro serviço do catálogo   |

Nenhum texto fixo no app: sem frase cadastrada, o componente simplesmente não
mostra a Mel naquele passo. As frases entram pela Plataforma → Mel (ou por
importação JSON), com o briefing para o GPT igual ao dos momentos anteriores.

## 5. Ordem de entrega sugerida

1. Migration 143: colunas em categorias, renomeações, divisão Cílios,
   `catalogo_itens` + triggers + RLS, `services.catalogo_item_id`. (**sem semente**)
2. Aprovação do `catalogo_v1.json` → migration 144 com a semente gerada.
3. App: cache do catálogo + busca + `CadastroDeServico` (desktop e celular),
   demo com o mesmo JSON.
4. Mel: modo direto + 7 momentos + briefing para as frases.
5. Plataforma: tela "Catálogo de Serviços" (árvore, editar, ativar/desativar,
   importar/exportar JSON) — mesmo molde da tela da Mel.
6. Depois: imagens por slug, "Ligar ao catálogo" nos serviços antigos,
   variações, "mais usados" por dados reais.
