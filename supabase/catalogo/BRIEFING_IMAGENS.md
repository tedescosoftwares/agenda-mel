# Briefing — imagens do catálogo de serviços da MIMO

Para gerar com o GPT (ou outra IA de imagem). Cole este briefing inteiro e
anexe `imagens_lista.csv`, que tem a lista completa: 10 categorias, 51
famílias e 252 serviços (313 arquivos), com nome, caminho e contexto.

## 1. O que é a MIMO e onde as imagens aparecem

A MIMO é um app de agendamento para salões e profissionais de beleza e
estética no Brasil (cabelo, unhas, cílios, sobrancelhas, maquiagem,
depilação, estética facial e corporal, micropigmentação, bem-estar e spa).
Público: donas e profissionais de salão, estúdios e clínicas de estética.

As imagens aparecem em cartões pequenos dentro do app:

- **Categoria**: cartão de 210×118 px no computador e dois por linha no
  celular; também numa faixa de 150×68 px. É a imagem mais vista.
- **Família** (ex.: Cabelo › Tratamentos): miniatura de 56×56 px ao lado do nome.
- **Serviço** (ex.: Cabelo › Tratamentos › Hidratação): miniatura de 44×44 px na lista.

Em todos os casos a imagem é cortada pelo centro (`object-fit: cover`) e pode
aparecer bem pequena. Por isso: **assunto centralizado, grande e único**,
sem detalhe importante nas bordas (deixe 15% de margem de segurança), fundo
limpo, contraste suave. O nome da categoria vai escrito por cima ou ao lado
no app, então **nenhuma imagem pode ter texto, letras, números, logotipo
ou marca d'água**.

## 2. Identidade visual

- Claro, leve, sofisticado, feminino sem ser infantil. Editorial de beleza,
  não foto de banco de imagens.
- Paleta da marca para harmonizar (não para pintar tudo): rosa `#ff2d7a`,
  rosa claro `#ff7baa`, roxo `#aa4cff`, lilás `#fbf6fb`, grafite `#1f2026`.
  Use como toque: um esmalte, uma toalha, uma flor, um reflexo. Fundos em
  branco, off-white, bege claro, lilás pálido, rosa pálido.
- Luz natural suave de janela ou softbox; sombras macias; nada de flash
  duro, neon, HDR ou saturação exagerada.
- Fotorrealista, lente 50–85 mm, foco raso (fundo desfocado), textura de
  pele e cabelo real.
- Pessoas: mulheres de tons de pele, idades e tipos de cabelo variados
  (preta, parda, branca, asiática; cabelos lisos, ondulados, cacheados e
  crespos). Rosto não é obrigatório: close de mãos, unhas, fios, cílios,
  pele. Quando houver rosto, expressão natural e serena, sem sorriso forçado.
- O conjunto precisa parecer uma única sessão de fotos: mesma luz, mesma
  temperatura de cor, mesmo acabamento.

Não fazer:

- texto, letras, logotipos, embalagens de marcas, telas de celular;
- homens como assunto principal (o catálogo da MIMO não sugere serviços
  masculinos; é posicionamento, não restrição do app);
- cabine ou câmara de bronzeamento UV;
- agulhas, seringas e sangue visíveis (em injetáveis e micropigmentação
  mostre o resultado, a pele, o ambiente calmo, o profissional de luva);
- mãos com dedos a mais, dentes estranhos, olhos tortos, reflexos errados;
- fundo poluído, muitos objetos, cores gritantes, visual de clínica fria;
- rosa em tudo: a marca é acento, não tema.

## 3. Especificação técnica

