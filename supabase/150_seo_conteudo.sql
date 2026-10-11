-- 150: o conteúdo SEO da 3.2, nos dados que a plataforma edita.
-- Só dados: nenhuma tabela, coluna ou função muda. Regra de sempre: não passar
-- por cima do que a plataforma já editou. A linha da manicure só muda se ainda
-- estiver igual à semente da 116; as inserções não tocam no que já existe.
--
--   seo_pages:  /agenda-para-manicure ganha título e descrição novos (a página foi
--               reconstruída em torno da rotina da manicure: manutenção, encaixe,
--               remarcação, sinal, agenda cheia); /alternativa-ao-trinks nasce.
--   blog_posts: três artigos novos, todos apontando para os hubs:
--               planilha-ou-sistema-para-salao-de-beleza,
--               quanto-custa-sistema-para-salao-de-beleza,
--               como-reduzir-faltas-no-salao-de-beleza.

do $$
declare n integer;
begin
  update public.seo_pages set title = 'Agenda para manicure que lembra da manutenção antes da cliente sumir.', seo_title = 'Agenda para Manicure: online, grátis, manutenção em dia | MIMO', og_title = 'Agenda para Manicure: online, grátis, manutenção em dia | MIMO', meta_description = 'Agenda para manicure com aviso de manutenção vencida, encaixe de serviço curto, remarcação pelo app, sinal por Pix e link para a cliente marcar sozinha. Grátis.', og_description = 'Agenda para manicure com aviso de manutenção vencida, encaixe de serviço curto, remarcação pelo app, sinal por Pix e link para a cliente marcar sozinha. Grátis.', og_image_url = 'https://mimo.com.vc/imagens/lifestyle-1400.webp', updated_at = now()
   where route = '/agenda-para-manicure' and seo_title = 'Agenda para Manicure: online e grátis | MIMO' and meta_description = 'Agenda online para manicure: manutenção em dia, clientes recorrentes com histórico, serviços e preços, horários e link próprio para a cliente marcar sozinha. Grátis.';
  get diagnostics n = row_count;
  raise notice '150: % %', '/agenda-para-manicure', case when n > 0 then 'título e descrição atualizados' else 'mantida (editada pela plataforma ou já atualizada)' end;
end $$;

-- a página nova: a plataforma passa a poder editar título, descrição e capa dela
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type)
  values ('/alternativa-ao-trinks', 'SEO_LANDING', 'Alternativa ao Trinks para salão e autônoma: o que muda na MIMO.', 'alternativa-ao-trinks', 'Alternativa ao Trinks: compare com a MIMO (2026) | MIMO', 'Alternativa ao Trinks: preço público (grátis para autônoma, R$ 49,90 o salão), sem marketplace, WhatsApp no seu número e sinal por Pix. Com o lado de lá incluído.', 'Alternativa ao Trinks: compare com a MIMO (2026) | MIMO', 'Alternativa ao Trinks: preço público (grátis para autônoma, R$ 49,90 o salão), sem marketplace, WhatsApp no seu número e sinal por Pix. Com o lado de lá incluído.', 'https://mimo.com.vc/imagens/profissional-1400.webp', 'WebPage')
  on conflict (route) do nothing;

-- os artigos novos (quem já tem o slug, fica como está)
insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Planilha ou sistema para salão de beleza: até onde a planilha vai', 'planilha-ou-sistema-para-salao-de-beleza', 'O que a planilha faz bem, os seis pontos em que ela trava quando o salão cresce, os sinais de que chegou a hora de trocar e como fazer a troca sem parar o salão.', $mimo$Quase todo salão começa no caderno ou na planilha. E funciona: enquanto é uma pessoa atendendo, com dez ou quinze horários por dia, a planilha dá conta. O problema não é a planilha ser ruim. É que o salão cresce e ela continua do mesmo tamanho.

Este texto é para quem está nesse ponto: a planilha ainda funciona, mas já dá trabalho. A ideia é mostrar o que ela faz bem, onde ela trava e como saber se chegou a hora de trocar por um [sistema para salão de beleza](/sistema-para-salao-de-beleza), sem romantizar nenhum dos dois lados.

