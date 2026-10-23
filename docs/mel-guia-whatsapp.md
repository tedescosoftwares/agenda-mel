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

1. **bat B** — aplica as migrações novas: **199, 200, 201, 202, 203, 204, 205, 206**.
2. **bat 9** — publica as funções: **whatsapp-webhook** (ganhou `?tarefa=ociosas` e, na 3.55, o agente de onboarding antes da Mel; na 3.57, o voto da enquete e a varredura dos pedidos) e **guia-whats** (simular com "como a dona"; na 3.55, `simular_onboarding`/`reiniciar_onboarding`; na 3.57, `simular_voto` e o Reenviar com a enquete).
3. **bat 2** — publica a Plataforma (versão **3.59.0**).
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

---

## 11. 3.57 — O retorno do salão: a enquete "vai atender?" e os avisos (migração 205)

Até aqui a gente só sabia que o salão **abriu o link** do pedido (`clicou_em`). Agora o salão **diz se vai atender**, e a Mel reage.

### A enquete
Logo depois da mensagem do pedido, o salão recebe uma **enquete do WhatsApp** (o único "botão" que a Evolution/Baileys renderiza em todo aparelho; já era o que o bot dos salões usava): pergunta `enquete_pergunta` ("Vai atender a {cliente}?") e as opções `enquete_sim` / `enquete_nao`, editáveis. A chave da mensagem da enquete fica no pedido (`guia_whats_leads.enquete_id`); quando o salão toca, o voto chega como `pollUpdateMessage` com essa chave → `guia_whats_voto` acha o pedido certo, sem depender de citação nem de interpretar "1".

- **O primeiro voto vale.** O WhatsApp não deixa travar o voto nem fechar a enquete; uma troca depois chega para a gente, mas só fica **anotada** (`voto_atual`, `voto_mudou_em`, visível na lista de pedidos) — não dispara nada de novo. A resposta da Mel em texto funciona como o "fechamento".
- Se a chave não casar (a Evolution não devolveu o id), vale o pedido que o contexto escolheu para aquele número, desde que ainda sem voto.
- **Por texto também:** um "não vou conseguir" / "não dá" / "sem agenda" ou um "vou atender" / "pode deixar" / "já chamei" claro conta como voto (`voto_origem = 'texto'`), só o primeiro e só no claro — na dúvida, fica na thread para a equipe. QUERO e SAIR continuam mandando.

### O que cada voto faz
- **Sim** → status `salao_vai_atender`; a Mel responde ao salão `msg_salao_vai_atender` ({cliente}, {salao}, {servico}, {preferencia}, {link} — o link rastreável de novo).
- **Não** → status `salao_nao_atende`; a Mel agradece (`msg_salao_nao_atende`); **avisa a equipe** no `numero_avisos` (`aviso_nao_atende`, `msg_aviso_nao_atende`); e, se `avisar_cliente_nao`, **avisa a cliente** (`msg_cliente_nao_atende`, {nome} = primeiro nome) e **reabre a conversa dela sem salão** (`guia_whats_conversa_reabrir`: estado `conversando`, sem lugar e sem pedido, nome/serviço/preferência mantidos, contadores zerados) — ela manda o nome ou o link de outro salão e a Mel já vai ao resumo. Um "não" nunca deixa a cliente no vácuo.
- Um texto depois do voto não rebaixa o status (`guia_whats_salao_respondeu`).

### O relógio: demora e cutucada
O mesmo `cutucar-ociosas.sh` (cron, `?tarefa=ociosas`) passa a chamar `guia_whats_pendentes()`: pedido `enviado` há mais de `aviso_demora_min` sem o salão **abrir o link, votar ou responder** → aviso à equipe (`msg_aviso_demora`, com {tempo}), uma vez (`aviso_demora_em`); `cutucar_salao_min` → cutucada no salão (`msg_cutucar_salao`, com {link}), uma vez (`cutucado_em`). 0 = desligado (padrão). Só olha até 2 dias depois do prazo (ligar o recurso não inunda a equipe com pedidos velhos). O ocioso desligado não impede a varredura dos pedidos.

