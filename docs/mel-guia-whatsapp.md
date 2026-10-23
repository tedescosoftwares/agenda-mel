# A Mel (WhatsApp do guia) — o que a gente adicionou (3.51 → 3.54.1)

Documento de referência do comportamento da Mel no WhatsApp do guia e de tudo que
virou **configurável na Plataforma** (aba **Guia de salões → WhatsApp**) nas versões
3.51 a 3.54.1. A base (a Mel pré-atende quem veio de um salão fora da MIMO e passa o
pedido ao salão) é da 3.48 (migração 195); aqui está o que evoluiu depois.

> **Onde fica:** Plataforma → **Guia de salões** → aba **WhatsApp**.
> **Motor:** `supabase/functions/_shared/guia_whats.ts` (roda no `whatsapp-webhook`).
> **Config:** tabela `guia_whats_config` (uma linha, id = 1).

---

## 1. Resumo rápido (o que mudou)

| Versão | O que entrou |
|---|---|
| **3.51** | O **ciclo da conversa** configurável: dúvidas depois do envio, encerrar por "sem avançar", esquecer conversa parada, mensagem de encerramento, exigir ou não a preferência. |
| **3.52** | O **ocioso ativo**: parada um tempo → a Mel pergunta "posso encerrar?"; sem resposta → encerra. Precisa de um **relógio (cron)** na VPS. |
| **3.53** | **Salão sem WhatsApp** (ou com o número da própria cliente) não vira pedido no vazio: fica "sem contato" e a Mel **avisa a equipe**. |
| **3.54 / 3.54.1** | A Mel **reconhece a própria dona** testando o salão e apresenta a **MIMO Agenda**; dá pra testar isso no **Simulador** sem celular. |

---

## 2. Os campos da aba WhatsApp

Todos editáveis e salvos em `guia_whats_config`. Os **novos** desta leva estão marcados.

### Conexão e básico (já existiam)
- **Ligado**, **Número do WhatsApp do guia**, **Instância na Evolution**.
- **Botões que passam pela MIMO** (WhatsApp, Ligar, Quero marcar).
- **IA que atende** (Groq/Claude) e **Modelo**.
- **Orientação da Mel** (texto livre; `{salao}` vira o nome).
- **Mensagem que o botão do site deixa escrita** (`msg_cliente`).
- **Mensagem que o salão recebe** (`msg_salao`; aceita `{cliente} {servico} {preferencia} {observacao} {contato} {link} {salao}`).
- **Resposta quando o salão responde** (`msg_salao_resposta`).
- **Limite de pedidos por dia**, **Respostas da Mel por número por dia**, **Guardar conversas (dias)**, **A cliente recebe o contato do salão no fim**.

### O ciclo da conversa — 3.51 🆕
- **Só enviar ao salão com a preferência de dia e horário** (`exigir_preferencia`, padrão **desligado**): desligado, basta **nome e serviço** para enviar; a preferência vira um extra.
- **Dúvidas que a Mel responde depois de enviar** (`pos_envio`, padrão **3**): depois disso, uma despedida e silêncio.
- **Mensagens sem avançar antes de encerrar** (`max_sem_avanco`, padrão **6**): se a conversa não anda (sem dado novo e ainda sem o essencial), a Mel insiste com gentileza e, no limite, encerra com carinho.
- **Esquecer a conversa parada depois de (horas)** (`ocioso_horas`, padrão **24**): rede de segurança; passando disso, a cliente recomeça do zero.
- **Mensagem ao encerrar a conversa** (`msg_encerramento`).

### O ocioso ativo — 3.52 🆕
- **Encerrar sozinha as conversas paradas** (`ocioso_ativo`, padrão **desligado**): liga o fluxo ativo. **Precisa do relógio na VPS** (ver seção 4).
- **Parada há (min), a Mel pergunta se pode encerrar** (`ocioso_perguntar_min`, padrão **60**).
- **Sem resposta por mais (min), encerra e fecha** (`ocioso_encerrar_min`, padrão **120**).
- **Mensagem "posso encerrar?"** (`msg_ocioso`): a Mel manda quando a conversa fica parada; se a cliente responder, a conversa continua.

### Avisos à equipe — 3.53 🆕
- **WhatsApp da equipe para avisos** (`numero_avisos`): recebe o aviso quando um salão não tem WhatsApp (ou é o número da cliente) e quando a **dona** testa o guia. **Vazio = sem aviso** (só a entrada na lista de pedidos).

