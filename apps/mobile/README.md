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
    entrar.tsx         e-mail e senha, ou Google; esqueci a senha (o link chega por e-mail); o aviso de conta de salão (3.65)
    auth/confirmado    mimo://auth/confirmado: o link "confirme seu e-mail" volta para o app com a sessão (3.66)
    cadastro.tsx       criar conta, com ou sem convite (3.65): quem é você (WhatsApp único), como você entra, confira o e-mail
    completar.tsx      o cadastro completo antes das abas: nome, WhatsApp e o aceite (quem entrou pelo Google, conta antiga sem aceite)
    ler-qr.tsx         a câmera lê o QR da profissional ou do salão
    (tabs)/index.tsx   Início: próximo horário, atalhos, novidades, promoções, salões, profissionais e destaques
    (tabs)/guia.tsx    Guia de salões (3.64): a cidade (lembrada; na primeira vez, pela conexão), busca, categorias, a lista
    (tabs)/horarios.tsx Horários: próximos e histórico por mês (as regras da web, ClienteAgenda)
    (tabs)/saloes.tsx  Salões que ela segue (os vínculos); seguir um novo pelo guia (o código e o QR ficam atrás de um toque)
    (tabs)/perfil.tsx  Perfil: foto, dados (WhatsApp, e-mail, aniversário), agendas, como ser avisada, ajuda
    agendar/           o fluxo de marcar, nativo: com quem → serviços → data → hora → confirmar → sucesso
                       (remarcar entra pela data; as regras são as da web, src/pages/cliente/Agendar.jsx)
    agendamento/[id]   a página de um horário (as regras da web, ClienteAgendamento)
    salao/[id]         a página do salão: capas, pagamento, endereço, serviços por categoria, equipe, sobre
    guia/[cidade]/[slug] a página de um salão do guia: fotos, endereço, horários, serviços, sobre, vizinhos;
                       "Agendar pela MIMO" (entra na agenda, origem guia) ou "Quero marcar pela Mel" (WhatsApp)
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
  src/components/          Tela (moldura das telas empilhadas), Localizacao (a primeira tela: por que a MIMO
                           pede a localização, 3.66), Trilha (passos), Calendario (mês),
                           Folha (a folha que sobe de baixo, e a Confirmacao), Avaliar, Convites,
                           Ciencia (o aviso que ela precisa ler antes de seguir)
  src/lib/             config (variante, env), supabase, tema (claro/escuro), formato, ponte, agendar, guia (os
                       dados do guia: o JSON do servidor, senão as funções públicas; entrar pelo guia),
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

## Publicar na Play Store (EAS) e atualizar por cima (OTA)

A ideia: **uma build na loja de vez em quando, e o resto chega por OTA**. A
build (`.aab`) é a casca nativa; o JS, as telas e os textos viajam pelo EAS
Update: você roda um comando, e os aparelhos pegam a versão nova na próxima
abertura (ou na hora, pela faixa "Reiniciar" que aparece por cima das abas quando
a atualização terminou de baixar; o app nunca reinicia sozinho no meio de um
agendamento). No Perfil, a linha da versão mostra "atualizada em dd/mm" quando o
que está rodando veio por OTA.

### Uma vez só

1. `npm i -g eas-cli` e `eas login` (a conta Expo).
2. `cd apps/mobile && eas init`: cria o projeto no Expo e mostra um `projectId`.
   Cole em `app.json`, dentro de `"expo"`: `"extra": { "eas": { "projectId": "..." } }`.
   (O CLI não escreve sozinho porque a configuração é dinâmica, `app.config.js`.
   O `app.config.js` monta a URL das atualizações a partir desse `projectId`.)
3. As variáveis do build ficam no Expo, não no git (o apk de teste usa as mesmas,
   do ambiente `production`):
   ```
   eas env:create --scope project --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_URL --value https://SEU-PROJETO.supabase.co
   eas env:create --scope project --environment production --visibility plaintext --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value SUA-ANON-KEY
   eas env:create --scope project --environment production --visibility plaintext --name EXPO_PUBLIC_WEB_URL --value https://mimo.com.vc
   ```
4. A chave de assinatura o EAS cria e guarda na primeira build
   (`eas credentials -p android` mostra). Não precisa de keystore na mão, e
   nenhuma chave entra no git.

### A build da loja

```
npm run build:teste   # .apk para instalar no seu celular e testar (canal preview)
npm run build:loja    # .aab para a loja (canal production; o versionCode sobe sozinho)
```

