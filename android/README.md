# MIMO no Android (Play Store)

A MIMO continua sendo uma só: o site/PWA que já roda em `pro.mimo.com.vc` e `mimo.com.vc`.
O app Android é um **Trusted Web Activity (TWA)**: um pacote nativo, assinado, publicado na
Play Store, que abre a PWA em tela cheia (sem barra de endereço), com ícone, splash,
atalhos e os avisos push que já existem. Nenhuma tela é reescrita; cada deploy do site
(bat 2) já atualiza o app, sem passar pela loja.

Primeiro app: **MIMO Pro** (`vc.com.mimo.pro`), o das profissionais e donas de salão.
As clientes seguem pelo link do salão (instalar app atrapalha a conversão de agendamento);
se um dia fizer sentido, um segundo TWA `vc.com.mimo` para `mimo.com.vc` é só repetir
esta pasta.

## O que está neste repo

| Caminho | O que é |
|---|---|
| `android/mimo-pro/twa-manifest.json` | A receita do app (Bubblewrap): pacote, cores, ícones, atalhos, versão. |
| `android/publicar-android.sh` | Gera o `.aab` para subir no Play Console (`--subir` incrementa a versão). |
| `public/.well-known/assetlinks.json` | Prova para o Android de que o app e o site são da mesma dona. **Precisa das impressões SHA-256** (abaixo). |

O projeto Android gerado (`android/mimo-pro/app/`, gradle etc.) e o **keystore** ficam
fora do git (`.gitignore`). O keystore é a identidade do app na loja: perder ele é perder
o app. Guarde em dois lugares seguros (gerenciador de senhas + backup offline).

## Passo a passo (uma vez)

1. **Ferramentas** (no seu PC, Windows serve):
   ```bash
   npm i -g @bubblewrap/cli
   ```
   Na primeira execução o Bubblewrap pergunta se pode baixar o JDK 17 e o Android SDK. Diga sim.

2. **Keystore** (dentro de `android/mimo-pro/`). Anote as duas senhas num lugar seguro.
   ```bash
   keytool -genkeypair -v -keystore mimo-pro.keystore -alias mimo-pro -keyalg RSA -keysize 2048 -validity 10000
   ```

3. **Gerar o projeto e o pacote**:
   ```bash
   ./android/publicar-android.sh
   ```
   Sai `android/mimo-pro/app-release-bundle.aab` (para a loja) e um `.apk` (para instalar no seu
   celular e testar: `adb install app-release-signed.apk`).

4. **Play Console → Criar app**: nome "MIMO Pro", idioma português (Brasil), app, gratuito.
   Em **Teste interno**, suba o `.aab`. Adicione seu e-mail como testador e instale pelo link.

5. **Assinatura pelo Google (Play App Signing)**: ao subir o primeiro `.aab`, o Google passa a
   assinar o app com uma chave dele. Em **Configuração do app → Integridade do app**, copie a
   impressão **SHA-256 do certificado de assinatura do app** e também a da **chave de upload**.

6. **assetlinks.json**: cole as duas impressões em `public/.well-known/assetlinks.json`
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
./android/publicar-android.sh --subir     # versionCode +1, versionName = src/lib/versao.js
```
Suba o `.aab` novo no Play Console.

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