### A dona testando — 3.54 🆕
- **Mensagem para a própria dona testando** (`msg_dona`): quando quem escreve está no número cadastrado do salão. `{salao}` vira o nome; `{exemplo}` vira o exemplo de como um pedido chegaria (montado a partir de "Mensagem que o salão recebe").

---

## 3. Como a Mel decide (o fluxo)

Quando chega uma mensagem no número do guia, nesta ordem:

1. **Salão respondendo a um pedido** (QUERO / SAIR / texto) → guarda a thread, responde uma vez.
2. **"Apagar meus dados"** → apaga tudo da pessoa.
3. **Salão que já agenda pela MIMO** → manda o link da agenda.
4. **A própria dona testando** (número de quem escreve == cadastrado do salão) → **reconhece, mostra o exemplo, apresenta a MIMO Agenda** e avisa a equipe (3.54).
5. **Conversa normal com a cliente:**
   - Teto de respostas do dia (`limite_respostas`): avisa uma vez e silencia.
   - Depois do envio: mais `pos_envio` dúvidas, depois despedida e silêncio.
   - **Sem avançar:** sem dado novo e ainda sem o essencial → conta; em `max_sem_avanco`, encerra com `msg_encerramento` (3.51).
   - Coleta o **essencial** (`exigir_preferencia` decide se precisa da preferência), mostra o **resumo**, e no **"sim"** manda o pedido ao salão.
6. **Envio ao salão:**
   - Salão **com WhatsApp** (número diferente da cliente) → pedido vai pro salão.
   - Salão **sem WhatsApp**, ou **número == o da cliente** → **sem contato**; a cliente segue normal e a equipe é avisada no `numero_avisos` (3.53).

**Ocioso ativo (3.52), fora do fluxo de mensagem:** um relógio varre as conversas paradas e, pela Evolution, manda a pergunta "posso encerrar?" (passou `ocioso_perguntar_min`) ou o encerramento e fecha (passou `ocioso_encerrar_min` desde a pergunta). Qualquer resposta da cliente zera a marca.

---

## 4. O relógio do ocioso (cron na VPS)

A Mel **só fala quando chega mensagem**. Para ela cutucar sozinha uma conversa parada, algo precisa chamá-la de tempos em tempos — igual ao `republicar-se-mudou.sh`.

```bash
cd evolution
# precisa de VITE_SUPABASE_URL e EVOLUTION_WEBHOOK_TOKEN no .env (o mesmo segredo do webhook)
./cutucar-ociosas.sh            # roda uma vez (mostra quantas perguntou/encerrou)
./cutucar-ociosas.sh --cron     # instala no cron: a cada 5 minutos (log em cutucar.log)
./cutucar-ociosas.sh --sem-cron # tira do cron
```

Enquanto esse cron não estiver no ar, deixe **"Encerrar sozinha as conversas paradas"** desligado — o resto do ciclo (3.51) não depende dele e continua valendo.

Por baixo: o script chama `whatsapp-webhook?tarefa=ociosas&token=<EVOLUTION_WEBHOOK_TOKEN>`, que roda `guia_whats_ociosas()`, manda as mensagens pela Evolution e marca com `guia_whats_ociosa_feita()`.

---

## 5. Como testar

### No Simulador da Plataforma (sem celular) — ótimo para o básico e para a dona
Aba **WhatsApp → "Testar a Mel"**. Converse como cliente; no "sim", você vê a mensagem que o salão receberia (nada é enviado).
- **Testar como a dona:** marque **"Testar como a dona deste salão"** e comece. A Mel reconhece, mostra o exemplo e o pitch da MIMO Agenda; a **prévia do aviso à equipe** aparece embaixo (precisa do `numero_avisos` preenchido para a prévia; nada é enviado de verdade).
- **Limitações:** o Simulador roda em modo teste, então **não** exercita o envio real ao salão nem a decisão "sem contato". Para isso, teste no WhatsApp.

### No WhatsApp (de verdade) — para envio ao salão, "sem contato" e a dona por número
Pré-requisitos: guia **Conectado** e **Ligado**, `numero_avisos` preenchido, migrações + funções + site publicados.

- **Dona testando:** ponha o seu número de teste como o **WhatsApp cadastrado** de um salão; do seu celular, abra a página desse salão no guia e toque no botão (ou mande o código/nome do salão). → fluxo da dona + aviso à equipe.
- **Cliente normal:** mande sobre um salão com WhatsApp **diferente** do seu. No "sim", o pedido vai pro salão. ⚠️ Envia WhatsApp **de verdade** — use um salão de teste com um **segundo número seu**.
- **Salão sem WhatsApp:** mande sobre um salão sem WhatsApp no cadastro (ou cujo número seja o seu). Vira **"sem contato"** + aviso à equipe.

