# E-mails do login (Supabase Auth) com a cara do MIMO

Os e-mails de **confirmar cadastro**, **senha nova**, **trocar e-mail**,
**link mágico** e **convite** são gerados pelo Supabase Auth — é ele que
sabe o token. O que dá para mudar é *por onde saem* (Resend, com o
nosso domínio) e *como são* (estes modelos).

## 1. Saída pelo Resend (5 minutos)

Painel do Supabase → **Authentication → Settings → SMTP Settings** → ligar
**Enable Custom SMTP**:

| campo | valor |
|---|---|
| Sender email | `oi@mimo.com.vc` |
| Sender name | `MIMO` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a chave da API do Resend (`re_...`) |

Antes disso o domínio `mimo.com.vc` precisa estar **Verified** no Resend.

Efeitos: sai do remetente genérico do Supabase; some o limite de
poucos e-mails por hora do SMTP padrão (em **Authentication → Rate
Limits** dá para subir); e o "Load failed" no cadastro, que era a
lentidão desse SMTP, desaparece.

## 2. Os modelos

Painel → **Authentication → Email Templates**. Para cada aba, cola o
**Subject** (está na primeira linha de cada arquivo, no comentário) e o
HTML inteiro do arquivo no campo **Message body**:

| aba no painel | arquivo |
|---|---|
| Confirm signup | `confirmar-cadastro.html` |
| Reset password | `senha-nova.html` |
| Change email address | `trocar-email.html` |
| Magic link | `link-magico.html` |
| Invite user | `convite.html` |

As variáveis `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}` e
`{{ .SiteURL }}` são preenchidas pelo Supabase na hora do envio.

## 3. Os links têm de voltar para o domínio certo

**Authentication → URL Configuration**:

- Site URL: `https://mimo.com.vc`
- Redirect URLs: `https://mimo.com.vc/**`

Sem isso o botão do e-mail leva para o endereço antigo.

## E se quiser 100% em código?

Existe o **Send Email Hook** (Authentication → Hooks): o Supabase para
de mandar e chama uma Edge Function nossa com o token; a função monta o
e-mail e envia pelo Resend, igual ao `enviar-email`. Ganha-se modelo em
código e o mesmo visual do resto; perde-se a simplicidade. Vale quando
os modelos passarem a ser editados pela plataforma.
