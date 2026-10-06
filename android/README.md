# MIMO no Android (Play Store)

A MIMO continua sendo uma só: o site/PWA que já roda em `pro.mimo.com.vc` e `mimo.com.vc`.
Cada app Android é um **Trusted Web Activity (TWA)**: um pacote nativo, assinado, publicado na
Play Store, que abre a PWA em tela cheia (sem barra de endereço), com ícone, splash, atalhos e
os avisos push que já existem. Nenhuma tela é reescrita; cada deploy do site (bat 2) já atualiza
os apps, sem passar pela loja.

## A premissa

A **web continua sendo a porta de entrada** e o **desktop continua sendo a casa da gestão do
salão** (80% ou mais do uso administrativo). Os apps da loja são mais um jeito de chegar na
mesma MIMO: mesmo código, mesmo deploy, mesmas telas. Nada do que está feito muda de lugar, e o
desenvolvimento segue exatamente como está; a loja só ganha carona.

## O ecossistema: dois apps, não três

| App na loja | Pacote | Abre | Quem usa |
|---|---|---|---|
| **MIMO Pro** | `vc.com.mimo.pro` | `pro.mimo.com.vc` | Donas de salão **e** profissionais. É o mesmo login e o mesmo endereço: o app mostra o painel ou a agenda conforme o papel, e a dona que atende troca entre os dois. |
| **MIMO** | `vc.com.mimo` | `mimo.com.vc` | Clientes: encontram o salão, agendam, veem seus horários, recebem lembretes. |

Salão e profissional **não** viram dois apps: seria o mesmo site duas vezes (a Play Store barra
apps duplicados) e obrigaria a dona que atende a instalar dois. Salão e profissional convivem
no MIMO Pro; a cliente tem o dela.

> **Play Console: o nome do pacote não se define ao criar o app.** Ao "criar app" você escolhe
> nome, idioma e se é gratuito; o pacote (`vc.com.mimo.pro`) fica definido pelo **primeiro
> `.aab` que você sobe**, e aí não muda mais. Então o app que você já criou serve: se o nome
> for "MIMO Pro", suba o `.aab` do `android/mimo-pro`; se for "MIMO", o do `android/mimo-cliente`.
> O nome exibido dá para trocar depois na ficha; o pacote, não.

## O que está neste repo

| Caminho | O que é |
|---|---|
| `android/mimo-pro/twa-manifest.json` | A receita do MIMO Pro (Bubblewrap): pacote, cores, ícones, atalhos Agenda e Encaixe, versão. |
| `android/mimo-cliente/twa-manifest.json` | A receita do MIMO (clientes): atalhos Meus agendamentos e Entrar num salão. |
| `android/publicar-android.sh pro\|cliente` | Gera o `.aab` para subir no Play Console (`--subir` incrementa a versão). |
| `public/.well-known/assetlinks.json` | Prova para o Android de que cada app e o site são da mesma dona. **Precisa das impressões SHA-256** dos dois apps (abaixo). |

O projeto Android gerado (`app/`, gradle etc.) e os **keystores** ficam fora do git
(`.gitignore`). Cada app tem o seu keystore; ele é a identidade do app na loja: perder é perder
o app. Guarde em dois lugares seguros (gerenciador de senhas + backup offline).

## Passo a passo (uma vez)

1. **Ferramentas** (no seu PC, Windows serve):
   ```bash
   npm i -g @bubblewrap/cli
   ```
   Na primeira execução o Bubblewrap pergunta se pode baixar o JDK 17 e o Android SDK. Diga sim.

2. **Keystore**, um por app, dentro da pasta do app. Anote as senhas num lugar seguro.
   ```bash
   cd android/mimo-pro     && keytool -genkeypair -v -keystore mimo-pro.keystore     -alias mimo-pro     -keyalg RSA -keysize 2048 -validity 10000
   cd android/mimo-cliente && keytool -genkeypair -v -keystore mimo-cliente.keystore -alias mimo-cliente -keyalg RSA -keysize 2048 -validity 10000
   ```