## O que a planilha faz bem

Vale reconhecer antes de criticar:

- **Custa zero.** Google Planilhas ou Excel, e pronto.
- **Você conhece.** Não tem curva de aprendizado nem suporte para chamar.
- **É flexível.** Quer uma coluna nova? Cria. Quer mudar a cor? Muda.
- **Serve para o caixa simples.** Entradas, saídas, quanto sobrou no mês.
- **Serve para a lista de clientes.** Nome, telefone, o que costuma fazer.

Se o seu salão é você, uma cadeira e clientes fixas, pode ser que a planilha baste por mais um bom tempo. Siga em frente sem culpa.

## Onde a planilha começa a falhar

A planilha falha quando a agenda deixa de ser de uma pessoa só e passa a ser da operação do salão. Os sinais costumam aparecer nesta ordem.

### 1. Mais de uma mão na agenda

Entra a segunda profissional, a recepção começa a marcar, a dona marca pelo WhatsApp. Duas pessoas editam a mesma célula, uma salva por cima da outra, e às 15h aparecem duas clientes para a mesma cadeira. A planilha não sabe quem marcou, quando nem por onde. Um sistema sabe: cada horário tem autor, hora e origem, e a [agenda tem uma coluna por profissional](/agenda-para-salao-de-beleza).

### 2. A cliente não consegue marcar sozinha

A planilha não tem link. Toda marcação passa por alguém: a cliente manda mensagem, alguém abre a planilha, confere, responde, anota. Dez pedidos por dia são dez conversas; vinte já pedem uma pessoa só para isso. Com [agendamento online](/agendamento-online), a cliente vê os horários livres do serviço e da profissional que quer, marca às 22h, e o horário cai na agenda sem ninguém acordar.

### 3. Ninguém avisa ninguém

A planilha não manda confirmação na véspera, não lembra a cliente perto da hora e não avisa a profissional que o horário mudou. Tudo isso vira tarefa manual da recepção, e tarefa manual é a primeira coisa que se perde no dia cheio. [Confirmação pelo WhatsApp](/confirmacao-de-agendamento-whatsapp) sozinha já derruba falta, mas só funciona se for automática.

### 4. A planilha aceita qualquer coisa

Coloração de três horas marcada às 17h numa agenda que fecha às 18h. Escova de 45 minutos em cima da pausa do almoço. A planilha aceita, porque é uma grade de células, não uma agenda. Um sistema cruza a duração do serviço, o horário de cada profissional, os bloqueios e o intervalo, e só oferece o que cabe.

### 5. Comissão vira briga de fórmula

Com equipe, chega o repasse: percentual por profissional, por serviço, com desconto de produto ou sem. A fórmula funciona até alguém inserir uma linha no meio. Aí o número do mês não bate, e a conversa com a profissional fica desconfortável por culpa de uma célula. [Comissão e repasse](/sistema-de-comissao-para-salao) saindo do próprio fechamento do dia acabam com essa conversa.

### 6. O histórico que ninguém encontra

"Qual foi a cor que a dona Fátima fez da última vez?" Está na planilha de agosto, em alguma aba. Ou no caderno velho. Ou na cabeça da profissional que saiu. O [histórico por cliente](/controle-de-clientes-para-salao), com as observações do atendimento, é o que faz a cliente voltar e ser bem atendida sem depender de memória.

## Sinais de que é hora de trocar

Marque os que valem para o seu salão:

- Há mais de uma profissional atendendo, ou vai haver nos próximos meses.
- Chegam mais de dez mensagens por dia perguntando se tem horário.
- Houve pelo menos uma falta sem aviso esta semana.
- O fechamento do dia leva mais de vinte minutos.
- Alguém já marcou duas clientes na mesma cadeira no mesmo horário.
- Uma cliente perguntou quando foi a última manutenção dela e ninguém soube responder.

Dois ou mais marcados, e a planilha já está custando mais do que um sistema.

## O que um sistema precisa ter (e o que não precisa)