### A aba WhatsApp
Bloco **"O retorno do salão"**: enquete (liga/desliga, pergunta, opções), as duas respostas ao salão, o aviso à cliente (liga/desliga + texto), o aviso à equipe no não (liga/desliga + texto), os dois tempos e os dois textos do relógio. KPIs **vão atender** / **não vão atender**. No pedido: "Vai atender · há 2 h · pela enquete" (ou "por texto"; e "depois mudou para…" quando trocou), "Enquete enviada · sem voto ainda", "Equipe avisada da demora", "Salão cutucado". No simulador: a enquete que iria junto do pedido e os botões **"Sim, vou atender" / "Não vou conseguir"**, que mostram o que o salão, a cliente e a equipe receberiam (nada sai).

### Referência técnica
- **205** `205_salao_vai_atender.sql` — colunas em `guia_whats_config` (`enquete_*`, `msg_salao_vai_atender`, `msg_salao_nao_atende`, `avisar_cliente_nao`, `msg_cliente_nao_atende`, `aviso_nao_atende`, `msg_aviso_nao_atende`, `aviso_demora_min`, `msg_aviso_demora`, `cutucar_salao_min`, `msg_cutucar_salao`) e em `guia_whats_leads` (`enquete_id`, `voto`, `voto_origem`, `votou_em`, `voto_atual`, `voto_mudou_em`, `aviso_demora_em`, `cutucado_em`); status `salao_vai_atender`/`salao_nao_atende`; `guia_whats_lead_enquete`, `guia_whats_voto`, `guia_whats_conversa_reabrir`, `guia_whats_pendentes`, `guia_whats_pendente_feita` (service role); `salao_respondeu`, `contexto` (traz `voto`), `painel` (totais `vao_atender`, `nao_atendem`, `demoraram`; campos do voto) e `salvar` atualizadas.
- `guia_whats.ts` — `enqueteDoPedido`, `votoDe` (1/2 ou o nome da opção), `votoDoTexto` (conservador), `respostasDoVoto`, `despacharPedido` (texto + enquete, usado no "sim" e no Reenviar), `avisoDemora`, `cutucadaSalao`, `trocarTudo`, `tempoBonito`, `simularVoto`; `Entrada.enquete`; `Deps.enviarEnquete`.
- `whatsapp-webhook` — o voto (`m.enquete`) vai direto à Mel (não passa pelo onboarding); `depsGuia.enviarEnquete` (sendPoll via `canais.ts`, `estilo: 'enquete'`); `?tarefa=ociosas` varre também os pedidos (`avisou_demora`, `cutucou` na resposta). `guia-whats` — `simular_voto`; `reenviar` manda a enquete junto.
- `WhatsAppGuia.jsx`, `demoGuiaWhats.js`, `guia-plataforma.css` (`.pg-wa-voto`, `.pg-wa-retorno`, `.pg-wa-enquete`, `.pg-wa-sim-voto`), `evolution/cutucar-ociosas.sh` (mensagem do log), `evolution/LEIAME.md`.
- Deploy: **bat B** (205) → **bat 9** (whatsapp-webhook, guia-whats) → **bat 2**. O cron já instalado não muda.
- Versão **3.57.0-mimo**.

---

## 12. 3.58 — A aba WhatsApp reorganizada

Sem mudança de banco nem de função: só a Plataforma (`WhatsAppGuia.jsx` e o bloco `.pg-wa-v2` em `guia-plataforma.css`). O que mudou de lugar:

- **Cabeçalho:** o estado da conexão, o número e a instância, a pílula "Ligado/Desligado no site" e as ações (Conectar/Reconectar, Desconectar, Conferir, Período). O pareamento (código/QR) aparece logo abaixo.
- **Números:** cartões com ícone (conversas, pedidos enviados, abriram, vão atender, não vão, responderam, querem a MIMO, enviados hoje com a barra do limite) e o **funil do pedido** (enviados → abriram o link → vão atender, com %).
- **Seções** (lembradas no navegador): **Pedidos** — filtros (todos, aguardando o salão, vão atender, não vão, querem a MIMO, com problema, atendidos), busca, e cada pedido com a **linha do tempo** (enviado → abriu o link → o retorno: voto pela enquete/por texto, enquete sem voto, salão respondeu), os avisos do relógio, a conversa do salão dobrável, "atendido" como chip e os atalhos; **Conversas**; **Testar a Mel** (o simulador com as dicas ao lado); **Configuração** — oito blocos (Conexão, No site, A Mel, O pedido ao salão, O retorno do salão, Ciclo e ocioso, Equipe e dona, Limites e privacidade), o índice lateral que acompanha a rolagem, interruptores e a **barra de salvar fixa** ("Tudo salvo · há X" / "Alterações sem salvar", com Descartar).
- Os ids de teste (`data-teste="wa-*"`) são os mesmos; os campos e as RPCs também. A aba Onboarding não mudou.
- Versão **3.58.0-mimo**.

