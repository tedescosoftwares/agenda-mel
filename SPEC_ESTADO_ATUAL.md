# MIMO — o que existe hoje

Documento de passagem para quem vai olhar UX/UI, navegação e evolução do
produto. Tudo aqui foi lido no código. Nada foi suposto.

---

## LEIA ISTO PRIMEIRO

**O produto se chama "Agenda Mel" em todo lugar do código.** A palavra
"MIMO" não aparece em nenhum arquivo — nem no nome do app, nem na tela de
login, nem no ícone. O rebatismo ainda não começou.

E o mais importante para quem vai pensar evolução: **não existe marketplace,
não existe busca, não existe atendimento domiciliar, não existe endereço da
cliente, não existe mapa e não existe pagamento.** Nada disso está começado —
não é "meio feito", é ausente. O código inteiro assume uma coisa só: *a
cliente vai até a profissional, no salão.*

O que existe é um **app de agenda para um salão de estética**, bem resolvido
naquilo que faz, com um diferencial forte: **um bot de WhatsApp que marca
horário sozinho**, conversando com a cliente.

---

## 1. VISÃO GERAL

**O que o app faz hoje:** a cliente marca horário sozinha — pelo link da
profissional ou conversando no WhatsApp — e a profissional aceita ou recusa.
Ninguém precisa atender telefone.

**Como é feito:**

| | |
|---|---|
| Plataforma | Web PWA (instalável no celular). Não existe app nativo. |
| Framework | React 19 + Vite |
| Linguagem | JavaScript (`.jsx`). **Não usa TypeScript no app** |
| Navegação | React Router — todas as rotas num arquivo só (`src/App.jsx`) |
| Estado | React Context (2 providers) + `useState` por tela. Sem Redux/Zustand/React Query |
| Backend | Supabase. **Não existe servidor próprio** |
| Banco | PostgreSQL (Supabase), 29 tabelas |
| Autenticação | Supabase Auth — e-mail e senha. Sem Google, sem SMS, sem "esqueci a senha" |
| Armazenamento | Supabase Storage — fotos de serviço e foto da profissional |
| Hospedagem | Vercel |

**Dependências de produção — são só quatro:** React, React DOM, React Router
e o cliente do Supabase. Não há biblioteca de UI, de ícones, de datas, de
formulário ou de gráfico. **Tudo é feito à mão**: os 12 ícones são SVG
escritos no código, os gráficos são CSS puro, o CSS é um arquivo único.

**Onde mora a lógica:** quase toda no banco, em funções SQL. O app é uma
casca fina que chama essas funções. Isso importa para quem for evoluir: mexer
em regra de negócio quase sempre é mexer em SQL, não em React.

**Serviços externos em uso:**
- **Evolution API** numa máquina EC2 própria — é o que conversa com o WhatsApp
- **Groq** (IA) — lê a mensagem da cliente e diz a intenção ("quer marcar",
  "confirmar", "cancelar"). Nasce **desligada** em todo salão.

**Não existe:** pagamento (nenhum gateway), mapa, GPS, push notification,
chat, avaliação.

---

## 2. ESTRUTURA DAS PASTAS

```
agenda-mel/
├── src/
│   ├── App.jsx            todas as rotas, num arquivo
│   ├── index.css          o sistema visual inteiro (~3.400 linhas, 1 arquivo)
│   ├── context/           login/perfil  +  notificações
│   ├── lib/               funções puras (datas, preço, horários livres)
│   ├── components/        18 peças compartilhadas + os 2 menus de navegação
│   └── pages/
│       ├── cliente/       2 telas
│       ├── pro/           10 telas
│       ├── admin/         8 telas
│       └── publico/       2 telas (sem login)
│
├── supabase/              48 migrações SQL + 2 funções de servidor (WhatsApp)
└── evolution/             scripts da máquina que roda o WhatsApp
```

---

## 3. QUEM USA

### Cliente
Toda conta nova nasce cliente. Vê as profissionais, marca, cancela, entra em
fila de espera e indica amigas para ganhar crédito.
**Não tem:** edição do próprio perfil, histórico de atendimentos passados,
avaliação, pagamento, endereço.
**Navegação:** só um cabeçalho no topo — **é o único perfil sem menu de abas**.