### Onde conferir
- No WhatsApp: a resposta da Mel e o aviso no número da equipe.
- Plataforma → Guia → WhatsApp: **Conversas com a Mel** e a lista de **Pedidos** (inclui os "sem contato").

---

## 6. O que subir (deploy)

A ordem de sempre (você roda):

1. **bat B** — aplica as migrações novas: **199, 200, 201, 202, 203, 204**.
2. **bat 9** — publica as funções: **whatsapp-webhook** (ganhou `?tarefa=ociosas` e, na 3.55, o agente de onboarding antes da Mel) e **guia-whats** (simular com "como a dona"; na 3.55, `simular_onboarding`/`reiniciar_onboarding`).
3. **bat 2** — publica a Plataforma (versão **3.56.0**).
4. **VPS (opcional, para o ocioso ativo):** `cd evolution && ./cutucar-ociosas.sh --cron` (com `EVOLUTION_WEBHOOK_TOKEN` no `.env`).
5. Na aba WhatsApp: preencha **"WhatsApp da equipe para avisos"**, revise os textos (encerramento, "posso encerrar?", mensagem da dona) e ligue o ocioso quando o cron estiver no ar.

---

## 7. Referência técnica

### Migrações (Supabase)
- **199** `199_mel_ciclo_conversa.sql` — campos `pos_envio`, `max_sem_avanco`, `ocioso_horas`, `msg_encerramento`, `exigir_preferencia`; `guia_whats_contexto` usa a janela configurável.
- **200** `200_mel_ocioso_ativo.sql` — `ocioso_ativo`, `ocioso_perguntar_min`, `ocioso_encerrar_min`, `msg_ocioso`; coluna `guia_whats_conversas.cutucada_em`; funções `guia_whats_ociosas()` e `guia_whats_ociosa_feita()`; `guia_whats_conversa_salvar` zera `cutucada_em`.
- **201** `201_salao_sem_whats_aviso.sql` — `numero_avisos`; `guia_whats_lead_criar` marca `sem_contato` quando o salão não tem WhatsApp **ou** o número é o da cliente.
- **202** `202_mel_dona_testando.sql` — `msg_dona` (`{salao}`, `{exemplo}`).
- Todas atualizam `guia_whats_salvar` para aceitar os novos campos. (Pacotes `setup_completo.sql` e `atualizacao_*.sql` reempacotados.)

### Motor e funções
- `supabase/functions/_shared/guia_whats.ts` — fluxo, `chaveDe()` (compara número da cliente com o do salão), `avisoEquipe()`/`avisoDona()`, detecção da dona, ciclo configurável, ocioso.
- `supabase/functions/whatsapp-webhook/index.ts` — `?tarefa=ociosas` (o relógio).
- `supabase/functions/guia-whats/index.ts` — `simular` repassa `comoDona`.

### Plataforma e demo
- `src/components/plataforma/guia/WhatsAppGuia.jsx` — todos os campos novos e o Simulador com "testar como a dona".
- `src/lib/demoGuiaWhats.js` — espelho do demo.
- `src/lib/versao.js` — **3.54.1-mimo**.

### VPS
- `evolution/cutucar-ociosas.sh` — o relógio do ocioso (`--cron` / `--sem-cron`).
- `evolution/LEIAME.md` — seção "O relógio do ocioso da Mel".

---

## 8. Regras que não mudam (lembretes)
- Nada vai ao salão sem o **"sim"** da cliente depois do resumo (LGPD).
- A Mel **nunca** passa o telefone do salão à cliente.
- "Apagar meus dados" apaga tudo da pessoa; **SAIR** tira o salão.
- A política de privacidade fala em **90 dias** de guarda e que a Mel se apresenta como **MIMO** — se mudar a retenção para mais, atualize a política.

---

## 9. 3.55 — O agente de onboarding pelo WhatsApp (migração 203)

### O que é
Um **segundo agente no mesmo número da Mel**, separado dela: persona, contexto, passos, mensagens e configuração próprios (aba **Onboarding** da Plataforma). Enquanto a Mel-cliente anota um pedido e passa ao salão, este atende a **profissional** (dona de salão ou autônoma) que quer criar a conta na MIMO Agenda — e faz o cadastro conversando. **Senha nunca pelo WhatsApp:** no fim ele manda um link seguro (`mimo.com.vc/comecar?c=<token>`, com validade) que abre o `/comecar` já pré-preenchido; na tela ela só cria a senha, aceita os termos e escolhe o plano.