---

## 13. 3.59 — A Abordagem cruzada com a Mel, as clientes que pediram e a Onboarding repaginada (migração 206)

### A fila de abordagem vê a Mel
`guia_fila_abordagem` (mesma assinatura) ganha, por salão: **no período** `mel.pedidos` (o que a Mel passou), `abriram` (o link), `vai`/`nao` (o voto da enquete ou por texto), `respondeu`; **fora do período** `quer` (QUERO nos últimos 90 dias, `quer_em`), `dona_em` (a dona testou pela Mel, 60 dias) e `sair` (pediu SAIR). No detalhe da página: `da_pagina` (pedidos cujo salão recebeu um toque de contato na página até 3 h antes da conversa) e `visitas_7`/`visitas_7_antes`.

- **Prioridade:** QUERO +150 (se não está em negociação/cliente), dona +100, +60 por pedido (até 3), +30 por "vai atender" (até 2), "não vai" sem nenhum "vai" −15, SAIR −20 — os mesmos pesos nos motivos (`mel_quer`, `mel_dona`, `mel`, `mel_vai`, `mel_nao`, `mel_sair`).
- **Filtros novos:** `mel` (pediram pela Mel) e `querem` (responderam QUERO); `resumo.contagem.mel/querem` e `resumo.mel` (totais da cidade: pedidos, abriram, vai, nao, querem, donas, visitas, contatos) para o funil da Mel no topo da aba.
- **QUERO entra sozinho:** `guia_whats_salao_respondeu(…, quer_ = true)` põe o salão (se ainda não é da MIMO) em `respondeu` na `guia_abordagens`, com `proximo_contato = hoje`, e grava uma ação `nota` ("Respondeu QUERO ao pedido da Mel…", `dados.origem = 'mel'`, `dados.lead`) — uma vez por pedido; quem está em negociação ou é cliente fica como está.
- **Mensagem para a dona** (`pelaMel` em `guiaMetricas.js`, usada em `mensagemParaDono` e na mensagem de quem pediu contato): um parágrafo com **contagens** ("3 clientes pediram horário com vocês pela MIMO… e vocês já disseram que vão atender 1"). Nunca os nomes das clientes.

### As clientes que pediram e a demanda sem dono
- `guia_whats_clientes(dias_)` — por telefone: nome, pedidos, salões, último, serviço, `atendida` (algum salão disse que vai), `recusados`, `aguardando` (enviado há menos de 24 h sem sinal), `sem_dono`, `abriram`. Seção **Clientes** da aba WhatsApp (filtros: todas, atendidas, aguardando, sem dono, pediram mais de uma vez; busca).
- `guia_demanda_sem_dono(dias_, cidade_)` — os pedidos sem quem atendesse (salão sem WhatsApp, envio falhou, SAIR, "não vai atender", ou enviado há mais de 24 h sem abrir/votar/responder): totais, por bairro (clientes, pedidos, salões, os 3 serviços mais pedidos) e os últimos 40 pedidos com o motivo. Painel dobrável **"Demanda sem dono"** no topo da Abordagem (da cidade escolhida). **A equipe decide na mão**; a Mel não encaminha a cliente sozinha.
- As pontes entre as abas (`src/lib/guiaPontes.js`): "Ver os pedidos na aba WhatsApp" no detalhe da Abordagem abre a aba WhatsApp já buscando o salão; "Ver na Abordagem" em cada pedido faz o inverso.

### A Onboarding repaginada
Mesmo layout da aba WhatsApp (as peças em `components/plataforma/guia/PecasWa.jsx` e `lib/guiaWa.js`): cabeçalho com o estado (e a IA), cartões e o **funil do cadastro** (entraram → confirmaram → link → abriram → conta), **Quem entrou** (filtros por estado, busca, a linha do tempo de cada profissional, "atendida" como chip), **Testar o agente** com as dicas, e **Configuração** em blocos (O agente, Gatilhos, Tolerância e link, Atendimento e ritmo, Os passos, e as mensagens em cinco grupos), com índice e a barra de salvar. Ids de teste iguais.

