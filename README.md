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
- **Salões no mapa**: `scripts/guia/mapa_saloes.py` abre uma tela local (http://127.0.0.1:8765) para desenhar a área no Google Maps, retângulo ou polígono, e rodar a mesma busca do script: descoberta grátis, plano com o custo antes de gastar, progresso por termo e um CSV por cidade na pasta `saida`. Sem a chave do mapa (`GOOGLE_MAPS_JS_KEY`, ou a da Places aceitando o referenciador local), a tela cai num formulário com os quatro cantos.
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
- **Perto de você e o mapa de acessos (3.13, migração 163).** Ao entrar numa lista do guia (cidade, categoria, bairro e horário), um modal curto pergunta "Pode liberar sua localização?": é para indicar os salões mais perto, com mais precisão (o que é feito com o ponto está na política de privacidade). Quem toca em "Sim, pode" autoriza o navegador (a caixa de permissão sai do toque, nunca sozinha), a lista reordena, cada cartão mostra a distância e a página do salão diz "a 1,2 km de você". Quem fecha tem o botão "Ver os mais perto de mim" na lista. A MIMO guarda o ponto onde a pessoa estava: o ponto exato, como o celular manda, vai para `site_eventos` como o evento `localizacao` (um gatilho confere lat e lng e descarta o resto), sem nome e com o código de visitante que muda todo dia. "Agora não" fica no aparelho por 30 dias; quem já autorizou antes não vê o aviso de novo (a posição é lida sem perguntar). Na Plataforma, Desempenho → **Mapa de acessos** (o Google Maps com a chave que o app já usa, ou o Leaflet sem chave; só a Plataforma, `guia_mapa_acessos(dias)`): um ponto por pessoa e dia, o salão no ar mais perto de cada um e "De onde procuram" por bairro (a mais de 8 km de qualquer salão é "fora da cidade"). Para isso os cartões públicos passaram a levar a coordenada do salão (5 casas), e o JSON-LD do salão ganhou `geo`. Os textos: o aviso de cookies ("a localização, só se você ativar no guia"), a política de privacidade (3.8, a finalidade em 5, o "Agora não" em 9 e a retenção de 400 dias em 10; a versão que vale é a publicada na Plataforma em Termos e privacidade, então publique a nova). Código: `src/lib/guiaPerto.js`, `src/components/guia/PertoDeVoce.jsx`, `desempenho/MapaAcessos.jsx`.
- **Fotos, artigos de cidade, várias cidades e o republicar sozinho (3.14, migração 164).** *Fotos:* a Plataforma envia fotos de um salão em Editar → Fatos do salão → Fotos (até 8, reduzidas no navegador, bucket `guia`); a primeira vira a capa da página, a imagem do link no WhatsApp (`og:image`) e entra no JSON-LD (`image`), as outras ficam numa faixa que abre a foto grande; os cartões das listas mostram a capa. A regra, escrita na própria tela: só foto que o salão mandou ou autorizou, ou que a equipe tirou; nada copiado do Google ou do Instagram (a foto é de quem publicou, e a chave do Google que faz o mapa e a extração cairia junto). Salão que já está na MIMO sem foto no guia usa as fotos da própria página dele (`salons.fotos`). A seção "É o seu salão?" pede fotos quando não há. *Artigos de cidade:* um artigo do blog com a cidade no título ou no slug (ex.: "Onde fazer as unhas em Santos") ganha a caixa "Salões em Santos" (a página da cidade e as categorias que ela tem) e aparece em "Leia também" na página da cidade, sem campo novo (`packages/core/guiaArtigos.js`); vale no app e no HTML estático. *Várias cidades:* as páginas de cidade e de categoria listam "Salões em outras cidades", o rodapé lista as cidades do guia e a barra ganhou "Guia de salões". *lastmod honesto:* `atualizado_em` (o `lastmod` do sitemap e o "atualizados em" da página) só anda quando muda algo que a página mostra; reimportar um CSV que não mudou nada não conta, e as datas que a reimportação tinha inflado voltaram para a data da publicação de cada página. *Republicar sozinho:* `site_conteudo_versao()` é um carimbo do que está publicado; no servidor, `evolution/republicar-se-mudou.sh --cron` confere de hora em hora e, se mudou, regenera o HTML estático e o sitemap em segundos (`node scripts/paginas-estaticas.mjs`, sem build e sem mexer no Caddy): o que a Plataforma publica (artigo, página SEO, salão aprovado) chega ao Google sem ninguém rodar o publicar. *Celular:* o modal do "perto de você" espera o primeiro gesto (rolar ou tocar) em vez de cobrir a página na chegada, que é o que o Google penaliza como interstitial. *Script do Maps v4* (`scripts/guia/buscar_saloes.py`): a v3 parava em ~500 lugares porque cada busca do Google devolve no máximo 60; a v4 descobre os ids com a busca "só ids" (grátis e ilimitada) numa grade que se divide até nenhuma célula lotar, busca os dados completos em lote só nas palavras que trazem mais lugares novos por chamada e lê o resto um a um, tudo dentro das cotas grátis do mês (teto por nível; o que não cabe fica em `mimo_pendentes.csv` para o mês seguinte). `--cidade "Santos"` ou `--regiao baixada-santista` (um CSV por cidade).
- **Fotos em lote (3.14.1).** Plataforma → Guia → Importar → **Fotos em lote**: um CSV com o salão (`place_id`, `id` ou `slug`; `slug` repetido em duas cidades pede a coluna `cidade`) e as colunas `foto_1_arquivo`, `foto_2_arquivo`… (ou uma coluna `fotos` com os nomes separados por `|`), mais a pasta com as imagens (ou os arquivos um a um). "Analisar" mostra a prévia antes de gravar: salões no CSV, encontrados, com fotos encontradas, imagens prontas, sem arquivo, sem estabelecimento, repetidas (mesmo conteúdo entra uma vez), quantos já têm fotos (as novas entram depois das existentes e a capa fica, ou "Substituir" troca tudo). Quem importou, quando e de que lote fica gravado no salão em `origem.fotos`; não há aceite para marcar, porque quem importa é a própria equipe (3.16.1). O envio é o mesmo do Editar → Fotos (`src/lib/guiaFotos.js`): 1600 px JPEG no bucket `guia`, com o nome do objeto tirado do SHA-256 do arquivo, então o mesmo arquivo nunca sobe duas vezes e já aparece como "já estava na página". Relatório por salão no fim, com download em CSV. Sem migração: usa a coluna `fotos` e o bucket da 164.
- **O dono manda as fotos (3.15, migração 165).** Quando a equipe marca uma reivindicação como **Confirmada** (Interesses), a pessoa recebe um segundo e-mail, "Confirmado: você responde por <salão>. Quer mandar as fotos?", com um link só dela, `/saloes/<cidade>/<salão>/fotos/<token>`, que vale 30 dias. Na página do link (sem login; `noindex`) ela vê as fotos que já estão na página, escolhe até as vagas que faltam (8 no total), declara que as fotos são do salão e envia; o site reduz cada uma a 1600 px e manda para a função `guia-fotos-dono` (publicada com `--no-verify-jwt`: o token é a credencial, conferido no banco). A função confere o tipo pelo conteúdo (JPG, PNG, WebP; até 6 MB), sobe para o bucket `guia` na pasta do salão com o prefixo `dono-` e o SHA-256 do arquivo (repetida não duplica), e grava por `guia_fotos_dono_gravar`, que só aceita URL com essa cara, junta sem repetir, respeita o limite de 8 e anota `origem.fotos_dono`. As fotos entram na página na hora; a equipe tira qualquer uma em Editar → Fotos. Na Plataforma, a reivindicação confirmada ganha **Link das fotos** (copia; renova se venceu) e mostra quantas fotos a pessoa já mandou. Código: `src/pages/publico/GuiaFotosDono.jsx`, `supabase/functions/guia-fotos-dono/` (lógica pura testada com node), migração 165.
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

> **Gemini e Groq lado a lado (3.27).** A função `guia-gerar` passa a ter dois provedores, e a Plataforma escolhe na hora de gerar: um seletor "Gemini | Groq" ao lado de Gerar em Páginas da cidade e de "Reescrever com IA" em Revisar (a escolha fica lembrada no aparelho e o modelo que escreveu fica gravado no texto, `_meta.modelo` e `_meta.provedor`, visível na linha da página e no painel do salão). Segredos: `GEMINI_API_KEY` (a chave do AI Studio; o projeto com faturamento ligado consome os créditos do Google Cloud) e `GUIA_IA_MODELO_GEMINI` (padrão `gemini-3.1-pro-preview`; o 2.5 Pro não existe mais para contas novas); `GROQ_API_KEY` e `GUIA_IA_MODELO` (padrão `openai/gpt-oss-120b`); `GUIA_IA_PADRAO` (`gemini` ou `groq`) decide quando o pedido não escolhe; sem ela, o Gemini se tiver chave. `GUIA_IA_URL` e `GUIA_IA_CHAVE` trocam o lado do Groq por outro provedor compatível com a OpenAI (OpenRouter, xAI). Mudar um segredo vale na próxima geração, sem republicar. Nos modelos que pensam antes de responder (Gemini, Qwen) o raciocínio conta no limite de tokens: a função dá folga (8.000), pede pouco raciocínio ao Gemini e esconde o raciocínio do Qwen para o JSON vir limpo. Pedir Gemini sem a chave devolve o erro com o segredo que falta. Testes: `conteudo.teste.ts` (32) e `t_ia_escolha.mjs` (navegador). Depois: `supabase secrets set GEMINI_API_KEY=...` e bat **9**.

> **O retrato da cidade nas páginas de cidade (3.26, migração 175).** O texto da página da cidade saía igual para qualquer cidade de praia: "moradores e veranistas que lidam com sol, maresia e cloro", uma lista de bairros como inventário e dicas sobre a maresia nos fios. A IA só recebia os nomes dos bairros com contagens e uma frase genérica em "Sobre a cidade". Três mudanças. *A ficha vira um retrato:* `prepararPagina` passa a montar, dos próprios salões, onde eles estão bairro a bairro (a fatia em palavras, "cerca de um terço"; o que cada bairro concentra; as ruas e avenidas onde eles se juntam, por `ruaDoEndereco`; quantos abrem no domingo), as ruas com mais lugares na cidade, o ritmo dos horários (cedo, noite, segunda fechada) e o que os cadastros informam em conjunto (cartão, estacionamento, acessibilidade, em proporção: a validação libera essas palavras quando três ou mais informam). *O pedido muda:* o prompt da página exige um parágrafo inteiro de retrato ("quem fica em Suarão ou Gaivota resolve unha e cabelo sem ir ao Centro" serve; "há opções em vários bairros" não), proíbe o inventário de bairros, deixa sol, sal e maresia para o ângulo da praia e em uma frase, pede dois itens de "como escolher" e uma pergunta da FAQ sobre esta cidade, e ganha o teste da outra cidade (troque o nome da cidade; se o parágrafo continuar verdadeiro, está genérico). A validação recusa como estilo (o modelo escreve de novo uma vez) a frase com quatro ou mais nomes de lugar e a fórmula do litoral em três campos ou mais. *"Sobre a cidade" com o desenho da cidade:* a 175 troca a semente da 170 de Praia Grande, Mongaguá, Itanhaém e Peruíbe por um texto que diz como cada cidade se organiza (norte e sul, bairros de praia e de moradores, as avenidas de comércio, a rodovia, as referências), só onde o texto ainda é o da semente; a caixa na Plataforma passa a dizer o que ajuda a IA. Confira e edite os quatro textos em Páginas da cidade. Depois: bat **B** (175), bat **9** (a função) e "Gerar de novo" nas páginas de cidade e de categoria. Testes: `conteudo.teste.ts` (31).

> **A Plataforma por cidade e a página da cidade por partes (3.25, migração 174).** Duas coisas pesadas viraram leves. *A Plataforma:* a tela do guia lia todos os salões ao abrir (3.214 hoje, 20 mil no fim: uns 5 MB a cada abertura, tudo em memória). Agora ela abre com `guia_resumo()` (174: uma linha por cidade com os números do topo e os "no ar" por categoria, alguns KB; só a Plataforma), escolhe a cidade (a lembrada no aparelho; senão a com mais trabalho esperando) e lê só a lista daquela cidade. O seletor fica no alto, ao lado dos números: trocar de cidade lê a outra (a anterior fica em memória) e "Todas as cidades" é escolha explícita, com o total ao lado. Os números do topo saem da lista carregada (mudam na hora ao aprovar, descartar, importar) e, antes de ela chegar, dos totais do banco. Os salões que os Interesses citam vêm à parte, de qualquer cidade; o Desempenho abre na cidade escolhida; "Páginas da cidade" conta o "no ar" de todas as cidades pelos totais; a importação leva a tela para a cidade importada; Abordagem e Desempenho trocam a cidade sozinhos ao abrir um salão de outra. Num banco sem a 174, tudo de uma vez, como antes. *A página da cidade:* Praia Grande baixava 1 MB de cartões (2.271) para mostrar 24. O gerador passa a gravar o JSON da cidade (e o de cada categoria) com a primeira parte (48 cartões) e os totais em `lista`; as outras partes ficam em `lista/<todos|categoria>-<n>.json` e a lista inteira em `lista/<todos|categoria>.json`, lidas só quando a pessoa toca em "Ver mais", busca, filtra por bairro ou ordena por distância. O panorama vem pronto no `resumo.json` (o gerador conta a lista inteira) e cada coleção (bairro, horário) vem montada em `colecao/<tipo>-<valor>[-<categoria>].json`, alguns KB em vez do `colecoes.json` de 2 MB, que fica como reserva. *Miniaturas das fotos antigas:* as fotos de antes da 3.24 não têm a cópia de 480 px e o cartão caía na foto inteira (uns 35 KB cada); em Importar, o painel "Miniaturas das fotos antigas" confere as da cidade escolhida e gera as que faltam no próprio navegador. No VPS: bat **B** (174) e bat **2**. Testes: `t_174.sql`, `t_lista_partes.mjs` (11), `t_dados_guia.mjs`, `t_plataforma_cidade.mjs` (15, navegador) e `t_cidade_partes.mjs` (navegador).

> **O guia leve (3.24, migração 173).** Quatro cortes no que cada visita e cada abertura da Plataforma carregam. *Miniaturas:* toda foto enviada (Plataforma, importação em lote e o link do dono) ganha uma cópia de 480 px ao lado (`-p.jpg`); os cartões das listas, os blocos de categoria e a faixa da galeria usam a miniatura (`miniatura()` no core), uns 7 vezes menor, e voltam à foto inteira sozinhos quando ela não existe (fotos de antes). A capa da página do salão e a foto aberta continuam inteiras. *A página da cidade leve:* em vez da lista completa com horários (1,7 MB em Praia Grande), a página lê `resumo.json`, alguns KB com os links de bairro e horário e as contagens do panorama por categoria; a lista completa só sai quando alguém abre uma página de bairro ou de horário. *A chave do gerador:* `guia_publicadas` só responde com a chave guardada em `guia_segredos` (tabela sem acesso pela API); o gerador lê `GUIA_CHAVE_GERADOR` do `.env` da Evolution. `guia_cidade` e `guia_colecoes` saem do alcance da chave pública (ficam para quem está logado); `guia_pagina` e `guia_cidades` continuam públicas como reserva. Assim ninguém queima a saída do plano gratuito chamando as funções pesadas em loop. *Listas por partes na Plataforma:* Revisar e Publicadas mostram 150 e "Mostrar mais"; o escolhido pelo teclado sempre aparece. Testes: `t_173.sql`, `t_panorama.mjs` (horasDe, miniatura), `t_dados_guia.mjs` (resumo.json), `t_guia_fonte.mjs` (chave) e os do navegador.

> **A cidade grande em fatias (3.23.1, migração 172).** No ar, Praia Grande entrou com 2.271 salões e a leitura da cidade inteira numa resposta (11 MB) passou dos cerca de 4 segundos que o Supabase dá a uma consulta pública (`57014`, statement timeout): o gerador seguiu sem o guia. Agora `guia_publicadas(cidade_, desde_, depois_, limite_)` entrega no máximo `limite_` salões por chamada (200 no gerador, teto 500), em ordem de slug a partir de `depois_`; os slugs na ordem do site e as páginas vêm só na primeira fatia, e a lista de cidades saiu da função (o gerador já a pede uma vez). O índice parcial `guia_lugares_no_ar` acelera as contagens de quem está no ar (`guia_cidades` levava 3,9 s a frio). O erro do gerador passa a trazer o motivo do banco, não só o 500. Teste: `t_172.sql` e `t_guia_fonte.mjs` (fatias).

> **O Supabase magro (3.23, migração 171).** Com 20 mil salões, três coisas liam demais no plano gratuito (5 GB de saída por mês). *O republicar:* `guia_publicadas()` montava o guia inteiro numa consulta (100 MB) e, para cada salão, procurava os 6 vizinhos varrendo a cidade (quadrático: Praia Grande sozinha dava 5 milhões de comparações, e a API corta a consulta antes). Agora `guia_publicadas(cidade_, desde_)` devolve uma cidade por vez: os slugs na ordem do site, só os salões que mudaram desde a última rodada, as páginas da cidade e as cidades; o gerador (`scripts/guia-fonte.mjs`) guarda cada cidade em `.cache/guia/<cidade>.json`, aplica o que mudou, apaga quem saiu e calcula os vizinhos em memória. A rodada de hora em hora sem novidade lê alguns KB por cidade; uma vez por dia a cidade vem inteira; se o banco falhar e houver cache, a rodada segue com ele e avisa; `node scripts/paginas-estaticas.mjs --refazer` ignora o cache. Banco fora do ar não apaga mais as páginas do guia que estão no ar nem as tira do sitemap. *O site:* o gerador grava os mesmos dados que `guia_cidades()`, `guia_cidade()`, `guia_colecoes()` e `guia_pagina()` devolvem em `dist/dados/guia/` (um JSON por cidade, por categoria, as coleções e um por salão); o site lê daí primeiro (Caddy, gzip, sem Supabase) e só chama a função do banco quando o arquivo não existe (desenvolvimento, demo, cidade publicada há menos de uma hora). A página da cidade de Praia Grande deixa de puxar 2,4 MB do Supabase a cada visita. *A Plataforma:* lia todos os salões com texto e rascunho (3,5 KB cada); agora lê a view `guia_lista` (sem os dois jsonb, com `tem_conteudo`, `tem_rascunho`, `resumo` e as `_meta`; `security_invoker`, então a RLS vale) e o texto do salão é lido ao escolher, editar ou aprovar (`carregarTexto`). Num banco sem a 171, a leitura cheia de antes. Ordem no VPS: bat **B** (171) antes do bat **2**; o gerador velho num banco novo ainda funciona (sem vizinhos), e o gerador novo num banco velho cai na função antiga e avisa. Testes: `t_171.sql`, `t_guia_fonte.mjs` (16), `t_dados_guia.mjs` (13), `t_plataforma_magra.mjs` (navegador) e os do HTML estático.

> **Páginas de cidade com conteúdo de verdade (3.22, migração 170).** Os textos do guia saíam genéricos por três motivos, e os três mudaram. *Panorama com números reais:* abaixo da introdução, a página da cidade (e a de cada categoria) ganha um bloco montado dos próprios dados na hora (`packages/core/guiaPanorama.js`, no site e no HTML estático): os bairros com mais lugares e a fatia que concentram, as categorias, quantos abrem aos domingos, à noite e cedo, quantos já agendam pela MIMO e os serviços mais divulgados; e a FAQ ganha perguntas respondidas pelos dados ("Quantos salões tem em Praia Grande?", "Quais bairros têm mais?", "Tem salão aberto no domingo ou à noite?"), que entram no JSON-LD e tiram da IA a pergunta do mesmo assunto. Números exatos, porque saem da lista que a página mostra, regenerada a cada mudança. *"Sobre a cidade":* a linha da cidade em `guia_paginas` ganhou `contexto` (170), editável na Plataforma em Páginas da cidade: o que a redação sabe da cidade (região, tipo de cidade, temporada, como ela se organiza). Não aparece no site; a função `guia-gerar` passa para a IA em todas as páginas da cidade (cidade, categorias e cada salão). Até aqui só Itanhaém, Mongaguá e Peruíbe tinham um parágrafo fixo no código, e Praia Grande e as outras recebiam "não invente nada". A 170 semeia as 29 cidades da Baixada, do Litoral Norte, do Vale do Paraíba e do Vale do Ribeira (só coisa geral e certa; edite à vontade, a semente só preenche o que está vazio). *O que o cadastro informa:* a ficha do salão leva os atributos do Google (`guia_lugares.atributos`: pagamento, acessibilidade, estacionamento, crianças, banheiro) em `o_que_o_lugar_informa`; a IA pode afirmar isso como fato, e a validação só libera o que foi informado (Pix e parcelamento continuam invenção). Os dois prompts ganharam o "teste da página genérica" (frase que serviria para qualquer salão ou cidade sai ou ganha um fato) e o da cidade sabe do bloco de números, para não repetir números. Temperatura 0,7. Para trocar o modelo da IA, `supabase secrets set GUIA_IA_MODELO=...` (padrão `openai/gpt-oss-120b`). Testes: `conteudo.teste.ts` (29), `t_panorama.mjs`, `t_170.sql`. Depois da 170, publique as funções (bat 9) e o site (bat 2).

> **O Bing avisado na hora (3.21).** O Google lê o sitemap quando quer; o Bing (e Yandex, Seznam e Naver, de onde bebem DuckDuckGo e Ecosia) aceita o aviso na hora pelo IndexNow. `scripts/indexnow.mjs` compara o `dist/sitemap.xml` com o último sitemap avisado (`evolution/indexnow-ultimo.xml`, fora do git) e manda só o que entrou, mudou (`lastmod`) ou saiu, em lotes de até 10.000 URLs; a chave fica em `INDEXNOW_KEY` no `.env` da Evolution (`node scripts/indexnow.mjs --gerar-chave` grava) e o script regrava `dist/<chave>.txt`, que o Bing confere no ar. O `republicar-se-mudou.sh` avisa depois de cada regeneração (e, de hora em hora, se um aviso anterior ficou pendente, porque o sitemap no ar ainda difere do último avisado) e o `publicar-site.sh` avisa depois do build e confere no fim que a chave responde. Sem a chave, nada muda. `--simular` mostra sem mandar; `--tudo` avisa tudo de novo. Teste: `t_indexnow.mjs`.

> **A Baixada inteira (3.20, migração 169).** A busca do Maps (`scripts/guia/buscar_saloes.py`) ficou mais precisa sem ficar mais larga: entram mais termos de salão (esmalteria, nail bar, espaço de beleza, studio de beleza, mega hair, podologia) e saem sauna e wellness; os tipos que não são salão (pet shop, loja, academia, clínica, barbearia, cabeleireiro masculino) e os nomes que denunciam (pet, dog, carros, motos, gym, loja) ficam de fora, a não ser que o Google diga que é salão. Cada salão sai com o **bairro** limpo e, quando o Google não manda o bairro, o script infere pelos vizinhos (pelo menos 2 a até 600 m) e marca `bairro_origem` (google, vizinhos ou vazio) para conferir; o relatório da cidade conta por bairro. Na Plataforma, Revisar ganhou o filtro por **bairro** (da cidade escolhida) e "Em lote" ganhou **Aprovar e publicar** (`guia_lote` com a ação `aprovar`): publica o que está pronto na lista filtrada (gerado com texto, ou no ar com versão nova), o mesmo que aprovar um a um; sem texto, descartado e removido não entram. No site, a cidade com mais de 10 bairros mostra um seletor com todos os bairros (no celular abre a lista nativa) e os 8 maiores em chips; o HTML estático e o JSON-LD da cidade param em 96 salões (240 na categoria), com uma nota apontando as páginas por bairro e por categoria, que listam tudo. Testes: `t_169.sql`, `t_lote.mjs` (aprovar e bairro), `t_caps_estatico.mjs`, `t_bairros_cidade.mjs` (celular, tablet e computador) e `t_buscar_v4.py`.

> **As categorias com vida (3.19, migração 168).** Os blocos de categoria no topo da cidade (e da categoria) eram um nome e um número. Agora cada bloco traz a **capa do melhor salão da categoria que tem foto** (a mesma ordem das listas, 3.17), e embaixo **quem está lá**: "Studio Lírio, Unhas da Ana e mais 1". Sem foto na categoria, fica o gradiente com o ícone, como antes. A descrição de cada categoria ("Manicure, pedicure, alongamento, gel e nail art") vive em `GUIA_CATEGORIAS` (`resumo`) e aparece no `title` do bloco, nas cartas de **Outras categorias** no fim da página da categoria (ícone, descrição, total e quem está lá) e no índice `/saloes`, que ganhou a seção **Por categoria** com as cidades que têm cada uma, linkando para a página da categoria em cada cidade (antes era só uma frase). Banco: `guia_cidade` devolve `foto` e `nomes` por categoria e `guia_cidades` devolve as categorias de cada cidade; a mesma conta em JS é `categoriasDaLista` (`packages/core/guia.js`), usada pelo HTML estático e pelo demo, e `quemEsta` monta a frase. O HTML estático da cidade lista as categorias com descrição, total e nomes, e o do índice lista as cidades por categoria. Testes: `t_168.sql`, `t_cats_estatico.mjs` e `t_cats.mjs` no demo.

> **Ações em lote e o desempenho por cidade (3.18, migração 167).** Em Guia → Revisar, o botão **Em lote** aplica uma ação a tudo o que está na lista filtrada (fase, cidade, categoria, triagem, busca), numa chamada só (`guia_lote`): **Tirar do ar** (publicado volta a gerado; texto, fotos, histórico e métricas ficam; aprovar de novo devolve ao ar), **Descartar** (com o motivo; a importação segue atualizando os dados; "Trazer de volta" em Descartados desfaz) e **Apagar de vez** (o salão com texto, as fotos do bucket, as reivindicações, o histórico de abordagem, as métricas e as buscas do Google só daquelas páginas; confirmação digitando o número de salões). Com "apagar também as páginas das cidades que ficarem sem salão", o texto da cidade e das categorias e as métricas dessas páginas vão junto: é o jeito de recomeçar uma cidade do zero. Nada fora dos salões da lista é tocado, então cada município continua com os seus próprios números; a importação pode trazer o salão de novo, como salão novo (mesmo endereço se o nome e a cidade forem os mesmos, outro id). A aba **Desempenho** ganhou o seletor de cidade (quando há mais de uma): os números de um município só, sem misturar com os outros (`guia_desempenho(dias, cidade_)` já aceitava). Testes: `t_167.sql` (duas cidades: o lote mexe numa e a outra fica intacta) e `t_lote.mjs` no demo.

> **As listas do site em ordem de nota e foto (3.17, migração 166).** Até aqui as listas do guia (cidade, categoria, bairro, horário e "mesma categoria" na página do salão) vinham em ordem alfabética depois de quem está na MIMO e da Seleção MIMO, e as primeiras telas ficavam cheias de salão sem foto. Agora, depois de MIMO e Seleção, a ordem é por **pontos** (`guia_pontos` no banco; `pontosDoLugar` em `packages/core/guia.js`, a mesma conta): a nota do Google puxada para 4,5 quando há poucas avaliações (como se houvesse 8 avaliações de 4,5 a mais: 5,0 com 3 avaliações dá 4,64; 4,9 com 200 dá 4,88; sem nota, 4,5) mais a foto (ter foto vale 0,4; cada foto a mais, 0,05, até 3 a mais; contam as fotos que a página mostra, inclusive as da página na MIMO). Desempate: mais avaliações, depois o nome. A nota continua sem ir para a página: ela só ordena, dentro do banco, e o JSON público segue sem nota e sem pontos. Para mudar os pesos, mexa em `guia_pontos` (166) e em `PONTOS` (`packages/core/guia.js`); `t_166.sql` e `t_pontos.mjs` conferem que as duas contas batem. O gerador do HTML estático respeita a ordem que `guia_publicadas()` manda (a lista já vem por cidade na ordem do site), e as coleções por bairro e horário também. Na **Plataforma**, Revisar e Publicadas ganharam a ordem **Mais fotos**, **Sem foto 1º** e **Ordem do site**, a triagem "Sem foto na página" / "Com foto na página", a pílula com quantas fotos cada salão tem e, no painel do salão, os pontos explicados ("4,79 pontos na ordem do site: 4,24 da nota + 0,55 da foto"). Depois de rodar a 166, publique o site (bat 2) ou rode `republicar-se-mudou.sh --forcar`: a ordem nova não mexe em `atualizado_em`, então o republicar automático não a vê.

> **A abordagem pede as fotos (3.16.1).** A mensagem de Guia → Abordagem → "Mandar mensagem" (e a mesma da aba Desempenho) ganha um parágrafo quando a página do salão está no ar e sem foto: "A página ainda está sem foto. Se puder, me manda umas fotos do salão por aqui (a fachada, o ambiente, trabalhos de vocês) que a gente coloca na página." Entra depois dos números (ou da apresentação) e antes da oferta, nas três versões do texto (para o salão, para quem pediu contato e para quem já é cliente); o modal avisa "A página ainda não tem foto: o texto pede". Salão que já está na MIMO usa as fotos da própria página dele e não recebe o pedido. A pessoa responde com as fotos no próprio WhatsApp e a equipe coloca em Editar → Fotos ou em Fotos em lote. A frase mora em `src/lib/guiaMetricas.js` (`PEDIDO_DE_FOTOS`). E **Fotos em lote** deixou de pedir o aceite antes de importar: quem importa é a própria equipe; `origem.fotos` continua anotando quem, quando e de que lote.

> **HTML estático em todas as páginas públicas (3.16).** Até a 3.15 só o guia de salões escrevia o corpo da página dentro de `<div id="root">` no build. O resto do site (home, páginas de produto, blog, institucionais, termos) saía só com as metas: antes de rodar o JavaScript, o Google via dezenas de páginas "iguais", a mesma casca vazia. Foi assim que dois artigos viraram "Cópia, o Google e o usuário selecionaram uma página canônica diferente" e 24 páginas ficaram "Detectada, mas não indexada". Agora `scripts/site-estatico.mjs` escreve o texto de verdade de cada página (o Markdown dos artigos e dos termos com a mesma gramática do app, as seções das páginas de produto, as listas do blog, os planos) e um rodapé com a malha interna (Soluções, Para profissionais, MIMO, cidades do guia) em todas as páginas, inclusive nas centenas do guia; um `<style>` pequeno deixa esse texto legível no instante antes de o app montar. O app continua trocando o corpo ao abrir.

> **Canônica (3.15.1).** O `index.html` do app (a casca que atende `/entrar`, `/cliente`, `/plataforma` e qualquer endereço sem página própria, inclusive erros de digitação e maiúsculas) leva `noindex` por padrão: ele saía com o título e o `og:url` da home, e o Search Console passou a apontar "Duplicada, o Google escolheu uma canônica diferente". O build troca a tag por `index, follow` em cada página pública gerada, e o `useSeo` faz o mesmo ao navegar dentro do app. O Caddy também passou a mandar `/x/` para `/x` com 301 (as duas abriam a mesma página).

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
- **Bing na hora (IndexNow, 3.21)**: `scripts/indexnow.mjs` compara o sitemap
  com o último avisado e manda ao Bing (e Yandex, Seznam, Naver) só o que
  entrou, mudou ou saiu, em lotes de 10.000; a chave vive em `INDEXNOW_KEY`
  (`.env` da Evolution) e `dist/<chave>.txt` prova que o site é seu. O
  `republicar-se-mudou.sh` avisa depois de cada regeneração e o
  `publicar-site.sh` depois do build. Ligar: `node scripts/indexnow.mjs
  --gerar-chave` e `./republicar-se-mudou.sh --forcar` (`evolution/LEIAME.md`,
  "Bing na hora").
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
