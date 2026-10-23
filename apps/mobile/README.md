# MIMO no celular (Expo / React Native)

O app da MIMO na loja. Nativo (Expo + expo-router) de ponta a ponta: as telas
da cliente são todas do app, falando direto com o mesmo Supabase da web. Nada
da web foi reescrito por cima: o banco, as funções Edge e as regras são os
mesmos, e a lógica que não depende de tela é compartilhada (`packages/core`).

## A premissa

- A **web continua sendo a porta de entrada** e o **desktop continua sendo a
  casa da gestão do salão** (80% ou mais do uso administrativo).
- Tudo o que está feito **permanece** e o desenvolvimento segue como está. O
  app e a web dividem o banco, as funções Edge e `packages/core`: uma regra
  nova nasce no banco ou no core e vale nos dois.
- O app não tem WebView: o que a cliente faz é tela nativa. Só os termos, a
  política de privacidade e o link de redefinir senha abrem no navegador.

## Dois apps, um código

| App | Variante | Pacote | Abre | Quem usa |
|---|---|---|---|---|
| **MIMO** | `APP_VARIANT=cliente` (padrão) | `vc.com.mimo` | `mimo.com.vc` | Clientes: horários, salões, agendar, lembretes |
| **MIMO Pro** | `APP_VARIANT=pro` | `vc.com.mimo.pro` | `pro.mimo.com.vc` | Donas de salão e profissionais (fase 2: hoje só a configuração existe) |

A variante decide nome, ícone, splash, `scheme`, pacote e quais links do site
abrem no app (`app.config.js`). O resto é igual (`app.json`).

> **Play Console:** o pacote não se define ao "criar app"; ele fica definido pelo
> **primeiro `.aab` que você sobe**, e aí não muda mais. O app que você já criou
> serve para o MIMO (cliente): suba o `.aab` do perfil `production`.

## O que tem aqui

```
apps/mobile/
  app.json             o que é igual nas duas variantes
  app.config.js        o que muda por variante (APP_VARIANT)
  eas.json             perfis de build: development, preview (apk), production (aab) e os pro-*
  metro.config.js      enxerga packages/core (a lógica compartilhada com a web)
  .env.example         EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY / EXPO_PUBLIC_WEB_URL
  assets/images/       ícones (cliente/ e pro/) e a Mel
  src/app/             as rotas (expo-router)
    _layout.tsx        com sessão → abas; sem sessão → entrar
    entrar.tsx         e-mail e senha; esqueci a senha (o link chega por e-mail)
    cadastro.tsx       criar conta pelo convite: quem é você (WhatsApp único), como você entra, confira o e-mail
    ler-qr.tsx         a câmera lê o QR da profissional ou do salão
    (tabs)/index.tsx   Início: próximo horário, atalhos, novidades, promoções, salões, profissionais e destaques
    (tabs)/horarios.tsx Horários: próximos e histórico por mês (as regras da web, ClienteAgenda)
    (tabs)/saloes.tsx  Salões onde ela tem agenda + entrar por código
    (tabs)/perfil.tsx  Perfil: foto, dados (WhatsApp, e-mail, aniversário), agendas, como ser avisada, ajuda
    agendar/           o fluxo de marcar, nativo: com quem → serviços → data → hora → confirmar → sucesso
                       (remarcar entra pela data; as regras são as da web, src/pages/cliente/Agendar.jsx)
    agendamento/[id]   a página de um horário (as regras da web, ClienteAgendamento)
    salao/[id]         a página do salão: capas, pagamento, endereço, serviços por categoria, equipe, sobre
    categoria.tsx      os serviços de uma categoria do salão, com quem faz (?salao=&cat=)
    profissional/[id]  a página da profissional: serviços, avaliações, sobre
    servico/[id]       a página de um serviço: fotos, preço, quem faz, o que costuma ir junto
    pagamento/[id]     o PIX do sinal (condições, CPF, QR e copia e cola, comprovante, devolução)
    comanda/[id]       o comprovante do atendimento fechado no balcão
    avisos.tsx         a central de avisos
    fila.tsx           a fila de espera (onde ela está esperando vaga)
    indicacao.tsx      indique e ganhe: código, link, QR e créditos
    v/[codigo].tsx     mimo.com.vc/v/CODIGO (QR, link do WhatsApp ou código digitado): quem convidou, entrar na agenda
    +not-found.tsx     um link do site com caminho antigo cai na tela nativa; sem tela, abre no navegador
  src/context/sessao.tsx   a sessão (Supabase + AsyncStorage)
  src/components/ui.tsx    botão, cartão, avatar, selo, chip, caixa, entrada, estado vazio com a Mel…
  src/components/          Tela (moldura das telas empilhadas), Trilha (passos), Calendario (mês),
                           Folha (a folha que sobe de baixo, e a Confirmacao), Avaliar, Convites,
                           Ciencia (o aviso que ela precisa ler antes de seguir)
  src/lib/             config (variante, env), supabase, tema (claro/escuro), formato, ponte, agendar
                       (parâmetros e regras do fluxo), notificacoes (ícone e destino de cada aviso),
                       avisos (push), configPublica (o WhatsApp da MIMO e afins), funcoes (chamar uma
                       Edge Function), convite (o código guardado), legal (aceites), datas, demo (dados fictícios)
```