### Como a mensagem chega ao agente (o webhook decide, antes da Mel)
1. Já existe uma **conversa de onboarding aberta** deste número (48 h desde a última mensagem) → continua nela.
2. A mensagem traz um **gatilho** (`gatilhos` na aba): o **1º gatilho é a frase do botão** das landings (origem *cta*: intenção certa, começa direto); qualquer outro é **intenção percebida** (origem *intencao*): o agente **primeiro pergunta** se ela quer mesmo criar a conta — quem é cliente diz que não e volta à Mel, sem ser arrastada.
3. Nada disso → a Mel-cliente, como sempre. Qualquer erro no agente (a migração 203 ainda não aplicada, por exemplo) também passa para a Mel: o agente novo nunca derruba o atendimento da cliente.

### Os passos
tipo (autônoma ou salão) → **CNPJ** (dígito verificador; consulta na Receita pela BrasilAPI; **só ATIVA passa** — baixado, inapto, suspenso, nulo ou não encontrado é recusado e pedido de novo; se a consulta estiver fora do ar, tenta de novo e, se persistir, **não aceita no escuro**) — ou **"não tenho"** → **CPF** (dígito validado; o Asaas valida de fato ao cobrar) → endereço (o do CNPJ, mostrado para confirmar; ou pedido) → nome do negócio (sugere o fantasia do CNPJ) → nº de profissionais → serviços (e explica que o cadastro completo é no painel) → horários → e-mail (validado) → explicações (link próprio, QR code, lembretes; tira dúvidas) → **o link**. Serviços, horários, e-mail e explicações são opcionais (toggles); o texto de cada passo é editável.

### O que é determinístico e o que é IA
Sem IA: gatilhos, o sim/não da confirmação, CPF/CNPJ/e-mail, a consulta do CNPJ, o "sim" do endereço, a tolerância, o link, o reenvio ("não recebi"). A IA conversa: lê texto livre, agradece e faz a pergunta do passo seguinte, explica — guiada pela orientação e pelo texto de cada passo. Quando o sistema já leu a mensagem (um dado entrou), a IA é avisada e **não extrai nada dela** (senão "sim" vira nome de salão).

### Tolerância
`tolerancia` (padrão 3) e `tolerancia_cnpj` (padrão 3): **encerra na N-ª resposta inválida seguida** — ela lê o motivo e a despedida (`msg_encerrar`) — e a **equipe recebe um aviso** no WhatsApp de avisos (`numero_avisos`, aba WhatsApp) com o passo em que parou. Conversa que não anda por `tolerancia + 3` mensagens também encerra. Os contadores zeram a cada resposta válida.

### A aba Onboarding (Plataforma)
Ligar (exige a Mel ligada e com número), IA e modelo, orientação (persona), gatilhos (uma frase por linha; a 1ª é a do botão), tolerâncias, validade do link, os 9 passos (texto e liga/desliga), as 9 mensagens fixas, o **simulador** (pelo botão ou por intenção; a consulta de CNPJ é de verdade; os avisos voltam como prévia) e **quem entrou** (origem, estado, onde parou, link enviado/aberto, conta criada, atendida pela equipe, a conversa). CPF aparece mascarado.

### O `/comecar?c=token`
Lê o rascunho (`guia_onboarding_por_token`, pública, só com o link enviado e dentro da validade) e preenche tipo, CNPJ ou CPF, razão social, nome, endereço, e-mail e WhatsApp; mostra "Preenchi com o que você me contou pelo WhatsApp". O token fica no navegador: no `/onboarding`, quando a conta nasce, o rascunho é amarrado ao salão (`guia_onboarding_concluir`) e horários/serviços/nº de profissionais aparecem como lembrete (o nº já entra no passo 4).

### As landings
Botão **"Criar conta pelo WhatsApp"** (herói e chamada final das páginas `/agenda-para-*`), que abre o número da Mel com a frase do 1º gatilho. Só aparece com o agente ligado (`guia_onboarding_publico`).

