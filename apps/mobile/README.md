# MIMO no celular (Expo / React Native)

O app da MIMO na loja. Uma casca nativa (Expo + expo-router) com as telas que
mais importam no celular e uma **ponte** para a web: tudo o que já existe em
`mimo.com.vc` abre dentro do app, com a sessão do app. Nada da web foi
reescrito; o app é mais um jeito de chegar na mesma MIMO.

## A premissa

- A **web continua sendo a porta de entrada** e o **desktop continua sendo a
  casa da gestão do salão** (80% ou mais do uso administrativo).
- Tudo o que está feito **permanece** e o desenvolvimento segue como está. O
  app pega carona: cada deploy da web (bat 2) já muda o que o app mostra na ponte.
- As telas nativas crescem aos poucos, começando pelo que a cliente faz no
  celular todo dia: ver os horários, os salões, o perfil.

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
    entrar.tsx         e-mail e senha (criar conta e recuperar senha abrem na web)
    (tabs)/index.tsx   Horários: a mesma consulta da web, em tela nativa
    (tabs)/saloes.tsx  Salões onde ela tem agenda + entrar por código
    (tabs)/perfil.tsx  Perfil, resumo e atalhos
    web.tsx            a ponte: a web dentro do app, com a sessão do app
    v/[codigo].tsx     mimo.com.vc/v/CODIGO (QR e link do WhatsApp) cai aqui
    +not-found.tsx     outros links do site abrem na ponte
  src/context/sessao.tsx   a sessão (Supabase + AsyncStorage)
  src/components/ui.tsx    botão, cartão, avatar, selo, estado vazio com a Mel…
  src/lib/             config (variante, env), supabase, tema (claro/escuro), formato, ponte
```

E fora daqui:

- `packages/core` (`@mimo/core`): a lógica que não depende de tela (catálogo,
  formatação, planos, telefone, horários). A web importa pelos arquivos de
  `src/lib/*.js`, que só reexportam; o app importa `@mimo/core`.
- `src/pages/SessaoApp.jsx` e `src/lib/app.js` (na web): a outra ponta da ponte.
- `public/.well-known/assetlinks.json` e `apple-app-site-association`: a prova
  de que o app e o site são da mesma dona (links que abrem no app).

## Rodar no celular (desenvolvimento)

1. Uma vez: `cd apps/mobile && npm install`; depois copie `.env.example` para
   `.env` e preencha com os mesmos valores do `.env` da web.
2. `npx expo start` abre um QR. No celular, o app **Expo Go** (Play Store) lê o
   QR e roda a MIMO na hora, sem build. Tudo o que o app usa roda no Expo Go.
3. A ponte abre a web publicada (`EXPO_PUBLIC_WEB_URL`, padrão `https://mimo.com.vc`).
   Para ver a web local dentro do app: na raiz do repo `npm run dev -- --host`,
   e no `.env` do app `EXPO_PUBLIC_WEB_URL=http://IP-DO-SEU-PC:5173` (mesma rede Wi-Fi).
4. Variante pro: `APP_VARIANT=pro npx expo start` (no PowerShell:
   `$env:APP_VARIANT='pro'; npx expo start`).

Antes de subir código: `npm run tipos` (TypeScript), `npm run lint`,
`npm run doctor` e `npm run empacotar` (empacota como na loja, em `dist/`).

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

## Como a ponte funciona (para quem for mexer)

`src/app/web.tsx` abre `WEB_URL/sessao-app?ir=/cliente/home` injetando
`window.__mimoSessao` (access + refresh token) antes de a página carregar.
A web (`src/pages/SessaoApp.jsx`) assume a sessão e segue para o caminho.
Dali em diante:

- **app → web**: o app renovou o token → `injectJavaScript` atualiza
  `window.__mimoSessao` e dispara o evento `mimo:sessao`; a web chama `setSession`.
- **web → app**: `postMessage` em JSON: `{ tipo: 'sessao', access_token, refresh_token }`
  (login feito na web, como no cadastro), `{ tipo: 'sair' }`, `{ tipo: 'fechar' }`,
  `{ tipo: 'abrir', url }`, `{ tipo: 'titulo', texto }`.
- Dentro do app a web **não renova o token sozinha** (`autoRefreshToken` desligado
  em `src/lib/supabase.js` quando existe `window.ReactNativeWebView`): quem renova
  é o app. Dois clientes disputando o mesmo refresh token derrubariam a sessão dos dois.
- A WebView só navega dentro de `WEB_URL`; WhatsApp, mapa, telefone e outros
  sites vão para o sistema. O token nunca é injetado fora da MIMO.
- A web sabe que está no app: `html.mimo-app` no CSS, `window.__mimoApp`
  (`{ variante, versao, plataforma }`) e `MIMOApp/<versão>` no User-Agent.

## O que vem depois

1. **Avisos nativos** (FCM): `expo-notifications`, uma tabela de tokens do app e a
   `enviar-push` mandando também pelo Expo Push. Até lá os lembretes seguem
   chegando pelo WhatsApp e pelo push da web (PWA).
2. **MIMO Pro**: a variante já existe; faltam as abas de quem atende (agenda do
   dia, encaixe, pedidos). O resto abre na ponte, como aqui.
3. Mais telas nativas na cliente (agendar sem sair do app) conforme o uso mostrar.
4. **iPhone**: mesma base. Precisa da conta Apple Developer (US$ 99/ano); a build
   é na nuvem do EAS, sem Mac.