O `.aab` sobe à mão no Play Console: **Testar e lançar → Teste interno → Criar
nova versão**, envia o arquivo, salva, publica, e adiciona o seu e-mail na lista
de testadores (o link de teste instala pela Play Store). Depois, **Produção**.
Uma conta pessoal nova no Play passa antes por um **teste fechado** com um
número mínimo de testadores por 14 dias (o Console diz quantos) para liberar a
produção. `eas submit` (manda direto para o Teste interno) precisa de uma conta
de serviço do Google Cloud ligada ao Play Console; o JSON dela fica fora do git
e entra em `eas.json` (`submit.production.android.serviceAccountKeyPath`).

### Atualizar por cima (OTA)

```
npm run ota -- --message "3.64: o guia no app"      # os aparelhos com a build da loja
npm run ota:teste -- --message "testando o guia"    # só o .apk de teste (canal preview)
```

O que chega por OTA: tudo o que é JS e TS (telas, textos, regras, `packages/core`,
imagens importadas no código). O que **precisa de build nova**: pacote nativo
novo (`expo install` de algo com código nativo), permissão nova, mudança no
`app.json`/`app.config.js` (ícone, splash, nome, scheme, App Links, plugins) e
upgrade do SDK do Expo. A versão de runtime é por **fingerprint**
(`runtimeVersion: { policy: "fingerprint" }`): o EAS calcula uma impressão da
parte nativa; a atualização só vai para builds com a mesma impressão.
`fingerprint.config.js` tira da impressão o que não é nativo e muda toda hora:
a versão do app (vem de `src/lib/versao.js`), os scripts do `package.json`, o
`eas.json`, o `.gitignore`, a pasta `loja/`. Sem isso, cada entrega mudava a
impressão e a build da loja ficava sem receber atualização (foi o que aconteceu
na primeira build, 3.65.1). `npm run fingerprint` mostra a impressão atual;
`eas build:list --platform android --limit 1` mostra a da última build. Se as
duas diferem, a OTA não chega: é hora de `npm run build:loja`.

Cada `eas update` imprime o runtime version por plataforma; o painel do Expo
(Updates) mostra quantas builds têm aquele runtime.

Os canais são por perfil de build (`eas.json`): `preview`, `production`,
`pro-preview`, `pro-production`. Cada atualização vai para um canal; a build
instalada só escuta o dela. As variáveis `EXPO_PUBLIC_*` entram na hora do
`eas update` pela opção `--environment` (os valores do passo 3).

A versão do app (`versionName`) é a do site, lida de `src/lib/versao.js`; o
`versionCode` é do EAS (`appVersionSource: remote`) e sobe a cada build de produção.

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

## A cliente no mapa (3.66)

**Localização, pedida na abertura.** A primeira tela do app (`components/Localizacao.tsx`,
antes de entrar) explica para que a MIMO pede a localização (os salões, as
promoções e as ofertas mais perto, e a cidade do guia) e o que não faz com ela
(fica só no aparelho; nada do ponto vai para o servidor; não vendemos nem
repassamos dados). "Permitir" abre o pedido do sistema; a tela volta a cada
abertura enquanto a permissão não for dada (3.66.1), e "Continuar sem
localização" vale só para a sessão. Negada de vez, oferece "Abrir ajustes".
Obrigar não dá: o Play derruba app que trava tudo atrás da localização quando
ela não é o núcleo do produto, a LGPD pede consentimento livre e o sistema
deixa negar de qualquer jeito. No pagamento (antifraude) a exigência será ali,
ligada ao motivo, com a declaração de dados da loja e a política atualizadas.
`lib/localizacao.ts`: permissão, posição (a última conhecida, cache de 5 min),
distância, a cidade do guia pela posição (geocodificação reversa do aparelho).
Na aba Guia, com a permissão, a lista fica em ordem de distância e cada cartão
mostra "1,2 km"; sem a permissão, uma linha "Ative a localização" pede de novo
(ou abre os ajustes, se foi negada de vez). `expo-location` é nativo: precisa
de build nova. Demo: `EXPO_PUBLIC_DEMO=local` mostra a tela; nos outros cenários
a posição é o centro de Itanhaém.

**A página do guia abre.** Os cartões que vêm do servidor não trazem
`cidade_slug`; o app navega pela cidade da lista (e, nos vizinhos, pela cidade
da página). Antes caía em "página não existe".