### Profissional
Precisa que alguém crie a ficha dela no painel do salão. Se a conta existe mas
a ficha não, ela vê uma tela dizendo "conta ainda não vinculada" e não faz mais
nada.
**Tem:** agenda do dia e da semana, pedidos para aceitar, encaixe manual,
proposta de adiantar horário, seus horários e bloqueios, quais serviços faz,
link público com foto e bio, números do mês, ferramenta para chamar cliente
sumida de volta.
**Não tem:** cadastro próprio, documentos, aprovação, preço próprio (o preço é
do salão), ganhos, saque, área de atendimento.
**Navegação:** menu de 5 abas — Agenda · Volta · O mês · Serviços · Ajustes.

### Admin do salão
Manda no salão: agenda de todas, equipe, serviços, horários, clientes, números
e a configuração do WhatsApp.
**Navegação:** menu de 6 abas — Agenda · O mês · Equipe · Serviços · Clientes ·
WhatsApp.

### O que existe no banco mas não tem dono na tela
- **Afiliada** — uma cliente pode indicar uma *profissional* e ganhar comissão
  recorrente. O banco todo está pronto. A tela quase não existe.
- **Dona da plataforma** — há tabela de taxa e comissão. **Nenhuma tela.**

---

## 4. O CAMINHO DA CLIENTE

Não existe splash, onboarding, tour ou tela de boas-vindas. O app abre direto.

**1. Login** (`/login`)
Duas abas: Entrar e Criar conta. Pede e-mail, senha e — no cadastro — nome e
WhatsApp (opcional). Depois de entrar, cada perfil vai para a sua home.

**2. Home** (`/`)
Mostra, de cima para baixo: ofertas de vaga que abriram, convites para
adiantar horário, "Meus agendamentos" (só os futuros), "Estou esperando vaga",
o atalho de crédito e, por último, **"Agendar com" — a lista de todas as
profissionais ativas, em ordem alfabética.**
> Essa lista é toda a "descoberta" que existe: sem busca, sem filtro, sem
> categoria, sem foto grande, sem preço, sem avaliação. E ela **não filtra por
> salão** — num cenário com vários salões, mistura todas as equipes.

**3. Página da profissional** (`/p/nome-dela`) — **a tela mais importante do produto**
É pública, funciona sem login, e é o funil inteiro numa tela só:
escolher serviço → escolher dia (14 dias à frente) → escolher hora → Confirmar.
Se a pessoa não estiver logada, o login abre num modal **no meio do fluxo** e
o agendamento se completa sozinho depois. Termina numa tela "Agendado!".
Se não houver vaga, ela pode entrar na fila de espera.

**4. Depois de marcado**
O acompanhamento é a própria lista da home, com uma etiqueta de status.
Não existe "a caminho", "em andamento" nem rastreio.

**5. Avisos** (`/avisos`) — as notificações, que chegam em tempo real.

**6. Indique e ganhe** (`/indique`) — código, links prontos para mandar no
WhatsApp e extrato de crédito.

**O que não existe no caminho da cliente:** pagamento, avaliação, histórico do
que já passou, e escolha de local (é sempre no salão, implicitamente).

---

## 5. O CAMINHO DA PROFISSIONAL

**Antes de tudo: não existe cadastro de profissional pelo app.** Não há
onboarding, upload de documento, verificação nem aprovação. Ela passa a
existir quando o admin cria a ficha dela e vincula à conta. O campo "ativo" é
um liga/desliga, não um fluxo de aprovação.

**Agenda** (`/pro`) — a home dela.
No topo ficam **fixados os pedidos esperando resposta**. Depois, um aviso de
"mensagens pra enviar" quando houver. Então a agenda, em vista de dia ou
semana. Dentro do dia ela pode: mudar o status, encaixar cliente na mão,
propor um horário mais cedo, perdoar falta e usar o crédito da cliente.

**Pedidos de horário** — aceitar ou recusar, e configurar o próprio prazo
(quanto tempo tem para responder, e o que acontece se o prazo vencer).
⚠️ **A rota `/pro/pedidos` está quebrada** (ver seção 9). A função só funciona
pelo bloco fixado na agenda.

