-- 149: a malha de links do SEO (3.1), nos dados que a plataforma edita.
-- Só dados: nenhuma tabela, coluna ou função muda. A regra é não passar por
-- cima do que a plataforma já editou: cada linha só é atualizada se ainda
-- estiver igual à semente da 116; se foi editada, fica como está e o aviso diz.
--
--   seo_pages:  /agenda-online-para-salao-de-beleza vira /agenda-para-salao-de-beleza
--               (o Caddy faz o 301), o hub e a agenda ganham título e descrição novos,
--               e as páginas /sistema-de-agendamento e /agendamento-online nascem.
--   blog_posts: os seis artigos ganham links no texto e o botão de produto certo.

do $$
declare n integer;
begin
  -- a agenda muda de endereço (o antigo vira 301 no Caddy); as edições da plataforma vão junto
  update public.seo_pages set route = '/agenda-para-salao-de-beleza', slug = 'agenda-para-salao-de-beleza', updated_at = now()
   where route = '/agenda-online-para-salao-de-beleza' and not exists (select 1 from public.seo_pages where route = '/agenda-para-salao-de-beleza');
  get diagnostics n = row_count;
  if n > 0 then raise notice '149: % movida para %', '/agenda-online-para-salao-de-beleza', '/agenda-para-salao-de-beleza'; end if;

  -- título e descrição novos, só onde ainda estão iguais à semente
  update public.seo_pages set title = 'Uma agenda para salão que entende como o salão funciona.', seo_title = 'Agenda para Salão de Beleza: online e por profissional | MIMO', og_title = 'Agenda para Salão de Beleza: online e por profissional | MIMO', meta_description = 'Agenda para salão de beleza online: uma coluna por profissional, duração real por serviço, bloqueios e encaixes, cliente marcando pelo link, confirmação no WhatsApp e lista de espera. 7 dias grátis.', og_description = 'Agenda para salão de beleza online: uma coluna por profissional, duração real por serviço, bloqueios e encaixes, cliente marcando pelo link, confirmação no WhatsApp e lista de espera. 7 dias grátis.', og_image_url = 'https://mimo.com.vc/imagens/agenda-celular-1400.webp', updated_at = now()
   where route = '/agenda-para-salao-de-beleza' and seo_title = 'Agenda Online para Salão de Beleza | MIMO' and meta_description = 'Agenda online para salão de beleza: a cliente marca pelo seu QR ou link, o salão vê todas as profissionais, confirma pelo WhatsApp e preenche vagas com a lista de espera.';
  get diagnostics n = row_count;
  raise notice '149: % %', '/agenda-para-salao-de-beleza', case when n > 0 then 'título e descrição atualizados' else 'mantida (editada pela plataforma ou já atualizada)' end;

  update public.seo_pages set title = 'Sistema para salão de beleza que organiza o dia inteiro: agenda, equipe e clientes.', seo_title = 'Sistema para Salão de Beleza: agenda, equipe e clientes | MIMO', og_title = 'Sistema para Salão de Beleza: agenda, equipe e clientes | MIMO', meta_description = 'Sistema para salão de beleza com agenda por profissional, agendamento online pela cliente, confirmação no WhatsApp, sinal por Pix, lista de espera e comanda. 7 dias grátis, sem cartão.', og_description = 'Sistema para salão de beleza com agenda por profissional, agendamento online pela cliente, confirmação no WhatsApp, sinal por Pix, lista de espera e comanda. 7 dias grátis, sem cartão.', og_image_url = 'https://mimo.com.vc/imagens/salao-1400.webp', updated_at = now()
   where route = '/sistema-para-salao-de-beleza' and seo_title = 'Sistema para Salão de Beleza | MIMO' and meta_description = 'Sistema para salão de beleza com agenda multi-profissional, equipe, clientes, WhatsApp, lista de espera, sinal e comanda. Organize a operação inteira com a MIMO.';
  get diagnostics n = row_count;
  raise notice '149: % %', '/sistema-para-salao-de-beleza', case when n > 0 then 'título e descrição atualizados' else 'mantida (editada pela plataforma ou já atualizada)' end;
end $$;

-- as páginas novas: a plataforma passa a poder editar título, descrição e capa delas
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type)
  values ('/sistema-de-agendamento', 'SEO_LANDING', 'Sistema de agendamento para salão, estúdio e clínica de estética.', 'sistema-de-agendamento', 'Sistema de Agendamento Online para Salão e Estúdio de Beleza | MIMO', 'Sistema de agendamento para salão de beleza, estúdio, barbearia e clínica de estética: regras por serviço e profissional, antecedência e intervalo, aceite automático ou aprovação, confirmação no WhatsApp e sinal por Pix.', 'Sistema de Agendamento Online para Salão e Estúdio de Beleza | MIMO', 'Sistema de agendamento para salão de beleza, estúdio, barbearia e clínica de estética: regras por serviço e profissional, antecedência e intervalo, aceite automático ou aprovação, confirmação no WhatsApp e sinal por Pix.', 'https://mimo.com.vc/imagens/painel-1400.webp', 'WebPage')
  on conflict (route) do nothing;
insert into public.seo_pages (route, page_type, title, slug, seo_title, meta_description, og_title, og_description, og_image_url, schema_type)
  values ('/agendamento-online', 'SEO_LANDING', 'Agendamento online: a cliente marca sozinha enquanto você atende.', 'agendamento-online', 'Agendamento Online para Salão de Beleza: a cliente marca sozinha | MIMO', 'Agendamento online para salão de beleza e profissionais: a cliente marca pelo link ou QR, só vê horários livres, confirma pelo WhatsApp, remarca pelo app e paga sinal por Pix se o salão pedir. Sem instalar nada.', 'Agendamento Online para Salão de Beleza: a cliente marca sozinha | MIMO', 'Agendamento online para salão de beleza e profissionais: a cliente marca pelo link ou QR, só vê horários livres, confirma pelo WhatsApp, remarca pelo app e paga sinal por Pix se o salão pedir. Sem instalar nada.', 'https://mimo.com.vc/imagens/qr-1400.webp', 'WebPage')
  on conflict (route) do nothing;

