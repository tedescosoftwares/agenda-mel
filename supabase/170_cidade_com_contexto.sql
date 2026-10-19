-- 170 (3.22): a página da cidade ganha "Sobre a cidade" (contexto): o que a redação sabe da
-- cidade e a IA pode usar em todas as páginas dela (a da cidade, as de categoria e a de cada
-- salão). Até aqui só Itanhaém, Mongaguá e Peruíbe tinham um parágrafo fixo no código; as
-- outras recebiam "a redação não tem informações, não invente", e o texto saía igual para
-- qualquer cidade. O contexto não aparece no site: é insumo. Edita-se na Plataforma, em
-- Páginas da cidade, na linha da cidade.
--
-- As sementes abaixo são um ponto de partida para as cidades da Baixada, do Litoral Norte,
-- do Vale do Paraíba e do Vale do Ribeira (só coisa geral e certa: região, tipo de cidade,
-- temporada, como ela se organiza). Só preenchem onde está vazio; o que a Plataforma escreveu
-- fica. Cidade sem linha ainda ganha a linha da página (status rascunho, fora do site até o
-- primeiro salão publicado), para o contexto já existir quando a cidade for importada.

alter table public.guia_paginas add column if not exists contexto text;
comment on column public.guia_paginas.contexto is 'Guia (170): "Sobre a cidade", só na linha da cidade (categoria vazia). O que a redação sabe da cidade e a IA pode usar nas páginas dela. Não aparece no site.';

-- mexer no contexto não é atualização da página (ninguém vê): o lastmod não anda
create or replace function public.guia_tocar()
returns trigger language plpgsql as $$
declare
  -- o que a página NÃO mostra: mexer só nisso não é atualização
  internos text[] := array['atualizado_em', 'criado_em', 'nota', 'avaliacoes', 'origem', 'fontes', 'place_id', 'cnpj',
                           'motivo', 'aprovado_por', 'rascunho', 'gerado_em', 'contexto'];
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - internos) = (to_jsonb(old) - internos) then
    return new; -- nada visível mudou: fica a data que estava (ou a que o update mandou de propósito)
  end if;
  new.atualizado_em := now();
  return new;
end $$;
comment on function public.guia_tocar() is 'Guia (164, 170): atualizado_em só anda quando muda algo que a página mostra.';

