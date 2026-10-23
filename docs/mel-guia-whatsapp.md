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

1. **bat B** — aplica as migrações novas: **199, 200, 201, 202**.
2. **bat 9** — publica as funções: **whatsapp-webhook** (ganhou `?tarefa=ociosas`) e **guia-whats** (simular com "como a dona").
3. **bat 2** — publica a Plataforma (versão **3.54.1**).
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