-- os artigos: texto com links e botão de produto, só onde o texto ainda é o da semente
do $$
declare n integer;
begin
  update public.blog_posts set content = $mimo$Uma agenda de salão parece simples enquanto existem poucos horários para controlar.

O problema começa quando entram [várias profissionais](/agenda-multi-profissional), serviços com durações diferentes, pausas, encaixes, clientes que atrasam, cancelamentos e mensagens chegando ao mesmo tempo pelo WhatsApp.

Nessa hora, a agenda deixa de ser apenas uma lista de nomes e passa a ser parte da operação do salão.

Organizar bem não significa criar regras demais. Significa deixar claro quem atende, o que atende, em qual horário e o que acontece quando alguma coisa muda.

Neste guia, você vai ver uma forma prática de organizar essa rotina.

## 1. Comece pelos horários reais da equipe

O primeiro erro é montar a agenda com base apenas no horário de funcionamento do salão.

Se o salão abre das 9h às 19h, isso não significa que todas as profissionais estão disponíveis nesse mesmo período.

Cada profissional pode ter:

- dias diferentes;
- horário de entrada e saída;
- intervalo;
- folga;
- bloqueios;
- serviços específicos.

Por isso, a agenda precisa nascer da disponibilidade real de cada pessoa. Uma [agenda para salão de beleza](/agenda-para-salao-de-beleza) feita para isso parte do horário de cada profissional, não do horário da porta.

Uma forma simples é cadastrar primeiro o horário padrão do salão e depois ajustar apenas as profissionais que fogem desse padrão.

Isso reduz trabalho e mantém a agenda coerente.

## 2. Cadastre duração real dos serviços

Se uma escova leva 45 minutos, não trate como 30.

Se uma progressiva ocupa três horas, esse tempo precisa estar reservado.

Quando a duração está errada, o salão cria atrasos em cascata.

A profissional termina um atendimento depois do previsto, a próxima cliente espera, a recepção tenta reorganizar tudo e o restante do dia começa a escorregar.

Para cada serviço, registre pelo menos:

- nome;
- duração;
- preço;
- profissionais que realizam.

Se determinadas profissionais levam tempos diferentes no mesmo serviço, a agenda deve permitir essa configuração individual.

## 3. Separe horário livre de horário disponível

Um espaço vazio no calendário não significa necessariamente que ele pode receber qualquer atendimento.

Imagine um intervalo de 50 minutos.

Ele pode servir para uma manicure de 45 minutos, mas não para uma coloração de duas horas.

A disponibilidade precisa considerar:

- duração do serviço;
- profissional escolhida;
- bloqueios;
- pausas;
- outros atendimentos.

É isso que impede a agenda de oferecer um horário que, na prática, não existe.

## 4. Use bloqueios para tudo que não é atendimento

Almoço, reunião, compromisso pessoal, treinamento e folga não devem ficar “na cabeça” da equipe.

Bloqueie na agenda.

Quanto mais informação importante fica fora do sistema, mais a recepção depende de perguntar.

Uma agenda organizada responde sozinha:

“Ela pode atender nesse horário?”

## 5. Tenha uma regra clara para encaixes

Encaixe não precisa significar bagunça.

Antes de aceitar, confira:

1. qual serviço será realizado;
2. quanto tempo ele exige;
3. quem está disponível;
4. se existe margem antes do próximo atendimento.

O melhor encaixe é aquele que ocupa um espaço real sem empurrar atraso para as próximas clientes.

## 6. Trate cancelamento como oportunidade

Quando alguém cancela, aparece um novo problema: um horário que estava vendido agora está vazio.

Se o salão possui [lista de espera](/lista-de-espera-para-salao), essa vaga pode voltar a ser útil.

Uma boa lista de espera registra:

- serviço desejado;
- profissional preferida;
- dias possíveis;
- faixa de horário.

Assim, quando uma vaga surge, fica mais fácil encontrar uma cliente compatível.

## 7. Centralize a informação

O pior cenário é este:

- agenda no papel;
- confirmação no WhatsApp;
- folga num grupo;
- pagamento em outro lugar;
- retorno anotado em uma planilha.

O objetivo de um sistema não deveria ser apenas digitalizar o caderno.

Ele deveria conectar essas informações. É o que separa um caderno digital de um [sistema para salão de beleza](/sistema-para-salao-de-beleza).

Quando a cliente agenda, o salão já deveria saber:

- serviço;
- profissional;
- duração;
- valor;
- status;
- origem;
- necessidade de sinal;
- histórico da cliente.

Isso reduz perguntas e retrabalho.

## 8. Revise a agenda todos os dias

Não precisa de uma reunião.

Cinco minutos no começo do dia já ajudam.

Olhe:

- atendimentos confirmados;
- pendentes;
- horários livres;
- cancelamentos;
- clientes em espera.

A ideia é descobrir os problemas antes que eles aconteçam.

## Conclusão

Organizar a agenda não é colocar mais regra no salão.

É tirar informação da memória das pessoas e colocar num fluxo que todo mundo entende.

Quando horários, serviços, profissionais e clientes estão conectados, a recepção trabalha melhor, a profissional recebe uma agenda mais clara e a cliente encontra menos atrito para marcar.

