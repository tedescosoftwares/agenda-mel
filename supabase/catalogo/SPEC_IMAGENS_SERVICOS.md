# SPEC — Imagens padrão dos serviços da MIMO (famílias e serviços)

Cole este documento inteiro no GPT (ou no gerador de imagens) e peça em lotes. As imagens das 10 categorias já existem; esta spec cobre o que falta: **51 famílias** e **252 serviços** (303 imagens). As prioritárias (as 51 famílias e os 70 serviços mais sugeridos) vêm primeiro.

## 1. Para que servem
- São as **fotos padrão** que aparecem no catálogo da MIMO: nas sugestões da configuração inicial, no assistente de serviço (opção “Foto da MIMO”), na página da cliente e na lista de serviços quando o salão não sobe uma foto própria.
- A profissional pode trocar pela foto dela depois. A padrão precisa ser bonita o bastante para ela não sentir falta de trocar.
- Sobem pelo painel da Plataforma (menu **Catálogo** → categoria → família ou serviço → “Escolher imagem”). O painel redimensiona e converte sozinho; o nome do arquivo não importa, mas use o `slug` para você se achar.

## 2. Identidade visual (vale para todas)
- **Clima**: salão de beleza feminino, premium e acolhedor. Luz natural suave, tons de pele reais, fundo limpo e desfocado (bokeh leve). Paleta que conversa com a MIMO: rosa (#FF2D7A) e lilás (#AA4CFF) aparecem só como toque (uma toalha, um esmalte, uma flor), nunca dominando.
- **Enquadramento**: close no gesto ou no resultado (mãos, cabelo, olhos, pele), **sem rosto inteiro identificável** sempre que possível. Pessoa real, pele e cabelo com textura, sem cara de banco de imagem genérico.
- **Sem texto, sem logo, sem marca d’água, sem marcas de produtos.** Sem fundo branco chapado. Sem colagem.
- **Diversidade**: alterne tons de pele e tipos de cabelo entre as imagens da mesma família.
- **Nada masculino**: o catálogo é feminino (barba e serviços masculinos não existem aqui).
- **Proibido**: menores de idade, nudez, procedimentos invasivos explícitos (agulha entrando na pele, sangue), antes/depois lado a lado.

## 3. Especificações técnicas
| Tipo | Proporção | Tamanho ideal | Formato | Peso máx. |
|---|---|---|---|---|
| Família | 14:9 (horizontal) | 1400 × 900 px | WebP (ou JPG q85) | 250 KB |
| Serviço | 14:9 (horizontal) | 1120 × 720 px | WebP (ou JPG q85) | 180 KB |

- Gere em 14:9 (ou 16:10 e corte). O painel corta para esses tamanhos; deixe o assunto principal **no centro** e com respiro nas bordas, porque em alguns lugares a imagem aparece com corte e com um degradê escuro na base (o nome vem escrito em branco por cima).
- Nome do arquivo: `<categoria>__<familia>.webp` para família e `<categoria>__<familia>__<servico>.webp` para serviço (os slugs estão nas listas abaixo).

## 4. Prompt base (copie e troque o que está entre colchetes)
```
Fotografia editorial de salão de beleza feminino, [ASSUNTO], close no gesto/resultado, mãos de profissional visíveis quando fizer sentido, luz natural suave lateral, fundo de salão desfocado em tons claros, toque sutil de rosa ou lilás em um objeto, pele e cabelo com textura real, sem rosto inteiro, sem texto, sem logo, sem marca, proporção 14:9, alta resolução, estilo limpo e premium.
```
- Para **família**, o [ASSUNTO] é o tema geral (ex.: “corte de cabelo feminino, tesoura e mecha sendo cortada”).
- Para **serviço**, o [ASSUNTO] é o resultado ou o momento específico (ex.: “esmaltação em gel rosa nude recém-finalizada, mão apoiada em toalha”).
- Peça **2 variações** por imagem e escolha a melhor. Se vier rosto inteiro, peça para reenquadrar.

## 5. Como pedir em lotes
1. Primeiro as **51 famílias** (lote A), 10 por mensagem, na ordem abaixo.
2. Depois os **70 serviços prioritários** (lote B).
3. Por fim os demais 182 serviços (lote C), quando der.
Em cada mensagem para o GPT: “Gere as imagens dos itens a seguir, uma por item, seguindo a spec: [cole 10 linhas da lista]”.

## 6. Lote A — Famílias (51)

Formato: `arquivo` · **Família** (categoria) · assunto sugerido

### Cabelo
1. `cabelo__corte.webp` · **Corte** (Cabelo) · tema: corte em cabelo; inclui Corte de cabelo, Corte infantil, Corte de franja
2. `cabelo__escova-e-finalizacao.webp` · **Escova e finalização** (Cabelo) · tema: escova e finalização em cabelo; inclui Escova, Babyliss, Chapinha
3. `cabelo__coloracao.webp` · **Coloração** (Cabelo) · tema: coloração em cabelo; inclui Coloração global, Retoque de raiz, Tonalização
4. `cabelo__mechas-e-iluminacao.webp` · **Mechas e iluminação** (Cabelo) · tema: mechas e iluminação em cabelo; inclui Mechas, Mechas com corte e tratamento
5. `cabelo__alisamento-e-alinhamento.webp` · **Alisamento e alinhamento** (Cabelo) · tema: alisamento e alinhamento em cabelo; inclui Progressiva, Botox capilar, Selagem
6. `cabelo__tratamentos.webp` · **Tratamentos** (Cabelo) · tema: tratamentos em cabelo; inclui Hidratação, Nutrição, Reconstrução
7. `cabelo__penteados.webp` · **Penteados** (Cabelo) · tema: penteados em cabelo; inclui Penteado, Penteado de noiva, Penteado infantil
8. `cabelo__trancas.webp` · **Tranças** (Cabelo) · tema: tranças em cabelo; inclui Box braids, Knotless braids, Nagô
9. `cabelo__mega-hair-e-extensoes.webp` · **Mega hair e extensões** (Cabelo) · tema: mega hair e extensões em cabelo; inclui Aplicação de mega hair, Manutenção de mega hair, Retirada de mega hair
10. `cabelo__cachos.webp` · **Cachos** (Cabelo) · tema: cachos em cabelo; inclui Corte para cachos, Finalização de cachos, Hidratação para cachos

### Unhas
11. `unhas__manicure.webp` · **Manicure** (Unhas) · tema: manicure em unhas; inclui Manicure, Manicure e pedicure, Cutilagem
12. `unhas__pedicure.webp` · **Pedicure** (Unhas) · tema: pedicure em unhas; inclui Pedicure, Spa dos pés, Cuidado com calos
13. `unhas__esmaltacao.webp` · **Esmaltação** (Unhas) · tema: esmaltação em unhas; inclui Esmaltação comum, Esmaltação em gel, Francesinha
14. `unhas__alongamento.webp` · **Alongamento** (Unhas) · tema: alongamento em unhas; inclui Alongamento de unhas, Reparo de unha, Alongamento de uma unha
15. `unhas__blindagem-e-banho-de-gel.webp` · **Blindagem e banho de gel** (Unhas) · tema: blindagem e banho de gel em unhas; inclui Blindagem, Banho de gel, Manutenção de banho de gel
16. `unhas__manutencao-e-remocao.webp` · **Manutenção e remoção** (Unhas) · tema: manutenção e remoção em unhas; inclui Manutenção de gel, Manutenção de alongamento, Remoção de gel
17. `unhas__nail-art.webp` · **Nail art** (Unhas) · tema: nail art em unhas; inclui Nail art, Decoração por unha, Unha de festa
18. `unhas__spa-e-cuidados.webp` · **Spa e cuidados** (Unhas) · tema: spa e cuidados em unhas; inclui Banho de parafina, Esfoliação de mãos e pés, Tratamento para unhas fracas

### Cílios
19. `cilios__extensao-de-cilios.webp` · **Extensão de cílios** (Cílios) · tema: extensão de cílios em cílios; inclui Extensão de cílios, Extensão de cílios inferiores
20. `cilios__manutencao.webp` · **Manutenção** (Cílios) · tema: manutenção em cílios; inclui Manutenção de cílios
21. `cilios__remocao.webp` · **Remoção** (Cílios) · tema: remoção em cílios; inclui Remoção de extensão
22. `cilios__lash-lifting.webp` · **Lash lifting** (Cílios) · tema: lash lifting em cílios; inclui Lash lifting, Botox de cílios, Lash lifting e brow lamination
23. `cilios__coloracao-e-posticos.webp` · **Coloração e postiços** (Cílios) · tema: coloração e postiços em cílios; inclui Tintura de cílios, Aplicação de cílios postiços

### Sobrancelhas
24. `sobrancelhas__design.webp` · **Design** (Sobrancelhas) · tema: design em sobrancelhas; inclui Design de sobrancelhas, Manutenção de design
25. `sobrancelhas__henna-e-tintura.webp` · **Henna e tintura** (Sobrancelhas) · tema: henna e tintura em sobrancelhas; inclui Design com henna, Tintura de sobrancelha, Retoque de henna
26. `sobrancelhas__brow-lamination.webp` · **Brow lamination** (Sobrancelhas) · tema: brow lamination em sobrancelhas; inclui Brow lamination, Botox de sobrancelha
27. `sobrancelhas__reconstrucao-e-cuidados.webp` · **Reconstrução e cuidados** (Sobrancelhas) · tema: reconstrução e cuidados em sobrancelhas; inclui Reconstrução de sobrancelhas, Hidratação de sobrancelhas

### Maquiagem
28. `maquiagem__maquiagem.webp` · **Maquiagem** (Maquiagem) · tema: maquiagem em maquiagem; inclui Maquiagem social, Maquiagem para noiva, Maquiagem para madrinhas
29. `maquiagem__pele-e-preparacao.webp` · **Pele e preparação** (Maquiagem) · tema: pele e preparação em maquiagem; inclui Preparação de pele, Limpeza de pele pré-make
30. `maquiagem__cursos.webp` · **Cursos** (Maquiagem) · tema: cursos em maquiagem; inclui Curso de automaquiagem, Aula particular de maquiagem

### Depilação
31. `depilacao__cera.webp` · **Cera** (Depilação) · tema: cera em depilação; inclui Depilação com cera, Virilha completa, Virilha simples
32. `depilacao__linha.webp` · **Linha** (Depilação) · tema: linha em depilação; inclui Depilação com linha, Buço com linha, Rosto com linha
33. `depilacao__laser-e-luz-pulsada.webp` · **Laser e luz pulsada** (Depilação) · tema: laser e luz pulsada em depilação; inclui Depilação a laser, Laser axila, Laser virilha
34. `depilacao__cuidados.webp` · **Cuidados** (Depilação) · tema: cuidados em depilação; inclui Esfoliação pré-depilação, Tratamento de foliculite, Clareamento de virilha

### Estética facial
35. `estetica-facial__limpeza-de-pele.webp` · **Limpeza de pele** (Estética facial) · tema: limpeza de pele em estética facial; inclui Limpeza de pele, Hidradermoabrasão, Limpeza de pele com peeling
36. `estetica-facial__peeling.webp` · **Peeling** (Estética facial) · tema: peeling em estética facial; inclui Peeling químico, Peeling de diamante, Peeling de cristal
37. `estetica-facial__tratamentos.webp` · **Tratamentos** (Estética facial) · tema: tratamentos em estética facial; inclui Hidratação facial, Revitalização facial, Tratamento para acne
38. `estetica-facial__tecnologias.webp` · **Tecnologias** (Estética facial) · tema: tecnologias em estética facial; inclui Microagulhamento, Radiofrequência facial, Ultrassom microfocado
39. `estetica-facial__procedimentos-injetaveis.webp` · **Procedimentos injetáveis** (Estética facial) · tema: procedimentos injetáveis em estética facial; inclui Toxina botulínica, Preenchimento com ácido hialurônico, Bioestimulador de colágeno

### Estética corporal
40. `estetica-corporal__massagens-esteticas.webp` · **Massagens estéticas** (Estética corporal) · tema: massagens estéticas em estética corporal; inclui Drenagem linfática, Massagem modeladora, Massagem turbinada
41. `estetica-corporal__gordura-localizada.webp` · **Gordura localizada** (Estética corporal) · tema: gordura localizada em estética corporal; inclui Criolipólise, Lipocavitação, Radiofrequência corporal
42. `estetica-corporal__celulite-flacidez-e-estrias.webp` · **Celulite, flacidez e estrias** (Estética corporal) · tema: celulite, flacidez e estrias em estética corporal; inclui Tratamento para celulite, Tratamento para flacidez, Tratamento para estrias
43. `estetica-corporal__bronzeamento.webp` · **Bronzeamento** (Estética corporal) · tema: bronzeamento em estética corporal; inclui Bronzeamento a jato, Bronze natural com marquinha, Preparação pré-bronze
44. `estetica-corporal__cuidados-com-a-pele-do-corpo.webp` · **Cuidados com a pele do corpo** (Estética corporal) · tema: cuidados com a pele do corpo em estética corporal; inclui Peeling corporal, Hidratação corporal, Esfoliação corporal

### Micropigmentação
45. `micropigmentacao__sobrancelhas.webp` · **Sobrancelhas** (Micropigmentação) · tema: sobrancelhas em micropigmentação; inclui Micropigmentação de sobrancelhas
46. `micropigmentacao__labios.webp` · **Lábios** (Micropigmentação) · tema: lábios em micropigmentação; inclui Micropigmentação labial
47. `micropigmentacao__olhos.webp` · **Olhos** (Micropigmentação) · tema: olhos em micropigmentação; inclui Micropigmentação de olhos
48. `micropigmentacao__retoques-correcoes-e-remocao.webp` · **Retoques, correções e remoção** (Micropigmentação) · tema: retoques, correções e remoção em micropigmentação; inclui Retoque de micropigmentação, Correção de cor, Neutralização

### Bem-estar e spa
49. `bem-estar-e-spa__massagens.webp` · **Massagens** (Bem-estar e spa) · tema: massagens em bem-estar e spa; inclui Massagem relaxante, Massagem terapêutica, Massagem desportiva
50. `bem-estar-e-spa__terapias.webp` · **Terapias** (Bem-estar e spa) · tema: terapias em bem-estar e spa; inclui Reflexologia, Ventosaterapia, Auriculoterapia
51. `bem-estar-e-spa__spa.webp` · **Spa** (Bem-estar e spa) · tema: spa em bem-estar e spa; inclui Day spa, Ritual de spa, Banho de ofurô

## 7. Lote B — Serviços prioritários (70)

Formato: `arquivo` · **Serviço** (categoria › família) · duração sugerida · pistas

### Cabelo
1. `cabelo__corte__corte-de-cabelo.webp` · **Corte de cabelo** (Cabelo › Corte) · 60 min · pistas: corte, corte feminino, cortar o cabelo
2. `cabelo__escova-e-finalizacao__escova.webp` · **Escova** (Cabelo › Escova e finalização) · 45 min · pistas: escova lisa, escova de cabelo, secar o cabelo
3. `cabelo__coloracao__coloracao-global.webp` · **Coloração global** (Cabelo › Coloração) · 120 min · pistas: coloração, tintura, tinta
4. `cabelo__coloracao__retoque-de-raiz.webp` · **Retoque de raiz** (Cabelo › Coloração) · 90 min · pistas: raiz, retoque, retoque de cor
5. `cabelo__mechas-e-iluminacao__mechas.webp` · **Mechas** (Cabelo › Mechas e iluminação) · 180 min · pistas: luzes, mecha, reflexos
6. `cabelo__alisamento-e-alinhamento__progressiva.webp` · **Progressiva** (Cabelo › Alisamento e alinhamento) · 180 min · pistas: escova progressiva, alisamento, liso
7. `cabelo__tratamentos__hidratacao.webp` · **Hidratação** (Cabelo › Tratamentos) · 60 min · pistas: hidratação capilar, hidratar, máscara
8. `cabelo__penteados__penteado.webp` · **Penteado** (Cabelo › Penteados) · 60 min · pistas: penteado de festa, penteado social, arrumar para festa

### Unhas
9. `unhas__manicure__manicure.webp` · **Manicure** (Unhas › Manicure) · 45 min · pistas: mão, mãos, unha da mão
10. `unhas__manicure__manicure-e-pedicure.webp` · **Manicure e pedicure** (Unhas › Manicure) · 90 min · pistas: pé e mão, mão e pé, mãos e pés
11. `unhas__pedicure__pedicure.webp` · **Pedicure** (Unhas › Pedicure) · 45 min · pistas: pé, pés, unha do pé
12. `unhas__esmaltacao__esmaltacao-em-gel.webp` · **Esmaltação em gel** (Unhas › Esmaltação) · 60 min · pistas: gel, esmalte em gel, esmaltação gel
13. `unhas__alongamento__alongamento-de-unhas.webp` · **Alongamento de unhas** (Unhas › Alongamento) · 150 min · pistas: alongamento, unha de gel, unha alongada
14. `unhas__blindagem-e-banho-de-gel__blindagem.webp` · **Blindagem** (Unhas › Blindagem e banho de gel) · 60 min · pistas: blindagem de unhas, blindar, fortalecimento
15. `unhas__manutencao-e-remocao__manutencao-de-gel.webp` · **Manutenção de gel** (Unhas › Manutenção e remoção) · 60 min · pistas: manutenção em gel, manutenção de esmaltação em gel, manutenção
16. `unhas__nail-art__nail-art.webp` · **Nail art** (Unhas › Nail art) · 30 min · pistas: decoração, decoração de unhas, desenho

### Cílios
17. `cilios__extensao-de-cilios__extensao-de-cilios.webp` · **Extensão de cílios** (Cílios › Extensão de cílios) · 120 min · pistas: alongamento de cílios, aplicação de cílios, cílios fio a fio
18. `cilios__manutencao__manutencao-de-cilios.webp` · **Manutenção de cílios** (Cílios › Manutenção) · 60 min · pistas: manutenção, manutenção de extensão, reposição de cílios
19. `cilios__remocao__remocao-de-extensao.webp` · **Remoção de extensão** (Cílios › Remoção) · 30 min · pistas: remoção de cílios, retirada de cílios, tirar extensão
20. `cilios__lash-lifting__lash-lifting.webp` · **Lash lifting** (Cílios › Lash lifting) · 60 min · pistas: lifting de cílios, lash, lash lift
21. `cilios__lash-lifting__botox-de-cilios.webp` · **Botox de cílios** (Cílios › Lash lifting) · 40 min · pistas: lash botox, nutrição de cílios, tratamento de cílios
22. `cilios__coloracao-e-posticos__tintura-de-cilios.webp` · **Tintura de cílios** (Cílios › Coloração e postiços) · 30 min · pistas: coloração de cílios, tingimento de cílios, pintar os cílios

### Sobrancelhas
23. `sobrancelhas__design__design-de-sobrancelhas.webp` · **Design de sobrancelhas** (Sobrancelhas › Design) · 30 min · pistas: sobrancelha, design, fazer sobrancelha
24. `sobrancelhas__design__manutencao-de-design.webp` · **Manutenção de design** (Sobrancelhas › Design) · 15 min · pistas: manutenção de sobrancelha, retoque de sobrancelha, limpeza
25. `sobrancelhas__henna-e-tintura__design-com-henna.webp` · **Design com henna** (Sobrancelhas › Henna e tintura) · 40 min · pistas: henna, sobrancelha de henna, henna na sobrancelha
26. `sobrancelhas__henna-e-tintura__tintura-de-sobrancelha.webp` · **Tintura de sobrancelha** (Sobrancelhas › Henna e tintura) · 30 min · pistas: coloração de sobrancelha, tingimento de sobrancelha, pintar a sobrancelha
27. `sobrancelhas__brow-lamination__brow-lamination.webp` · **Brow lamination** (Sobrancelhas › Brow lamination) · 60 min · pistas: laminação de sobrancelhas, laminação, lamination
28. `sobrancelhas__reconstrucao-e-cuidados__reconstrucao-de-sobrancelhas.webp` · **Reconstrução de sobrancelhas** (Sobrancelhas › Reconstrução e cuidados) · 45 min · pistas: reconstrução, sobrancelha com falhas, preenchimento de falhas

### Maquiagem
29. `maquiagem__maquiagem__maquiagem-social.webp` · **Maquiagem social** (Maquiagem › Maquiagem) · 60 min · pistas: make social, make, maquiagem de festa
30. `maquiagem__maquiagem__maquiagem-para-noiva.webp` · **Maquiagem para noiva** (Maquiagem › Maquiagem) · 120 min · pistas: make de noiva, noiva, maquiagem de casamento
31. `maquiagem__maquiagem__maquiagem-para-madrinhas.webp` · **Maquiagem para madrinhas** (Maquiagem › Maquiagem) · 60 min · pistas: madrinha, make madrinha
32. `maquiagem__maquiagem__maquiagem-para-formatura.webp` · **Maquiagem para formatura** (Maquiagem › Maquiagem) · 60 min · pistas: formanda, make de formatura
33. `maquiagem__maquiagem__teste-de-maquiagem.webp` · **Teste de maquiagem** (Maquiagem › Maquiagem) · 60 min · pistas: prova de make, teste de make
34. `maquiagem__cursos__curso-de-automaquiagem.webp` · **Curso de automaquiagem** (Maquiagem › Cursos) · 180 min · pistas: auto maquiagem, aula de maquiagem, automaquiagem

### Depilação
35. `depilacao__cera__depilacao-com-cera.webp` · **Depilação com cera** (Depilação › Cera) · 40 min · pistas: cera, depilação, depilar
36. `depilacao__cera__virilha-completa.webp` · **Virilha completa** (Depilação › Cera) · 30 min · pistas: virilha cavada, virilha total, íntima completa
37. `depilacao__cera__perna-completa.webp` · **Perna completa** (Depilação › Cera) · 40 min · pistas: pernas completas, perna inteira, pernas
38. `depilacao__cera__meia-perna.webp` · **Meia perna** (Depilação › Cera) · 25 min · pistas: meia perna, perna até o joelho
39. `depilacao__cera__axila.webp` · **Axila** (Depilação › Cera) · 15 min · pistas: axilas, sovaco
40. `depilacao__cera__buco.webp` · **Buço** (Depilação › Cera) · 10 min · pistas: buço, bigode, labio superior
41. `depilacao__linha__depilacao-com-linha.webp` · **Depilação com linha** (Depilação › Linha) · 20 min · pistas: linha, egípcia, epilação egípcia
42. `depilacao__laser-e-luz-pulsada__depilacao-a-laser.webp` · **Depilação a laser** (Depilação › Laser e luz pulsada) · 30 min · pistas: laser, depilação definitiva, sessão de laser

### Estética facial
43. `estetica-facial__limpeza-de-pele__limpeza-de-pele.webp` · **Limpeza de pele** (Estética facial › Limpeza de pele) · 60 min · pistas: limpeza facial, limpeza de pele profunda, skincare
44. `estetica-facial__peeling__peeling-quimico.webp` · **Peeling químico** (Estética facial › Peeling) · 45 min · pistas: peeling, peeling de ácido, ácido
45. `estetica-facial__peeling__dermaplaning.webp` · **Dermaplaning** (Estética facial › Peeling) · 45 min · pistas: dermaplaning, lâmina, esfoliação com lâmina
46. `estetica-facial__tratamentos__hidratacao-facial.webp` · **Hidratação facial** (Estética facial › Tratamentos) · 45 min · pistas: hidratação da pele, hidratação profunda, hidratar o rosto
47. `estetica-facial__tratamentos__tratamento-para-acne.webp` · **Tratamento para acne** (Estética facial › Tratamentos) · 60 min · pistas: acne, espinhas, cravos
48. `estetica-facial__tratamentos__tratamento-para-manchas.webp` · **Tratamento para manchas** (Estética facial › Tratamentos) · 60 min · pistas: melasma, clareamento de manchas, manchas
49. `estetica-facial__tecnologias__microagulhamento.webp` · **Microagulhamento** (Estética facial › Tecnologias) · 60 min · pistas: dermaroller, dermapen, micro agulhamento
50. `estetica-facial__tecnologias__radiofrequencia-facial.webp` · **Radiofrequência facial** (Estética facial › Tecnologias) · 45 min · pistas: radiofrequência, rf facial, flacidez facial

### Estética corporal
51. `estetica-corporal__massagens-esteticas__drenagem-linfatica.webp` · **Drenagem linfática** (Estética corporal › Massagens estéticas) · 60 min · pistas: drenagem, drenagem corporal, inchaço
52. `estetica-corporal__massagens-esteticas__massagem-modeladora.webp` · **Massagem modeladora** (Estética corporal › Massagens estéticas) · 60 min · pistas: modeladora, massagem redutora, redutora
53. `estetica-corporal__gordura-localizada__criolipolise.webp` · **Criolipólise** (Estética corporal › Gordura localizada) · 60 min · pistas: crio, criolipolise, congelamento de gordura
54. `estetica-corporal__gordura-localizada__lipocavitacao.webp` · **Lipocavitação** (Estética corporal › Gordura localizada) · 45 min · pistas: cavitação, ultracavitação, ultrassom de cavitação
55. `estetica-corporal__gordura-localizada__radiofrequencia-corporal.webp` · **Radiofrequência corporal** (Estética corporal › Gordura localizada) · 45 min · pistas: radiofrequência, rf corporal, flacidez corporal
56. `estetica-corporal__celulite-flacidez-e-estrias__tratamento-para-celulite.webp` · **Tratamento para celulite** (Estética corporal › Celulite, flacidez e estrias) · 60 min · pistas: celulite, anticelulite, furinhos
57. `estetica-corporal__bronzeamento__bronzeamento-a-jato.webp` · **Bronzeamento a jato** (Estética corporal › Bronzeamento) · 40 min · pistas: spray tan, bronze de spray, jato
58. `estetica-corporal__bronzeamento__bronze-natural-com-marquinha.webp` · **Bronze natural com marquinha** (Estética corporal › Bronzeamento) · 90 min · pistas: marquinha, fita, bronze de fita

### Micropigmentação
59. `micropigmentacao__sobrancelhas__micropigmentacao-de-sobrancelhas.webp` · **Micropigmentação de sobrancelhas** (Micropigmentação › Sobrancelhas) · 150 min · pistas: micro, micropigmentação, sobrancelha definitiva
60. `micropigmentacao__labios__micropigmentacao-labial.webp` · **Micropigmentação labial** (Micropigmentação › Lábios) · 120 min · pistas: micro labial, micro de boca, lábios definitivos
61. `micropigmentacao__olhos__micropigmentacao-de-olhos.webp` · **Micropigmentação de olhos** (Micropigmentação › Olhos) · 90 min · pistas: delineado definitivo, micro de olhos, eyeliner definitivo
62. `micropigmentacao__retoques-correcoes-e-remocao__retoque-de-micropigmentacao.webp` · **Retoque de micropigmentação** (Micropigmentação › Retoques, correções e remoção) · 90 min · pistas: retoque, retoque de micro, segunda sessão
63. `micropigmentacao__retoques-correcoes-e-remocao__remocao-de-micropigmentacao.webp` · **Remoção de micropigmentação** (Micropigmentação › Retoques, correções e remoção) · 60 min · pistas: remoção de micro, despigmentação, remoção de pigmento

### Bem-estar e spa
64. `bem-estar-e-spa__massagens__massagem-relaxante.webp` · **Massagem relaxante** (Bem-estar e spa › Massagens) · 60 min · pistas: massagem, relaxante, relaxar
65. `bem-estar-e-spa__massagens__massagem-terapeutica.webp` · **Massagem terapêutica** (Bem-estar e spa › Massagens) · 60 min · pistas: massoterapia, massagem para dor, dor nas costas
66. `bem-estar-e-spa__massagens__quick-massage.webp` · **Quick massage** (Bem-estar e spa › Massagens) · 20 min · pistas: massagem rápida, massagem na cadeira, massagem expressa
67. `bem-estar-e-spa__terapias__reflexologia.webp` · **Reflexologia** (Bem-estar e spa › Terapias) · 45 min · pistas: reflexologia podal, reflexo, pontos nos pés
68. `bem-estar-e-spa__terapias__ventosaterapia.webp` · **Ventosaterapia** (Bem-estar e spa › Terapias) · 45 min · pistas: ventosa, ventosas, cupping
69. `bem-estar-e-spa__spa__day-spa.webp` · **Day spa** (Bem-estar e spa › Spa) · 180 min · pistas: dia de spa, dia no spa, pacote spa
70. `bem-estar-e-spa__spa__escalda-pes.webp` · **Escalda-pés** (Bem-estar e spa › Spa) · 30 min · pistas: escalda pés, escaldapés, banho de pés

## 8. Lote C — Demais serviços (182)

### Cabelo
1. `cabelo__corte__corte-infantil.webp` · **Corte infantil** (Cabelo › Corte) · 30 min · pistas: corte criança, corte kids
2. `cabelo__corte__corte-de-franja.webp` · **Corte de franja** (Cabelo › Corte) · 20 min · pistas: franja, aparar franja
3. `cabelo__corte__corte-com-lavagem-e-finalizacao.webp` · **Corte com lavagem e finalização** (Cabelo › Corte) · 90 min · pistas: corte completo, corte lavagem e escova
4. `cabelo__escova-e-finalizacao__babyliss.webp` · **Babyliss** (Cabelo › Escova e finalização) · 45 min · pistas: ondas, cachos com babyliss, modelador
5. `cabelo__escova-e-finalizacao__chapinha.webp` · **Chapinha** (Cabelo › Escova e finalização) · 30 min · pistas: prancha, alisar com chapinha
6. `cabelo__escova-e-finalizacao__lavagem-e-secagem.webp` · **Lavagem e secagem** (Cabelo › Escova e finalização) · 30 min · pistas: lavar e secar, lavagem, secagem
7. `cabelo__escova-e-finalizacao__finalizacao.webp` · **Finalização** (Cabelo › Escova e finalização) · 30 min · pistas: finalização de cabelo, arrumar o cabelo
8. `cabelo__coloracao__tonalizacao.webp` · **Tonalização** (Cabelo › Coloração) · 60 min · pistas: tonalizante, tonalizar
9. `cabelo__coloracao__matizacao.webp` · **Matização** (Cabelo › Coloração) · 45 min · pistas: matizar, desamarelador, matizador
10. `cabelo__coloracao__correcao-de-cor.webp` · **Correção de cor** (Cabelo › Coloração) · 240 min · pistas: corrigir a cor, correção, cor errada
11. `cabelo__coloracao__descoloracao-global.webp` · **Descoloração global** (Cabelo › Coloração) · 180 min · pistas: platinado, platinar, descolorir
12. `cabelo__coloracao__coloracao-fantasia.webp` · **Coloração fantasia** (Cabelo › Coloração) · 180 min · pistas: cor fantasia, cabelo colorido, rosa
13. `cabelo__coloracao__banho-de-brilho.webp` · **Banho de brilho** (Cabelo › Coloração) · 60 min · pistas: gloss, glossing, banho de gloss
14. `cabelo__mechas-e-iluminacao__mechas-com-corte-e-tratamento.webp` · **Mechas com corte e tratamento** (Cabelo › Mechas e iluminação) · 240 min · pistas: pacote mechas, mechas completa
15. `cabelo__alisamento-e-alinhamento__botox-capilar.webp` · **Botox capilar** (Cabelo › Alisamento e alinhamento) · 120 min · pistas: btx capilar, btx, botox
16. `cabelo__alisamento-e-alinhamento__selagem.webp` · **Selagem** (Cabelo › Alisamento e alinhamento) · 120 min · pistas: selagem térmica, selagem capilar
17. `cabelo__alisamento-e-alinhamento__realinhamento.webp` · **Realinhamento** (Cabelo › Alisamento e alinhamento) · 120 min · pistas: realinhamento capilar, realinhamento térmico, alinhamento
18. `cabelo__alisamento-e-alinhamento__relaxamento.webp` · **Relaxamento** (Cabelo › Alisamento e alinhamento) · 120 min · pistas: relaxamento capilar, guanidina, hidróxido
19. `cabelo__alisamento-e-alinhamento__escova-definitiva.webp` · **Escova definitiva** (Cabelo › Alisamento e alinhamento) · 180 min · pistas: definitiva, escova japonesa, definitiva japonesa
20. `cabelo__alisamento-e-alinhamento__alisamento-com-queratina.webp` · **Alisamento com queratina** (Cabelo › Alisamento e alinhamento) · 180 min · pistas: keratina, queratina, alisamento de queratina
21. `cabelo__tratamentos__nutricao.webp` · **Nutrição** (Cabelo › Tratamentos) · 60 min · pistas: nutrição capilar, nutrir
22. `cabelo__tratamentos__reconstrucao.webp` · **Reconstrução** (Cabelo › Tratamentos) · 60 min · pistas: reconstrução capilar, queratina, reconstrução com queratina
23. `cabelo__tratamentos__cronograma-capilar.webp` · **Cronograma capilar** (Cabelo › Tratamentos) · 90 min · pistas: cronograma
24. `cabelo__tratamentos__cauterizacao.webp` · **Cauterização** (Cabelo › Tratamentos) · 60 min · pistas: cauterização capilar, cauterizar
25. `cabelo__tratamentos__plastica-dos-fios.webp` · **Plástica dos fios** (Cabelo › Tratamentos) · 90 min · pistas: plástica capilar, plástica
26. `cabelo__tratamentos__umectacao.webp` · **Umectação** (Cabelo › Tratamentos) · 60 min · pistas: umectação capilar, umectar, óleo
27. `cabelo__tratamentos__detox-capilar.webp` · **Detox capilar** (Cabelo › Tratamentos) · 45 min · pistas: limpeza do couro cabeludo, detox, esfoliação capilar
28. `cabelo__tratamentos__tratamento-antiqueda.webp` · **Tratamento antiqueda** (Cabelo › Tratamentos) · 60 min · pistas: queda de cabelo, antiqueda, tricologia
29. `cabelo__tratamentos__ampola.webp` · **Ampola** (Cabelo › Tratamentos) · 30 min · pistas: tratamento com ampola, ampola de tratamento
30. `cabelo__tratamentos__laser-capilar.webp` · **Laser capilar** (Cabelo › Tratamentos) · 30 min · pistas: laser para queda, laserterapia capilar
31. `cabelo__penteados__penteado-de-noiva.webp` · **Penteado de noiva** (Cabelo › Penteados) · 90 min · pistas: noiva, penteado para casamento
32. `cabelo__penteados__penteado-infantil.webp` · **Penteado infantil** (Cabelo › Penteados) · 30 min · pistas: penteado criança, penteado de daminha
33. `cabelo__penteados__teste-de-penteado.webp` · **Teste de penteado** (Cabelo › Penteados) · 60 min · pistas: prova de penteado
34. `cabelo__penteados__dia-da-noiva.webp` · **Dia da noiva** (Cabelo › Penteados) · 300 min · pistas: dia de noiva, pacote noiva, noiva completo
35. `cabelo__trancas__box-braids.webp` · **Box braids** (Cabelo › Tranças) · 240 min · pistas: tranças box, box, tranças soltas
36. `cabelo__trancas__knotless-braids.webp` · **Knotless braids** (Cabelo › Tranças) · 300 min · pistas: knotless, tranças sem nó
37. `cabelo__trancas__nago.webp` · **Nagô** (Cabelo › Tranças) · 120 min · pistas: tranças nagô, trança raiz, cornrows
38. `cabelo__trancas__twist.webp` · **Twist** (Cabelo › Tranças) · 180 min · pistas: twists, tranças twist, senegalesa
39. `cabelo__trancas__fulani.webp` · **Fulani** (Cabelo › Tranças) · 240 min · pistas: fulani braids, tranças fulani
40. `cabelo__trancas__goddess-braids.webp` · **Goddess braids** (Cabelo › Tranças) · 240 min · pistas: goddess, tranças goddess, boho braids
41. `cabelo__trancas__crochet-braids.webp` · **Crochet braids** (Cabelo › Tranças) · 180 min · pistas: crochê, crochet, entrelace
42. `cabelo__trancas__tranca-boxeadora.webp` · **Trança boxeadora** (Cabelo › Tranças) · 45 min · pistas: boxeadora, boxer braids, trança dupla
43. `cabelo__trancas__tranca-embutida.webp` · **Trança embutida** (Cabelo › Tranças) · 45 min · pistas: embutida, trança lateral
44. `cabelo__trancas__manutencao-de-trancas.webp` · **Manutenção de tranças** (Cabelo › Tranças) · 90 min · pistas: manutenção das tranças, retoque de tranças
45. `cabelo__trancas__retirada-de-trancas.webp` · **Retirada de tranças** (Cabelo › Tranças) · 90 min · pistas: tirar tranças, desmanchar tranças
46. `cabelo__trancas__dreads.webp` · **Dreads** (Cabelo › Tranças) · 300 min · pistas: dread, dreadlocks, instalação de dreads
47. `cabelo__trancas__manutencao-de-dreads.webp` · **Manutenção de dreads** (Cabelo › Tranças) · 120 min · pistas: retoque de dreads, manutenção de locs
48. `cabelo__mega-hair-e-extensoes__aplicacao-de-mega-hair.webp` · **Aplicação de mega hair** (Cabelo › Mega hair e extensões) · 180 min · pistas: mega hair, megahair, alongamento capilar
49. `cabelo__mega-hair-e-extensoes__manutencao-de-mega-hair.webp` · **Manutenção de mega hair** (Cabelo › Mega hair e extensões) · 120 min · pistas: manutenção do mega, retoque de mega
50. `cabelo__mega-hair-e-extensoes__retirada-de-mega-hair.webp` · **Retirada de mega hair** (Cabelo › Mega hair e extensões) · 90 min · pistas: tirar mega, remoção de mega hair
51. `cabelo__mega-hair-e-extensoes__aplique-tic-tac.webp` · **Aplique tic-tac** (Cabelo › Mega hair e extensões) · 20 min · pistas: tic tac, aplique, aplique de festa
52. `cabelo__mega-hair-e-extensoes__hidratacao-de-mega-hair.webp` · **Hidratação de mega hair** (Cabelo › Mega hair e extensões) · 60 min · pistas: tratamento do mega
53. `cabelo__cachos__corte-para-cachos.webp` · **Corte para cachos** (Cabelo › Cachos) · 60 min · pistas: curly cut, corte de cacheado, corte seco
54. `cabelo__cachos__finalizacao-de-cachos.webp` · **Finalização de cachos** (Cabelo › Cachos) · 45 min · pistas: fitagem, dedoliss, day after
55. `cabelo__cachos__hidratacao-para-cachos.webp` · **Hidratação para cachos** (Cabelo › Cachos) · 60 min · pistas: hidratação cacheado, hidratação crespo
56. `cabelo__cachos__transicao-capilar.webp` · **Transição capilar** (Cabelo › Cachos) · 90 min · pistas: big chop, transição, corte de transição
57. `cabelo__cachos__permanente-afro.webp` · **Permanente afro** (Cabelo › Cachos) · 120 min · pistas: permanente, afro, cachos de permanente
58. `cabelo__cachos__texturizacao.webp` · **Texturização** (Cabelo › Cachos) · 120 min · pistas: textura, texturizar, texturização capilar
59. `cabelo__cachos__penteado-para-cachos.webp` · **Penteado para cachos** (Cabelo › Cachos) · 45 min · pistas: penteado afro, puff, coque afro

### Unhas
60. `unhas__manicure__cutilagem.webp` · **Cutilagem** (Unhas › Manicure) · 20 min · pistas: tirar cutícula, cutícula
61. `unhas__manicure__spa-das-maos.webp` · **Spa das mãos** (Unhas › Manicure) · 45 min · pistas: hidratação das mãos, spa de mãos
62. `unhas__pedicure__spa-dos-pes.webp` · **Spa dos pés** (Unhas › Pedicure) · 60 min · pistas: spa pés, hidratação dos pés, spa de pés
63. `unhas__pedicure__cuidado-com-calos.webp` · **Cuidado com calos** (Unhas › Pedicure) · 30 min · pistas: calo, calos, remoção de calos
64. `unhas__esmaltacao__esmaltacao-comum.webp` · **Esmaltação comum** (Unhas › Esmaltação) · 20 min · pistas: esmaltação simples, esmaltação tradicional, esmalte comum
65. `unhas__esmaltacao__francesinha.webp` · **Francesinha** (Unhas › Esmaltação) · 30 min · pistas: francesa, french, unha francesinha
66. `unhas__esmaltacao__troca-de-esmalte.webp` · **Troca de esmalte** (Unhas › Esmaltação) · 15 min · pistas: trocar esmalte, remover e esmaltar
67. `unhas__esmaltacao__esmaltacao-em-gel-pes.webp` · **Esmaltação em gel pés** (Unhas › Esmaltação) · 60 min · pistas: gel no pé, esmaltação em gel pedicure
68. `unhas__alongamento__reparo-de-unha.webp` · **Reparo de unha** (Unhas › Alongamento) · 15 min · pistas: conserto, unha quebrada, reparo
69. `unhas__alongamento__alongamento-de-uma-unha.webp` · **Alongamento de uma unha** (Unhas › Alongamento) · 20 min · pistas: uma unha, reposição de unha
70. `unhas__blindagem-e-banho-de-gel__banho-de-gel.webp` · **Banho de gel** (Unhas › Blindagem e banho de gel) · 60 min · pistas: banho em gel, capa de gel, gel na unha natural
71. `unhas__blindagem-e-banho-de-gel__manutencao-de-banho-de-gel.webp` · **Manutenção de banho de gel** (Unhas › Blindagem e banho de gel) · 60 min · pistas: manutenção banho de gel
72. `unhas__manutencao-e-remocao__manutencao-de-alongamento.webp` · **Manutenção de alongamento** (Unhas › Manutenção e remoção) · 120 min · pistas: manutenção do alongamento, manutenção de unha de gel, manutenção de fibra
73. `unhas__manutencao-e-remocao__remocao-de-gel.webp` · **Remoção de gel** (Unhas › Manutenção e remoção) · 30 min · pistas: remoção de esmalte em gel, tirar o gel, remoção gel
74. `unhas__manutencao-e-remocao__remocao-de-alongamento.webp` · **Remoção de alongamento** (Unhas › Manutenção e remoção) · 45 min · pistas: tirar alongamento, remoção de fibra, remoção de acrílico
75. `unhas__manutencao-e-remocao__manutencao-de-blindagem.webp` · **Manutenção de blindagem** (Unhas › Manutenção e remoção) · 60 min · pistas: manutenção da blindagem
76. `unhas__nail-art__decoracao-por-unha.webp` · **Decoração por unha** (Unhas › Nail art) · 10 min · pistas: uma unha decorada, desenho em uma unha, por unha
77. `unhas__nail-art__unha-de-festa.webp` · **Unha de festa** (Unhas › Nail art) · 45 min · pistas: unha para casamento, unha de noiva, unha de formatura
78. `unhas__spa-e-cuidados__banho-de-parafina.webp` · **Banho de parafina** (Unhas › Spa e cuidados) · 30 min · pistas: parafina, parafina nas mãos, parafina nos pés
79. `unhas__spa-e-cuidados__esfoliacao-de-maos-e-pes.webp` · **Esfoliação de mãos e pés** (Unhas › Spa e cuidados) · 20 min · pistas: esfoliação, esfoliar
80. `unhas__spa-e-cuidados__tratamento-para-unhas-fracas.webp` · **Tratamento para unhas fracas** (Unhas › Spa e cuidados) · 30 min · pistas: unhas fracas, fortalecedor, tratamento de unha

### Cílios
81. `cilios__extensao-de-cilios__extensao-de-cilios-inferiores.webp` · **Extensão de cílios inferiores** (Cílios › Extensão de cílios) · 30 min · pistas: cílios inferiores, cílios de baixo
82. `cilios__lash-lifting__lash-lifting-e-brow-lamination.webp` · **Lash lifting e brow lamination** (Cílios › Lash lifting) · 110 min · pistas: lifting + lamination, combo lifting e lamination
83. `cilios__coloracao-e-posticos__aplicacao-de-cilios-posticos.webp` · **Aplicação de cílios postiços** (Cílios › Coloração e postiços) · 20 min · pistas: cílios postiços, postiços, tufinho

### Sobrancelhas
84. `sobrancelhas__henna-e-tintura__retoque-de-henna.webp` · **Retoque de henna** (Sobrancelhas › Henna e tintura) · 20 min · pistas: só a henna, reaplicação de henna
85. `sobrancelhas__brow-lamination__botox-de-sobrancelha.webp` · **Botox de sobrancelha** (Sobrancelhas › Brow lamination) · 30 min · pistas: nutrição de sobrancelha, tratamento de sobrancelha, brow botox
86. `sobrancelhas__reconstrucao-e-cuidados__hidratacao-de-sobrancelhas.webp` · **Hidratação de sobrancelhas** (Sobrancelhas › Reconstrução e cuidados) · 15 min · pistas: nutrição, hidratação, cuidados

### Maquiagem
87. `maquiagem__maquiagem__maquiagem-para-ensaio-fotografico.webp` · **Maquiagem para ensaio fotográfico** (Maquiagem › Maquiagem) · 60 min · pistas: ensaio, make para foto, book
88. `maquiagem__maquiagem__maquiagem-para-debutante.webp` · **Maquiagem para debutante** (Maquiagem › Maquiagem) · 90 min · pistas: 15 anos, debutante, make 15 anos
89. `maquiagem__maquiagem__maquiagem-artistica.webp` · **Maquiagem artística** (Maquiagem › Maquiagem) · 90 min · pistas: carnaval, fantasia, caracterização
90. `maquiagem__maquiagem__maquiagem-infantil.webp` · **Maquiagem infantil** (Maquiagem › Maquiagem) · 30 min · pistas: make infantil, maquiagem criança
91. `maquiagem__maquiagem__maquiagem-express.webp` · **Maquiagem express** (Maquiagem › Maquiagem) · 30 min · pistas: make rápida, retoque de make, express
92. `maquiagem__pele-e-preparacao__preparacao-de-pele.webp` · **Preparação de pele** (Maquiagem › Pele e preparação) · 30 min · pistas: skin prep, preparar a pele, pele para maquiagem
93. `maquiagem__pele-e-preparacao__limpeza-de-pele-pre-make.webp` · **Limpeza de pele pré-make** (Maquiagem › Pele e preparação) · 45 min · pistas: limpeza antes da make
94. `maquiagem__cursos__aula-particular-de-maquiagem.webp` · **Aula particular de maquiagem** (Maquiagem › Cursos) · 120 min · pistas: aula individual, mentoria de make

### Depilação
95. `depilacao__cera__virilha-simples.webp` · **Virilha simples** (Depilação › Cera) · 20 min · pistas: virilha comum, virilha básica, contorno de virilha
96. `depilacao__cera__rosto-completo.webp` · **Rosto completo** (Depilação › Cera) · 25 min · pistas: face, rosto, depilação facial
97. `depilacao__cera__braco.webp` · **Braço** (Depilação › Cera) · 20 min · pistas: braços, braço completo
98. `depilacao__cera__costas.webp` · **Costas** (Depilação › Cera) · 30 min · pistas: costa, depilação de costas
99. `depilacao__cera__peito-e-abdomen.webp` · **Peito e abdômen** (Depilação › Cera) · 30 min · pistas: peito, abdômen, barriga
100. `depilacao__cera__gluteos.webp` · **Glúteos** (Depilação › Cera) · 20 min · pistas: bumbum, nádegas, glúteo
101. `depilacao__cera__corpo-inteiro.webp` · **Corpo inteiro** (Depilação › Cera) · 120 min · pistas: depilação completa, corpo todo, completa
102. `depilacao__linha__buco-com-linha.webp` · **Buço com linha** (Depilação › Linha) · 10 min · pistas: buço na linha
103. `depilacao__linha__rosto-com-linha.webp` · **Rosto com linha** (Depilação › Linha) · 25 min · pistas: rosto na linha, face na linha
104. `depilacao__laser-e-luz-pulsada__laser-axila.webp` · **Laser axila** (Depilação › Laser e luz pulsada) · 15 min · pistas: laser nas axilas
105. `depilacao__laser-e-luz-pulsada__laser-virilha.webp` · **Laser virilha** (Depilação › Laser e luz pulsada) · 20 min · pistas: laser na virilha, laser íntimo
106. `depilacao__laser-e-luz-pulsada__laser-perna-completa.webp` · **Laser perna completa** (Depilação › Laser e luz pulsada) · 40 min · pistas: laser nas pernas
107. `depilacao__laser-e-luz-pulsada__laser-rosto.webp` · **Laser rosto** (Depilação › Laser e luz pulsada) · 20 min · pistas: laser no buço, laser facial
108. `depilacao__laser-e-luz-pulsada__laser-corpo-inteiro.webp` · **Laser corpo inteiro** (Depilação › Laser e luz pulsada) · 90 min · pistas: laser completo, pacote laser
109. `depilacao__laser-e-luz-pulsada__luz-pulsada.webp` · **Luz pulsada** (Depilação › Laser e luz pulsada) · 30 min · pistas: ipl, fotodepilação, luz intensa pulsada
110. `depilacao__cuidados__esfoliacao-pre-depilacao.webp` · **Esfoliação pré-depilação** (Depilação › Cuidados) · 15 min · pistas: esfoliação, esfoliar antes da cera
111. `depilacao__cuidados__tratamento-de-foliculite.webp` · **Tratamento de foliculite** (Depilação › Cuidados) · 30 min · pistas: foliculite, pelo encravado, pelos encravados
112. `depilacao__cuidados__clareamento-de-virilha.webp` · **Clareamento de virilha** (Depilação › Cuidados) · 45 min · pistas: clareamento íntimo, clareamento de axilas, clareamento

### Estética facial
113. `estetica-facial__limpeza-de-pele__hidradermoabrasao.webp` · **Hidradermoabrasão** (Estética facial › Limpeza de pele) · 60 min · pistas: hydrafacial, hydra facial, hidra facial
114. `estetica-facial__limpeza-de-pele__limpeza-de-pele-com-peeling.webp` · **Limpeza de pele com peeling** (Estética facial › Limpeza de pele) · 90 min · pistas: limpeza + peeling, limpeza e peeling
115. `estetica-facial__limpeza-de-pele__limpeza-de-pele-para-adolescentes.webp` · **Limpeza de pele para adolescentes** (Estética facial › Limpeza de pele) · 60 min · pistas: limpeza teen, acne juvenil
116. `estetica-facial__peeling__peeling-de-diamante.webp` · **Peeling de diamante** (Estética facial › Peeling) · 45 min · pistas: peeling mecânico, microdermoabrasão, diamante
117. `estetica-facial__peeling__peeling-de-cristal.webp` · **Peeling de cristal** (Estética facial › Peeling) · 45 min · pistas: cristal, peeling de cristal
118. `estetica-facial__peeling__peeling-ultrassonico.webp` · **Peeling ultrassônico** (Estética facial › Peeling) · 45 min · pistas: ultrassônico, espátula ultrassônica
119. `estetica-facial__tratamentos__revitalizacao-facial.webp` · **Revitalização facial** (Estética facial › Tratamentos) · 60 min · pistas: revitalização, pele cansada, glow
120. `estetica-facial__tratamentos__tratamento-antienvelhecimento.webp` · **Tratamento antienvelhecimento** (Estética facial › Tratamentos) · 60 min · pistas: anti-idade, rugas, rejuvenescimento
121. `estetica-facial__tratamentos__tratamento-para-olheiras.webp` · **Tratamento para olheiras** (Estética facial › Tratamentos) · 45 min · pistas: olheiras, bolsas nos olhos, área dos olhos
122. `estetica-facial__tratamentos__mascara-facial.webp` · **Máscara facial** (Estética facial › Tratamentos) · 30 min · pistas: máscara, máscara de ouro, máscara de argila
123. `estetica-facial__tratamentos__drenagem-facial.webp` · **Drenagem facial** (Estética facial › Tratamentos) · 30 min · pistas: drenagem do rosto, drenagem linfática facial, inchaço no rosto
124. `estetica-facial__tratamentos__massagem-facial.webp` · **Massagem facial** (Estética facial › Tratamentos) · 30 min · pistas: lifting manual, yoga facial, massagem no rosto
125. `estetica-facial__tratamentos__hidratacao-labial.webp` · **Hidratação labial** (Estética facial › Tratamentos) · 20 min · pistas: hidragloss, hidra gloss, lábios
126. `estetica-facial__tecnologias__ultrassom-microfocado.webp` · **Ultrassom microfocado** (Estética facial › Tecnologias) · 60 min · pistas: hifu, lifting sem cirurgia, ultraformer
127. `estetica-facial__tecnologias__ledterapia.webp` · **Ledterapia** (Estética facial › Tecnologias) · 30 min · pistas: led, fototerapia, luz de led
128. `estetica-facial__tecnologias__alta-frequencia.webp` · **Alta frequência** (Estética facial › Tecnologias) · 20 min · pistas: alta frequencia, ozônio
129. `estetica-facial__tecnologias__jato-de-plasma.webp` · **Jato de plasma** (Estética facial › Tecnologias) · 60 min · pistas: plasma, jett plasma, blefaroplastia sem corte
130. `estetica-facial__tecnologias__criofrequencia-facial.webp` · **Criofrequência facial** (Estética facial › Tecnologias) · 45 min · pistas: criofrequência, crio facial
131. `estetica-facial__tecnologias__carboxiterapia-facial.webp` · **Carboxiterapia facial** (Estética facial › Tecnologias) · 30 min · pistas: carboxi, carboxiterapia, co2
132. `estetica-facial__tecnologias__eletroterapia-facial.webp` · **Eletroterapia facial** (Estética facial › Tecnologias) · 30 min · pistas: corrente, microcorrentes, lifting elétrico
133. `estetica-facial__procedimentos-injetaveis__toxina-botulinica.webp` · **Toxina botulínica** (Estética facial › Procedimentos injetáveis) · 30 min · pistas: botox, toxina, aplicação de botox
134. `estetica-facial__procedimentos-injetaveis__preenchimento-com-acido-hialuronico.webp` · **Preenchimento com ácido hialurônico** (Estética facial › Procedimentos injetáveis) · 60 min · pistas: preenchimento, preenchimento labial, ácido hialurônico
135. `estetica-facial__procedimentos-injetaveis__bioestimulador-de-colageno.webp` · **Bioestimulador de colágeno** (Estética facial › Procedimentos injetáveis) · 60 min · pistas: bioestimulador, sculptra, radiesse
136. `estetica-facial__procedimentos-injetaveis__skinbooster.webp` · **Skinbooster** (Estética facial › Procedimentos injetáveis) · 45 min · pistas: skin booster, hidratação injetável
137. `estetica-facial__procedimentos-injetaveis__fios-de-pdo.webp` · **Fios de PDO** (Estética facial › Procedimentos injetáveis) · 60 min · pistas: fios de sustentação, fios, lifting com fios
138. `estetica-facial__procedimentos-injetaveis__enzimas-para-papada.webp` · **Enzimas para papada** (Estética facial › Procedimentos injetáveis) · 30 min · pistas: lipo de papada, enzimas, papada
139. `estetica-facial__procedimentos-injetaveis__harmonizacao-facial.webp` · **Harmonização facial** (Estética facial › Procedimentos injetáveis) · 90 min · pistas: harmonização, full face, harmonização orofacial

### Estética corporal
140. `estetica-corporal__massagens-esteticas__massagem-turbinada.webp` · **Massagem turbinada** (Estética corporal › Massagens estéticas) · 60 min · pistas: turbinada, drenagem + modeladora
141. `estetica-corporal__massagens-esteticas__drenagem-pos-operatorio.webp` · **Drenagem pós-operatório** (Estética corporal › Massagens estéticas) · 60 min · pistas: pós operatório, pós cirúrgico, drenagem pós-cirúrgica
142. `estetica-corporal__massagens-esteticas__massagem-relaxante-corporal.webp` · **Massagem relaxante corporal** (Estética corporal › Massagens estéticas) · 60 min · pistas: relaxante, massagem
143. `estetica-corporal__gordura-localizada__carboxiterapia-corporal.webp` · **Carboxiterapia corporal** (Estética corporal › Gordura localizada) · 30 min · pistas: carboxi, carboxiterapia, estrias com carboxi
144. `estetica-corporal__gordura-localizada__ultrassom-corporal.webp` · **Ultrassom corporal** (Estética corporal › Gordura localizada) · 30 min · pistas: ultrassom, ultrassom estético
145. `estetica-corporal__gordura-localizada__vacuoterapia.webp` · **Vacuoterapia** (Estética corporal › Gordura localizada) · 45 min · pistas: vácuo, endermologia, endermoterapia
146. `estetica-corporal__gordura-localizada__corrente-russa.webp` · **Corrente russa** (Estética corporal › Gordura localizada) · 30 min · pistas: eletroestimulação, eletro, tonificação muscular
147. `estetica-corporal__gordura-localizada__enzimas-corporais.webp` · **Enzimas corporais** (Estética corporal › Gordura localizada) · 30 min · pistas: intradermoterapia, lipo enzimática, lipo de enzimas
148. `estetica-corporal__gordura-localizada__manta-termica.webp` · **Manta térmica** (Estética corporal › Gordura localizada) · 30 min · pistas: manta, manta de emagrecimento
149. `estetica-corporal__gordura-localizada__detox-corporal.webp` · **Detox corporal** (Estética corporal › Gordura localizada) · 60 min · pistas: bandagem, body wrap, bandagem redutora
150. `estetica-corporal__gordura-localizada__heccus-terapia-combinada.webp` · **Heccus / terapia combinada** (Estética corporal › Gordura localizada) · 45 min · pistas: heccus, terapia combinada, ultrassom + corrente
151. `estetica-corporal__celulite-flacidez-e-estrias__tratamento-para-flacidez.webp` · **Tratamento para flacidez** (Estética corporal › Celulite, flacidez e estrias) · 60 min · pistas: flacidez, firmeza, tonificar
152. `estetica-corporal__celulite-flacidez-e-estrias__tratamento-para-estrias.webp` · **Tratamento para estrias** (Estética corporal › Celulite, flacidez e estrias) · 60 min · pistas: estrias, estria, clareamento de estrias
153. `estetica-corporal__celulite-flacidez-e-estrias__microagulhamento-corporal.webp` · **Microagulhamento corporal** (Estética corporal › Celulite, flacidez e estrias) · 60 min · pistas: microagulhamento, estrias com microagulhamento
154. `estetica-corporal__celulite-flacidez-e-estrias__tratamento-para-gluteos.webp` · **Tratamento para glúteos** (Estética corporal › Celulite, flacidez e estrias) · 60 min · pistas: bumbum up, glúteo, bumbum
155. `estetica-corporal__celulite-flacidez-e-estrias__protocolo-corporal-completo.webp` · **Protocolo corporal completo** (Estética corporal › Celulite, flacidez e estrias) · 90 min · pistas: pacote corporal, protocolo, sessão completa
156. `estetica-corporal__bronzeamento__preparacao-pre-bronze.webp` · **Preparação pré-bronze** (Estética corporal › Bronzeamento) · 20 min · pistas: preparação para bronze, pré-bronze, hidratação pré-bronze
157. `estetica-corporal__bronzeamento__esfoliacao-pre-bronze.webp` · **Esfoliação pré-bronze** (Estética corporal › Bronzeamento) · 20 min · pistas: esfoliação, esfoliar antes do bronze
158. `estetica-corporal__bronzeamento__cuidados-pos-bronze.webp` · **Cuidados pós-bronze** (Estética corporal › Bronzeamento) · 30 min · pistas: pós-bronze, hidratação pós-bronze, prolongar o bronze
159. `estetica-corporal__cuidados-com-a-pele-do-corpo__peeling-corporal.webp` · **Peeling corporal** (Estética corporal › Cuidados com a pele do corpo) · 45 min · pistas: peeling de corpo, peeling nas costas, peeling de axila
160. `estetica-corporal__cuidados-com-a-pele-do-corpo__hidratacao-corporal.webp` · **Hidratação corporal** (Estética corporal › Cuidados com a pele do corpo) · 45 min · pistas: hidratação do corpo, hidratar
161. `estetica-corporal__cuidados-com-a-pele-do-corpo__esfoliacao-corporal.webp` · **Esfoliação corporal** (Estética corporal › Cuidados com a pele do corpo) · 30 min · pistas: esfoliação, esfoliar o corpo
162. `estetica-corporal__cuidados-com-a-pele-do-corpo__tratamento-para-foliculite-corporal.webp` · **Tratamento para foliculite corporal** (Estética corporal › Cuidados com a pele do corpo) · 30 min · pistas: foliculite, pelos encravados

### Micropigmentação
163. `micropigmentacao__retoques-correcoes-e-remocao__correcao-de-cor.webp` · **Correção de cor** (Micropigmentação › Retoques, correções e remoção) · 120 min · pistas: correção de micro, micro avermelhada, micro azulada
164. `micropigmentacao__retoques-correcoes-e-remocao__neutralizacao.webp` · **Neutralização** (Micropigmentação › Retoques, correções e remoção) · 90 min · pistas: neutralização de pigmento, neutralizar, camuflagem de micro antiga

### Bem-estar e spa
165. `bem-estar-e-spa__massagens__massagem-desportiva.webp` · **Massagem desportiva** (Bem-estar e spa › Massagens) · 60 min · pistas: esportiva, massagem para atleta, pós-treino
166. `bem-estar-e-spa__massagens__massagem-para-gestante.webp` · **Massagem para gestante** (Bem-estar e spa › Massagens) · 60 min · pistas: gestante, grávida, massagem na gravidez
167. `bem-estar-e-spa__massagens__massagem-tailandesa.webp` · **Massagem tailandesa** (Bem-estar e spa › Massagens) · 90 min · pistas: tailandesa, thai, thai massage
168. `bem-estar-e-spa__massagens__shiatsu.webp` · **Shiatsu** (Bem-estar e spa › Massagens) · 60 min · pistas: shiatsu, massagem japonesa
169. `bem-estar-e-spa__massagens__massagem-ayurvedica.webp` · **Massagem ayurvédica** (Bem-estar e spa › Massagens) · 90 min · pistas: ayurveda, ayurvédica, abhyanga
170. `bem-estar-e-spa__massagens__massagem-nos-pes.webp` · **Massagem nos pés** (Bem-estar e spa › Massagens) · 30 min · pistas: massagem podal, pés cansados
171. `bem-estar-e-spa__massagens__massagem-para-casal.webp` · **Massagem para casal** (Bem-estar e spa › Massagens) · 60 min · pistas: casal, massagem a dois
172. `bem-estar-e-spa__terapias__auriculoterapia.webp` · **Auriculoterapia** (Bem-estar e spa › Terapias) · 30 min · pistas: auricular, sementes na orelha, acupuntura auricular
173. `bem-estar-e-spa__terapias__acupuntura.webp` · **Acupuntura** (Bem-estar e spa › Terapias) · 60 min · pistas: agulhas, acupuntura chinesa
174. `bem-estar-e-spa__terapias__reiki.webp` · **Reiki** (Bem-estar e spa › Terapias) · 60 min · pistas: reiki, energização
175. `bem-estar-e-spa__terapias__liberacao-miofascial.webp` · **Liberação miofascial** (Bem-estar e spa › Terapias) · 60 min · pistas: miofascial, liberação, fáscia
176. `bem-estar-e-spa__terapias__drenagem-relaxante.webp` · **Drenagem relaxante** (Bem-estar e spa › Terapias) · 60 min · pistas: drenagem, drenagem linfática relaxante
177. `bem-estar-e-spa__terapias__terapia-com-pedras-quentes.webp` · **Terapia com pedras quentes** (Bem-estar e spa › Terapias) · 60 min · pistas: pedras quentes, hot stone therapy
178. `bem-estar-e-spa__spa__ritual-de-spa.webp` · **Ritual de spa** (Bem-estar e spa › Spa) · 120 min · pistas: ritual, ritual relaxante, experiência spa
179. `bem-estar-e-spa__spa__banho-de-ofuro.webp` · **Banho de ofurô** (Bem-estar e spa › Spa) · 45 min · pistas: ofurô, ofuro, banheira
180. `bem-estar-e-spa__spa__sauna.webp` · **Sauna** (Bem-estar e spa › Spa) · 30 min · pistas: sauna seca, sauna a vapor
181. `bem-estar-e-spa__spa__esfoliacao-e-hidratacao-corporal.webp` · **Esfoliação e hidratação corporal** (Bem-estar e spa › Spa) · 60 min · pistas: esfoliação com hidratação, ritual corporal
182. `bem-estar-e-spa__spa__spa-das-noivas.webp` · **Spa das noivas** (Bem-estar e spa › Spa) · 240 min · pistas: noiva spa, pacote noiva relaxante

## 9. Checklist antes de subir
- [ ] 14:9, assunto no centro, respiro nas bordas
- [ ] sem texto, logo, marca ou marca d’água
- [ ] sem rosto inteiro identificável, sem menores, nada invasivo
- [ ] tom de pele e cabelo variados dentro da mesma família
- [ ] WebP ≤ 250 KB (família) / ≤ 180 KB (serviço)
- [ ] subida no painel da Plataforma → Catálogo, no item certo