E fora daqui:

- `packages/core` (`@mimo/core`): a lógica que não depende de tela (catálogo,
  formatação, planos, telefone, horários). A web importa pelos arquivos de
  `src/lib/*.js`, que só reexportam; o app importa `@mimo/core`.
- `public/.well-known/assetlinks.json` e `apple-app-site-association`: a prova
  de que o app e o site são da mesma dona (links que abrem no app).

## Rodar no celular (desenvolvimento)

1. Uma vez: `cd apps/mobile && npm install`; depois copie `.env.example` para
   `.env` e preencha com os mesmos valores do `.env` da web.
2. `npx expo start` abre um QR. No celular, o app **Expo Go** (Play Store) lê o
   QR e roda a MIMO na hora, sem build. Tudo o que o app usa roda no Expo Go.
3. Termos, privacidade e o link de redefinir senha abrem no navegador, na web
   publicada (`EXPO_PUBLIC_WEB_URL`, padrão `https://mimo.com.vc`). Para apontar
   para a web local: na raiz do repo `npm run dev -- --host`, e no `.env` do app
   `EXPO_PUBLIC_WEB_URL=http://IP-DO-SEU-PC:5173` (mesma rede Wi-Fi).
4. Variante pro: `APP_VARIANT=pro npx expo start` (no PowerShell:
   `$env:APP_VARIANT='pro'; npx expo start`).

Antes de subir código: `npm run tipos` (TypeScript), `npm run lint`,
`npm run doctor` e `npm run empacotar` (empacota como na loja, em `dist/`).

### Ver as telas sem banco (modo demonstração)

Com `EXPO_PUBLIC_DEMO` o app roda inteiro com dados fictícios, sem Supabase e
sem conta: a Juliana, cliente do Studio Mel (salão) e da Bia (autônoma). Serve
para olhar e fotografar qualquer tela, mostrar o app para alguém, e testar no
navegador sem aparelho (`react-native-web` está instalado):

```powershell
$env:EXPO_PUBLIC_DEMO='1'; npx expo start --web     # abre no navegador, em F12 escolha um celular
$env:EXPO_PUBLIC_DEMO='1'; npx expo start           # ou no Expo Go
```

O valor escolhe o cenário: `1` (a Juliana com tudo: horários, novidades,
promoções), `vazia` (sem nada marcado e sem aviso novo), `nova` (acabou de
criar a conta, ainda sem agenda) e `fora` (sem sessão: entrar, criar conta, o
convite e o Google). Ao trocar o cenário (ou desligar a demo)
acrescente `--clear`: o Metro guarda o valor anterior no cache e, sem isso,
continua mostrando o cenário de antes. Os dados moram em `src/lib/demo.ts`, uma
imitação do cliente do Supabase igual à da web (`src/lib/demo.js`): quando uma
tela nova usar uma tabela ou função que não está lá, acrescente. Nada disso
entra no pacote da loja: sem a variável, `src/lib/supabase.ts` nem carrega o
arquivo.