A MIMO foi construída exatamente em torno dessa lógica: a agenda é o ponto de partida, mas ela precisa conversar com o restante da operação.$mimo$, produto_url = '/agenda-para-salao-de-beleza', produto_rotulo = 'Conheça a agenda da MIMO para salões', updated_at = now()
   where slug = 'como-organizar-agenda-salao-de-beleza' and md5(content) = md5($mimo$Uma agenda de salão parece simples enquanto existem poucos horários para controlar.

O problema começa quando entram várias profissionais, serviços com durações diferentes, pausas, encaixes, clientes que atrasam, cancelamentos e mensagens chegando ao mesmo tempo pelo WhatsApp.

Nessa hora, a agenda deixa de ser apenas uma lista de nomes e passa a ser parte da operação do salão.

Organizar bem não significa criar regras demais. Significa deixar claro quem atende, o que atende, em qual horário e o que acontece quando alguma coisa muda.

Neste guia, você vai ver uma forma prática de organizar essa rotina.

## 1. Comece pelos horários reais da equipe

O primeiro erro é montar a agenda com base apenas no horário de funcionamento do salão.

Se o salão abre das 9h às 19h, isso não significa que todas as profissionais estão disponíveis nesse mesmo período.

Cada profissional pode ter:

- dias diferentes;
- horário de entrada e saída;
- intervalo;
- folga;
- bloqueios;
- serviços específicos.

Por isso, a agenda precisa nascer da disponibilidade real de cada pessoa.

Uma forma simples é cadastrar primeiro o horário padrão do salão e depois ajustar apenas as profissionais que fogem desse padrão.

Isso reduz trabalho e mantém a agenda coerente.

## 2. Cadastre duração real dos serviços

Se uma escova leva 45 minutos, não trate como 30.

Se uma progressiva ocupa três horas, esse tempo precisa estar reservado.

Quando a duração está errada, o salão cria atrasos em cascata.

A profissional termina um atendimento depois do previsto, a próxima cliente espera, a recepção tenta reorganizar tudo e o restante do dia começa a escorregar.

Para cada serviço, registre pelo menos:

- nome;
- duração;
- preço;
- profissionais que realizam.

Se determinadas profissionais levam tempos diferentes no mesmo serviço, a agenda deve permitir essa configuração individual.

## 3. Separe horário livre de horário disponível

Um espaço vazio no calendário não significa necessariamente que ele pode receber qualquer atendimento.

Imagine um intervalo de 50 minutos.

Ele pode servir para uma manicure de 45 minutos, mas não para uma coloração de duas horas.

A disponibilidade precisa considerar:

- duração do serviço;
- profissional escolhida;
- bloqueios;
- pausas;
- outros atendimentos.

É isso que impede a agenda de oferecer um horário que, na prática, não existe.

## 4. Use bloqueios para tudo que não é atendimento

Almoço, reunião, compromisso pessoal, treinamento e folga não devem ficar “na cabeça” da equipe.

Bloqueie na agenda.

Quanto mais informação importante fica fora do sistema, mais a recepção depende de perguntar.

Uma agenda organizada responde sozinha:

“Ela pode atender nesse horário?”

## 5. Tenha uma regra clara para encaixes

Encaixe não precisa significar bagunça.

Antes de aceitar, confira:

1. qual serviço será realizado;
2. quanto tempo ele exige;
3. quem está disponível;
4. se existe margem antes do próximo atendimento.

O melhor encaixe é aquele que ocupa um espaço real sem empurrar atraso para as próximas clientes.

## 6. Trate cancelamento como oportunidade

Quando alguém cancela, aparece um novo problema: um horário que estava vendido agora está vazio.

Se o salão possui lista de espera, essa vaga pode voltar a ser útil.

Uma boa lista de espera registra:

- serviço desejado;
- profissional preferida;
- dias possíveis;
- faixa de horário.

Assim, quando uma vaga surge, fica mais fácil encontrar uma cliente compatível.

## 7. Centralize a informação

O pior cenário é este:

- agenda no papel;
- confirmação no WhatsApp;
- folga num grupo;
- pagamento em outro lugar;
- retorno anotado em uma planilha.

O objetivo de um sistema não deveria ser apenas digitalizar o caderno.

Ele deveria conectar essas informações.

Quando a cliente agenda, o salão já deveria saber:

- serviço;
- profissional;
- duração;
- valor;
- status;
- origem;
- necessidade de sinal;
- histórico da cliente.

Isso reduz perguntas e retrabalho.

## 8. Revise a agenda todos os dias

Não precisa de uma reunião.

Cinco minutos no começo do dia já ajudam.

Olhe:

- atendimentos confirmados;
- pendentes;
- horários livres;
- cancelamentos;
- clientes em espera.

A ideia é descobrir os problemas antes que eles aconteçam.

## Conclusão

Organizar a agenda não é colocar mais regra no salão.

É tirar informação da memória das pessoas e colocar num fluxo que todo mundo entende.

Quando horários, serviços, profissionais e clientes estão conectados, a recepção trabalha melhor, a profissional recebe uma agenda mais clara e a cliente encontra menos atrito para marcar.

A MIMO foi construída exatamente em torno dessa lógica: a agenda é o ponto de partida, mas ela precisa conversar com o restante da operação.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'como-organizar-agenda-salao-de-beleza', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
  update public.blog_posts set content = $mimo$Uma cadeira vazia custa mais do que parece.

O salão continua pagando aluguel, energia e estrutura. A profissional reservou aquele período. E uma cliente que poderia estar ali talvez nem saiba que o horário ficou disponível.

Nenhum salão consegue eliminar totalmente os espaços vagos, mas dá para reduzir bastante o desperdício de agenda quando a operação reage rápido.

## 1. Descubra de onde os vazios vêm

Antes de tentar preencher, entenda a causa.

Os espaços normalmente aparecem por:

- cancelamento;
- falta;
- horários difíceis;
- serviços mal distribuídos;
- agenda aberta sem estratégia;
- intervalos que não comportam os serviços disponíveis.

Observe durante algumas semanas.

Quais dias têm mais buracos?

Quais profissionais?

Quais horários?

Quais serviços cancelam mais?

Sem isso, o salão tenta resolver tudo com promoção.

## 2. Confirme os atendimentos

Muita falta acontece porque o compromisso simplesmente saiu da cabeça da cliente.

Uma [confirmação pelo WhatsApp](/confirmacao-de-agendamento-whatsapp) próxima ao atendimento reduz esse risco e ainda abre tempo para agir caso ela precise cancelar.

A mensagem deve ser curta.

Exemplo:

“Oi, Camila. Seu horário no Studio Essenza é amanhã às 14h para escova com a Melissa. Pode confirmar?”

Se a cliente disser que não consegue ir, o salão ganha algumas horas para procurar substituta.

## 3. Crie uma lista de espera útil

Uma [lista de espera](/lista-de-espera-para-salao) com apenas nomes não resolve muita coisa.

Registre também:

- serviço;
- profissional;
- dias disponíveis;
- período preferido;
- contato.

Quando aparece uma vaga de manicure às 16h, o salão não precisa mandar mensagem para vinte pessoas.

Ele procura quem realmente combina com aquele horário.

## 4. Trabalhe o retorno antes da agenda esvaziar

Nem todo horário precisa ser preenchido por cliente nova.

Muitas vezes existe uma cliente antiga que já deveria ter voltado.

Exemplos:

- manutenção de unha;
- retoque;
- cílios;
- coloração;
- tratamento;
- sobrancelha.

O salão pode acompanhar quem está chegando no período normal de retorno e fazer contato antes que essa cliente desapareça.

## 5. Facilite o reagendamento

Cancelar e remarcar são coisas diferentes.

Se remarcar for difícil, a cliente cancela e “depois vê”.

Se houver uma forma simples de escolher outro horário, aumenta a chance de o atendimento continuar dentro da agenda. É para isso que serve o [agendamento online](/agendamento-online): a cliente remarca sozinha, no link do salão.

## 6. Evite criar buracos impossíveis

Um espaço de 20 minutos entre dois atendimentos dificilmente vende.

Às vezes isso acontece porque os serviços foram encaixados sem considerar duração e sequência.

Observe se a distribuição da agenda está criando muitos intervalos pequenos.

Sempre que possível, priorize combinações que preservem blocos utilizáveis.

## 7. Use sinal quando fizer sentido

Para serviços mais longos ou horários muito disputados, um [sinal no agendamento](/sinal-para-agendamento) pode aumentar o compromisso da reserva.

A política precisa estar clara antes do pagamento.

Explique:

- valor;
- condições de cancelamento;
- como funciona o reagendamento;
- quando existe estorno ou crédito.

Não transforme o sinal em punição.

Ele deve ajudar a dar previsibilidade para os dois lados.

## 8. Meça o que está acontecendo

Alguns números simples já ajudam:

- horários disponíveis;
- agendamentos;
- cancelamentos;
- faltas;
- vagas recuperadas;
- clientes que retornaram.

O salão não precisa de cinquenta gráficos.

Precisa enxergar onde a agenda está vazando.

## Conclusão

Horário vazio não se resolve só com desconto.

A solução costuma ser uma combinação de organização, confirmação, lista de espera e relacionamento com clientes que já conhecem o salão.

A MIMO conecta essas partes para que uma vaga liberada não seja apenas um buraco no calendário, mas uma oportunidade de ação.$mimo$, produto_url = '/lista-de-espera-para-salao', produto_rotulo = 'Veja como a lista de espera funciona na MIMO', updated_at = now()
   where slug = 'como-reduzir-horarios-vagos-salao' and md5(content) = md5($mimo$Uma cadeira vazia custa mais do que parece.

O salão continua pagando aluguel, energia e estrutura. A profissional reservou aquele período. E uma cliente que poderia estar ali talvez nem saiba que o horário ficou disponível.

Nenhum salão consegue eliminar totalmente os espaços vagos, mas dá para reduzir bastante o desperdício de agenda quando a operação reage rápido.

## 1. Descubra de onde os vazios vêm

Antes de tentar preencher, entenda a causa.

Os espaços normalmente aparecem por:

- cancelamento;
- falta;
- horários difíceis;
- serviços mal distribuídos;
- agenda aberta sem estratégia;
- intervalos que não comportam os serviços disponíveis.

Observe durante algumas semanas.

Quais dias têm mais buracos?

Quais profissionais?

Quais horários?

Quais serviços cancelam mais?

Sem isso, o salão tenta resolver tudo com promoção.

## 2. Confirme os atendimentos

Muita falta acontece porque o compromisso simplesmente saiu da cabeça da cliente.

Uma confirmação próxima ao atendimento reduz esse risco e ainda abre tempo para agir caso ela precise cancelar.

A mensagem deve ser curta.

Exemplo:

“Oi, Camila. Seu horário no Studio Essenza é amanhã às 14h para escova com a Melissa. Pode confirmar?”

Se a cliente disser que não consegue ir, o salão ganha algumas horas para procurar substituta.

## 3. Crie uma lista de espera útil

Uma lista com apenas nomes não resolve muita coisa.

Registre também:

- serviço;
- profissional;
- dias disponíveis;
- período preferido;
- contato.

Quando aparece uma vaga de manicure às 16h, o salão não precisa mandar mensagem para vinte pessoas.

Ele procura quem realmente combina com aquele horário.

## 4. Trabalhe o retorno antes da agenda esvaziar

Nem todo horário precisa ser preenchido por cliente nova.

Muitas vezes existe uma cliente antiga que já deveria ter voltado.

Exemplos:

- manutenção de unha;
- retoque;
- cílios;
- coloração;
- tratamento;
- sobrancelha.

O salão pode acompanhar quem está chegando no período normal de retorno e fazer contato antes que essa cliente desapareça.

## 5. Facilite o reagendamento

Cancelar e remarcar são coisas diferentes.

Se remarcar for difícil, a cliente cancela e “depois vê”.

Se houver uma forma simples de escolher outro horário, aumenta a chance de o atendimento continuar dentro da agenda.

## 6. Evite criar buracos impossíveis

Um espaço de 20 minutos entre dois atendimentos dificilmente vende.

Às vezes isso acontece porque os serviços foram encaixados sem considerar duração e sequência.

Observe se a distribuição da agenda está criando muitos intervalos pequenos.

Sempre que possível, priorize combinações que preservem blocos utilizáveis.

## 7. Use sinal quando fizer sentido

Para serviços mais longos ou horários muito disputados, um sinal pode aumentar o compromisso da reserva.

A política precisa estar clara antes do pagamento.

Explique:

- valor;
- condições de cancelamento;
- como funciona o reagendamento;
- quando existe estorno ou crédito.

Não transforme o sinal em punição.

Ele deve ajudar a dar previsibilidade para os dois lados.

## 8. Meça o que está acontecendo

Alguns números simples já ajudam:

- horários disponíveis;
- agendamentos;
- cancelamentos;
- faltas;
- vagas recuperadas;
- clientes que retornaram.

O salão não precisa de cinquenta gráficos.

Precisa enxergar onde a agenda está vazando.

## Conclusão

Horário vazio não se resolve só com desconto.

A solução costuma ser uma combinação de organização, confirmação, lista de espera e relacionamento com clientes que já conhecem o salão.

A MIMO conecta essas partes para que uma vaga liberada não seja apenas um buraco no calendário, mas uma oportunidade de ação.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'como-reduzir-horarios-vagos-salao', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
  update public.blog_posts set content = $mimo$A cliente sai satisfeita, diz que volta e o salão acredita que vai lembrar dela.

Só que chegam outras mensagens, novos atendimentos, problemas do dia e, algumas semanas depois, ninguém lembra exatamente quem deveria ter voltado.

Retenção não começa com uma campanha sofisticada.

Começa com memória organizada.

## 1. Cada serviço tem um ritmo

Nem toda cliente volta no mesmo intervalo.

Manutenção de unhas pode ter um ciclo.

Cílios, outro.

Cabelo e tratamentos também.

Por isso, o primeiro passo é entender quais serviços têm retorno previsível.

O salão não precisa impor uma data exata, mas pode trabalhar com uma janela aproximada.

## 2. Registre o último atendimento

O mínimo necessário:

- data;
- serviço;
- profissional;
- observações relevantes.

Com isso, já é possível identificar clientes que estão chegando na época de voltar. Um [controle de clientes para salão](/controle-de-clientes-para-salao) faz essa conta sozinho, serviço por serviço.

## 3. Faça contato com contexto

Evite mensagem genérica:

“Oi, estamos com horários disponíveis.”

Prefira contexto:

“Oi, Mariana. Vi que já faz algumas semanas desde sua manutenção em gel. A Ana abriu alguns horários essa semana. Quer que eu te mande?”

A mensagem parece atendimento, não disparo.

## 4. Não mande para todo mundo

Nem toda cliente precisa receber mensagem toda semana.

Crie grupos simples:

- retorno próximo;
- atrasada no retorno;
- aniversário;
- sem atendimento há muito tempo.

Isso evita cansar a base.

## 5. Preserve a relação com a profissional

Em muitos salões, a cliente possui vínculo forte com quem atende.

Essa informação importa.

Se a cliente costuma fazer determinado serviço com determinada profissional, o sistema deve preservar esse contexto.

Assim, o salão não trata toda a carteira como uma lista anônima.

## 6. Dê caminho fácil para marcar

A mensagem de retorno deveria terminar com um próximo passo.

Por exemplo:

- link do salão;
- link da profissional;
- resposta pelo WhatsApp;
- opções de horários.

Quanto mais etapas, maior a chance de a cliente deixar para depois. Com [agendamento online](/agendamento-online), o próximo passo é um toque: ela abre o link e marca.

## 7. Observe quem realmente voltou

O salão precisa diferenciar:

“mensagem enviada”

de:

“cliente voltou”.

O objetivo não é disparar contato.

É recuperar relacionamento.

## Conclusão

Fidelização não precisa nascer de pontos, cupom ou clube.

Ela pode começar com algo muito simples: lembrar da cliente no momento certo.

A MIMO organiza histórico e retorno justamente para transformar uma informação esquecida numa ação concreta.$mimo$, produto_url = '/controle-de-clientes-para-salao', produto_rotulo = 'Veja o retorno de clientes na MIMO', updated_at = now()
   where slug = 'como-fazer-clientes-voltarem-salao' and md5(content) = md5($mimo$A cliente sai satisfeita, diz que volta e o salão acredita que vai lembrar dela.

Só que chegam outras mensagens, novos atendimentos, problemas do dia e, algumas semanas depois, ninguém lembra exatamente quem deveria ter voltado.

Retenção não começa com uma campanha sofisticada.

Começa com memória organizada.

## 1. Cada serviço tem um ritmo

Nem toda cliente volta no mesmo intervalo.

Manutenção de unhas pode ter um ciclo.

Cílios, outro.

Cabelo e tratamentos também.

Por isso, o primeiro passo é entender quais serviços têm retorno previsível.

O salão não precisa impor uma data exata, mas pode trabalhar com uma janela aproximada.

## 2. Registre o último atendimento

O mínimo necessário:

- data;
- serviço;
- profissional;
- observações relevantes.

Com isso, já é possível identificar clientes que estão chegando na época de voltar.

## 3. Faça contato com contexto

Evite mensagem genérica:

“Oi, estamos com horários disponíveis.”

Prefira contexto:

“Oi, Mariana. Vi que já faz algumas semanas desde sua manutenção em gel. A Ana abriu alguns horários essa semana. Quer que eu te mande?”

A mensagem parece atendimento, não disparo.

## 4. Não mande para todo mundo

Nem toda cliente precisa receber mensagem toda semana.

Crie grupos simples:

- retorno próximo;
- atrasada no retorno;
- aniversário;
- sem atendimento há muito tempo.

Isso evita cansar a base.

## 5. Preserve a relação com a profissional

Em muitos salões, a cliente possui vínculo forte com quem atende.

Essa informação importa.

Se a cliente costuma fazer determinado serviço com determinada profissional, o sistema deve preservar esse contexto.

Assim, o salão não trata toda a carteira como uma lista anônima.

## 6. Dê caminho fácil para marcar

A mensagem de retorno deveria terminar com um próximo passo.

Por exemplo:

- link do salão;
- link da profissional;
- resposta pelo WhatsApp;
- opções de horários.

Quanto mais etapas, maior a chance de a cliente deixar para depois.

## 7. Observe quem realmente voltou

O salão precisa diferenciar:

“mensagem enviada”

de:

“cliente voltou”.

O objetivo não é disparar contato.

É recuperar relacionamento.

## Conclusão

Fidelização não precisa nascer de pontos, cupom ou clube.

Ela pode começar com algo muito simples: lembrar da cliente no momento certo.

A MIMO organiza histórico e retorno justamente para transformar uma informação esquecida numa ação concreta.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'como-fazer-clientes-voltarem-salao', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
  update public.blog_posts set content = $mimo$Quando apenas uma pessoa atende, qualquer agenda simples pode funcionar.

Quando entram quatro, seis ou dez profissionais, a lógica muda.

Agora existem agendas paralelas, serviços diferentes, horários individuais, folgas, clientes preferenciais e regras específicas.

O salão precisa enxergar o todo sem apagar a individualidade de cada profissional.

## 1. Uma agenda por profissional, uma visão para o salão

Cada profissional precisa ter seu calendário.

Ao mesmo tempo, a gestão precisa enxergar todas elas juntas. É o que uma [agenda multi-profissional](/agenda-multi-profissional) faz: uma coluna por pessoa, uma tela para o salão.

São duas visões da mesma operação:

- individual;
- geral.

A recepção usa a visão geral para procurar disponibilidade.

A profissional usa sua agenda para entender o próprio dia.

## 2. Defina quem realiza cada serviço

Nem todas fazem tudo.

Ao cadastrar um serviço, relacione quem pode executá-lo.

Isso evita oferecer manicure para uma profissional de cabelo ou colocar uma química com alguém que não realiza aquele procedimento. Num [sistema para salão de beleza](/sistema-para-salao-de-beleza), serviço e profissional andam juntos desde o cadastro.

## 3. Permita tempo individual por serviço

Duas profissionais podem fazer o mesmo serviço em tempos diferentes.

Uma pode levar 45 minutos.

Outra, uma hora.

Quando necessário, permita que o tempo padrão do salão seja substituído por um tempo individual.

## 4. Configure horários sem repetir trabalho

Use o horário do salão como base.

Depois altere apenas quem trabalha diferente.

Exemplo:

Salão:
terça a sábado, 9h às 19h.

Profissional A:
segue padrão.

Profissional B:
quarta a sábado.

Profissional C:
terça a sexta, até 17h.

É mais rápido do que configurar tudo do zero para cada pessoa.

## 5. Use bloqueios individuais

Folga, almoço, evento e compromisso pessoal precisam ser aplicados na agenda correta.

Um bloqueio da Ana não pode fechar a agenda da Bruna.

## 6. Defina permissões

Nem toda profissional precisa gerenciar tudo.

Algumas podem:

- visualizar agenda;
- confirmar atendimento;
- bloquear horário.

Outras talvez não devam:

- alterar preço;
- mudar regra financeira;
- editar serviço;
- mexer em outra agenda.

Permissão deve acompanhar a responsabilidade real.

## 7. Registre o tipo de vínculo operacional

O salão pode trabalhar com profissionais em modelos diferentes.

Por exemplo:

- parceira;
- funcionária;
- autônoma vinculada;
- aluguel de espaço;
- temporária.

Na MIMO, o tipo de vínculo pode funcionar como um preset operacional.

Depois o salão ajusta serviços, horários e permissões individualmente.

## Conclusão

Uma agenda multi-profissional boa não é apenas um calendário com várias colunas.

Ela precisa entender quem trabalha, quando trabalha e o que pode fazer.

A gestão ganha visão geral e cada profissional continua com uma rotina clara.$mimo$, produto_url = '/agenda-multi-profissional', produto_rotulo = 'Veja a agenda geral e por profissional na MIMO', updated_at = now()
   where slug = 'agenda-multi-profissional-salao' and md5(content) = md5($mimo$Quando apenas uma pessoa atende, qualquer agenda simples pode funcionar.

Quando entram quatro, seis ou dez profissionais, a lógica muda.

Agora existem agendas paralelas, serviços diferentes, horários individuais, folgas, clientes preferenciais e regras específicas.

O salão precisa enxergar o todo sem apagar a individualidade de cada profissional.

## 1. Uma agenda por profissional, uma visão para o salão

Cada profissional precisa ter seu calendário.

Ao mesmo tempo, a gestão precisa enxergar todas elas juntas.

São duas visões da mesma operação:

- individual;
- geral.

A recepção usa a visão geral para procurar disponibilidade.

A profissional usa sua agenda para entender o próprio dia.

## 2. Defina quem realiza cada serviço

Nem todas fazem tudo.

Ao cadastrar um serviço, relacione quem pode executá-lo.

Isso evita oferecer manicure para uma profissional de cabelo ou colocar uma química com alguém que não realiza aquele procedimento.

## 3. Permita tempo individual por serviço

Duas profissionais podem fazer o mesmo serviço em tempos diferentes.

Uma pode levar 45 minutos.

Outra, uma hora.

Quando necessário, permita que o tempo padrão do salão seja substituído por um tempo individual.

## 4. Configure horários sem repetir trabalho

Use o horário do salão como base.

Depois altere apenas quem trabalha diferente.

Exemplo:

Salão:
terça a sábado, 9h às 19h.

Profissional A:
segue padrão.

Profissional B:
quarta a sábado.

Profissional C:
terça a sexta, até 17h.

É mais rápido do que configurar tudo do zero para cada pessoa.

## 5. Use bloqueios individuais

Folga, almoço, evento e compromisso pessoal precisam ser aplicados na agenda correta.

Um bloqueio da Ana não pode fechar a agenda da Bruna.

## 6. Defina permissões

Nem toda profissional precisa gerenciar tudo.

Algumas podem:

- visualizar agenda;
- confirmar atendimento;
- bloquear horário.

Outras talvez não devam:

- alterar preço;
- mudar regra financeira;
- editar serviço;
- mexer em outra agenda.

Permissão deve acompanhar a responsabilidade real.

## 7. Registre o tipo de vínculo operacional

O salão pode trabalhar com profissionais em modelos diferentes.

Por exemplo:

- parceira;
- funcionária;
- autônoma vinculada;
- aluguel de espaço;
- temporária.

Na MIMO, o tipo de vínculo pode funcionar como um preset operacional.

Depois o salão ajusta serviços, horários e permissões individualmente.

## Conclusão

Uma agenda multi-profissional boa não é apenas um calendário com várias colunas.

Ela precisa entender quem trabalha, quando trabalha e o que pode fazer.

A gestão ganha visão geral e cada profissional continua com uma rotina clara.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'agenda-multi-profissional-salao', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
  update public.blog_posts set content = $mimo$O sinal pode ajudar o salão a proteger horários longos e muito disputados.

Mas, se for aplicado sem clareza, também pode criar desconforto.

O segredo está menos no valor e mais na regra.

A cliente precisa entender o que está pagando e o que acontece se precisar mudar o horário. Na MIMO, o [sinal por Pix](/sinal-para-agendamento) mostra valor, restante e regra antes de a cliente pagar.

## 1. Quando o sinal faz mais sentido

Ele costuma ser mais útil em:

- procedimentos longos;
- serviços com materiais preparados antecipadamente;
- horários muito disputados;
- agendas com alto índice de cancelamento.

Não é obrigatório cobrar sinal de todo serviço.

## 2. Explique antes do pagamento

Mostre:

- valor do serviço;
- valor do sinal;
- valor restante;
- política de cancelamento;
- regra de reagendamento.

A cliente não deve descobrir as regras depois de pagar.

## 3. Sinal não precisa ser o pagamento completo

Exemplo:

Serviço: R$ 180  
Sinal: R$ 50  
Restante: R$ 130

Isso já cria compromisso sem exigir pagamento integral antecipado.

## 4. Tenha política de reagendamento

Imprevistos existem.

Uma política equilibrada pode permitir reagendamento dentro de determinado prazo.

O importante é ser simples e previsível.

## 5. Registre tudo junto do agendamento

Não deixe o sinal solto em conversa.

O atendimento deveria mostrar:

- valor;
- status;
- data;
- pagamento;
- eventual estorno ou crédito.

Assim a recepção não precisa reconstruir a história pelo WhatsApp. Quando o sinal nasce dentro do [agendamento online](/agendamento-online), isso vem de graça.

## 6. Valide sua política

Regras financeiras e de cancelamento precisam ser compatíveis com a realidade jurídica e comercial do negócio.

A MIMO pode organizar a configuração e o registro, mas o salão deve validar sua política com orientação adequada quando necessário.

## Conclusão

O melhor sinal é aquele que aumenta compromisso sem criar sensação de armadilha.

Transparência, valor razoável e regra clara são mais importantes que rigidez.$mimo$, produto_url = '/sinal-para-agendamento', produto_rotulo = 'Veja sinal e pagamento ligados ao atendimento na MIMO', updated_at = now()
   where slug = 'sinal-no-agendamento-salao' and md5(content) = md5($mimo$O sinal pode ajudar o salão a proteger horários longos e muito disputados.

Mas, se for aplicado sem clareza, também pode criar desconforto.

O segredo está menos no valor e mais na regra.

A cliente precisa entender o que está pagando e o que acontece se precisar mudar o horário.

## 1. Quando o sinal faz mais sentido

Ele costuma ser mais útil em:

- procedimentos longos;
- serviços com materiais preparados antecipadamente;
- horários muito disputados;
- agendas com alto índice de cancelamento.

Não é obrigatório cobrar sinal de todo serviço.

## 2. Explique antes do pagamento

Mostre:

- valor do serviço;
- valor do sinal;
- valor restante;
- política de cancelamento;
- regra de reagendamento.

A cliente não deve descobrir as regras depois de pagar.

## 3. Sinal não precisa ser o pagamento completo

Exemplo:

Serviço: R$ 180  
Sinal: R$ 50  
Restante: R$ 130

Isso já cria compromisso sem exigir pagamento integral antecipado.

## 4. Tenha política de reagendamento

Imprevistos existem.

Uma política equilibrada pode permitir reagendamento dentro de determinado prazo.

O importante é ser simples e previsível.

## 5. Registre tudo junto do agendamento

Não deixe o sinal solto em conversa.

O atendimento deveria mostrar:

- valor;
- status;
- data;
- pagamento;
- eventual estorno ou crédito.

Assim a recepção não precisa reconstruir a história pelo WhatsApp.

## 6. Valide sua política

Regras financeiras e de cancelamento precisam ser compatíveis com a realidade jurídica e comercial do negócio.

A MIMO pode organizar a configuração e o registro, mas o salão deve validar sua política com orientação adequada quando necessário.

## Conclusão

O melhor sinal é aquele que aumenta compromisso sem criar sensação de armadilha.

Transparência, valor razoável e regra clara são mais importantes que rigidez.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'sinal-no-agendamento-salao', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
  update public.blog_posts set content = $mimo$Existem sistemas de salão cheios de funcionalidades.

Isso não significa que todos servem para o seu negócio.

O melhor sistema não é necessariamente o que possui mais menus.

É o que resolve sua rotina sem criar um novo trabalho para ser administrado.

Antes de escolher, observe alguns pontos.

## 1. A agenda funciona do jeito que sua equipe trabalha?

Veja se é possível configurar:

- horários por profissional;
- serviços diferentes;
- duração;
- bloqueios;
- folgas;
- encaixes;
- reagendamento.

Se a agenda não representa a rotina real, o salão volta para o WhatsApp. Veja o que uma [agenda para salão de beleza](/agenda-para-salao-de-beleza) precisa ter antes de qualquer outro módulo.

## 2. A recepção enxerga o salão inteiro?

Um salão com equipe precisa de visão geral.

Procure saber se existe:

- agenda geral;
- agenda por profissional;
- filtro de status;
- busca de cliente;
- disponibilidade.

## 3. O sistema ajuda depois do atendimento?

Cadastrar cliente é básico.

Pergunte se o sistema ajuda a entender:

- histórico;
- último atendimento;
- profissional;
- retorno;
- preferências;
- cancelamentos.

É aqui que cadastro começa a virar relacionamento.

## 4. WhatsApp está ligado à agenda?

Lembrete isolado é útil, e [confirmação pelo WhatsApp ligada à agenda](/confirmacao-de-agendamento-whatsapp) é melhor ainda.

Mas é melhor quando comunicação acompanha eventos reais:

- confirmação;
- cancelamento;
- reagendamento;
- retorno.

## 5. Como funciona a equipe?

Se há profissionais com formas diferentes de trabalho, veja se o sistema permite configurar:

- serviços;
- agenda;
- horários;
- permissões;
- comissões;
- vínculo operacional.

## 6. O financeiro é proporcional à sua necessidade?

Um salão pequeno talvez não precise de um ERP completo.

Mas pode precisar de:

- sinal;
- pagamento;
- comanda;
- caixa;
- comissão.

Escolha profundidade compatível com a operação. Sinal e [comissão por profissional](/sistema-de-comissao-para-salao) costumam ser o primeiro degrau.

## 7. O preço é fácil de entender?

Desconfie quando você não consegue descobrir nem aproximadamente quanto vai pagar.

Avalie:

- mensalidade;
- cobrança por profissional;
- taxas de pagamento;
- funcionalidades extras;
- custo de implantação.

## 8. É fácil começar?

Um software pode ser excelente e ainda fracassar na implantação.

Veja quanto tempo leva para:

- cadastrar serviços;
- adicionar profissionais;
- configurar horários;
- colocar a primeira agenda para funcionar.

## 9. O sistema preserva seu relacionamento com clientes?

Essa pergunta é especialmente importante quando a plataforma também possui marketplace.

Entenda:

- como o cliente encontra seu negócio;
- quem controla a relação;
- como a origem é registrada;
- se seus dados são usados para direcionar o cliente para concorrentes.

## 10. Teste com a rotina real

Não avalie apenas uma demonstração bonita.

Use durante alguns dias.

Cadastre profissionais reais.

Marque horários.

Cancele.

Reagende.

Bloqueie um almoço.

Veja se a ferramenta continua simples quando a rotina fica menos perfeita. É exatamente o teste que vale fazer com um [sistema de agendamento](/sistema-de-agendamento) antes de assinar.

## Conclusão

Escolher sistema para salão não é comparar uma lista de cinquenta funcionalidades.

É entender qual ferramenta representa melhor a sua operação.

A MIMO segue essa filosofia: agenda, equipe, clientes e relacionamento conectados em uma experiência que tenta reduzir trabalho, não criar mais um painel para administrar.$mimo$, produto_url = '/sistema-para-salao-de-beleza', produto_rotulo = 'Conheça o sistema da MIMO para salões', updated_at = now()
   where slug = 'como-escolher-sistema-para-salao-de-beleza' and md5(content) = md5($mimo$Existem sistemas de salão cheios de funcionalidades.

Isso não significa que todos servem para o seu negócio.

O melhor sistema não é necessariamente o que possui mais menus.

É o que resolve sua rotina sem criar um novo trabalho para ser administrado.

Antes de escolher, observe alguns pontos.

## 1. A agenda funciona do jeito que sua equipe trabalha?

Veja se é possível configurar:

- horários por profissional;
- serviços diferentes;
- duração;
- bloqueios;
- folgas;
- encaixes;
- reagendamento.

Se a agenda não representa a rotina real, o salão volta para o WhatsApp.

## 2. A recepção enxerga o salão inteiro?

Um salão com equipe precisa de visão geral.

Procure saber se existe:

- agenda geral;
- agenda por profissional;
- filtro de status;
- busca de cliente;
- disponibilidade.

## 3. O sistema ajuda depois do atendimento?

Cadastrar cliente é básico.

Pergunte se o sistema ajuda a entender:

- histórico;
- último atendimento;
- profissional;
- retorno;
- preferências;
- cancelamentos.

É aqui que cadastro começa a virar relacionamento.

## 4. WhatsApp está ligado à agenda?

Lembrete isolado é útil.

Mas é melhor quando comunicação acompanha eventos reais:

- confirmação;
- cancelamento;
- reagendamento;
- retorno.

## 5. Como funciona a equipe?

Se há profissionais com formas diferentes de trabalho, veja se o sistema permite configurar:

- serviços;
- agenda;
- horários;
- permissões;
- comissões;
- vínculo operacional.

## 6. O financeiro é proporcional à sua necessidade?

Um salão pequeno talvez não precise de um ERP completo.

Mas pode precisar de:

- sinal;
- pagamento;
- comanda;
- caixa;
- comissão.

Escolha profundidade compatível com a operação.

## 7. O preço é fácil de entender?

Desconfie quando você não consegue descobrir nem aproximadamente quanto vai pagar.

Avalie:

- mensalidade;
- cobrança por profissional;
- taxas de pagamento;
- funcionalidades extras;
- custo de implantação.

## 8. É fácil começar?

Um software pode ser excelente e ainda fracassar na implantação.

Veja quanto tempo leva para:

- cadastrar serviços;
- adicionar profissionais;
- configurar horários;
- colocar a primeira agenda para funcionar.

## 9. O sistema preserva seu relacionamento com clientes?

Essa pergunta é especialmente importante quando a plataforma também possui marketplace.

Entenda:

- como o cliente encontra seu negócio;
- quem controla a relação;
- como a origem é registrada;
- se seus dados são usados para direcionar o cliente para concorrentes.

## 10. Teste com a rotina real

Não avalie apenas uma demonstração bonita.

Use durante alguns dias.

Cadastre profissionais reais.

Marque horários.

Cancele.

Reagende.

Bloqueie um almoço.

Veja se a ferramenta continua simples quando a rotina fica menos perfeita.

## Conclusão

Escolher sistema para salão não é comparar uma lista de cinquenta funcionalidades.

É entender qual ferramenta representa melhor a sua operação.

A MIMO segue essa filosofia: agenda, equipe, clientes e relacionamento conectados em uma experiência que tenta reduzir trabalho, não criar mais um painel para administrar.$mimo$);
  get diagnostics n = row_count;
  raise notice '149: artigo % %', 'como-escolher-sistema-para-salao-de-beleza', case when n > 0 then 'atualizado' else 'mantido (editado pela plataforma ou já atualizado)' end;
end $$;