A tentação é escolher o sistema com mais funções. O que resolve a lista acima é curto:

- Agenda com uma coluna por profissional e duração real por serviço.
- Link e QR para a cliente marcar sozinha, vendo só o que está livre.
- Confirmação e lembrete pelo WhatsApp, de preferência pelo número do salão.
- Ficha da cliente com histórico, faltas e observações.
- [Sinal por Pix](/sinal-para-agendamento) para os serviços longos.
- [Lista de espera](/lista-de-espera-para-salao) para a vaga que abre.
- Fechamento do dia com comissão e repasse.

Controle de estoque, nota fiscal e dezenas de tipos de relatório são úteis para rede de salões. Para a maioria dos salões de bairro, são menus que ninguém abre e preço que todo mundo paga. Se você está comparando opções, o guia [como escolher um sistema para salão](/blog/como-escolher-sistema-para-salao-de-beleza) entra nesse detalhe.

## O que o sistema não faz sozinho

Vale dizer antes que alguém se decepcione: o sistema não organiza o salão por conta própria. A duração real de cada serviço, o horário de cada profissional, a regra de remarcação e a decisão de pedir sinal continuam sendo suas. O que o sistema faz é cumprir essas regras todos os dias, sem cansar, inclusive às 22h de domingo. A planilha também cumpria, enquanto alguém lembrava de olhar para ela.

## E o custo?

A planilha é grátis no boleto e cara no relógio: uma hora por dia de recepção respondendo "tem horário?" são vinte horas no mês. Um sistema para salão pequeno custa, no mercado brasileiro, de zero a algumas centenas de reais por mês, dependendo de como cobra; o artigo [quanto custa um sistema para salão de beleza](/blog/quanto-custa-sistema-para-salao-de-beleza) abre essa conta. Na MIMO, a conta de autônoma é gratuita e o plano de salão, o MIMO Pro, custa R$ 49,90 por mês com três agendas.

## Como trocar sem parar o salão

Não precisa virar a chave num domingo. O caminho que costuma funcionar:

1. **Uma tarde para cadastrar.** Serviços com preço e duração real, profissionais com os horários de cada uma, bloqueios de almoço.
2. **QR no balcão e link na bio.** A partir daí, cliente nova já entra pelo sistema.
3. **Duas semanas com a planilha como cópia.** Tudo que é marcado pelo balcão entra nos dois. O que entra pelo link, só no sistema.
4. **Confirmação ligada.** Na primeira semana você já sente a diferença nas faltas.
5. **Planilha vira histórico.** Quando ninguém abre mais, ela cumpriu o papel dela.

A planilha foi a ferramenta certa para o salão que você tinha. O sistema é a ferramenta para o salão que você está montando.$mimo$, '/imagens/salao-1400.webp', 'dona de salão na recepção com o caderno de agendamentos e o celular', c.id, 'Equipe MIMO', 'Planilha ou sistema para salão de beleza? | MIMO', 'Planilha, caderno ou sistema para salão de beleza: o que cada um resolve, onde a planilha trava (equipe, cliente marcando sozinha, confirmação) e quando vale trocar.', 'Planilha ou sistema para salão de beleza? | MIMO', 'Planilha, caderno ou sistema para salão de beleza: o que cada um resolve, onde a planilha trava (equipe, cliente marcando sozinha, confirmação) e quando vale trocar.', 'https://mimo.com.vc/imagens/salao-1400.webp', 'published', '2026-10-11T12:00:00-03:00', 6, '/sistema-para-salao-de-beleza', 'Veja o sistema da MIMO para salão', $mimo$["quanto-custa-sistema-para-salao-de-beleza","como-escolher-sistema-para-salao-de-beleza"]$mimo$::jsonb, $mimo${"titulo":"Na prática","texto":"Se duas pessoas mexem na mesma agenda, ou se a cliente precisa mandar mensagem para saber se tem horário, a planilha já ficou pequena. Troque antes de contratar a segunda profissional, não depois."}$mimo$::jsonb, $mimo$[["Posso continuar usando a planilha para o caixa?","Pode, se preferir. Muitos salões mantêm a planilha de despesas e usam o sistema para agenda, clientes e fechamento. O que não funciona por muito tempo é a agenda em dois lugares."],["Perco meu histórico ao trocar?","A planilha continua com você. O histórico novo começa no sistema a partir do primeiro atendimento; muitos salões anotam na ficha da cliente, no primeiro dia, o essencial do que estava na planilha."],["Preciso de computador para usar um sistema?","Na MIMO não. A profissional usa a agenda dela no celular; a recepção costuma preferir a agenda geral no computador ou no tablet. É a mesma agenda, com a tela certa para cada uso."],["Sistema serve para quem atende sozinha?","Serve, e nesse caso costuma ser grátis. A conta de autônoma da MIMO tem agenda, link próprio, clientes e retorno sem mensalidade."]]$mimo$::jsonb
  from public.blog_categories c where c.slug = 'gestao-do-salao' on conflict (slug) do nothing;

insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Quanto custa um sistema para salão de beleza (e o que não aparece no preço)', 'quanto-custa-sistema-para-salao-de-beleza', 'Os quatro jeitos de cobrar, as taxas que não aparecem na proposta, o custo de ficar sem sistema e quanto a MIMO cobra para autônoma e para salão, com exemplos.', $mimo$A resposta curta: de zero a algumas centenas de reais por mês. A resposta útil depende de como cada sistema cobra, e é isso que este texto abre. No fim, tem a conta da MIMO, com os números que estão na nossa [página de planos](/planos).

## Os quatro jeitos de cobrar

Quando você pede o preço de um sistema para salão, ele chega num destes formatos.

### Por profissional (ou por agenda)

O mais comum. Um valor por pessoa que atende, às vezes em faixas: até 2, de 3 a 5, de 6 a 10. É justo enquanto o salão cresce devagar; fica caro quando entra a sexta profissional e o preço pula de faixa. Pergunte sempre qual é o valor da próxima faixa, não só da sua.

### Por plano com teto

Um valor fixo que inclui até certo número de profissionais e, acima disso, um adicional por agenda. É o modelo da MIMO. A vantagem é saber hoje quanto vai custar com dez pessoas.

### Por transação

Alguns sistemas são baratos ou gratuitos na mensalidade e ganham na maquininha, na conta digital ou numa taxa sobre cada pagamento que passa por eles. O preço real está na taxa, e ela cresce com o seu faturamento.

### Sob consulta

O preço não está no site; você preenche um formulário e um vendedor liga. No site do Trinks, por exemplo, em outubro de 2026, as cinco faixas de profissionais (de 1 a 2 até 21 ou mais) aparecem como "sob consulta". Não quer dizer que seja caro. Quer dizer que o preço pode ser negociado, o que costuma significar que alguém paga mais do que outro pela mesma coisa. Se você está nessa comparação, a página [alternativa ao Trinks](/alternativa-ao-trinks) coloca os dois lado a lado.

## Quanto o mercado cobra

Para um salão pequeno, com duas a cinco profissionais, os sistemas conhecidos no Brasil costumam ficar entre algumas dezenas e algumas centenas de reais por mês na mensalidade base. A dispersão é grande porque os pacotes são diferentes: um inclui mensagens, outro cobra à parte; um tem app para a cliente, outro cobra pelo app com a marca do salão.

Por isso comparar mensalidade é comparar maçã com laranja. O que vale comparar é o custo total do ano com o salão que você tem e com o salão que você vai ter.

Um detalhe que muda a conta: quem o plano considera profissional. Recepcionista e dona que não atende entram na contagem? Em alguns sistemas, sim. Pergunte antes, porque é aí que o preço de dois vira preço de quatro.

## O que fica escondido no preço

Pergunte sobre cada item antes de assinar:

- **Mensagens.** SMS, e-mail e WhatsApp cobrados por envio ou por pacote. Um salão com 300 confirmações por mês sente isso.
- **Taxa de adesão ou implantação.** Um valor único no começo, às vezes do tamanho de três mensalidades.
- **Contrato mínimo.** Plano anual com multa para sair. Teste de cinco dias não cabe numa decisão de doze meses.
- **Limite de usuários ou de clientes.** O plano barato vale até certo número de cadastros; depois, upgrade.
- **Maquininha ou conta digital obrigatória.** A mensalidade é baixa porque a taxa compensa.
- **App "exclusivo" com a marca do salão.** Bonito, e geralmente cobrado à parte.
- **Suporte.** Incluso por chat, ou só no plano de cima.
- **Exportar os dados.** Se um dia sair, você leva a lista de clientes? Em que formato?

## O custo de não ter sistema

Do outro lado da conta está o que o salão perde sem organização. Uma estimativa conservadora para um salão com três profissionais:

- **Faltas sem aviso.** Duas por semana a R$ 80 cada são R$ 640 por mês de cadeira parada. [Confirmação pelo WhatsApp](/confirmacao-de-agendamento-whatsapp) e [sinal](/sinal-para-agendamento) nos serviços longos derrubam boa parte disso.
- **Horário vago que ninguém preencheu.** Uma vaga por dia que a [lista de espera](/lista-de-espera-para-salao) preencheria: mais R$ 1.500 no mês.
- **Tempo da recepção no WhatsApp.** Uma hora por dia respondendo "tem horário?" são vinte horas por mês.
- **Cliente que não voltou.** A manutenção venceu, ninguém chamou, ela foi em outro lugar.

Qualquer sistema que resolva dois desses itens já se paga. Isso não é argumento para comprar o mais caro; é argumento para não ficar sem. Se a dúvida ainda é entre planilha e sistema, [este texto](/blog/planilha-ou-sistema-para-salao-de-beleza) ajuda a decidir o momento.

## Quanto custa a MIMO

Os preços estão na [página de planos](/planos) e não mudam por conversa:

- **Autônoma: R$ 0.** Para quem atende sozinha. Agenda, serviços, clientes, retorno, lista de espera, link próprio com QR.
- **MIMO Pro: R$ 49,90 por mês**, com 3 agendas profissionais incluídas. Da 4ª à 10ª agenda, R$ 9,90 cada. Um salão com cinco profissionais paga R$ 69,70.
- **MIMO Pro+: R$ 149,90 por mês**, com 11 agendas incluídas e R$ 7,90 por agenda a partir da 12ª, sem limite.

Os 7 dias de teste são sem cartão: você só cadastra pagamento se decidir ficar. Confirmação e lembrete saem pelo WhatsApp do próprio salão, sem cobrança por mensagem. Não tem taxa de adesão nem maquininha obrigatória. O que a MIMO não tem (estoque, nota fiscal, maquininha) está dito na [comparação com o Trinks](/alternativa-ao-trinks), para você não descobrir depois.

## Como comparar propostas sem se perder

Monte uma tabela com estas linhas e preencha para cada sistema:

1. Mensalidade com o número de profissionais de hoje.
2. Mensalidade com o dobro de profissionais.
3. Custo de mensagens por mês, com o seu volume de confirmações.
4. Taxa de adesão.
5. Tempo mínimo de contrato.
6. O que acontece com os seus dados se você sair.
7. Dias de teste e se pedem cartão.