**Salões que você segue.** O vínculo, para a cliente, é "seguir": a aba
Salões, o Perfil ("Deixar de seguir", "Seguir outro salão") e o Início (sem
salão, "Agendar" leva ao guia) falam assim. Cliente nova vê a aba vazia com o
convite para o guia.

**Confirmação de e-mail fluida.** O link "confirme seu e-mail" volta para o
app (`emailRedirectTo: mimo://auth/confirmado`, rota `auth/confirmado.tsx`)
com a sessão: abre já logado. Precisa de `mimo://auth/confirmado` nas Redirect
URLs do Supabase (Authentication → URL Configuration). Se o link abrir no
computador, a tela "falta só confirmar" entra sozinha: tenta o e-mail e a senha
a cada 12 s e ao voltar ao primeiro plano. E só um e-mail chega no cadastro: as
boas-vindas da MIMO esperam a confirmação (migração 211); o modelo sugerido do
e-mail de confirmação do Supabase está em `docs/emails/confirmar-cadastro.html`.

## Só a cliente entra (3.65)

O app MIMO é da cliente, e só dela. Não há multiambiente: uma conta de salão ou
de profissional que entra aqui (e-mail e senha, ou Google) é posta para fora na
hora, pela sessão (`context/sessao.tsx`: o perfil chega com `role` diferente de
`cliente`, o app sai e guarda o motivo em `lib/contaErrada.ts`), e a tela de
entrar explica: "o app MIMO é só para clientes; para o salão, pro.mimo.com.vc".
A abertura espera o perfil chegar antes de mostrar as abas (`_layout.tsx`), para
não piscar. Demo: `EXPO_PUBLIC_DEMO=dona`.

**Cadastro sem vínculo.** A conta nasce sozinha, sem convite (`cadastro.tsx`):
nome, WhatsApp (um por conta), e-mail, senha, aniversário opcional e o aceite.
Os vínculos vêm depois, pelo guia, pelo QR, pelo link `/v/CODIGO` ou pelo código
de seis letras. Quando o convite vem (QR ou link), o cartão "você vai entrar na
agenda de…" aparece e a conta já nasce vinculada; um código errado vira "seguir
sem o código". Na web é igual (`CadastroCliente.jsx`, e o botão "Criar conta
sem código" em `/entrar`).

**Cadastro completo.** Quem entra pelo Google chega sem WhatsApp e sem aceite;
uma conta antiga pode estar sem o aceite. Nos dois casos a tela
`completar.tsx` vem antes das abas (`precisaCompletar`, em `lib/oauth.ts`:
nome, WhatsApp e `aceitou_termos_em`) e chama `completar_perfil` (207).

## O guia dentro do app (3.64)

O app da cliente é a porta de descoberta: a aba **Guia** mostra os salões da
cidade dela (os mesmos dados do site, `mimo.com.vc/dados/guia/*.json`, e as
funções públicas `guia_cidades`, `guia_cidade` e `guia_pagina` quando o arquivo
não existe). A cidade fica lembrada no aparelho; na primeira vez vem pela
conexão (`site_minha_cidade`, sem guardar nada). Na página do salão:

- **Salão que agenda pela MIMO** (`lugar.mimo.salao_id`): "Agendar pela MIMO"
  chama `vincular_pelo_guia(salao_, lugar_)` (migração 210): o vínculo nasce com
  `como = 'guia'` e `guia_lugar_id` apontando para a página do guia por onde ela
  entrou (a origem fica registrada), e a página nativa do salão abre para ela
  marcar. O salão pode fechar essa porta (`salons.aberto_no_guia = false`: só
  por convite, código ou QR); a equipe do salão não entra como cliente.
- **Salão fora da MIMO**: "Quero marcar pela Mel" abre o WhatsApp da MIMO com o
  pedido pronto (a Mel do guia, 3.48, anota e passa ao salão). O WhatsApp do
  próprio salão só aparece quando a Mel está desligada.

O código de seis letras e o QR continuam valendo (`v/[codigo]`), só ficam atrás
de um toque na aba Salões. Links do site `/saloes/...` caem nas telas nativas
(`ponte.ts`: a cidade, a categoria, a página do salão; coleções e região caem na
aba do guia na cidade) e são App Links da variante cliente.

Vem depois: a página do guia apontar para o subdomínio do salão e a atendente
virtual do salão (069) com os recursos da Mel do guia. (Casar o salão do guia com
o salão da MIMO ganhou os dois caminhos em 3.67, abaixo.)

## Seguir pelo guia e "quero esse salão na MIMO" (3.67)