insert into public.guia_paginas (cidade, cidade_slug, uf, categoria, contexto) values
  -- Baixada Santista
  ('Praia Grande', 'praia-grande', 'SP', '', 'Praia Grande fica no litoral sul de São Paulo, na Baixada Santista, e é uma das cidades mais populosas do litoral paulista. É cidade de praia: nos fins de semana, no verão e nos feriados chegam veranistas e turistas de um dia vindos da Grande São Paulo, e o movimento do comércio acompanha. A cidade se estende ao longo da orla, e os bairros levam os nomes que quem frequenta a praia conhece (Canto do Forte, Boqueirão, Guilhermina, Aviação, Tupi, Ocian, Mirim, Caiçara, Solemar); o comércio se concentra nas avenidas paralelas à praia. Sol, sal, cloro de piscina e maresia pesam no cabelo, na pele, nos cílios e no esmalte.'),
  ('Santos', 'santos', 'SP', '', 'Santos fica na Baixada Santista, litoral de São Paulo, e é a maior cidade da região, com o porto e o comércio e os serviços que atendem toda a Baixada. A orla (Gonzaga, Boqueirão, Embaré, Aparecida, Ponta da Praia) concentra comércio, turismo e moradores; o Centro histórico e a Zona Noroeste são outras áreas grandes da cidade. Além dos moradores, recebe turistas no verão e nos feriados e gente das cidades vizinhas que vem trabalhar, estudar e fazer compras. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('São Vicente', 'sao-vicente', 'SP', '', 'São Vicente fica na Baixada Santista, colada a Santos, e é a cidade mais antiga do Brasil. Tem a parte da ilha, com a orla (Itararé, Gonzaguinha, Biquinha) e o Centro, e a Área Continental, do outro lado do canal, com bairros grandes e populosos. Boa parte dos moradores trabalha em Santos ou nas cidades vizinhas; no verão e nos feriados a orla recebe veranistas. É cidade de praia: sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Guarujá', 'guaruja', 'SP', '', 'Guarujá fica na ilha de Santo Amaro, na Baixada Santista, e é um dos destinos de praia mais procurados por quem vem da Grande São Paulo. Pitangueiras, Enseada, Astúrias e Tombo concentram turismo, hotéis e comércio; Vicente de Carvalho, do lado do canal, é o distrito mais populoso e mais ligado à rotina de quem mora e trabalha na cidade. O movimento muda muito entre a temporada e o resto do ano. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Cubatão', 'cubatao', 'SP', '', 'Cubatão fica na Baixada Santista, entre a serra e o canal, e é uma cidade industrial: o polo petroquímico e siderúrgico está na origem de boa parte dos empregos. Não tem praia. A rotina é de cidade de trabalho, com o comércio concentrado no Centro e em bairros como Vila Nova e Jardim Casqueiro, e muita gente circulando entre Cubatão, Santos e São Vicente.'),
  ('Bertioga', 'bertioga', 'SP', '', 'Bertioga fica no litoral de São Paulo, na ponta norte da Baixada Santista, na divisa com o Litoral Norte. É cidade de praia e de casas de veraneio: o Centro e os bairros próximos (Indaiá, Vista Linda, Maitinga) concentram quem mora o ano todo, e a Riviera de São Lourenço, mais ao norte, é um bairro planejado de alto padrão com movimento forte na temporada e nos feriados. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Mongaguá', 'mongagua', 'SP', '', 'Mongaguá fica no litoral sul de São Paulo, entre Praia Grande e Itanhaém. É cidade pequena, de praia e de casas de veraneio: o movimento cresce muito no verão e nos feriados prolongados, quando chegam veranistas e donos de casa de praia. O comércio fica no Centro e ao longo da rodovia e das avenidas que acompanham a praia. Sol, sal, cloro de piscina e maresia pesam no cabelo, na pele, nos cílios e no esmalte.'),
  ('Itanhaém', 'itanhaem', 'SP', '', 'Itanhaém fica no litoral sul de São Paulo e é uma das cidades mais antigas do Brasil. É cidade de praia, comprida: vai do Centro e da Boca da Barra até Suarão e Gaivota, com muitos bairros ao longo da orla e para dentro, uns de moradores o ano todo, outros de veraneio. O movimento cresce no verão e nos feriados prolongados, quando chegam veranistas e donos de casa de praia. Sol, sal, cloro de piscina e maresia pesam no cabelo, na pele, nos cílios e no esmalte.'),
  ('Peruíbe', 'peruibe', 'SP', '', 'Peruíbe fica no litoral sul de São Paulo, a última cidade antes da Estação Ecológica da Juréia, que limita a cidade ao sul. É cidade de praia e de veraneio: o Centro e os bairros junto à praia concentram o comércio, e o movimento cresce no verão e nos feriados prolongados. Sol, sal, cloro de piscina e maresia pesam no cabelo, na pele, nos cílios e no esmalte.'),
  -- Litoral Norte
  ('Caraguatatuba', 'caraguatatuba', 'SP', '', 'Caraguatatuba é a maior cidade do Litoral Norte de São Paulo e o centro de comércio e serviços da região. O Centro, Martim de Sá, Indaiá e a região sul (Porto Novo, Perequê-Mirim) concentram moradores o ano todo; Massaguaçu e as praias do norte têm mais casas de veraneio. Recebe turistas no verão e nos feriados, mas tem rotina de cidade grande o ano inteiro. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('São Sebastião', 'sao-sebastiao', 'SP', '', 'São Sebastião fica no Litoral Norte de São Paulo, de frente para Ilhabela. A cidade tem duas partes bem diferentes: o Centro e os bairros próximos, com o porto e a rotina de quem mora e trabalha, e a Costa Sul (Maresias, Boiçucanga, Camburi, Juquehy, Barra do Sahy), a quase uma hora do Centro, com praias de turismo e casas de alto padrão, muito movimentadas na temporada e nos feriados. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Ubatuba', 'ubatuba', 'SP', '', 'Ubatuba fica no extremo norte do litoral paulista, perto da divisa com o Rio de Janeiro, com dezenas de praias e muita mata atlântica. O Centro, Itaguá e Perequê-Açu concentram comércio e moradores; as praias do sul e do norte têm mais pousadas e casas de veraneio. A temporada de verão e os feriados multiplicam o movimento. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Ilhabela', 'ilhabela', 'SP', '', 'Ilhabela é uma ilha do Litoral Norte de São Paulo, ligada a São Sebastião por balsa. Quem mora o ano todo se concentra na face voltada para o continente (Perequê, Vila, Itaquanduba, Barra Velha, Água Branca). A ilha vive do turismo, da vela e das casas de veraneio, com movimento muito maior na temporada, nos feriados e nos eventos náuticos. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  -- Vale do Paraíba
  ('São José dos Campos', 'sao-jose-dos-campos', 'SP', '', 'São José dos Campos é a maior cidade do Vale do Paraíba, polo de tecnologia, indústria aeronáutica e universidades, a cerca de 90 km de São Paulo. É cidade grande e espalhada: o Centro, a Vila Adyana e o Jardim Aquarius concentram comércio e serviços; as zonas Sul, Norte, Leste e Oeste têm bairros populosos com comércio próprio. Não é cidade de praia: o clima é de interior, mais seco no inverno.'),
  ('Taubaté', 'taubate', 'SP', '', 'Taubaté fica no Vale do Paraíba, entre São José dos Campos e Pindamonhangaba, e é uma das maiores cidades da região, com indústria, universidade e comércio forte no Centro e na região da Independência. Não é cidade de praia: clima de interior, seco no inverno.'),
  ('Jacareí', 'jacarei', 'SP', '', 'Jacareí fica no Vale do Paraíba, colada a São José dos Campos, a cerca de 80 km de São Paulo. É cidade industrial e de moradores que trabalham também nas cidades vizinhas; o Centro e os bairros ao redor concentram o comércio. Não é cidade de praia: clima de interior.'),
  ('Pindamonhangaba', 'pindamonhangaba', 'SP', '', 'Pindamonhangaba fica no Vale do Paraíba, entre Taubaté e Guaratinguetá, com indústria forte e o distrito de Moreira César, populoso e com comércio próprio. Não é cidade de praia: clima de interior.'),
  ('Guaratinguetá', 'guaratingueta', 'SP', '', 'Guaratinguetá fica no Vale do Paraíba, vizinha de Aparecida e Lorena, com universidade, indústria e comércio regional no Centro; recebe parte do movimento dos romeiros de Aparecida. Não é cidade de praia: clima de interior.'),
  ('Caçapava', 'cacapava', 'SP', '', 'Caçapava fica no Vale do Paraíba, entre São José dos Campos e Taubaté. É cidade menor, industrial e residencial, com o comércio no Centro. Não é cidade de praia: clima de interior.'),
  ('Lorena', 'lorena', 'SP', '', 'Lorena fica no Vale do Paraíba, perto de Guaratinguetá e Aparecida, com universidades (a USP tem campus na cidade) e comércio no Centro. Não é cidade de praia: clima de interior.'),
  ('Cruzeiro', 'cruzeiro', 'SP', '', 'Cruzeiro fica no fundo do Vale do Paraíba, perto da divisa com Minas Gerais e com o Rio de Janeiro. É cidade de porte médio, com comércio regional no Centro. Não é cidade de praia: clima de interior.'),
  ('Campos do Jordão', 'campos-do-jordao', 'SP', '', 'Campos do Jordão fica na Serra da Mantiqueira, a mais de 1.600 m de altitude, e é a cidade mais fria do estado. A temporada de inverno (julho) lota a cidade de turistas, com o movimento concentrado em Capivari; Abernéssia e Vila Jaguaribe são as áreas de quem mora o ano todo. Frio e ar seco pesam na pele e no cabelo.'),
  ('Tremembé', 'tremembe', 'SP', '', 'Tremembé fica no Vale do Paraíba, colada a Taubaté. É cidade pequena, com comércio no Centro e muitos moradores que trabalham nas cidades vizinhas. Não é cidade de praia: clima de interior.'),
  ('Aparecida', 'aparecida', 'SP', '', 'Aparecida fica no Vale do Paraíba e vive do turismo religioso: a Basílica Nacional recebe milhões de romeiros por ano, com picos nos fins de semana, em outubro e nos feriados. O comércio se concentra no Centro e perto do Santuário. Não é cidade de praia: clima de interior.'),
  -- Vale do Ribeira
  ('Iguape', 'iguape', 'SP', '', 'Iguape fica no Vale do Ribeira, no litoral sul de São Paulo, cidade histórica junto ao Mar Pequeno, de frente para a Ilha Comprida. O comércio fica no Centro histórico; recebe turistas nas festas religiosas e no verão, e muita gente da região vem à cidade para serviços.'),
  ('Ilha Comprida', 'ilha-comprida', 'SP', '', 'Ilha Comprida é uma ilha de cerca de 70 km de praia no litoral sul de São Paulo, ligada a Iguape por ponte. É cidade de veraneio: o Boqueirão Norte concentra comércio e moradores, e o movimento se multiplica no verão e nos feriados. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Cananéia', 'cananeia', 'SP', '', 'Cananéia fica no extremo sul do litoral paulista, cidade histórica e pesqueira, cercada de ilhas e mangue, com turismo de natureza; o comércio fica no Centro. Sol, sal e maresia pesam no cabelo, na pele e no esmalte.'),
  ('Miracatu', 'miracatu', 'SP', '', 'Miracatu fica no Vale do Ribeira, na rodovia Régis Bittencourt. É cidade pequena, de agricultura (banana) e comércio no Centro. Não tem praia.'),
  ('Itariri', 'itariri', 'SP', '', 'Itariri fica no Vale do Ribeira, entre Pedro de Toledo e Peruíbe. É cidade pequena, com comércio no Centro e no distrito de Ana Dias. Não tem praia.')
on conflict (cidade_slug, categoria) do update set contexto = coalesce(public.guia_paginas.contexto, excluded.contexto);

do $$
begin
  raise notice '170: guia_paginas.contexto ("Sobre a cidade" para a IA), sementes das cidades, lastmod ignora o contexto';
end $$;