O sistema mais barato na linha 1 raramente é o mais barato na soma. E o que importa, no fim, é a linha 8, que nenhuma proposta traz: quantas faltas, horários vagos e clientes sumidas ele vai evitar no seu salão. Para saber o que precisa ter antes de olhar preço, [como escolher um sistema para salão](/blog/como-escolher-sistema-para-salao-de-beleza) lista o essencial; para ver o sistema inteiro, módulo a módulo, a página de [sistema para salão de beleza](/sistema-para-salao-de-beleza) mostra como a MIMO resolve cada parte do dia.$mimo$, '/imagens/painel-1400.webp', 'painel do salão com a agenda do dia e o fechamento no computador', c.id, 'Equipe MIMO', 'Quanto custa um sistema para salão de beleza? | MIMO', 'Quanto custa um sistema para salão de beleza: como o mercado cobra, o que fica escondido no preço, o custo de ficar sem e quanto a MIMO cobra, com a conta feita.', 'Quanto custa um sistema para salão de beleza? | MIMO', 'Quanto custa um sistema para salão de beleza: como o mercado cobra, o que fica escondido no preço, o custo de ficar sem e quanto a MIMO cobra, com a conta feita.', 'https://mimo.com.vc/imagens/painel-1400.webp', 'published', '2026-10-11T12:00:00-03:00', 5, '/sistema-para-salao-de-beleza', 'Veja os planos e o sistema da MIMO', $mimo$["planilha-ou-sistema-para-salao-de-beleza","como-escolher-sistema-para-salao-de-beleza"]$mimo$::jsonb, $mimo${"titulo":"Na prática","texto":"Antes de comparar preço, pergunte quatro coisas: cobra por profissional? cobra por mensagem? tem contrato mínimo? o preço está no site? Quem responde não às quatro costuma ser o mais barato no fim do ano."}$mimo$::jsonb, $mimo$[["Existe sistema para salão de beleza grátis?","Existe, com limites. Na MIMO a conta de autônoma é gratuita de verdade para quem atende sozinha; o plano pago começa quando há equipe. Em outros sistemas, o grátis costuma ser um período de teste ou um plano com poucos cadastros."],["O preço por profissional vale a pena?","Vale enquanto o salão é pequeno e não vai crescer. Com cinco ou mais profissionais, um plano com teto costuma sair mais barato e, principalmente, previsível."],["Preciso pagar pela confirmação no WhatsApp?","Depende do sistema. Alguns cobram por mensagem ou vendem pacotes. Na MIMO a confirmação e o lembrete saem pelo WhatsApp do próprio salão, inclusos no plano, sem cobrança por envio."],["Quanto custa a MIMO para um salão com oito profissionais?","MIMO Pro: R$ 49,90 com 3 agendas, mais 5 agendas a R$ 9,90, total de R$ 99,40 por mês. A partir de onze profissionais, o MIMO Pro+ a R$ 149,90 passa a compensar."]]$mimo$::jsonb
  from public.blog_categories c where c.slug = 'financeiro' on conflict (slug) do nothing;

insert into public.blog_posts (title, slug, excerpt, content, cover_image_url, cover_alt, category_id, author_name, seo_title, meta_description, og_title, og_description, og_image_url, status, published_at, reading_time_minutes, produto_url, produto_rotulo, relacionados, caixa, faq)
  select 'Como reduzir faltas no salão de beleza: confirmação, sinal e lista de espera', 'como-reduzir-faltas-no-salao-de-beleza', 'Por que a cliente falta, quanto isso custa e as seis medidas que derrubam falta na ordem em que vale aplicar: confirmação, lembrete, sinal, remarcação fácil, lista de espera e ficha da cliente.', $mimo$Falta é o custo mais silencioso do salão. Não aparece em nenhuma planilha: a cadeira ficou vazia, a profissional ficou parada, o material já estava separado, e a cliente que você recusou para aquele horário foi em outro lugar. Em salão pequeno, duas faltas por semana equivalem a um dia de trabalho perdido por mês.

A boa notícia é que falta tem padrão, e padrão se corrige. Este texto junta o que funciona, na ordem em que vale aplicar.

## Primeiro, a conta

Pegue o valor médio dos seus serviços e multiplique pelas faltas da semana passada. Depois multiplique por quatro. Esse é o número que você está pagando por mês para não ter um processo. Para um salão com ticket de R$ 80 e duas faltas por semana, são R$ 640; para R$ 150 e três faltas, R$ 1.800. Guarde o número: é com ele que você decide quanto esforço vale.

## Por que a cliente falta

Quase nunca é má-fé. Os motivos que mais aparecem quando se pergunta:

- **Esqueceu.** Marcou há três semanas, a vida aconteceu.
- **Não conseguiu avisar.** Ia desmarcar, mas o WhatsApp do salão demorou a responder, ou era tarde da noite, e ela desistiu.
- **Marcou em dois lugares** e foi no primeiro que confirmou.
- **Não sentiu compromisso.** Marcar foi fácil demais e não custou nada.
- **Imprevisto de verdade.** Esses existem e sempre vão existir.

Cada motivo tem uma resposta diferente. Mandar "multa de 50%" para todo mundo resolve o quarto e irrita os outros.

## 1. Confirmar na véspera, do jeito certo

Confirmação é a medida de maior efeito e menor custo, com três condições:

- **Automática.** Se depende de alguém lembrar de mandar, não é processo, é esperança.
- **Com contexto.** Nome da cliente, serviço, profissional, dia e hora. "Confirma seu horário?" sem detalhe gera "qual horário?".
- **Pelo número do salão.** A cliente reconhece o número, responde, e a resposta tem de voltar para a agenda, não para uma caixa de entrada.

Na MIMO a [confirmação sai pelo WhatsApp do próprio salão](/confirmacao-de-agendamento-whatsapp) na véspera, e a resposta da cliente muda o cartão na agenda: confirmado fica confirmado, cancelado libera a vaga. Quem não respondeu continua marcado como não confirmado, e a recepção decide se liga.

## 2. Lembrar perto da hora

Confirmou ontem, esqueceu hoje. O lembrete algumas horas antes resolve o "esqueci" de quem já tinha dito sim. Quantas horas antes é regra do salão: duas para quem trabalha perto, quatro para quem vem de longe.

## 3. Sinal nos serviços longos

Aqui mora o motivo "não sentiu compromisso". Não precisa ser em tudo: alongamento, coloração, progressiva, pacote de noiva. Serviço longo, material caro, horário disputado.

Como fazer sem assustar:

- Porcentagem ou valor fixo, dito antes de marcar. A cliente vê quanto é o sinal, quanto falta e qual é a regra.
- Pix na hora de marcar. O horário fica reservado quando o Pix entra; se vencer sem pagamento, a vaga volta para a agenda.
- Regra de devolução clara: até quando ela pode remarcar e levar o sinal junto.

[Sinal por Pix](/sinal-para-agendamento) muda a conversa: quem paga aparece, e quem não ia aparecer não ocupa a vaga. O artigo sobre [sinal no agendamento](/blog/sinal-no-agendamento-salao) detalha como definir o valor sem perder cliente.

## 4. Remarcar tem de ser fácil

Parece contraditório, mas quanto mais fácil remarcar, menos falta. A cliente que consegue trocar o horário às 23h pelo app não falta às 10h: ela remarcou. A que precisa esperar o salão responder às vezes desiste e simplesmente não vem.

Regras que funcionam:

- Remarcação pelo app, dentro de um prazo (24 horas é o mais comum).
- Pedido de troca entra como pedido: o horário antigo só libera quando o novo é aceito, para a agenda não ficar com dois buracos.
- Cancelamento em cima da hora fica registrado na ficha dela como tardio, sem drama e sem esquecimento.

## 5. Preencher a vaga que abriu

Mesmo com tudo acima, vai haver falta e cancelamento. A diferença entre o salão organizado e o desorganizado é o que acontece nos minutos seguintes.

Mandar "abriu vaga às 15h!" no grupo ou no status alcança quem está olhando o celular naquele instante. A [lista de espera](/lista-de-espera-para-salao) alcança quem pediu exatamente aquele serviço, com aquela profissional, naquele período. Na MIMO a vaga aparece no quadro do salão com as clientes da lista que combinam com ela; você chama duas ou três, uma aceita, a cadeira não fica parada. Se o problema do salão é mais horário vago do que falta, [este texto](/blog/como-reduzir-horarios-vagos-salao) entra fundo nisso.

## 6. Registrar e decidir na próxima

A falta registrada na ficha da cliente, junto com cancelamentos tardios e remarcações, é o que permite tratar cada caso como caso. A cliente de cinco anos que faltou uma vez não é a cliente nova que faltou duas. Com a ficha, a recepção decide: aceita normal, pede sinal, ou conversa antes de marcar de novo. O [controle de clientes](/controle-de-clientes-para-salao) é isso: a história de cada uma à mão, na hora de decidir.