| item | valor |
|---|---|
| formato | WebP, qualidade 80–85, sRGB |
| proporção | 14:9 (horizontal) em todos os níveis |
| tamanho | 1400×900 px (categorias e famílias); 1120×720 px (serviços) |
| peso alvo | categorias até 160 KB; famílias até 120 KB; serviços até 80 KB |
| nome do arquivo | exatamente como está na coluna `arquivo` do CSV, minúsculas, sem acento, hífens |
| pastas | `imagens/catalogo/<categoria>.webp`, `imagens/catalogo/<categoria>/<familia>.webp`, `imagens/catalogo/<categoria>/<familia>/<servico>.webp` |

Técnicas (ex.: Progressiva › Orgânica) não têm imagem. Entregar um .zip com
a árvore `imagens/catalogo/...` já montada; o app encontra tudo pelo nome.

## 4. Ordem de produção

1. As 10 categorias (as mais vistas; capricho máximo).
2. As 51 famílias.
3. Os serviços com prioridade de sugestão (coluna `prioridade_sugestao` do
   catálogo; os 6–8 primeiros de cada categoria aparecem na tela inicial).
4. O resto dos serviços.

## 5. Modelo de prompt

Para cada linha do CSV, montar:

> Fotografia editorial de beleza, fotorrealista. Assunto: **{nome}**
> ({nivel} de {categoria}{, família {familia}}). Mostrar: {contexto}.
> Enquadramento fechado, assunto centralizado, horizontal 14:9, margem de
> segurança nas bordas. Luz natural suave de janela, fundo limpo e
> desfocado em tons off-white e lilás pálido, um toque discreto de rosa.
> Pele e cabelo com textura real. Sem texto, sem logotipo, sem marca
> d'água, sem homem como assunto, sem agulha visível.

Prompt negativo (quando a ferramenta aceitar): `texto, letras, logo, marca
d'água, neon, saturado, HDR, flash duro, mãos deformadas, dedos extras,
rosto distorcido, cabine UV, agulha, seringa, sangue, homem, fundo
bagunçado, produto de marca`.

## 6. As 10 categorias, uma a uma

| arquivo | o que mostrar |
|---|---|
| `imagens/catalogo/cabelo.webp` | cabelo longo saudável sendo finalizado com escova e secador, fios brilhando na luz, close nas mechas; sem rosto inteiro |
| `imagens/catalogo/unhas.webp` | mãos com esmaltação em gel rosa-nude recém-feita, um esmalte aberto ao lado, fundo claro |
| `imagens/catalogo/cilios.webp` | close extremo de um olho fechado com extensão de cílios volumosa e limpa, pele luminosa |
| `imagens/catalogo/sobrancelhas.webp` | close de sobrancelha desenhada com henna ou laminada, pinça ou lápis fora de foco |
| `imagens/catalogo/maquiagem.webp` | pele iluminada, pincel aplicando blush, batom e paleta fora de foco, luz de camarim suave |
| `imagens/catalogo/depilacao.webp` | pernas lisas e hidratadas sobre toalha branca, espátula de cera ou roll-on ao lado, nada de pelos |
| `imagens/catalogo/estetica-facial.webp` | rosto com máscara ou gotas de sérum, toalha na cabeça, esteticista de luva branca ao lado |
| `imagens/catalogo/estetica-corporal.webp` | abdômen/cintura durante massagem modeladora ou drenagem, mãos da profissional, óleo, luz quente |
| `imagens/catalogo/micropigmentacao.webp` | close de sobrancelha fio a fio e lábios com micropigmentação suave, resultado natural, dermógrafo fora de foco e sem agulha visível |
| `imagens/catalogo/bem-estar-e-spa.webp` | pedras quentes nas costas, velas, toalha enrolada, flor, vapor suave, ambiente de spa claro |

## 7. Como o app usa (para quem for conferir)

- A categoria aparece pelo arquivo `imagens/catalogo/<slug>.webp`. Sem o
  arquivo, o app mostra um gradiente da marca; nada quebra.
- Família e serviço aparecem pelo caminho de slugs do catálogo. Sem o
  arquivo, a miniatura simplesmente não aparece.
- Os slugs estão no CSV e em `catalogo_v1.json`. Não renomear.