A página do salão no guia (`guia/[cidade]/[slug]`) passa a ter dois destinos,
conforme o salão agenda ou não pela MIMO (migração 212):

- **Salão da MIMO**: o botão vira **"Seguir e ver a agenda"**: a cliente entra
  na agenda do salão (`vincular_pelo_guia`, como antes) e cai na vitrine dele; a
  partir daí ela vê a agenda, as promoções e as novidades do salão no app (aba
  Salões, Início). Quando já segue, a página mostra o selo **"Você segue"** e o
  botão é só **"Agendar"** (`sigoSalao()` em `lib/guia.ts` lê `minhas_agendas`).
- **Salão fora da MIMO**: não dá para seguir. O cartão **"Quer esse salão na
  MIMO?"** explica e tem o botão **"Quero esse salão na MIMO"** (`guia_votar`):
  um pedido por cliente, com desfazer, e a contagem ("12 pessoas já pediram").
  O pedido fica em `guia_votos`, soma em `guia_lugares.votos` e vira métrica
  de abordagem na Plataforma: na **Abordagem**, cada salão mostra "N clientes
  pediram no app" como motivo, isso pesa na ordem da fila (10 por pedido, até
  60), e o número aparece no detalhe; em **Fatos do salão**, o total e o botão
  de promover. Sem conta, o toque leva a Entrar. Quem está logada vê o que já
  pediu (`guia_meus_votos`). O site público do guia ainda não tem o botão: fica
  para quando o guia divulgar o app (a função já aceita um token do navegador,
  `guia_votar(lugar_, token_)`, para essa hora).
- O chip **Instagram** já estava e continua (`linkInstagram`), com Como chegar e
  Site.

Os dois caminhos entre o guia e a agenda, na Plataforma:

- **Promover** (Guia de salões → Fatos do salão → "Promover a salão com
  agenda…"): `guia_promover(lugar_, dono_email_, tipo_)`, só a Plataforma. Pelo
  e-mail da conta da dona (ela cria antes, em `mimo.com.vc/comecar` ou no app):
  se ela já tem um salão sem página no guia, a página é ligada a ele; senão
  nasce um salão (`abrir_negocio_interno`, salão ou autônoma) com os dados do
  guia copiados (endereço, bairro, CEP, cidade, telefone, WhatsApp, Instagram,
  ponto no mapa, fotos, resumo) e ela vira a dona. Serve ao teste e à venda.
- **Espelhar** (Salões e autônomas → ícone do livro "Pôr no guia de salões"):
  `guia_espelhar_salao(salao_)`, Plataforma ou a dona. O salão da MIMO ganha a
  sua entrada no guia (`status = importado`, `origem.fonte = mimo`, ligada por
  `salon_id`), com a categoria pelo ramo e os serviços ativos; segue a fila de
  sempre (gerar o texto, revisar, aprovar). **Quem conclui o onboarding entra
  sozinho** (gatilho em `salons.onboarding_concluido_em`), e a página do guia
  já nasce "Agenda pela MIMO": a cliente segue por ela.

## O contato pelo WhatsApp fica registrado (3.68)

Num salão do guia que não agenda pela MIMO, "Quero marcar pela Mel" e "WhatsApp
do salão" não saem do app de uma vez: sobe a folha **"Você vai para o WhatsApp"**
(`Folha`, na página do salão), que explica quem atende (a Mel, atendente da
MIMO, ou o próprio salão), que **o contato fica registrado no app** (aba Salões,
lista "Contatos pelo guia"), que **depois a MIMO pergunta se o atendimento
aconteceu e que nota ela dá**, e que o salão não recebe nada do app (só a
mensagem dela no WhatsApp). "Ir para o WhatsApp" registra
(`guia_registrar_contato(lugar_, canal_)`, migração 213; o mesmo toque em dez
minutos não vira outro registro) e abre o link. Sem conta, a folha pede para
entrar e abre o WhatsApp do mesmo jeito.

Na aba Salões, **Contatos pelo guia** lista o que ela chamou (salão, pela Mel ou
WhatsApp do salão, quando) com **"Como foi?"**: a folha pergunta se o
atendimento aconteceu ("Não aconteceu" ou "Sim, fui atendida" e as estrelas) e
guarda em `guia_contatos` (`guia_responder_contato`). Esse é o lugar que a
pesquisa por push vai abrir, na próxima etapa: a tabela já tem `pesquisa_em`
para marcar quando o app perguntou.

Na Plataforma, a Abordagem ganha o sinal "N clientes chamaram pelo app" (motivo
e peso na fila, 5 por contato até 30; `guia_lista.contatos_app`) e o número no
detalhe; Fatos do salão mostra o total ao lado dos pedidos. As notas por salão
ficam para a próxima etapa, junto com o push.

## Explorar livre, categorias e a ordem do guia (3.69)

A aba Guia deixa de ficar presa à localização:

- **Onde você quer procurar?** O toque na cidade abre a folha com a busca
  ("Cidade ou região"), "Usar minha localização" e a lista por **região**
  (`regioes.json` do gerador, ou `guia_regioes()`), cada região com as cidades
  dela e o total; "Ver a região" abre a região; cidades sem região ficam em
  "Outras cidades". A cidade escolhida fica lembrada, como antes.
- **A região** mostra a chamada da Plataforma, as cidades dela em cartões (foto
  e total), as categorias somadas e os salões das cidades mesclados na ordem do
  guia (a primeira parte de cada cidade; "para ver todos, escolha a cidade").
- **Categorias em cartões** com a foto do melhor salão da categoria e o total
  (os mesmos blocos do site: `categorias[].foto` do JSON da cidade), na cidade e
  na região; o toque filtra e a lista ganha o título ("Unhas em Itanhaém").
- **Perto de você é um interruptor** (com a permissão dada) e respeita a
  hierarquia do guia em vez de só a distância (`lib/guiaOrdem.ts`): agenda pela
  MIMO → Seleção MIMO → com foto → sem foto; dentro de cada grupo, os mais perto
  primeiro; entre os com foto, faixas de 2 km e, na faixa, os pontos (foto +
  nota do Google, migração 185). Um salão sem foto não passa na frente de um com
  foto por estar 300 metros mais perto. Escolher outra cidade ou região na folha
  desliga o interruptor ("perto" é da posição dela); "Usar minha localização"
  liga de novo.
- **A ordem sem localização** é a do site (3.17): MIMO, Seleção, pontos. Os
  cartões do servidor já vêm nessa ordem; o gerador passa a pôr os **pontos** no
  cartão (`scripts/guia-fonte.mjs`, e `guia_cartao` na migração 214) para a
  mescla das regiões e as faixas do "perto" usarem a conta exata. Até a próxima
  republicação, vale a posição na lista.

## Categorias, regiões em cartões, paginação e cartões ricos (3.70)

- **Categorias com cara.** Cada categoria tem ícone e cor (`VISUAL` em
  `(tabs)/guia.tsx`): o cartão traz a foto do melhor salão com o ícone sobre
  ela; o ativo fica pintado na cor da categoria com o check. Com uma categoria
  escolhida, entra a **faixa da categoria** acima da lista (foto, nome por
  extenso, "57 salões em Itanhaém" e o botão "Todas").
- **Onde você quer procurar?** Primeiro os **cartões das regiões** (foto, nome,
  "N cidades · N salões"); tocar um filtra as cidades para as da região e mostra
  "Ver toda a região"; embaixo, as cidades (agrupadas por região, ou só as da
  região tocada), com a busca por nome e "Usar minha localização".
- **Paginação na tela.** 30 cartões por vez, com "N de M salões" e "Mostrar
  mais" (e ao chegar no fim). O servidor manda partes de 48; acabando a memória,
  vem a próxima parte. Com **"perto de você" ligado** (ou na busca), a **lista
  inteira** da cidade entra de uma vez (`/dados/guia/<cidade>/lista/todos.json`,
  240 KB numa cidade de 4 mil salões) para a ordem valer para todos, e a tela
  continua paginada; enquanto baixa, "Ordenando todos os salões pelos mais
  perto…" sobre a primeira parte.
- **Cartões dos salões** com foto maior, a categoria com o ícone, o bairro (e a
  cidade, na região), a distância em destaque, o resumo em duas linhas, até três
  serviços ("+n") e os selos Agenda pela MIMO e Seleção MIMO.
- Na demonstração, Peruíbe com 40 salões gerados (paginação e a lista inteira).

## O que vem depois

1. **Entrar com Apple** no app (o Google já entra; a web mostra a opção quando o
   provedor está ligado).
2. **MIMO Pro**: a variante já existe; faltam as abas de quem atende (agenda do
   dia, encaixe, pedidos).
3. **iPhone**: mesma base. Precisa da conta Apple Developer (US$ 99/ano); a build
   é na nuvem do EAS, sem Mac.