## O que não fazer

- **Cobrar multa que não foi combinada.** Regra é antes, não depois.
- **Expor a cliente** em story, grupo ou balcão.
- **Bloquear de cara.** Uma falta é um dado; três são um padrão.
- **Confirmar manualmente "quando dá".** Ou é automático, ou não é.

## Para quem atende sozinha

Tudo acima vale para a manicure, a lash designer ou a cabeleireira autônoma, com um agravante: a falta é 100% do seu dia. Sinal no alongamento, remarcação pelo app e lista de espera pelo seu link estão na conta gratuita de autônoma da MIMO; a [agenda para manicure](/agenda-para-manicure) mostra como isso fica no dia a dia de quem trabalha com manutenção a cada 15 ou 20 dias.

## Por onde começar

Se for fazer uma coisa só esta semana, ligue a confirmação automática. Na semana seguinte, defina o sinal para os três serviços mais longos. Na terceira, coloque o link da lista de espera na bio. É o caminho que a maioria dos salões segue, e é a ordem do efeito. O [sistema da MIMO para salão](/sistema-para-salao-de-beleza) tem os três no mesmo lugar, ligados à mesma agenda.$mimo$, '/imagens/agenda-celular-1400.webp', 'profissional conferindo a confirmação de horário no celular ao lado da agenda', c.id, 'Equipe MIMO', 'Como reduzir faltas no salão de beleza | MIMO', 'Como reduzir faltas no salão de beleza: confirmação pelo WhatsApp na véspera, lembrete, sinal por Pix nos serviços longos, remarcação fácil e lista de espera.', 'Como reduzir faltas no salão de beleza | MIMO', 'Como reduzir faltas no salão de beleza: confirmação pelo WhatsApp na véspera, lembrete, sinal por Pix nos serviços longos, remarcação fácil e lista de espera.', 'https://mimo.com.vc/imagens/agenda-celular-1400.webp', 'published', '2026-10-11T12:00:00-03:00', 5, '/agenda-para-salao-de-beleza', 'Veja a agenda da MIMO com confirmação, sinal e lista de espera', $mimo$["sinal-no-agendamento-salao","como-reduzir-horarios-vagos-salao"]$mimo$::jsonb, $mimo${"titulo":"Na prática","texto":"Confirmação automática na véspera para todo mundo, sinal nos serviços longos, remarcação pelo app com prazo claro e lista de espera para a vaga que abrir. Quatro ajustes, uma semana para sentir a diferença."}$mimo$::jsonb, $mimo$[["Confirmação pelo WhatsApp reduz falta de verdade?","Reduz, desde que seja automática, traga serviço, profissional e hora, e saia do número que a cliente reconhece. A resposta dela precisa voltar para a agenda, não para uma caixa de entrada que alguém lê depois."],["Devo cobrar sinal de todo mundo?","Não precisa. Comece pelos serviços longos e de material caro: alongamento, coloração, progressiva, pacotes. Esmaltação e corte simples costumam ficar sem sinal, e a cliente entende a diferença."],["O que faço com a cliente que falta sempre?","Olhe a ficha: faltas, cancelamentos tardios e remarcações. Uma falta é um dado; três são um padrão. Para o padrão, peça sinal antes de marcar de novo, ou converse. Bloquear de cara perde cliente que só teve um dia ruim."],["Lista de espera funciona para preencher a vaga de quem faltou?","Funciona quando ela registra serviço, profissional e período, e não só o nome. Assim a vaga das 15h de quinta mostra quem pediu exatamente isso, e você chama duas ou três pessoas em vez de avisar o grupo inteiro."]]$mimo$::jsonb
  from public.blog_categories c where c.slug = 'agenda' on conflict (slug) do nothing;

do $$ begin raise notice '150: conteúdo da 3.2 aplicado (manicure, alternativa ao Trinks, 3 artigos)'; end $$;