### Entrar com Google (3.60)

No app da cliente, **Continuar com Google** aparece em Entrar e em Criar conta
assim que o provedor está ligado no Supabase (o app pergunta em
`/auth/v1/settings`; no Pro não aparece). O login abre o navegador do sistema
(`expo-web-browser`), o Google volta para o Supabase e o Supabase devolve para
o app em `mimo://auth/google`, que precisa estar nas *Redirect URLs* do projeto
(Authentication → URL Configuration). Não há SDK nativo do Google nem client ID
por plataforma: é o mesmo cliente OAuth da web (README da raiz, "Entrar com
Google"). A conta nova chega sem WhatsApp e o app pede o número em
`src/app/completar.tsx` antes de abrir as abas; a lógica mora em
`src/lib/oauth.ts`. Na demo (`fora`), o botão "entra" como a Juliana sem
WhatsApp e mostra essa tela.

## Publicar na Play Store (EAS)

Uma vez só:

1. `npm i -g eas-cli` e `eas login` (conta Expo, grátis).
2. `cd apps/mobile && eas init`: cria o projeto no Expo e mostra um `projectId`.
   Cole em `app.json`, dentro de `"expo"`: `"extra": { "eas": { "projectId": "..." } }`.
   (O CLI não escreve sozinho porque a configuração é dinâmica, `app.config.js`.)
3. As variáveis do build ficam no Expo, não no git (repita para `preview` e `development`):
   ```
   eas env:create --scope project --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value https://SEU-PROJETO.supabase.co
   eas env:create --scope project --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value SUA-ANON-KEY
   ```
4. A chave de assinatura o EAS cria e guarda na primeira build
   (`eas credentials -p android` mostra). Não precisa de keystore na mão, e
   nenhuma chave entra no git.

Cada versão:

```
eas build -p android --profile preview      # .apk para instalar no seu celular e testar
eas build -p android --profile production   # .aab para a loja (o versionCode sobe sozinho)
eas submit -p android --profile production  # manda para o Teste interno
```

Ou suba o `.aab` à mão no Play Console (Teste interno, depois Produção).
`eas submit` precisa de uma **conta de serviço** do Google Cloud com acesso ao
Play Console; o JSON dela fica fora do git e entra em `eas.json`
(`submit.production.android.serviceAccountKeyPath`).

A versão do app (`versionName`) é a do site, lida de `src/lib/versao.js`; o
`versionCode` é do EAS (`appVersionSource: remote`) e sobe a cada build de produção.
Só precisa de versão nova na loja quando a **casca** muda (telas nativas, ícone,
nome); mudança na web é deploy da web, como sempre.

### Links que abrem no app (App Links)

Com o app instalado, `mimo.com.vc/v/CODIGO`, `mimo.com.vc/p/...` e
`mimo.com.vc/cliente/...` abrem direto nele. Para o Android aceitar, o site
precisa provar que é da mesma dona:

1. `eas credentials -p android` mostra a **SHA-256** da chave de assinatura. Com o
   Play App Signing (padrão), pegue também as do Play Console em *Configuração do
   app → Integridade do app* (assinatura do app e chave de upload).
2. Cole em `public/.well-known/assetlinks.json` (formato `AA:BB:...`), faça o deploy
   da web (bat 2) e confira `https://mimo.com.vc/.well-known/assetlinks.json`.
3. No iPhone o arquivo é o `apple-app-site-association` (troque `TEAMID` pelo Team
   ID da conta Apple Developer). O Caddy já serve esse arquivo como JSON.

### Ficha da loja

Ícone 512×512 (`public/pwa-512.png`), gráfico de destaque 1024×500, de 4 a 8
capturas de tela, descrição curta e longa, categoria *Beleza*, e-mail de
contato, política de privacidade `https://mimo.com.vc/privacidade`, termos
`https://mimo.com.vc/termos/cliente`, questionário de segurança de dados
(coletamos nome, telefone, e-mail e agenda; não vendemos dados) e classificação etária.

## Avisos nativos (push)

Com sessão, o app pede permissão, pega um token do **Expo Push** e registra em
`push_tokens_app` (migração 152, `registrar_token_app`). A função Edge
`enviar-push` manda cada aviso da fila (`notifications`) pelo Web Push do PWA
**e** pelo Expo Push dos aparelhos do app; tocou no aviso, o app abre a tela
do caminho dele (`action_url`, traduzido por `rotaNativa`). Ao sair da conta o
token é removido.

Uma vez só, depois do `eas init` (o token precisa do `projectId` em `app.json`):

1. **Android (FCM)**: no [console do Firebase](https://console.firebase.google.com)
   crie um projeto (não precisa adicionar app), vá em *Configurações do projeto →
   Contas de serviço → Gerar nova chave privada* e guarde o JSON fora do git. Depois
   `eas credentials -p android` → *Push Notifications: Upload a service account key*
   (FCM V1) e aponte o JSON.
2. **iPhone (APNs)**: `eas credentials -p ios` → *Push Notifications* → deixe o EAS
   gerar a chave na sua conta Apple Developer.
3. Opcional, recomendado: em expo.dev → *Access tokens* crie um token e grave no
   Supabase (`supabase secrets set EXPO_ACCESS_TOKEN=...`): só a MIMO consegue mandar
   pelos tokens dela.

Testar: **não funciona no Expo Go** (desde o SDK 53 ele não recebe aviso remoto).
Use `eas build -p android --profile preview`, instale o .apk, entre na conta e
gere um aviso (uma confirmação de horário, por exemplo), ou mande um de teste em
<https://expo.dev/notifications> com o token que aparece no log do app em
desenvolvimento (`avisos: token do aparelho`). O ícone da barra é
`assets/images/*/aviso.png` (o coração, branco sobre transparente, 96×96).

## Tudo nativo

O app da cliente não tem WebView: entrar, criar conta (pelo convite de uma
profissional, com WhatsApp único e aceite dos termos), esqueci a senha, entrar
numa agenda (QR pela câmera, código digitado ou o link `/v/CODIGO`), as quatro
abas (início, horários, salões, perfil), o fluxo de marcar inteiro (com quem,
serviços, data, hora, confirmar com descontos, "quer aproveitar e adicionar?",
a visita com outras profissionais, pagamento pelo app e crédito; e remarcar,
que é um pedido de troca), a página do horário (estado, o que aconteceu com o
sinal, onde e como chegar, serviços, partes da visita, cancelar com a política
do sinal, avaliar com estrelas, marcar de novo), os convites (vir mais cedo,
vaga da fila), a vitrine (a página do salão com serviços por categoria, equipe
e sobre; a categoria; a profissional; o serviço), a central de avisos, a fila
de espera, a indicação, o perfil (foto, WhatsApp com código, e-mail,
aniversário, sair de uma agenda, como ser avisada), o PIX do sinal (condições,
CPF, QR e copia e cola, o relógio da reserva, comprovante e devolução), a
comanda e os avisos push.

No navegador do sistema, fora do app: os termos, a política de privacidade e
o link de redefinir senha que chega por e-mail (a senha nova vale no app). Um
aviso push ou um link com o caminho da web cai na tela nativa dele
(`rotaNativa`, em `src/lib/ponte.ts`); um caminho sem tela abre no navegador.

## O que vem depois

1. **Entrar com Google/Apple** no app (hoje é e-mail e senha; na web a opção
   aparece quando o provedor está ligado).
2. **MIMO Pro**: a variante já existe; faltam as abas de quem atende (agenda do
   dia, encaixe, pedidos).
3. **iPhone**: mesma base. Precisa da conta Apple Developer (US$ 99/ano); a build
   é na nuvem do EAS, sem Mac.