### Referência técnica
- **203** `203_guia_onboarding.sql` — `guia_onboarding_config` (uma linha), `guia_onboarding_leads` (conversa + rascunho + token + vínculo); `guia_onboarding_publico` (anon), `guia_onboarding_por_token` (anon), `guia_onboarding_concluir` (authenticated, só o dono do salão); `contexto`, `conversa_salvar`, `gerar_link`, `apagar` (service role); `painel`, `lead`, `lead_atendido`, `config_salvar` (Plataforma).
- `supabase/functions/_shared/guia_onboarding.ts` — o motor (`atenderOnboarding`, `validarCpf/validarCnpj`, `consultarCnpjDe` (BrasilAPI), `iaOnbDe`).
- `supabase/functions/_shared/ia_json.ts` — a chamada da IA com esquema JSON, agora compartilhada pelos dois agentes (`guia_whats.iaDe` virou um atalho dela).
- `whatsapp-webhook/index.ts` — o agente olha primeiro; `acao: 'passa'` → Mel. `guia-whats/index.ts` — `simular_onboarding`, `reiniciar_onboarding`.
- `src/components/plataforma/guia/OnboardingGuia.jsx`, `src/lib/demoGuiaOnboarding.js`, `src/lib/guiaOnboarding.js` (público), `src/components/site/Whats.jsx` (`BotaoCriarContaWhats`), `src/pages/Onboarding.jsx` (`?c=token`).
- Versão **3.55.0-mimo**.

---

## 10. 3.56 — Contexto, CEP, pausa e confirmações (migração 204)

Do feedback de uso do agente de onboarding: ele estava cru em quatro pontos.

### Contexto: conferir antes de aceitar (`guia_onboarding_conferir`)
- **Número de quem escreve** já é de um perfil ou de um salão (telefone ou WhatsApp cadastrados, com ou sem o 9º dígito) → não é onboarding, é atendimento: `msg_numero_em_uso` com o link do **WhatsApp do atendimento** (`numero_atendimento`, na aba), a conversa encerra e a equipe é avisada. Roda a cada entrada nova.
- **CPF ou CNPJ já cadastrado** → `msg_documento_em_uso` + atendimento; encerra (sem gastar a consulta da Receita).
- **E-mail já cadastrado** (auth ou salão) → `msg_email_em_uso`; ela pode mandar outro (não conta como erro).
- **Nome do salão já existe** (pelo slug: "Studio X" = `studio-x` = o subdomínio) → `msg_nome_em_uso` com a cidade; pede outro.
- Num banco sem a 204 nada é conferido e o fluxo segue.

### Endereço pelo CEP
Sem CNPJ (ou quando o endereço do CNPJ não é o de atendimento): `msg_cep` → ela manda o CEP → BrasilAPI (`consultarCep`) → `msg_cep_numero` com rua/bairro/cidade → só o número (e complemento). CEP curto, de dígitos repetidos ou inexistente → `msg_cep_invalido` (conta na tolerância); consulta fora do ar não conta. "Não sei o CEP" → o endereço escrito, pela IA.

### Pausa e bolhas
`pausa_seg` (0–30 s; padrão 2) e `bolhas` (cada parágrafo numa mensagem). O webhook manda cada bolha com o `delay` da Evolution — ela vê "digitando…" antes de cada uma (`canais.ts` ganhou `atraso`). O simulador mostra as bolhas.

### Confirmações
- **E-mail**: validado, conferido e **confirmado de volta** (`msg_email_confirmar`): "sim" fecha; outro e-mail recomeça; "não" pede o certo.
- **WhatsApp do salão** (passo `telefone`, `com_telefone`): `msg_telefone` pergunta se é o número de onde ela fala, com a orientação de que precisa ser o WhatsApp do salão (a MIMO se conecta a ele para confirmações e lembretes); outro número é validado e conferido (um número de outra conta não serve); depois `msg_telefone_extra` (um telefone a mais, opcional).
- **Resumo** (passo `resumo`, `com_resumo`): `msg_resumo` com tudo anotado antes do link; "sim" manda o link; uma correção (e-mail, nome, endereço, profissionais, serviços, horários, telefone) é anotada e o resumo volta — e-mail corrigido pede confirmação de novo.

### Referência técnica
- **204** `204_onboarding_contexto_e_pausa.sql` — colunas novas em `guia_onboarding_config` (`numero_atendimento`, `pausa_seg`, `bolhas`, `com_telefone`, `com_resumo`, `passo_telefone`, `passo_resumo`, 12 `msg_*`); `guia_onboarding_conferir(tel_, email_, documento_, nome_)` (service role); `guia_onboarding_config_salvar` recriada.
- `guia_onboarding.ts` — `consultarCepDe`, `telefoneDe`, `montarResumo`, `dividir` (bolhas); a saída traz `bolhas` e `pausa`. `canais.ts` — `Envio.atraso`. `whatsapp-webhook` — manda as bolhas com a pausa. `guia-whats` — `consultarCep` no simulador.
- Aba Onboarding — WhatsApp do atendimento, pausa, bolhas, os passos telefone/resumo e as mensagens novas; `demoGuiaOnboarding.js` espelha tudo.
- Versão **3.56.0-mimo**.
