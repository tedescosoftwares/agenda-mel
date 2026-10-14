# Agenda Mel 🌸

App de agendamento de serviços estéticos — PWA em React, multi-profissional:

- **Link público da profissional** (`/p/<slug>`) — qualquer pessoa abre, vê os
  serviços e os horários livres; o login só entra na hora de fechar
- **Área da cliente** (`/`) — meus agendamentos e com quem agendar
- **App da profissional** (`/pro`) — agenda dela, quem sumiu e precisa ser
  chamada de volta, o mês em números, as mensagens prontas pra enviar no
  WhatsApp, serviços que atende, horários e o link
- **Área do salão / admin** (`/admin`) — agenda de todas, o mês do salão,
  equipe, catálogo de serviços, horário padrão e clientes

Backend: [Supabase](https://supabase.com) (plano gratuito — autenticação + banco Postgres).

## Stack

- React 19 + Vite
- React Router (rotas protegidas por papel: `cliente` / `profissional` / `admin`)
- Supabase (Auth + Postgres com Row Level Security)
- PWA via `vite-plugin-pwa` (instalável no celular, pronto pra virar app depois)

## Como rodar

### 1. Criar o projeto no Supabase (grátis)

1. Acesse [supabase.com](https://supabase.com) e crie uma conta (pode usar o GitHub).
2. Crie um projeto novo (região `South America (São Paulo)` é a mais próxima).
3. No painel do projeto, abra **SQL Editor**, cole o conteúdo inteiro de
   [`supabase/setup_completo.sql`](supabase/setup_completo.sql) e clique em
   **Run**. É só isso — um arquivo, uma vez.

   Ele monta o banco inteiro, pode ser rodado em banco vazio **ou** em banco
   que já tem parte das coisas, e pode ser executado de novo quantas vezes
   quiser sem duplicar nada. No fim, cria três contas de teste e um salão de
   exemplo com serviços, horários e agendamentos.

   > Os arquivos numerados (`001_` a `018_`) continuam na pasta como
   > histórico — cada um é um passo da construção. Para instalar, use só o
   > `setup_completo.sql`.

### 2. Configurar as variáveis de ambiente

1. No Supabase, vá em **Project Settings → API** e copie a **URL** e a **anon key**.
2. Na raiz deste projeto:

```bash
cp .env.example .env
# edite o .env e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
```

### 3. Rodar o app

```bash
npm install
npm run dev
```

Abra http://localhost:5173 — a tela de login aparece. Crie uma conta pela aba
**Criar conta** (chega um e-mail de confirmação).

### 4. Entrar

O `setup_completo.sql` já criou estas contas:

| Conta                      | Senha          | Cai em    |
| -------------------------- | -------------- | --------- |
| `admin@exemplo.com`        | `agendamel123` | `/admin`  |
| `profissional@exemplo.com` | `agendamel123` | `/pro`    |
| `cliente@exemplo.com`      | `agendamel123` | `/`       |

Para promover a **sua** conta a admin, rode no **SQL Editor**:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'seu-email@exemplo.com');
```

Depois é só sair e entrar de novo no app.

### Não está vendo as mudanças?

A tela de login mostra a versão no rodapé (`v0.9.0 · salões, agenda real e
afiliadas`). Se aparecer versão diferente ou nenhuma, o código na sua máquina
está velho:

```bash
git fetch origin
git checkout claude/aesthetic-services-booking-app-b327z0
git pull
npm install
# pare o servidor (Ctrl+C) e suba de novo
npm run dev
```

Se ainda assim não mudar, é o cache do navegador/PWA: abra uma janela anônima,
ou aperte Ctrl+Shift+R.

## Publicar o app

O app é estático: HTML, CSS e JS falando direto com o Supabase. Não tem
backend para rodar, então não precisa de servidor — uma hospedagem
estática serve melhor e de graça.

**Vercel** ou **Cloudflare Pages**: aponte para este repositório, e é só.
O `vercel.json` e o `public/_redirects` já estão aqui — sem eles, abrir
`/p/ana-paula` direto no navegador daria 404, porque quem resolve essa
rota é o React, e o servidor precisa devolver o `index.html` para
qualquer caminho.

Configure as duas variáveis no painel da hospedagem:

```
VITE_SUPABASE_URL=https://SEU_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

O envio de WhatsApp **não depende disso**. Quem manda é a Edge Function
no Supabase, então o lembrete das 19h sai mesmo com o app rodando só na
sua máquina — ou fechado.

## O app da loja (Expo)

Avisos nativos (3.3): o app registra o aparelho em `push_tokens_app` e a `enviar-push` manda também pelo Expo Push; detalhes em `apps/mobile/README.md`.

### Guia de salões (3.9)

Uma página pública para cada salão da região, mesmo antes de ele ser cliente
da MIMO, mais a página da cidade e de cada categoria:
`/saloes/itanhaem`, `/saloes/itanhaem/unhas`, `/saloes/itanhaem/<salão>`.
Serve para aparecer no Google ("salão de beleza em Itanhaém") e para
captar: a cliente toca "Quero marcar aqui pelo app" e a dona toca "É o seu
salão?"; os dois pedidos aparecem na Plataforma.

- **Plataforma → Guia de salões**: importa os CSVs (o do Google Places e o
  validado na Receita, que casam pelo `place_id`), monta o texto de cada
  página e mostra a prévia da landing para aprovar, montar de novo, editar
  ou descartar, um a um. A nota e as avaliações do Google aparecem só ali,
  para a triagem (ordenar por nota, filtrar "4,8+ com 30+ avaliações").
- **De graça (3.10)**: a página é montada sem IA (`packages/core/guiaTexto.js`),
  dos fatos do salão e da comparação com os outros da cidade ("abre aos
  domingos, coisa que só 36 dos 283 fazem"), com dicas e perguntas por
  categoria escritas à mão e sorteadas pelo slug. Página com poucos dados vai
  ao ar sem pedir para indexar. A IA (Edge Function `guia-gerar`, Groq,
  segredo `GROQ_API_KEY`) fica como opção, salão por salão ("Reescrever com IA").
- **Script do Maps**: `scripts/guia/buscar_saloes.py` (Python). A chave vem
  da variável `GOOGLE_PLACES_KEY` (ou é pedida na hora), nunca do arquivo.
  Uma chamada por página de resultados já traz endereço em partes, horário,
  pagamento, acessibilidade e estacionamento; a busca fica presa no retângulo
  da cidade e dividida em faixas; tem cache de 7 dias e teto de chamadas, e
  no fim mostra quantas chamadas fez. Barbearia, público masculino e o que não
  é salão vão para o CSV de descartados, com o motivo.
- **Banco**: `supabase/153_guia_de_saloes.sql`. O público só lê pelas
  funções `guia_*`, que nunca entregam nota, avaliações, CNPJ, razão social
  nem coordenadas (ficam só para a triagem).
- **Site**: o build (`scripts/guia-estatico.mjs`) grava o HTML de cada
  página com o texto já escrito, título, canonical e JSON-LD, e põe tudo no
  sitemap. Página aprovada aparece na hora para quem navega; no HTML estático
  e no sitemap, depois do próximo bat 2.
- Toda página de salão fora da MIMO diz que é informativa e tem o caminho
  para o dono corrigir ou pedir a remoção; removido nunca volta pela importação.
- Barbearia não entra no guia (migração 154): a importação deixa de fora, e
  o CSV da Receita só confirma e completa quem veio do CSV do Google.
- **Métricas (3.11, migração 156)**: cada página do guia conta visitas e
  toques em WhatsApp, Ligar, Como chegar, Instagram, site, "Agendar" e
  "Quero marcar", por dia, origem (Google, direto, de dentro do guia,
  Instagram...), aparelho e parte da página. Sem cookie e sem guardar IP (o
  aviso do site promete "sem rastreio"): o banco conta visitantes com um
  código que muda todo dia. Robô não conta; a mesma ação da mesma pessoa em
  30 minutos conta uma vez; quem abre a Plataforma não conta. Plataforma →
  Guia → **Desempenho** mostra os números, a tabela por página e monta a
  mensagem com os números para mandar ao dono do salão.
  - Para evoluir: um evento novo é uma linha em `site_eventos_tipos` e
    `data-evento="tipo"` no botão (ou `registrarEvento('tipo')`, em
    `src/lib/eventos.js`); o painel já mostra. A tabela `site_eventos` guarda
    a página pelo caminho, então blog e outras páginas podem entrar depois.
  - Os eventos ficam 400 dias (a limpeza roda quando o painel abre).
- **Desempenho de cara nova (3.12, migração 161).** A aba Guia → Desempenho foi feita para abrir todo dia e entender em 5 segundos.
  - No topo, uma frase diz o período em linguagem simples ("Nos últimos 30 dias, 702 pessoas viram as páginas do guia e 131 tentaram falar com os salões, 59% a mais que nos 30 dias anteriores").
  - Cinco números mostram tendência (até ontem) e comparação com o período anterior, que só aparece com histórico do período anterior inteiro.
  - O caminho visitou → tentou contato → pediu é medido sempre contra quem visitou.
  - O gráfico por dia tem um eixo só: as pessoas do dia, com quem tentou contato em destaque, e também pode ser visto como tabela.
  - Os destaques dizem o que fazer: mandar o número ao dono de quem foi mais procurado ou cresceu, conferir os dados de quem tem muita visita e pouco contato (sem WhatsApp, sem Instagram, sem horário...) e olhar os salões no ar que ninguém abriu.
  - A tabela por página mostra a barra de visitas na linha, cabeçalho parado, 25 por vez e busca, e vira cartões no celular.
  - A migração 161 só troca guia_desempenho(): acrescenta pessoas, contatos e pedidos por dia, as visitas do período anterior por página e os pedidos do período anterior, sem mudar nenhum campo antigo.
  - As peças ficam em src/components/plataforma/guia/desempenho/, as contas em src/lib/guiaMetricas.js e o estilo em src/guia-desempenho.css.
- **Páginas por bairro e por horário (3.12, migração 157)**: mais portas de entrada pelo Google, feitas dos dados, sem IA. `/saloes/itanhaem/bairro/centro` ("Salões de beleza no Centro de Itanhaém"), `/saloes/itanhaem/horario/domingo`, `/cedo`, `/noite` e `/sabado-o-dia-todo`, e o horário por categoria (`/horario/domingo/unhas`, "Manicures abertas no domingo"). Só existem com pelo menos 3 salões no ar (5 no horário por categoria) e quando não são quase a cidade inteira (até 70%); abaixo disso, 404. Quem divulga "24 horas" ou um horário que passa da meia-noite fica fora das contas de horário. A regra e o texto (introdução com números e comparações com a cidade, perguntas frequentes) moram em `packages/core/guiaColecoes.js` e servem o site (`GuiaColecao.jsx`) e o HTML estático, com sitemap e JSON-LD CollectionPage + ItemList, sem nota. O bairro do Google vem sujo ("Sl 18 - Centro", "Gaivota - Praia"); a chave junta as variações e é a mesma no banco (`guia_bairro_slug`): mexeu numa, mexa na outra. A cidade ganha "Por horário" e "Por bairro", e o salão ganha "Mais salões no <bairro>" quando essa página existe. O banco entrega os salões pela `guia_colecoes(cidade)`, reserva `bairro` e `horario` como slug de salão, e `site_evento` passa a contar as visitas das coleções.
- **Abordagem (3.12, migração 158)**: Plataforma → Guia → **Abordagem** é a fila de trabalho para transformar visitas e contatos do guia em clientes da MIMO. Cada salão vem com a prioridade explicada em palavras ("3 pessoas pediram para marcar · 18 tocaram no WhatsApp · lembrete vencido ontem"). Pedido aberto do dono e de "quero marcar" pesam muito; toques e visitas do período somam; lembrete vencido sobe; lembrete para depois e abordagem de poucos dias sem resposta descem; a nota do Google só desempata e nunca vai para o site. Quem já é cliente, quem está sem interesse ou não abordar e quem pediu para remover a página saem da fila principal e continuam nos filtros de cada status. "Mandar mensagem" monta o texto com os números do período (o mesmo da aba Desempenho), abre o WhatsApp do salão ou de quem pediu contato (ou o e-mail, quando a pessoa só deixou e-mail) e já marca o salão como abordado; para quem já é cliente, o texto vem sem a oferta do teste, com lembrete em 3 dias. Status, nota interna, lembrete e contato por outro canal ficam no histórico do salão, e toda ação tem "Desfazer". Contadores por status, funil (a abordar → abordado → respondeu → cliente) e atalhos de teclado (J/K, W, 1 a 7, L, N, U, R, /). Banco: `guia_abordagens` (um registro por salão) e `guia_abordagem_acoes` (o histórico), só para a Plataforma, escritos pelas funções `guia_abordagem_registrar` e `guia_abordagem_desfazer`; a fila vem de `guia_fila_abordagem(dias)`. Para mudar os pesos da prioridade, mexa na CTE `motivos` da 158 e em `src/lib/demoAbordagem.js` (o demo imita a mesma conta).
- **Reivindicação ("É o seu salão?", 3.12, migração 159).** Na página de cada salão, quem responde por ele toca em "Sim, sou responsável" e deixa nome, e-mail (obrigatório), WhatsApp (opcional), a ligação com o salão (dona, sócia, gerente ou funcionária) e um aceite de que responde pelo salão. Por enquanto, isso só faz duas coisas.
  - A pessoa recebe uma confirmação por e-mail, pela fila email_outbox. O e-mail diz que a MIMO fala com ela em até 3 dias úteis, o que acontece depois e como pedir correção ou remoção da página (respondendo o e-mail ou escrevendo para contato@mimo.com.vc).
  - A equipe recebe o aviso na Plataforma: o pedido soma em "interesses novos", aparece na aba Interesses (painel Reivindicações) e na Atividade recente da Visão Geral.

  Na aba Interesses, a equipe vê se a confirmação saiu e muda o status: nova, em contato, confirmada ou recusada. "Nova" é o que conta como interesse novo. Não há código por WhatsApp nem painel do dono.

  O pedido passa por guia_registrar_interesse, a mesma função dos outros pedidos, com estas proteções:
  - e-mail validado e campo-armadilha contra robô;
  - o mesmo e-mail no mesmo salão conta uma vez por dia;
  - no máximo 3 reivindicações por e-mail, 10 por salão e 5 por rede (código do dia que não identifica ninguém) por dia, e 300 no total. O e-mail conta pela caixa (`guia_chave_email`: sem "+apelido" e, no Gmail, sem pontos) e a rede de um IPv6 é o /64 (`rede_do_ip`, o mesmo do limite de `site_evento`), para trocar de endereço não furar o limite;
  - o nome só entra na saudação do e-mail quando parece um nome (um link digitado ali viraria link clicável num e-mail assinado pela MIMO), e nunca vai no destinatário.

  O público nunca lê guia_interesses nem email_outbox, e o e-mail de quem pediu nunca vai para o site. Não precisa de segredo novo. Recomendado: `supabase secrets set EMAIL_RESPONDER=contato@mimo.com.vc`, para as respostas chegarem à equipe. Para testar: `supabase/ensaio_reivindicar.sql`.
- **Perto de você e o mapa de acessos (3.13, migração 163).** Ao entrar numa lista do guia (cidade, categoria, bairro e horário), um modal curto pergunta "Pode liberar sua localização?": é para indicar os salões mais perto, com mais precisão, e uma linha pequena diz que o ponto fica guardado. Quem toca em "Sim, pode" autoriza o navegador (a caixa de permissão sai do toque, nunca sozinha), a lista reordena, cada cartão mostra a distância e a página do salão diz "a 1,2 km de você". Quem fecha tem o botão "Ver os mais perto de mim" na lista. O modal diz com todas as letras que a MIMO guarda o ponto onde a pessoa estava: o ponto exato, como o celular manda, vai para `site_eventos` como o evento `localizacao` (um gatilho confere lat e lng e descarta o resto), sem nome e com o código de visitante que muda todo dia. "Agora não" fica no aparelho por 30 dias; quem já autorizou antes não vê o aviso de novo (a posição é lida sem perguntar). Na Plataforma, Desempenho → **Mapa de acessos** (o Google Maps com a chave que o app já usa, ou o Leaflet sem chave; só a Plataforma, `guia_mapa_acessos(dias)`): um ponto por pessoa e dia, o salão no ar mais perto de cada um e "De onde procuram" por bairro (a mais de 8 km de qualquer salão é "fora da cidade"). Para isso os cartões públicos passaram a levar a coordenada do salão (5 casas), e o JSON-LD do salão ganhou `geo`. Os textos: o aviso de cookies ("a localização, só se você ativar no guia"), a política de privacidade (3.8, a finalidade em 5, o "Agora não" em 9 e a retenção de 400 dias em 10; a versão que vale é a publicada na Plataforma em Termos e privacidade, então publique a nova). Código: `src/lib/guiaPerto.js`, `src/components/guia/PertoDeVoce.jsx`, `desempenho/MapaAcessos.jsx`.
- **Buscas do Google (3.12; o site inteiro na 3.12.1, migração 162).** Na aba Desempenho do guia, a seção "Buscas no Google" mostra o que as pessoas digitaram no Google antes de abrir cada página do site, com um seletor Guia (/saloes) · Blog (/blog) · Site (o resto: página inicial, planos, sobre, SEO) · Tudo, cada um com as impressões do período. Os nomes vêm do salão, do título do artigo (blog_posts) ou do título da página (seo_pages). Os endereços dos salões (subdomínios) ficam de fora por enquanto. A seção mostra:
  - cliques, impressões, CTR e posição média, com comparação com o período anterior;
  - cliques e impressões por dia;
  - as buscas que mais trouxeram gente;
  - as oportunidades: posição entre 4 e 15, ou topo com pouco clique;
  - as buscas de cada página.

  Os dados vêm do Google Search Console, que é grátis. A Edge Function `gsc-sincronizar` busca esses dados com uma conta de serviço (JWT assinado no Deno, sem SDK) e grava em `site_buscas` (migração 160). As janelas de 30 dias vão ao Google em lotes de 4, e a função responde em menos de um minuto (o caminho entre o navegador e a função corta antes dos 150 s dela): o que não coube volta como parcial, com até onde chegou, e a tela pede o resto sozinha, de trás para a frente, até fechar os 16 meses. Só ficam os números que o Search Console devolve, sem nada de quem buscou, e o histórico continua além dos 16 meses que o Google guarda.

  Para ligar:
  1. Crie uma conta de serviço no Google Cloud, com a Search Console API ativada e uma chave JSON.
  2. Adicione o e-mail dela como usuário da propriedade no Search Console.
  3. Rode `supabase secrets set GSC_CONTA_SERVICO="$(cat chave.json)" GSC_PROPRIEDADE=sc-domain:mimo.com.vc`.
  4. Rode `./supabase/publicar.sh` e toque em "Atualizar agora".

  Para atualizar todo dia sozinho, com o relógio da 052 ligado, rode `select cron.schedule('mimo-gsc', '23 9 * * *', 'select public.chutar_gsc()');`. Cada sincronização fica registrada, e um erro do relógio aparece na própria tela.
- Migração 155: `guia_lugares.atributos` (pagamento, acessibilidade,
  estacionamento, crianças, banheiro), que vão para a página e para o JSON-LD;
  reimportar o CSV do Google corrige categoria e serviços pela regra nova
  (tipo do Google + nome, nunca as palavras da busca).

A MIMO também vai para a Play Store como app de verdade, em `apps/mobile`:
nativo (Expo/React Native) de ponta a ponta para a cliente, falando com o
mesmo Supabase da web, sem WebView. A web continua sendo a porta de entrada e
o desktop a casa da gestão do salão; tudo o que está aqui permanece e segue
evoluindo. Como rodar, publicar e o que vem depois:
[`apps/mobile/README.md`](apps/mobile/README.md).

A lógica que não depende de tela (catálogo, formatação, planos, telefone,
horários) mora em `packages/core` (`@mimo/core`) e é compartilhada pelos dois:
a web importa pelos arquivos de `src/lib/*.js`, que só reexportam.

## Site público e app: separados no carregamento (3.2)

O site (home, páginas por intenção de busca, blog, planos, sobre, contato,
termos) e o app (cliente, pro, admin, plataforma, telas de entrada) saem do
mesmo `npm run build`, mas o navegador só baixa o que a URL pede:

| Quem | CSS | JS |
|---|---|---|
| Site público | `src/base.css` (tokens, reset, botões, marca, avisos) + `src/landing.css` | o pacote de entrada, com as páginas públicas |
| App | `src/app.css` (o antigo `index.css`) + `src/polish.css`, puxados pelos pedaços do app | `src/rotas/entrada.jsx` (login, convites, código, cadastro, onboarding) e `src/rotas/RotasCliente.jsx`, `RotasPro.jsx`, `RotasAdmin.jsx`, `RotasPlataforma.jsx`, carregados com `React.lazy` quando a rota abre |

Regras para não desfazer a separação:

- CSS de tela do app vai em `app.css`; CSS do site vai em `landing.css`; só o
  que os dois usam entra em `base.css` (e, se mudar lá, muda nos dois).
- Rota nova do app entra no grupo dela em `src/rotas/`, não no `App.jsx`.
  Rota pública nova entra no `App.jsx` (ou em `paginasSeo.js`, se for página SEO).
- Nenhum componente do site público pode importar nada de `pages/cliente`,
  `pages/pro`, `pages/admin` ou `pages/plataforma`: isso arrastaria o app
  inteiro de volta para a entrada. Conferir com `npm run build` e olhar o
  tamanho de `dist/assets/index-*.js` (deve ficar perto de 400 KB, não de 2 MB).

## WhatsApp da MIMO: um número, várias chamadas

O número de reserva mora em `src/lib/contato.js` (`WHATSAPP_MIMO`), junto
com as chamadas: cada canto do site chama com uma frase diferente e a
conversa já chega escrita (planos, dúvida, autônoma, migrar, artigo, 404,
suporte dentro do app). A Plataforma troca o número sem publicar, em
Configurações (vira `config_publica.whatsapp_suporte`); o site e o app leem
de lá primeiro. No site: `src/components/site/Whats.jsx` (botão, faixa,
cartão do contato e o flutuante); no app: `src/components/LinkSuporte.jsx`.

## SEO: onde mora e como chega no Google

### A regra da casa (3.3): tudo que é página pública se edita na Plataforma

O código é a reserva e o modelo; o banco manda. Em Plataforma → SEO e
Conteúdo → Páginas, cada linha de `seo_pages` tem as metas (title,
description, OG, robots) **e o miolo** (`conteudo` jsonb): herói, rotina,
módulos, FAQ, "veja também", guias ligados, chamada. Enquanto `conteudo`
está vazio, vale o que está em `src/conteudo/paginasSeo.js` (o editor já
abre pré-preenchido com isso); "Voltar para o do código" limpa a coluna.
Home, planos, sobre, contato e a cabeça do blog seguem a mesma regra
(`conteudo` com os campos de cada uma; reserva em `home.js` e
`paginasSeo.js`). Artigos e termos já eram 100% do banco.

- **Página nova pelo código**: entra em `PAGINAS_SEO` **e** numa migração
  de dados que insere a linha em `seo_pages` (`on conflict (route) do
  nothing`), como a 151 fez para todas as existentes. Sem a linha, a página
  não aparece na Plataforma, e isso é bug.
- **Página nova pela Plataforma**: "Nova página" com rota `/alguma-coisa`
  e tipo SEO; abre no site na hora (`PaginaOu404` resolve a rota) e entra
  no sitemap e no HTML estático no próximo publicar (o build lê o banco).
- **Rodapé e "veja também"** listam tudo que existe, do código e do banco,
  pelo nome curto (`rodape`) e pela `ordem`; "Mostrar no rodapé" tira uma
  página de lá sem apagar.
- **Campo novo no miolo**: uma linha em `src/conteudo/esquemas.js` e o uso
  dele na tela pública. O formulário se monta sozinho
  (`src/components/plataforma/FormularioConteudo.jsx`).
- **WhatsApp**: número e as frases de cada chamada em Plataforma →
  Configurações (`config_publica.whatsapp_suporte` e `whatsapp_chamadas`).

- **Conteúdo** em `src/conteudo/`: `paginasSeo.js` (uma página por intenção
  de busca: hub `/sistema-para-salao-de-beleza`, agenda, sistema de
  agendamento, agendamento online, páginas por problema e por profissão),
  `artigos.js` (o blog) e `home.js` (title, description e dados
  estruturados da home). A **Plataforma** edita title, description, capa e
  os artigos nas tabelas `seo_pages` e `blog_posts`; o banco vale, o código
  é a reserva.
- **O que o robô lê**: `npm run build` roda `scripts/paginas-estaticas.mjs`,
  que grava um `dist/<rota>/index.html` por página (title, description,
  canonical, Open Graph e JSON-LD), `dist/_home.html` (a home com canonical,
  servida pelo Caddy em `/`) e `dist/sitemap.xml`. O `publicar-site.sh` não
  publica sem esses arquivos. Confira no ar: `curl -sI https://mimo.com.vc/sitemap.xml`.
- **Endereço único por intenção**: os antigos viram 301 no Caddy
  (`evolution/Caddyfile`, bloco "SEO"); `pro.mimo.com.vc` sai do índice
  (`X-Robots-Tag` e `robots-pro.txt`).
- **Malha interna**: rodapé com todas as soluções, landing linkando cada
  hub, páginas com "veja também", artigos com links no texto. Mudança de
  texto de artigo ou de título de página vai para o banco por migração de
  dados (ex.: `supabase/149_seo_malha.sql`), que só atualiza o que ainda
  está igual à semente: o que a Plataforma editou fica.

## Estrutura

```
src/
  lib/
    supabase.js            # cliente Supabase (lê o .env)
    format.js              # preço, duração (combo = tempo médio), data
    booking.js             # grade de horários livres, slug, iniciais
    roles.js               # para onde cada papel vai ao entrar
  context/AuthContext.jsx  # sessão, perfil, papel e ficha da profissional
  components/
    ProtectedRoute.jsx     # rota por papel (cliente | profissional | admin)
    AdminShell.jsx         # abas do salão
    ProShell.jsx           # abas da profissional
    AgendaDia.jsx          # agenda de um dia (usada pelo admin e pela pro)
    AuthModal.jsx          # login rápido dentro do link público
    Avatar.jsx | FotoUpload.jsx  # foto da profissional (cai nas iniciais)
  pages/
    Login.jsx
    publico/PaginaProfissional.jsx  # /p/<slug> — serviço, dia, horário
    cliente/ClienteHome.jsx
    Estilo.jsx                      # /estilo — mostruário do sistema visual
    pro/ProAgenda.jsx | ProRetorno.jsx | ProNumeros.jsx | ProServicos.jsx
    pro/ProHorarios.jsx | ProLink.jsx | ProAjustes.jsx
    admin/AdminAgenda.jsx | AdminNumeros.jsx | AdminProfissionais.jsx
    admin/AdminServices.jsx | AdminHours.jsx | AdminClientes.jsx
public/fontes/             # as três fontes, servidas pelo próprio app
supabase/
  001_schema.sql           # perfis, trigger e políticas de segurança (RLS)
  002_services.sql         # tabela de serviços + políticas
  003_business_hours.sql   # horário padrão do salão
  004_appointments.sql     # agendamentos + admin enxerga perfis
  005_service_images_e_slots.sql # fotos dos serviços + horários ocupados
  006_combos.sql           # combos de serviços (duração = tempo médio)
  007_profissionais.sql    # equipe, agenda e link por profissional
  008_foto_profissional.sql # bucket das fotos das profissionais
  009_notificacoes.sql     # caixa de avisos no app (base das features)
  010_adiantar_agenda.sql  # convite para a cliente vir mais cedo
  011_lista_espera.sql     # fila de espera, vaga liberada e falta da cliente
  012_indique_e_ganhe.sql  # indicação, carteira de créditos e antifraude
  013_seguranca.sql        # travas de permissão e de sobreposição (obrigatório)
  014_correcoes.sql        # correções da revisão (horário no passado, fila, saldo)
  015_saloes.sql           # camada de salão: cada negócio com catálogo e equipe
  016_agenda_real.sql      # almoço/folga, arrumação, encaixe, preço congelado
  017_afiliados.sql        # cliente traz profissional e recebe parte da taxa
  018_dados_teste.sql      # três contas prontas + salão de exemplo
  019_volta_sozinha.sql    # lembrete de véspera, pós-atendimento e quem sumiu
  020_numeros.sql          # faturamento, ticket, ocupação e falta do mês
  021_dados_teste_historico.sql # dois meses de histórico, para os números terem o que mostrar
  022_gatilhos.sql         # corrige a trava de status que nunca travava
  023_whatsapp.sql         # fila de saída, canal por salão, janela de silêncio
  024_resposta_whatsapp.sql # 1 confirma, 2 cancela, SAIR desliga
  025_botoes.sql           # botão de resposta, com o texto como plano B
  026_botao_so_na_oficial.sql # botão nativo desligado: não desenha fora da API oficial
  027_estilo_do_botao.sql  # estilos de opção tocável: texto, enquete, nativo
  028_primeiro_voto_vale.sql # texto por padrão; na enquete o primeiro voto é o que vale
  029_texto_bonito.sql     # texto do WhatsApp por tipo: emoji, negrito e link da agenda
  setup_completo.sql       # TODOS os arquivos acima juntos — é este que se roda
  atualizacao_020_em_diante.sql  # só da 020 em diante, para quem já tem banco
  gerar.sh                 # regera os dois a partir das migrações
  testar.sh                # prova que os dois caminhos chegam ao mesmo schema
  functions/               # Edge Functions: envio e webhook (veja o LEIAME de lá)
evolution/                 # stack do WhatsApp automático: compose, Caddy e o passo a passo
```

## Papéis

| Papel          | Entra em  | O que faz                                            |
| -------------- | --------- | ---------------------------------------------------- |
| `cliente`      | `/`       | agenda, acompanha e cancela os próprios horários      |
| `profissional` | `/pro`    | agenda, quem sumiu, o mês em números, serviços e link |
| `admin`        | `/admin`  | equipe, catálogo, agenda de todas e o mês do salão    |

Toda conta nova nasce como `cliente`. Para promover:

```sql
-- admin
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'voce@exemplo.com');

-- profissional (depois de cadastrá-la em Admin → Equipe)
update public.profiles set role = 'profissional'
where id = (select id from auth.users where email = 'ela@exemplo.com');

update public.professionals set user_id =
  (select id from auth.users where email = 'ela@exemplo.com')
where slug = 'slug-dela';
```


## Próximos passos

- [x] Cadastro de serviços (nome, duração, preço) — admin
- [x] Configuração de horários de atendimento — admin
- [x] Painel admin mobile-first (abas: Agenda, Serviços, Horários, Clientes)
- [x] Fluxo de agendamento — cliente
- [x] Listagem/cancelamento de agendamentos
- [x] Fotos dos serviços (até 3 por serviço, Supabase Storage)
- [x] Confirmar/concluir agendamentos pelo admin
- [x] Combos de serviços (soma das durações exibida como tempo médio)
- [x] Equipe: profissionais com agenda, serviços e link próprios
- [x] Link público /p/<slug> — agenda sem precisar estar logada antes
- [x] Foto da profissional (admin e ela mesma trocam)
- [x] Caixa de avisos no app, em tempo real
- [x] Adiantar a agenda (convite com prazo; a cliente decide)
- [x] Lista de espera + falta da cliente libera a vaga
- [x] Indique e ganhe (crédito só depois do atendimento concluído)
- [x] Camada de salão (o produto nasce marketplace)
- [x] Almoço, folga e compromisso; tempo de arrumação entre atendimentos
- [x] Encaixe manual de cliente sem app; preço congelado no atendimento
- [x] Perdoar falta e a semana numa tela só
- [x] Indicação inversa: cliente traz profissional e vira afiliada dela
- [x] Sistema visual próprio (grafite e latão), fontes servidas pelo app
- [x] A cliente volta sozinha: lembrete de véspera, "obrigada pela visita" com
      sugestão de retorno, e a lista de quem passou do tempo de voltar
- [x] O mês em números: faturamento, ticket médio, ocupação da agenda, faltas,
      clientes novas, o que mais rendeu e quem mais volta
- [x] WhatsApp: fila de saída com adaptador de canal — manual (um toque, de
      graça), Evolution (chip próprio) ou Cloud API oficial
- [x] A resposta da cliente mexe na agenda: 1 confirma, 2 cancela e libera a
      vaga para a fila de espera, SAIR desliga os avisos
- [x] Resposta pelo WhatsApp: "Responda 1 ou 2" por padrão (funciona em todo
      aparelho); enquete e botão nativo como estilos opcionais — botão de
      verdade só a API oficial desenha
- [x] Mensagem de WhatsApp escrita por tipo, com emoji, negrito e o link da
      agenda da profissional (o aviso dentro do app continua seco)
- [x] A profissional decide: todo pedido passa pelo aceite dela (1 aceita,
      2 recusa, prazo configurável), no WhatsApp ou no app
- [x] Remarcar passa pelo aceite: a cliente pede a troca, o horário atual
      fica guardado até a resposta, e o pedido cai sozinho se ela desistir
- [x] Favoritas, avaliações (só de atendimento concluído) e posição na fila
- [x] Publicado na própria EC2 da Evolution (Caddy + DuckDNS), PWA instalável
- [x] A vitrine da profissional (/p/<slug>): foto, nota, avaliações, trabalhos,
      horários, onde fica, próxima vaga, WhatsApp e Instagram — e prévia
      bonita quando o link é mandado no WhatsApp (Caddy + pagina-publica)
- [x] O vínculo (053): a cliente só enxerga as agendas em que entrou — por QR
      lido no próprio app, código de seis letras ou link `/v/<código>`; o código
      é da profissional ou do salão, o vínculo é sempre com o salão e registra
      quem trouxe; cadastro com código vincula no servidor; agendar vincula;
      "Sou profissional" abre uma agenda autônoma (salão de uma) ou um salão
- [x] E-mail pelo Resend (054): fila `email_outbox`, função `enviar-email`, terceiro
      ponteiro do relógio; boas-vindas no cadastro dizendo quem convidou. Segredos:
      `supabase secrets set RESEND_API_KEY=re_... EMAIL_DE='MIMO <oi@seudominio.com>'`
- [x] A plataforma (055/056): o quarto papel, 'plataforma', com /plataforma — um
      painel de PC: visão geral com variação e tendência, salões e autônomas com
      checklist de implantação, pessoas, convites/vínculos com funil, filas e logs,
      métricas semanais, configurações; criar salão, desativar, trocar dona. Dá o
      papel com `select public.dar_plataforma('voce@email.com')` no SQL Editor
- [x] A porta é o código: sem login, o app abre em Escanear o QR / Digitar o código /
      Já tenho conta. Cadastro solto não existe; a conta nasce atrás de um código
      (cliente) ou de "sou profissional". Google/Apple entram com `VITE_OAUTH=google,apple`
      depois de ligar os provedores em Authentication → Providers
- [x] `supabase/povoar.sql`: gente de mentira (5 clientes, 4 profissionais com
      3 meses de histórico e avaliações) para ver tudo funcionando
- [x] O relógio da casa: pg_cron + pg_net dentro do Supabase empurram a fila a
      cada minuto e resolvem prazos, ofertas e lembretes a cada 5, sem depender
      da VPS. Liga com `select public.ligar_relogio(url, chave)` (migração 052)
- [ ] Remarcar e avaliar pelo próprio WhatsApp, sem abrir o app
- [ ] Migrar depois para React Native / Expo reaproveitando o Supabase


## Modo demonstração (sem Supabase)

```bash
VITE_DEMO=1 npm run dev
```

O app inteiro sobe com dados fictícios. Escolha o papel pela URL:
`/login?demo=cliente`, `?demo=profissional` ou `?demo=admin`
(`?demo=sair` para ver a tela de login). Nada é gravado. Serve para
mostrar o produto e para conferir cada tela sem precisar de conta.


## Servir o site na mesma máquina da Evolution

Em vez da Vercel, o app pode ser entregue pelo Caddy que já está na EC2:

```bash
cd ~/agenda-mel/evolution
./publicar-site.sh
```

Pede um segundo nome do DuckDNS (ex.: `mimo.com.vc`) apontando
para o mesmo IP, instala Node se precisar, builda e sobe. Publicar de
novo é rodar o mesmo script. O `.env` do app (chaves do Supabase)
precisa existir na raiz do repositório na EC2.