### Referência técnica
- **206** `206_abordagem_com_mel.sql` — `guia_ha_quanto(em, hoje)`; `guia_fila_abordagem` (v4); `guia_whats_clientes`; `guia_demanda_sem_dono`; `guia_whats_salao_respondeu` (QUERO → abordagem). Precisa da 205.
- `Abordagem.jsx` (filtros, funil da Mel, demanda sem dono, bloco Pela Mel, tendência), `guiaMetricas.js` (`pelaMel`), `guia-abordagem.css`; `WhatsAppGuia.jsx` (Clientes, ponte), `OnboardingGuia.jsx` (v2), `PecasWa.jsx`, `lib/guiaWa.js`, `lib/guiaPontes.js`; demos `demoAbordagem.js` (os sinais da Mel) e `demoGuiaWhats.js` (`guia_whats_clientes`, `guia_demanda_sem_dono`).
- Deploy: **bat B** (206) → **bat 9** (só se ainda não subiu a 3.57: whatsapp-webhook e guia-whats; a 206 não muda função) → **bat 2**.
- Versão **3.59.0-mimo**.

---

## 14. 3.61 — O onboarding que confirma tudo: a ficha da empresa, a rua pelo nome, as confirmações e o "criando o cadastro" (migração 208)

### A ficha da empresa
Depois do CNPJ válido e ativo, em vez de só o endereço, o agente mostra a **ficha** da Receita — nome fantasia, razão social, CNPJ e o endereço formatado — e pergunta "está tudo certo?" (`msg_empresa_confirmar`, com `{ficha}`). *Sim* segue. *Não* (ou "está errado") → `msg_empresa_qual`: qual dado está errado (**nome fantasia**, **razão social**, **CNPJ** ou **endereço**); ela pode responder já com o dado ("o nome fantasia", "o endereço"). Nome fantasia e razão social ela digita o certo; CNPJ volta para a consulta; endereço entra no fluxo do CEP abaixo. Depois de cada correção a ficha volta atualizada para confirmar de novo.

### O endereço: CEP, a rua pelo nome, número e complemento
- **CEP** (`msg_cep`): ViaCEP, como antes. Com o CEP achado, pergunta o número (`msg_cep_numero`).
- **"Não sei o CEP"** → `msg_rua`: ela manda o nome da rua e a cidade ("Rua das Flores, Itanhaém"; sem cidade, usa a do CNPJ). O agente procura em `viacep.com.br/ws/{UF}/{cidade}/{rua}/json/` (`consultarRuaDe`, no webhook e no guia-whats): **uma opção** → já pede o número; **várias** (uma por CEP, até 5 na tela) → `msg_rua_opcoes` com a lista numerada (rua · bairro · trecho · CEP), ela responde o número ou o bairro; "nenhuma" ou duas tentativas sem achar → endereço escrito. Rua não achada → `msg_rua_nao_achei` (`{cidade}`), com a dica de mandar a cidade junto.
- **Número** → **complemento** (`msg_complemento`; "5, fundos" já leva o complemento) → **o endereço montado** para confirmar (`msg_endereco_ok`, `{endereco}`); *sim* fecha (na correção da ficha, volta à ficha), um CEP novo ou um endereço escrito recomeçam.
- O endereço escrito inteiro (rua com número), em qualquer ponto, é aceito e confirmado de volta.

### As perguntas do sistema, com confirmação
Nome, profissionais, serviços e horários deixam de ser perguntas livres da IA e passam a ser **perguntas do sistema**, determinísticas, cada uma com texto editável e com a confirmação `msg_dado_confirmar` ("Anotei {rotulo}: *{valor}*. Está certo?"): *sim* vale, *não* pergunta de novo, outro texto vira o valor novo (que também é confirmado). Uma dúvida no meio ("o que é isso?") vai à IA responder curto e a pergunta volta.
- **Nome** (`msg_nome_confirmar` com `{nome}` quando o CNPJ trouxe nome fantasia, senão `msg_nome`); o nome em uso continua pedindo outro (`msg_nome_em_uso`).
- **Profissionais** (`msg_profissionais`) — **só para salão**. Quem começou como **autônoma** é uma pessoa só: o passo nem aparece (`profissionais = 1`), e o resumo e o aviso à equipe não mostram a contagem.
- **Serviços** (`msg_servicos`, com `{exemplos}`): a lista de exemplos dos mais escolhidos vem de `servicos_exemplos` (editável na aba, bloco "Os passos"), e a mensagem deixa claro que a lista completa, com preço e duração, e o resto (horários, fotos…) se ajustam no painel.
- **Horários** (`msg_horarios`).
- As orientações `passo_*` da IA foram reescritas (onde ainda eram as da semente) para o papel novo: ela só explica e tira dúvidas; quem pergunta é o sistema.