**Meus serviços** (`/pro/servicos`) — marca quais serviços do salão ela faz.
Não cria serviço nem define preço.

**Meus horários** (`/pro/horarios`) — dias que atende, horário, intervalo entre
atendimentos, e bloqueios (almoço, médico, folga — recorrentes ou em data
específica).

**Meu link** (`/pro/link`) — o endereço público dela, a bio e a foto.
**É o "perfil público" do produto.** Não tem galeria de trabalhos, nem
especialidades, nem avaliações.

**O mês** (`/pro/numeros`) — faturamento, ocupação, atendimentos, faturamento
por serviço, melhores clientes.
> É **relatório, não financeiro**: não há saldo, saque, extrato de repasse nem
> comissão descontada. O valor mostrado é o preço cheio.

**Volta pra cá** (`/pro/retorno`) — lista de clientes que sumiram, com um
botão para chamar de volta (uma ou todas).

**Pra enviar** (`/pro/enviar`) — quando o salão não tem WhatsApp automático,
as mensagens ficam escritas aqui e ela manda com um toque.

**Ajustes** (`/pro/ajustes`) — porta de entrada para Pedidos, Horários,
Meu link e Pra enviar.

---

## 6. O PAINEL DO SALÃO

Existe administração **do salão**. Não existe administração **da plataforma**.

| Tela | O que faz |
|---|---|
| Agenda | agenda do dia com filtro por profissional |
| O mês | faturamento, ocupação e atendimentos do salão |
| Equipe | cria, edita e desativa profissionais; vincula à conta; define quais serviços cada uma faz |
| Serviços | cria serviços com nome, descrição, duração, preço e fotos |
| Horários | horário padrão do salão |
| Clientes | lista de clientes com quantos agendamentos têm — **só leitura** |
| WhatsApp | diagnóstico do canal, liga/desliga a IA e o bot |
| Bancada | simula uma conversa de WhatsApp sem mandar nada (ferramenta interna) |

**Não existe:** aprovação de profissional, documentos, categorias, gestão de
pagamentos, comissões, avaliações, denúncias, suporte, promoções ou
configurações globais (as regras de indicação e comissão só se mudam por SQL).

---

## 7. TODAS AS TELAS

| # | Tela | Rota | Quem vê | Arquivo | Status |
|---|---|---|---|---|---|
| 1 | Login / Criar conta | `/login` | público | `pages/Login.jsx` | FUNCIONAL |
| 2 | Home da cliente | `/` | cliente | `pages/cliente/ClienteHome.jsx` | FUNCIONAL |
| 3 | Indique e ganhe | `/indique` | cliente | `pages/cliente/IndiqueEGanhe.jsx` | PARCIAL |
| 4 | Página da profissional | `/p/:slug` | público | `pages/publico/PaginaProfissional.jsx` | FUNCIONAL |
| 5 | Convite para abrir salão | `/convite/:codigo` | público | `pages/publico/Convite.jsx` | FUNCIONAL |
| 6 | Avisos | `/avisos` | qualquer logado | `pages/Avisos.jsx` | FUNCIONAL |
| 7 | Mostruário visual | `/estilo` | público | `pages/Estilo.jsx` | FUNCIONAL (interna) |
| 8 | Minha agenda | `/pro` | profissional | `pages/pro/ProAgenda.jsx` | FUNCIONAL |
| 9 | Pedidos de horário | `/pro/pedidos` | profissional | `pages/pro/ProPedidos.jsx` | **INCOMPLETA — rota quebrada** |
| 10 | Meus serviços | `/pro/servicos` | profissional | `pages/pro/ProServicos.jsx` | FUNCIONAL |
| 11 | Meus horários | `/pro/horarios` | profissional | `pages/pro/ProHorarios.jsx` | FUNCIONAL |
| 12 | Meu link | `/pro/link` | profissional | `pages/pro/ProLink.jsx` | FUNCIONAL |
| 13 | O mês (profissional) | `/pro/numeros` | profissional | `pages/pro/ProNumeros.jsx` | FUNCIONAL |
| 14 | Volta pra cá | `/pro/retorno` | profissional | `pages/pro/ProRetorno.jsx` | FUNCIONAL |
| 15 | Pra enviar | `/pro/enviar` | profissional | `pages/pro/ProEnviar.jsx` | FUNCIONAL |
| 16 | Ajustes | `/pro/ajustes` | profissional | `pages/pro/ProAjustes.jsx` | PARCIAL (1 link morto) |
| 17 | Conta não vinculada | (sem rota) | profissional | `pages/pro/SemFicha.jsx` | FUNCIONAL |
| 18 | Agenda do salão | `/admin` | admin | `pages/admin/AdminAgenda.jsx` | FUNCIONAL |
| 19 | Equipe | `/admin/equipe` | admin | `pages/admin/AdminProfissionais.jsx` | FUNCIONAL |
| 20 | Serviços | `/admin/servicos` | admin | `pages/admin/AdminServices.jsx` | FUNCIONAL |
| 21 | Horário do salão | `/admin/horarios` | admin | `pages/admin/AdminHours.jsx` | FUNCIONAL |
| 22 | Clientes | `/admin/clientes` | admin | `pages/admin/AdminClientes.jsx` | PARCIAL (só leitura) |
| 23 | O mês (salão) | `/admin/numeros` | admin | `pages/admin/AdminNumeros.jsx` | FUNCIONAL |
| 24 | WhatsApp | `/admin/whatsapp` | admin | `pages/admin/AdminWhatsapp.jsx` | FUNCIONAL |
| 25 | Bancada de testes | `/admin/bancada` | admin | `pages/admin/AdminBancada.jsx` | FUNCIONAL (interna) |