3. **Gerar o projeto e o pacote** (comece pelo Pro):
   ```bash
   ./android/publicar-android.sh pro
   ./android/publicar-android.sh cliente
   ```
   Sai `android/mimo-<app>/app-release-bundle.aab` (para a loja) e um `.apk` (para instalar no
   seu celular e testar: `adb install app-release-signed.apk`).

4. **Play Console**: no app que você já criou (ou num novo), em **Teste interno**, suba o `.aab`. Adicione seu e-mail como testador e instale pelo link.

5. **Assinatura pelo Google (Play App Signing)**: ao subir o primeiro `.aab`, o Google passa a
   assinar o app com uma chave dele. Em **Configuração do app → Integridade do app**, copie a
   impressão **SHA-256 do certificado de assinatura do app** e também a da **chave de upload**.

6. **assetlinks.json**: cole as impressões de cada app em `public/.well-known/assetlinks.json`
   (formato `AA:BB:CC:…`), faça o deploy do site (bat 2) e confira em
   `https://pro.mimo.com.vc/.well-known/assetlinks.json`. Sem isso o app abre com a barra de
   endereço do Chrome (é o sinal de que a verificação falhou).
   > O nginx precisa servir essa pasta como arquivo estático com `Content-Type: application/json`
   > (não pode cair no fallback do `index.html`). Teste com `curl -I`.

7. **Ficha da loja**: ícone 512×512 (`public/pro-512.png`), gráfico de destaque 1024×500,
   4 a 8 capturas do celular (agenda, encaixe, pedidos, Mel), descrição curta e longa,
   categoria *Beleza*, e-mail de contato, política de privacidade (use
   `https://pro.mimo.com.vc/privacidade` (e os termos em `/termos/profissional`)), questionário de segurança de dados
   (coletamos nome, telefone, e-mail, agenda; não vendemos dados) e classificação etária.

8. **Produção**: promova a versão do teste interno para produção. A revisão do Google leva de
   horas a alguns dias na primeira vez.

## Cada nova versão

Só precisa de uma versão nova na loja quando mudar algo do **pacote** (ícone, cores, atalhos,
nome). Mudança de tela é deploy do site, como sempre.
```bash
./android/publicar-android.sh pro --subir       # versionCode +1, versionName = src/lib/versao.js
./android/publicar-android.sh cliente --subir
```
Suba o `.aab` novo no Play Console.

## O app da cliente: o que vale saber

- **O link do salão abre dentro do app.** Com o app instalado, `mimo.com.vc/v/CODIGO` (QR, link
  no WhatsApp, Instagram) abre direto no MIMO, sem navegador. É assim que "todo mundo entra no
  ecossistema": a profissional divulga o link de sempre e a cliente que tem o app cai nele.
- **Endereço próprio do salão** (`studiomel.mimo.com.vc`): o Android só reconhece como "do app"
  os domínios listados; subdomínios não aceitam curinga. Esses links abrem no app, mas numa aba
  do Chrome com a barra de endereço. Para a divulgação que mira o app, prefira `mimo.com.vc/v/CODIGO`
  (o QR já usa esse formato).
- **Avisos**: lembrete de véspera, confirmação e "sua vez" chegam pelo push que já existe, agora
  com o ícone do app.

## Perguntas que vão aparecer

- **Push funciona?** Sim: no Android o TWA usa o Chrome, e os avisos web push (VAPID) que já
  existem seguem funcionando, com o ícone do app.
- **E se um dia precisar de algo nativo** (biometria, contatos, compartilhar para o app,
  push via FCM sem depender do Chrome)? Aí o caminho é **Capacitor**: a mesma PWA dentro de um
  WebView com plugins nativos. Dá para migrar mantendo o `packageId`, então nada do que foi
  feito aqui se perde.
- **iPhone?** A App Store não aceita TWA. Hoje a PWA instala pelo Safari ("Adicionar à Tela de
  Início") e já funciona. Para a App Store o caminho também é o Capacitor, com conta Apple
  Developer (US$ 99/ano) e um Mac para gerar o build.
- **A versão do site tem a ver com a do app?** Não precisa, mas o script copia a versão do
  site para o `versionName` do app, para você bater o olho e saber de quando é.