### A ajuda humana
No começo (depois das boas-vindas no CTA, ou depois do "sim" na intenção) e no fim, o agente avisa que **a qualquer momento ela pode escrever *ajuda*** e uma pessoa da equipe atende (`msg_ajuda_dica`). Quando ela pede ("ajuda", "quero falar com uma pessoa", "atendente"…): `msg_ajuda` (`{atendimento}` vira o link do WhatsApp do atendimento, e a linha sai se não há número), a **equipe recebe o aviso** no `numero_avisos` (quem, em que passo, o número dela) e a conversa segue de onde estava (`acao = 'ajuda'`).

### O resumo, o "criando…" e o fim
- **Resumo** (`msg_resumo`): todos os dados — tipo, CNPJ, razão social, nome fantasia (quando difere), nome para as clientes, endereço, profissionais (salão), serviços, horários, e-mail, WhatsApp — e "está tudo certo?". Corrigir continua igual.
- *Sim* → `msg_criando` ("me dá um minutinho que estou criando o seu cadastro…"), a **espera** `criar_espera_seg` (0–90 s, na aba em "Atendimento e ritmo"; 0 manda junto), e então `msg_link` ("Cadastro criado! 🎉 Agora é só acessar o link e criar a sua senha…") e `msg_final` (se ficou dúvida, o suporte para começar a configurar a agenda, "é só chamar"). A espera vai por bolha: `Saida.pausas[i]` (o webhook dorme a diferença antes da bolha do link; o simulador mostra "⏳ espera de N s").
- O aviso à equipe do link continua; o `msg_link` e o `msg_resumo` da semente foram trocados pelos textos novos só onde ainda estavam iguais à semente.

### A aba Onboarding e o demo
As mensagens novas em grupos (Entrada, Documentos, Endereço, Dados, Contato, Já em uso, Fim), o campo da espera (`onb-espera`) e os exemplos de serviços (`onb-exemplos`, desligado sem o passo dos serviços). O simulador do demo (`demoGuiaOnboarding.js`) anda pelo fluxo novo: a ficha (Studio Demo / STUDIO DEMO LTDA / 11.222.333/0001-81), as correções, a busca de rua de mentira ("Flores" → uma opção; "Palmeiras" → duas), as confirmações, a ajuda (com a prévia do aviso), o resumo e o "criando…" com a espera.

### Referência técnica
- **208** `208_onboarding_ficha_e_confirmacoes.sql` — em `guia_onboarding_config`: `criar_espera_seg` (0–90), `servicos_exemplos`, e as mensagens `msg_empresa_confirmar` `{ficha}`, `msg_empresa_qual`, `msg_empresa_cnpj`, `msg_empresa_nome`, `msg_empresa_razao`, `msg_rua`, `msg_rua_opcoes` `{opcoes}`, `msg_rua_nao_achei` `{cidade}`, `msg_complemento`, `msg_endereco_ok` `{endereco}`, `msg_nome`, `msg_nome_confirmar` `{nome}`, `msg_profissionais`, `msg_servicos` `{exemplos}`, `msg_horarios`, `msg_dado_confirmar` `{rotulo}` `{valor}`, `msg_ajuda_dica`, `msg_ajuda` `{atendimento}`, `msg_criando`, `msg_final`; `guia_onboarding_config_salvar` genérico (textos, sim/não, inteiros com faixa, os marcadores obrigatórios). Precisa da 204.
- `_shared/guia_onboarding.ts` — `PADRAO`, `cfgTexto`, `passosDe(cfg, dados)`, `montarFicha`, `listarOpcoes`, `consultarRuaDe(fetch)`, `avisoEquipe('ajuda')`, `Saida.pausas`, `Deps.consultarRua`; os estados `confirmando_empresa`, `empresa_qual`, `corrigindo`, `pedindo_rua`/`opcoes_rua`, `pedindo_complemento`, `confirmando_endereco_ok`, `confirmando {campo, valor}`, `perguntado`. `whatsapp-webhook` e `guia-whats`: `consultarRua` nas deps e a espera por bolha.
- `OnboardingGuia.jsx`, `PecasWa.jsx` (a linha "sistema" no chat), `guia-plataforma.css`, `demoGuiaOnboarding.js`.
- Deploy: **bat B** (208) → **bat 9** (whatsapp-webhook, guia-whats) → **bat 2**.
- Versão **3.61.0-mimo**.