**25 telas · 21 rotas funcionando · 1 quebrada · 1 tela sem rota.**

---

## 8. MAPA DE NAVEGAÇÃO

```
APP
│
├── SEM LOGIN
│   ├── /login .................. Entrar | Criar conta
│   ├── /p/:slug ................ Página da profissional
│   │     serviço → dia → hora → Confirmar
│   │       ├─ sem login → modal de login → conclui sozinho
│   │       └─ sem vaga  → entrar na fila de espera
│   ├── /convite/:codigo ........ Abrir seu próprio salão
│   └── /estilo ................. Mostruário do design system
│
└── COM LOGIN
    │
    ├── CLIENTE                        [sem menu de abas — só cabeçalho]
    │   ├── / ......................... Home
    │   │     ├── ofertas de vaga (aceitar / recusar)
    │   │     ├── convites para adiantar
    │   │     ├── meus agendamentos → cancelar
    │   │     ├── estou esperando vaga → sair da fila
    │   │     ├── indique e ganhe
    │   │     └── agendar com → /p/:slug
    │   ├── /indique
    │   └── /avisos
    │
    ├── PROFISSIONAL                   [menu de 5 abas]
    │   │  sem ficha vinculada → tela "conta não vinculada"
    │   ├── /pro ...................... [Agenda]
    │   │     ├── pedidos pendentes (fixados no topo)
    │   │     ├── "N mensagens pra enviar" → /pro/enviar
    │   │     ├── vista dia → mudar status · encaixar · adiantar
    │   │     ├── vista semana
    │   │     └── fila de espera
    │   ├── /pro/retorno .............. [Volta]
    │   ├── /pro/numeros .............. [O mês]
    │   ├── /pro/servicos ............. [Serviços]
    │   ├── /pro/ajustes .............. [Ajustes]
    │   │     ├── Pedidos → /pro/pedidos   ✗ QUEBRADO, joga para a home
    │   │     ├── Horários → bloqueios
    │   │     ├── Meu link → foto e bio
    │   │     ├── Pra enviar
    │   │     └── Sair
    │   └── /avisos
    │
    └── ADMIN DO SALÃO                 [menu de 6 abas]
        ├── /admin ..................... [Agenda] filtro por profissional
        ├── /admin/numeros ............. [O mês]
        ├── /admin/equipe .............. [Equipe]
        ├── /admin/servicos ............ [Serviços]
        ├── /admin/clientes ............ [Clientes]
        ├── /admin/whatsapp ............ [WhatsApp] → bancada de testes
        ├── /admin/horarios ............ (sem aba, só por link)
        └── /avisos

    qualquer rota desconhecida → volta para a home
```

