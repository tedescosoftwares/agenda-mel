# E-mails do Supabase Auth com a cara da MIMO

Estes são os e-mails que o próprio Supabase manda (confirmar cadastro, senha nova,
trocar e-mail…). Eles não passam pelo nosso código: o texto mora no painel.

Onde colar: **Supabase › Authentication › Email Templates**. Pra cada modelo,
cole o assunto no campo *Subject heading* e o HTML inteiro do arquivo no *Message body*.

| Modelo no painel | Arquivo | Assunto |
| --- | --- | --- |
| Confirm signup | `confirmar-cadastro.html` | Confirme seu e-mail e entre na MIMO 💗 |
| Reset password | `redefinir-senha.html` | Criar uma senha nova na MIMO |
| Magic Link | `link-magico.html` | Seu link pra entrar na MIMO |
| Change Email Address | `trocar-email.html` | Confirme o novo e-mail da sua conta MIMO |
| Invite user | `convite.html` | Você foi convidada pra MIMO 💗 |

As variáveis entre chaves (`{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`,
`{{ .Data.full_name }}`) são do Supabase e ele preenche na hora de mandar. Não mude.

Depois de colar, use *Send test email* em cada modelo pra conferir. O remetente e o
nome vêm de *SMTP Settings* (contato@mimo.com.vc · MIMO).

Os outros e-mails da MIMO (avisos, acesso da equipe, boas-vindas) já saem com esta
mesma moldura pelo nosso código: `email_layout` em `058_email_de_avisos.sql`.