### E existe um caminho inteiro sem tela nenhuma: o WhatsApp

```
Cliente manda mensagem no WhatsApp do salão
   ↓
"porteiro" decide se vale gastar IA (7 filtros, IA desligada por padrão)
   ↓
IA lê e diz a intenção ("quer marcar")
   ↓
o bot conversa:  serviço → profissional → dia → hora → confere
   ↓
cria um PEDIDO e avisa a profissional no WhatsApp dela
   ↓
ela responde "1" (aceita) ou "2" (recusa) — ou resolve pela tela
   ↓
a cliente é avisada
```

Isso reflete na agenda do app como qualquer outro agendamento. **É o
diferencial do produto e não aparece em nenhuma tela da cliente.**

---

## 9. O QUE ESTÁ QUEBRADO OU DESALINHADO

**1. A rota `/pro/pedidos` não existe.**
Por um erro de código em `src/App.jsx`, o trecho que registra essa rota foi
colado dentro de outra rota. A tela existe e funciona, mas navegar até ela
joga a pessoa para a home. O link em "Ajustes" está morto. A função sobrevive
só porque o mesmo conteúdo aparece fixado no topo da agenda.

**2. Duas contas diferentes para o mesmo horário livre.**
A página pública calcula os horários no navegador, e **não considera os
bloqueios da profissional nem o intervalo entre atendimentos**. O bot de
WhatsApp calcula no banco, e considera os dois. Ou seja: **o site pode
oferecer um horário que o bot recusaria.**

**3. A lista de profissionais na home não filtra por salão.**
Hoje, com um salão só, funciona. Com dois, mistura as equipes.

**4. Lembretes dependem de alguém abrir o app.**
Não há agendador no servidor. O lembrete de véspera é disparado quando
qualquer pessoa logada abre o app. Se ninguém abrir, ninguém é lembrado.
A fila do WhatsApp depende de um script rodando na máquina da EC2.

**5. Dados de teste nascem junto com o banco.**
Um banco novo já vem com salão, profissionais e clientes fictícios, além de
dois meses de histórico inventado. Existe um script para limpar.

---

## 10. PRONTO NO BANCO, SEM TELA

Coisas que já foram modeladas e funcionam por baixo, mas que ninguém consegue
ver ou usar pela interface:

- **Taxa da plataforma e comissão de afiliada** — 3% de taxa, 0,5% de
  comissão, teto mensal, atribuição vitalícia. Tudo calculado.
  **A função que registra a transação nunca é chamada por nenhuma tela.**
- **Programa de afiliadas completo** — indicação de profissional, comissão
  recorrente, extrato. No app existe só um resumo dentro de "Indique e ganhe".
- **White-label** — o salão já tem campos de logo e cor da marca. Nada usa.
- **Endereço do salão** — o campo existe e **nunca é escrito nem lido**.
- **Botões interativos do WhatsApp** — suportados, sem tela para configurar.
- **Agendamento de cliente sem conta** (nome e telefone soltos) — o encaixe
  manual usa; a cliente nunca vê.

---

## 11. IDENTIDADE VISUAL HOJE

**Nome:** "Agenda Mel" em todas as superfícies. O ícone é um SVG desenhado no
próprio código — não há arquivo de logo nem variações.

**Tema:** escuro, e **só escuro**. Não existe tema claro.

**Paleta** (valores reais):
```
fundo            #0d0d0f    quase preto
superfícies      #141419 · #1c1c23 · #24242c
linhas           #26262f · #383843    (borda de 1px)
texto            #f4f3f1 · #9d988f · #6b675f
ACENTO           #e9a23b    âmbar/latão — "a lâmpada do espelho do salão"
sucesso          #4fd1a0    verde menta
informação       #7fa6f0    azul
erro             #f0637e    carmim
```

**Tipografia** — três fontes, carregadas do próprio servidor:
- **Archivo** para texto
- **Archivo Narrow** para rótulos, abas e botões pequenos (sempre em
  maiúsculas, com espaçamento entre letras)
- **Azeret Mono** para **hora e dinheiro — sempre**

**Cantos:** 6px em cartões, 4px em campos e botões, pílula em etiquetas.
**Largura máxima do conteúdo:** 660px.

**A decisão visual mais marcante:** **não existe sombra em lugar nenhum.**
A profundidade vem de linha de 1px e de camadas de superfície. Está escrito
como intenção no topo do CSS: *"studio noturno"*.

**Consistência:** alta. Todas as telas usam as mesmas classes. O padrão de
lista clicável (avatar + nome + linha cinza de detalhe + seta) se repete de
"Equipe" a "Ajustes", em todos os perfis.

**Existe design system?** Sim, de fato — tokens de cor e medida no CSS, e uma
**página `/estilo` que mostra todas as peças numa tela só**. Não é uma
biblioteca de componentes; é uma folha de estilo com convenções fortes.

**Onde a consistência quebra:**
- A cliente **não tem menu de abas**; profissional e admin têm. São dois
  modelos de navegação convivendo no mesmo app.
- As telas de WhatsApp e Bancada têm vocabulário visual próprio (são
  ferramentas internas).
- Não há componente de modal genérico — cada modal tem estilo próprio.
- Não há escala de espaçamento definida; margens são valores soltos.

---

## 12. AS REGRAS QUE O SISTEMA APLICA

**Ao marcar**
- Um agendamento feito pela cliente **sempre nasce "pendente"**
- O banco **impede fisicamente** dois agendamentos sobrepostos da mesma
  profissional (se der conflito, a tela avisa "esse horário acabou de ser
  reservado")
- Preço e nome do serviço são **congelados** no momento da marcação: mudar o
  preço depois não altera agendamento antigo
- Horários são gerados **de 30 em 30 minutos**, e só aparecem se o serviço
  couber inteiro dentro do expediente

**Aprovação da profissional**
- Cada profissional configura: se quer aprovar (padrão **sim**), em quantos
  minutos (padrão **120**), e o que fazer se o prazo vencer (padrão
  **confirmar**)
- Cliente marcou + aprovação ligada → vira **pedido**
- A dona do salão marcando pela agenda → **confirma direto** (a casa não pede
  licença a si mesma)

**Ao cancelar**
- A cliente só cancela o próprio, e só se ainda não aconteceu
- Cancelar **libera o horário** e oferece automaticamente para quem está na
  fila de espera
- Regra de ouro das mensagens: **quem age pela tela não recebe mensagem do
  que acabou de fazer.** A profissional cancela → a cliente é avisada. E
  vice-versa.

**Mensagens de madrugada**
- Existe janela de silêncio (21h às 8h), mas ela **não vale para resposta**:
  aceite, recusa, cancelamento e confirmação saem na hora. Lembrete, convite
  e pós-atendimento esperam amanhecer.

**Falta**
- Existe status "faltou", com tolerância configurável, e é possível perdoar

**Indicação**
- Quem indica ganha R$ 20, quem é indicada ganha R$ 10, máximo 10 por mês,
  crédito válido por 180 dias
- **O crédito só nasce quando o primeiro atendimento é concluído**
- **Mas o crédito nunca vira desconto sozinho** — a profissional aplica na mão

**Não existe regra alguma sobre:** deslocamento, área atendida, distância,
pagamento, avaliação ou aprovação de profissional.

---

## 13. OS ESTADOS DE UM AGENDAMENTO

São cinco, com estes nomes exatos:
`pendente` · `confirmado` · `cancelado` · `concluido` · `faltou`

```
                  cliente marca
                       ↓
                  [ pendente ]
                       │
        ┌──────────────┴───────────────┐
        │                              │
 profissional pede aprovação    aprovação desligada,
        │                       ou quem marcou foi o salão
        │                              ↓
        │                       [ confirmado ]
        │
        ├─ ela responde "1" (WhatsApp ou tela) → [ confirmado ] → avisa a cliente
        ├─ ela responde "2"                     → [ cancelado ]  → avisa a cliente
        └─ o prazo vence                        → confirma ou cancela,
                                                   conforme ela configurou

[ pendente ] ou [ confirmado ]
        ├─ cliente cancela          → [ cancelado ]
        └─ profissional muda na tela → [ confirmado ] [ concluido ] [ faltou ] [ cancelado ]

[ concluido ]  → libera o crédito de indicação · manda o "obrigada pela visita"
[ faltou ]     → pode ser perdoado, e volta para [ confirmado ]
[ cancelado ] ou [ faltou ] → o horário é oferecido para a fila de espera
```

**Não existem** os estados "a caminho", "em atendimento", "aguardando
pagamento" ou "avaliado".

---

## 14. GEOLOCALIZAÇÃO E ATENDIMENTO DOMICILIAR

Esta seção é curta porque **não há absolutamente nada**.

Procurei em todo o repositório por latitude, longitude, GPS, mapa, distância,
raio, deslocamento, rota, CEP, bairro e coordenada. **Zero ocorrências.**

O que existe de "lugar":
- `salons.city` — a cidade do salão, gravada quando alguém abre um salão.
  **Nenhuma tela lê.**
- `salons.address` — a coluna existe. **Nada escreve, nada lê.**

Não existe: endereço da cliente, endereço no agendamento, permissão de GPS,
biblioteca de mapa, cálculo de distância ou rota, raio de atendimento, taxa de
deslocamento, localização de ninguém, nem qualquer distinção entre "no salão"
e "em domicílio".

**Para quem for desenhar atendimento domiciliar: não há nem o campo de
endereço para partir.** É modelagem do zero.

---

## 15. RESUMO

```
TELAS:            25
ROTAS:            21 funcionando · 1 quebrada
FLUXO CLIENTE:    entrar → escolher profissional → serviço → dia → hora →
                  marcado. Sem pagamento, sem avaliação, sem histórico.
FLUXO PROFISSIONAL: agenda · aceitar pedidos · encaixe · horários · link ·
                  números do mês. Sem cadastro próprio, sem ganhos.
FLUXO ADMIN:      painel do salão completo. Painel da plataforma não existe.
BACKEND:          Supabase, sem servidor próprio
BANCO:            PostgreSQL, 29 tabelas
AUTENTICAÇÃO:     e-mail e senha
PAGAMENTO:        não existe
GEOLOCALIZAÇÃO:   não existe
CHAT:             não existe (o que existe é bot de WhatsApp)
NOTIFICAÇÕES:     dentro do app (tempo real) + WhatsApp. Sem push.
```

| Área | |
|---|---|
| Login e perfis | 🟢 FUNCIONAL |
| Agendar pelo app | 🟢 FUNCIONAL |
| Agenda da profissional | 🟢 FUNCIONAL |
| Aceitar / recusar pedido | 🟢 FUNCIONAL |
| Painel do salão | 🟢 FUNCIONAL |
| Bot de WhatsApp que marca | 🟢 FUNCIONAL |
| Notificações no app | 🟢 FUNCIONAL |
| Fila de espera e adiantamento | 🟢 FUNCIONAL |
| Lembretes automáticos | 🟡 PARCIAL — dependem de alguém abrir o app |
| Indique e ganhe | 🟡 PARCIAL — o crédito nunca vira desconto sozinho |
| Programa de afiliadas | 🟡 PARCIAL — banco pronto, quase sem tela |
| Multi-salão / white-label | 🟡 PARCIAL — banco pronto, sem descoberta nem marca |
| Financeiro da profissional | 🟡 PARCIAL — é relatório, não financeiro |
| Tela de pedidos | 🟡 PARCIAL — tela pronta, rota quebrada |
| Taxa e comissão da plataforma | ⚪ SÓ ESTRUTURA — nunca é acionada |
| Dados de teste | ⚪ MOCK — nascem junto com o banco |
| Marketplace / busca / descoberta | 🔴 NÃO EXISTE |
| Atendimento domiciliar | 🔴 NÃO EXISTE |
| Geolocalização e mapas | 🔴 NÃO EXISTE |
| Pagamento | 🔴 NÃO EXISTE |
| Avaliações | 🔴 NÃO EXISTE |
| Chat | 🔴 NÃO EXISTE |
| Push notification | 🔴 NÃO EXISTE |
| Cadastro e aprovação de profissional | 🔴 NÃO EXISTE |
| Categorias de serviço | 🔴 NÃO EXISTE |
| Painel da plataforma | 🔴 NÃO EXISTE |
| Marca "MIMO" | 🔴 NÃO EXISTE NO CÓDIGO |

---

## 16. ARQUIVOS PARA OLHAR PRIMEIRO

**Para entender o produto rápido**
| Arquivo | Por quê |
|---|---|
| `src/App.jsx` | Todas as rotas num lugar. É onde está o defeito da rota quebrada. |
| `src/pages/publico/PaginaProfissional.jsx` | **A tela mais importante**: o funil de conversão inteiro |
| `src/pages/cliente/ClienteHome.jsx` | Tudo que a cliente vê logada |
| `src/pages/pro/ProAgenda.jsx` + `src/components/AgendaDia.jsx` | O dia de trabalho da profissional |
| `src/components/ProShell.jsx` e `AdminShell.jsx` | Os dois menus — a arquitetura de informação de cada perfil |

**Para entender o visual**
| Arquivo | Por quê |
|---|---|
| `src/index.css` (primeiras 125 linhas) | Todos os tokens de cor, fonte e medida, com a intenção escrita |
| `src/pages/Estilo.jsx` | Mostruário vivo de todas as peças |
| `src/components/icons.jsx` | Os 12 ícones do produto |

**Para entender as regras**
| Arquivo | Por quê |
|---|---|
| `supabase/setup_completo.sql` | O modelo de dados inteiro num arquivo |
| `supabase/035_bot_que_marca.sql` | A conversa do bot e o cálculo de horários livres |
| `supabase/038_aceite_da_profissional.sql` | O ciclo de aprovação com prazo |
| `supabase/017_afiliados.sql` | Todo o modelo econômico que ainda não tem tela |

**Para entender o WhatsApp**
| Arquivo | Por quê |
|---|---|
| `supabase/functions/whatsapp-webhook/index.ts` | O caminho da mensagem, do recebimento à resposta |
| `src/pages/admin/AdminBancada.jsx` | Como o time testa a conversa sem gastar telefone |

---

## HANDOFF PARA DESIGN/PRODUTO

O MIMO ainda se chama **Agenda Mel** no código — o rebatismo não começou.

Hoje ele é um **app de agenda para um salão de estética**, não um
marketplace. Funciona bem no que faz.

**A cliente** entra, vê uma lista alfabética de profissionais, abre a página
de uma delas e marca: serviço → dia → hora. Também pode entrar em fila de
espera, aceitar um horário mais cedo e indicar amigas para ganhar crédito. Ela
não paga, não avalia, não vê histórico e nunca escolhe onde será atendida.

**A profissional** tem uma agenda de dia e semana, aceita ou recusa pedidos
com um prazo que ela mesma define, encaixa cliente na mão, monta seus horários
e bloqueios, tem um link público com foto e bio, vê os números do mês e chama
de volta quem sumiu. Ela não se cadastra sozinha, não manda documento, não
define preço e não vê ganhos nem saque.

**O grande diferencial não tem tela:** um bot de WhatsApp que conversa com a
cliente e marca o horário sozinho — pergunta serviço, profissional, dia e
hora, cria o pedido e avisa a profissional, que responde "1" ou "2" no próprio
WhatsApp. Isso reflete na agenda como qualquer outro agendamento.

**Completos:** agendar (app e WhatsApp), aprovação da profissional, fila de
espera, adiantar horário, indicação com crédito, lembrete de véspera, avisos
no app, painel do salão.

**Pela metade:** o programa de afiliadas tem banco inteiro e quase nenhuma
tela; a taxa da plataforma é calculada mas nunca acionada; o "financeiro" da
profissional é só relatório; a tela de pedidos existe mas a rota está
quebrada; os lembretes só disparam quando alguém abre o app.

**Não existem:** pagamento, avaliação, chat, push, busca, categorias,
onboarding, cadastro e aprovação de profissional, painel da plataforma — e,
principalmente, **nada de geolocalização**: não há endereço da cliente, mapa,
distância, raio ou taxa de deslocamento. Para atendimento domiciliar, é
modelagem do zero.

**Visualmente** é um tema escuro, sem sombra nenhuma, com um único acento
âmbar, tipografia condensada em maiúsculas para rótulos e fonte monoespaçada
para hora e dinheiro. Consistente entre telas. A quebra mais visível: cliente
não tem menu de abas, profissional e admin têm.
