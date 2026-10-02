# Gera supabase/catalogo/catalogo_v1.json: a árvore do catálogo de serviços
# da MIMO (categoria → família → serviço → técnica) para revisão. Depois de
# aprovada, o mesmo JSON alimenta a semente da migração. Autoria compacta
# aqui, JSON completo lá.
#
#   python3 supabase/catalogo/gerar_catalogo.py
#
# Formato de cada serviço: (nome, duracao_min, aliases, tags, tecnicas)
# e de cada técnica: (nome, aliases, duracao_min ou None).
import json, re, unicodedata, os

def slug(t):
    t = unicodedata.normalize('NFD', t).encode('ascii', 'ignore').decode().lower()
    t = re.sub(r'[^a-z0-9]+', '-', t).strip('-')
    return t

def tec(nome, aliases=(), dur=None): return (nome, list(aliases), dur)
def sv(nome, dur, aliases=(), tags=(), tecnicas=()): return (nome, dur, list(aliases), list(tags), list(tecnicas))

CATALOGO = [
  # =====================================================================
  ('Cabelo', 'Corte, cor, escova, tratamentos e mais', ['cabeleireiro', 'cabeleireira', 'hair', 'salão de cabelo'], [
    ('Corte', ['cortes', 'cortar o cabelo'], [
      sv('Corte feminino', 60, ['corte de cabelo feminino', 'corte de cabelo', 'corte'], ['corte'], [
        tec('Reto'), tec('Em camadas', ['camadas', 'repicado em camadas']), tec('Repicado'), tec('Bob', ['chanel', 'chanel de bico', 'corte chanel']),
        tec('Long bob', ['lob']), tec('Pixie', ['curtinho', 'joãozinho']), tec('Curly cut', ['corte para cachos', 'corte de cachos', 'corte seco']),
        tec('Com franja', ['franja']), tec('Shag', ['wolf cut', 'mullet'])]),
      sv('Corte masculino', 30, ['corte de cabelo masculino', 'corte homem'], ['corte', 'masculino']),
      sv('Corte infantil', 30, ['corte criança', 'corte kids'], ['corte', 'infantil']),
      sv('Corte de franja', 20, ['franja', 'aparar franja'], ['corte']),
      sv('Corte com lavagem e finalização', 90, ['corte completo', 'corte lavagem e escova'], ['corte', 'combo']),
    ]),
    ('Escova e finalização', ['escovas', 'finalizações', 'secagem'], [
      sv('Escova', 45, ['escova lisa', 'escova de cabelo', 'secar o cabelo'], ['escova'], [
        tec('Lisa'), tec('Modelada', ['escova modelada', 'com volume']), tec('Com babyliss', ['escova com ondas'])]),
      sv('Babyliss', 45, ['ondas', 'cachos com babyliss', 'modelador', 'ondulado'], ['finalizacao']),
      sv('Chapinha', 30, ['prancha', 'alisar com chapinha'], ['finalizacao']),
      sv('Lavagem e secagem', 30, ['lavar e secar', 'lavagem', 'secagem'], ['finalizacao']),
      sv('Finalização', 30, ['finalização de cabelo', 'arrumar o cabelo'], ['finalizacao']),
    ]),
    ('Coloração', ['cor', 'pintar o cabelo', 'tintura', 'colorir'], [
      sv('Coloração global', 120, ['coloração', 'tintura', 'tinta', 'pintar o cabelo', 'cor', 'cobertura de brancos'], ['cor'], [
        tec('Permanente'), tec('Sem amônia', ['sem amonia']), tec('Tom sobre tom', ['semipermanente', 'tonalizante']), tec('Cobertura de brancos', ['cabelo branco', 'grisalhos'])]),
      sv('Retoque de raiz', 90, ['raiz', 'retoque', 'retoque de cor'], ['cor']),
      sv('Tonalização', 60, ['tonalizante', 'tonalizar'], ['cor']),
      sv('Matização', 45, ['matizar', 'desamarelador', 'matizador', 'tirar o amarelado'], ['cor', 'loiro']),
      sv('Correção de cor', 240, ['corrigir a cor', 'correção', 'cor errada'], ['cor']),
      sv('Descoloração global', 180, ['platinado', 'platinar', 'descolorir', 'descoloração', 'global loiro'], ['cor', 'loiro']),
      sv('Coloração fantasia', 180, ['cor fantasia', 'cabelo colorido', 'rosa', 'azul', 'cor vibrante'], ['cor']),
      sv('Banho de brilho', 60, ['gloss', 'glossing', 'banho de gloss'], ['cor', 'tratamento']),
    ]),
    ('Mechas e iluminação', ['mechas', 'luzes', 'iluminado', 'iluminação'], [
      sv('Mechas', 180, ['luzes', 'mecha', 'reflexos', 'iluminação'], ['cor', 'loiro'], [
        tec('Luzes', ['luzes tradicionais', 'com touca', 'com papel']), tec('Balayage', ['balaiagem', 'balayagem']), tec('Babylights'),
        tec('Ombré hair', ['ombre', 'ombré']), tec('Sombré', ['sombre']), tec('Morena iluminada', ['morena iluminada']),
        tec('Loiro iluminado', ['loira iluminada']), tec('Money piece', ['contorno', 'mechas frontais', 'contorno de rosto']),
        tec('Mechas invertidas', ['reverse', 'reverse balayage']), tec('Chunky highlights', ['mechas grossas', 'anos 2000']), tec('Mechas platinadas', ['mechas loiras'])]),
      sv('Mechas com corte e tratamento', 240, ['pacote mechas', 'mechas completa'], ['cor', 'combo']),
    ]),
    ('Alisamento e alinhamento', ['alisar', 'alisamento', 'liso', 'alinhamento'], [
      sv('Progressiva', 180, ['escova progressiva', 'alisamento', 'liso', 'progressiva de chocolate'], ['alisamento'], [
        tec('Orgânica', ['progressiva orgânica']), tec('Sem formol', ['sem formol', 'zero formol']), tec('Vegana'), tec('Com ácido', ['progressiva de ácido', 'ácido glioxílico']), tec('Premium')]),
      sv('Botox capilar', 120, ['btx capilar', 'btx', 'botox', 'redução de volume'], ['alisamento', 'tratamento']),
      sv('Selagem', 120, ['selagem térmica', 'selagem capilar'], ['alisamento', 'tratamento']),
      sv('Realinhamento', 120, ['realinhamento capilar', 'realinhamento térmico', 'alinhamento'], ['alisamento']),
      sv('Relaxamento', 120, ['relaxamento capilar', 'guanidina', 'hidróxido', 'relaxar'], ['alisamento']),
      sv('Escova definitiva', 180, ['definitiva', 'escova japonesa', 'definitiva japonesa'], ['alisamento']),
      sv('Alisamento com queratina', 180, ['keratina', 'queratina', 'alisamento de queratina'], ['alisamento']),
    ]),
    ('Tratamentos', ['tratamento capilar', 'cuidados com o cabelo', 'terapia capilar'], [
      sv('Hidratação', 60, ['hidratação capilar', 'hidratar', 'máscara'], ['tratamento']),
      sv('Nutrição', 60, ['nutrição capilar', 'nutrir'], ['tratamento']),
      sv('Reconstrução', 60, ['reconstrução capilar', 'queratina', 'reconstrução com queratina'], ['tratamento']),
      sv('Cronograma capilar', 90, ['cronograma'], ['tratamento']),
      sv('Cauterização', 60, ['cauterização capilar', 'cauterizar'], ['tratamento']),
      sv('Plástica dos fios', 90, ['plástica capilar', 'plástica'], ['tratamento']),
      sv('Umectação', 60, ['umectação capilar', 'umectar', 'óleo'], ['tratamento']),
      sv('Detox capilar', 45, ['limpeza do couro cabeludo', 'detox', 'esfoliação capilar'], ['tratamento', 'couro cabeludo']),
      sv('Tratamento antiqueda', 60, ['queda de cabelo', 'antiqueda', 'tricologia', 'terapia capilar'], ['tratamento', 'couro cabeludo']),
      sv('Ampola', 30, ['tratamento com ampola', 'ampola de tratamento'], ['tratamento']),
      sv('Laser capilar', 30, ['laser para queda', 'laserterapia capilar'], ['tratamento', 'couro cabeludo']),
    ]),
    ('Penteados', ['penteado', 'arrumação', 'festa'], [
      sv('Penteado', 60, ['penteado de festa', 'penteado social', 'arrumar para festa'], ['penteado'], [
        tec('Coque', ['coque bagunçado', 'coque baixo']), tec('Semipreso', ['semi preso', 'meio preso']), tec('Preso'), tec('Ondas', ['ondas de hollywood']),
        tec('Trança embutida', ['trança no penteado']), tec('Rabo de cavalo', ['rabo', 'ponytail'])]),
      sv('Penteado de noiva', 90, ['noiva', 'penteado para casamento'], ['penteado', 'noivas']),
      sv('Penteado infantil', 30, ['penteado criança', 'penteado de daminha'], ['penteado', 'infantil']),
      sv('Teste de penteado', 60, ['prova de penteado'], ['penteado', 'noivas']),
      sv('Dia da noiva', 300, ['dia de noiva', 'pacote noiva', 'noiva completo'], ['penteado', 'noivas', 'maquiagem', 'combo']),
    ]),
    ('Tranças', ['trança', 'braids', 'trançar'], [
      sv('Box braids', 240, ['tranças box', 'box', 'tranças soltas'], ['trancas']),
      sv('Knotless braids', 300, ['knotless', 'tranças sem nó'], ['trancas']),
      sv('Nagô', 120, ['tranças nagô', 'trança raiz', 'cornrows', 'trança rente'], ['trancas']),
      sv('Twist', 180, ['twists', 'tranças twist', 'senegalesa', 'twist senegalês'], ['trancas']),
      sv('Fulani', 240, ['fulani braids', 'tranças fulani'], ['trancas']),
      sv('Goddess braids', 240, ['goddess', 'tranças goddess', 'boho braids'], ['trancas']),
      sv('Crochet braids', 180, ['crochê', 'crochet', 'entrelace'], ['trancas']),
      sv('Trança boxeadora', 45, ['boxeadora', 'boxer braids', 'trança dupla'], ['trancas', 'penteado']),
      sv('Trança embutida', 45, ['embutida', 'trança lateral'], ['trancas', 'penteado']),
      sv('Manutenção de tranças', 90, ['manutenção das tranças', 'retoque de tranças'], ['trancas']),
      sv('Retirada de tranças', 90, ['tirar tranças', 'desmanchar tranças'], ['trancas']),
      sv('Dreads', 300, ['dread', 'dreadlocks', 'instalação de dreads', 'locs'], ['trancas']),
      sv('Manutenção de dreads', 120, ['retoque de dreads', 'manutenção de locs'], ['trancas']),
    ]),
    ('Mega hair e extensões', ['mega hair', 'megahair', 'extensão de cabelo', 'alongamento de cabelo', 'aplique'], [
      sv('Aplicação de mega hair', 180, ['mega hair', 'megahair', 'alongamento capilar', 'extensão capilar', 'colocar mega'], ['mega'], [
        tec('Nó italiano', ['nó', 'italiano']), tec('Fita adesiva', ['fita', 'tape in']), tec('Microlink', ['anel', 'micro link', 'anelzinho']),
        tec('Queratina', ['ponto a ponto', 'ponta de queratina']), tec('Costura', ['tela', 'costurado', 'na tela']), tec('Nano link', ['nanolink']), tec('Invisível', ['invisível', 'invisible'])]),
      sv('Manutenção de mega hair', 120, ['manutenção do mega', 'retoque de mega'], ['mega']),
      sv('Retirada de mega hair', 90, ['tirar mega', 'remoção de mega hair'], ['mega']),
      sv('Aplique tic-tac', 20, ['tic tac', 'aplique', 'aplique de festa'], ['mega', 'penteado']),
      sv('Hidratação de mega hair', 60, ['tratamento do mega'], ['mega', 'tratamento']),
    ]),
    ('Cachos', ['cacheados', 'crespos', 'cachos', 'curly'], [
      sv('Corte para cachos', 60, ['curly cut', 'corte de cacheado', 'corte seco'], ['cachos', 'corte']),
      sv('Finalização de cachos', 45, ['fitagem', 'dedoliss', 'day after', 'finalizar cachos', 'definição de cachos'], ['cachos', 'finalizacao']),
      sv('Hidratação para cachos', 60, ['hidratação cacheado', 'hidratação crespo'], ['cachos', 'tratamento']),
      sv('Transição capilar', 90, ['big chop', 'transição', 'corte de transição'], ['cachos']),
      sv('Permanente afro', 120, ['permanente', 'afro', 'cachos de permanente'], ['cachos']),
      sv('Texturização', 120, ['textura', 'texturizar', 'texturização capilar'], ['cachos']),
      sv('Penteado para cachos', 45, ['penteado afro', 'puff', 'coque afro'], ['cachos', 'penteado']),
    ]),
  ]),
  # =====================================================================
  ('Barbearia', 'Corte, barba, pigmentação e cuidados masculinos', ['barbeiro', 'barber', 'masculino'], [
    ('Corte masculino', ['cortes masculinos', 'corte homem'], [
      sv('Corte masculino', 30, ['corte', 'corte de cabelo', 'cortar', 'corte social'], ['corte', 'masculino'], [
        tec('Degradê', ['fade', 'degrade', 'disfarçado']), tec('Low fade', ['degradê baixo']), tec('Mid fade', ['degradê médio']), tec('High fade', ['degradê alto']),
        tec('Skin fade', ['navalhado', 'zero', 'na navalha']), tec('Taper', ['taper fade']), tec('Social', ['corte social', 'clássico']),
        tec('Americano', ['corte americano']), tec('Undercut'), tec('Moicano', ['moicano', 'mohawk']), tec('Na tesoura', ['tesoura']), tec('Na máquina', ['máquina', 'raspado'])]),
      sv('Corte infantil masculino', 30, ['corte criança', 'corte kids', 'corte de menino'], ['corte', 'infantil']),
      sv('Acabamento', 15, ['pezinho', 'contorno', 'pé do cabelo', 'acabamento de corte'], ['corte']),
      sv('Corte e barba', 60, ['corte + barba', 'combo', 'cabelo e barba'], ['corte', 'barba', 'combo']),
      sv('Corte com lavagem', 45, ['corte e lavagem', 'lavagem'], ['corte']),
    ]),
    ('Barba', ['barbas', 'fazer a barba'], [
      sv('Barba', 30, ['barba completa', 'fazer a barba', 'barbear', 'aparar a barba'], ['barba'], [
        tec('Com navalha', ['navalha', 'navalhada']), tec('Com toalha quente', ['toalha quente']), tec('Desenhada', ['desenho de barba', 'barba desenhada']),
        tec('Degradê na barba', ['barba degradê', 'barba fade']), tec('Na máquina', ['aparada na máquina'])]),
      sv('Barboterapia', 45, ['barba terapia', 'barbaterapia', 'ritual de barba', 'toalha quente'], ['barba']),
      sv('Aparar barba', 20, ['acabamento de barba', 'retoque de barba', 'alinhar barba'], ['barba']),
      sv('Bigode', 15, ['aparar bigode', 'bigode desenhado'], ['barba']),
      sv('Hidratação de barba', 30, ['tratamento de barba', 'óleo para barba'], ['barba', 'tratamento']),
      sv('Coloração de barba', 30, ['pintar a barba', 'tintura de barba', 'cobrir brancos na barba'], ['barba', 'cor']),
    ]),
    ('Pigmentação e cor', ['pigmentação', 'cor masculina'], [
      sv('Pigmentação capilar', 45, ['pigmentação', 'camuflagem de falhas', 'disfarce de falhas', 'hair stroke'], ['cor', 'masculino']),
      sv('Platinado', 180, ['platinado masculino', 'nevou', 'descoloração masculina', 'descolorir'], ['cor', 'loiro', 'masculino']),
      sv('Luzes masculinas', 120, ['mechas masculinas', 'luzes'], ['cor', 'masculino']),
      sv('Coloração masculina', 60, ['pintar o cabelo', 'tintura masculina', 'cobrir brancos'], ['cor', 'masculino']),
      sv('Camuflagem de fios brancos', 30, ['camuflagem de grisalhos', 'disfarce de brancos', 'tom sobre tom masculino'], ['cor', 'masculino']),
    ]),
    ('Alisamento masculino', ['progressiva masculina', 'relaxamento masculino'], [
      sv('Progressiva masculina', 90, ['progressiva', 'alisamento masculino'], ['alisamento', 'masculino']),
      sv('Relaxamento masculino', 60, ['relaxamento', 'relaxar o cabelo'], ['alisamento', 'masculino']),
      sv('Permanente masculino', 90, ['permanente', 'cachos masculinos', 'texturização masculina'], ['cachos', 'masculino']),
    ]),
    ('Sobrancelha e cuidados', ['sobrancelha masculina', 'cuidados masculinos'], [
      sv('Sobrancelha masculina', 15, ['sobrancelha na navalha', 'sobrancelha', 'limpeza de sobrancelha masculina'], ['sobrancelha', 'masculino']),
      sv('Limpeza de pele masculina', 45, ['limpeza de pele', 'skincare masculino'], ['pele', 'masculino']),
      sv('Depilação de nariz e orelha', 15, ['cera no nariz', 'cera na orelha', 'depilação nasal'], ['depilacao', 'masculino']),
      sv('Hidratação masculina', 30, ['hidratação capilar masculina', 'tratamento'], ['tratamento', 'masculino']),
      sv('Lavagem e massagem', 20, ['lavagem', 'massagem no couro cabeludo', 'lavagem relaxante'], ['masculino']),
      sv('Máscara facial masculina', 20, ['máscara preta', 'máscara facial'], ['pele', 'masculino']),
    ]),
  ]),
  # =====================================================================
  ('Unhas', 'Manicure, gel, alongamento e nail art', ['unha', 'manicure', 'nail', 'nail designer', 'esmalteria'], [
    ('Manicure', ['mão', 'mãos', 'unha da mão'], [
      sv('Manicure', 45, ['mão', 'mãos', 'unha da mão', 'fazer a mão', 'cutilagem e esmaltação'], ['manicure'], [
        tec('Tradicional', ['com alicate', 'com cutilagem']), tec('Russa', ['manicure russa', 'cutilagem russa', 'com broca', 'seca']), tec('Sem cutilagem', ['só esmaltação'])]),
      sv('Manicure e pedicure', 90, ['pé e mão', 'mão e pé', 'mãos e pés', 'manicure + pedicure'], ['manicure', 'pedicure', 'combo']),
      sv('Cutilagem', 20, ['tirar cutícula', 'cutícula'], ['manicure']),
      sv('Spa das mãos', 45, ['hidratação das mãos', 'spa de mãos'], ['manicure', 'spa']),
      sv('Manicure masculina', 30, ['mão masculina', 'unha masculina'], ['manicure', 'masculino']),
    ]),
    ('Pedicure', ['pé', 'pés', 'unha do pé'], [
      sv('Pedicure', 45, ['pé', 'pés', 'unha do pé', 'fazer o pé'], ['pedicure'], [
        tec('Tradicional'), tec('Russa', ['pedicure russa', 'com broca']), tec('Com esfoliação', ['com lixa nos pés'])]),
      sv('Spa dos pés', 60, ['spa pés', 'hidratação dos pés', 'spa de pés', 'escalda-pés com pedicure'], ['pedicure', 'spa']),
      sv('Cuidado com calos', 30, ['calo', 'calos', 'remoção de calos', 'calosidade'], ['pedicure', 'podologia']),
      sv('Tratamento de unha encravada', 45, ['unha encravada', 'encravada'], ['pedicure', 'podologia']),
      sv('Pedicure masculina', 40, ['pé masculino'], ['pedicure', 'masculino']),
    ]),
    ('Esmaltação', ['esmalte', 'esmaltar', 'pintar as unhas'], [
      sv('Esmaltação comum', 20, ['esmaltação simples', 'esmaltação tradicional', 'esmalte comum', 'só esmaltar'], ['esmaltacao']),
      sv('Esmaltação em gel', 60, ['gel', 'esmalte em gel', 'esmaltação gel', 'unha de gel', 'gel na unha natural'], ['esmaltacao', 'gel'], [
        tec('Com cutilagem'), tec('Sem cutilagem'), tec('Francesinha', ['francesa', 'french']), tec('Baby boomer', ['babyboomer', 'degradê']), tec('Com nail art', ['decorada'])]),
      sv('Francesinha', 30, ['francesa', 'french', 'unha francesinha'], ['esmaltacao']),
      sv('Troca de esmalte', 15, ['trocar esmalte', 'remover e esmaltar'], ['esmaltacao']),
      sv('Esmaltação em gel pés', 60, ['gel no pé', 'esmaltação em gel pedicure'], ['esmaltacao', 'gel', 'pedicure']),
    ]),
    ('Alongamento', ['alongamentos', 'unha de gel', 'unha postiça', 'alongar'], [
      sv('Alongamento de unhas', 150, ['alongamento', 'unha de gel', 'unha alongada', 'aplicação de alongamento', 'unhas postiças'], ['alongamento', 'gel'], [
        tec('Soft gel', ['softgel', 'soft gel tips', 'tips de gel']), tec('Fibra de vidro', ['fibra', 'alongamento de fibra']), tec('Molde F1', ['f1', 'molde', 'gel no molde']),
        tec('Tips', ['tip', 'com tips']), tec('Acrílico', ['acrílica', 'unha de acrílico', 'porcelana']), tec('Acrigel', ['polygel', 'poly gel', 'acrygel']),
        tec('Gel', ['gel na tela', 'alongamento em gel']), tec('Dual form', ['dual', 'molde dual'])]),
      sv('Reparo de unha', 15, ['conserto', 'unha quebrada', 'reparo', 'colar unha'], ['alongamento']),
      sv('Alongamento de uma unha', 20, ['uma unha', 'reposição de unha'], ['alongamento']),
    ]),
    ('Blindagem e banho de gel', ['blindagem', 'banho de gel', 'fortalecimento'], [
      sv('Blindagem', 60, ['blindagem de unhas', 'blindar', 'fortalecimento', 'unha blindada'], ['gel'], [
        tec('Com gel'), tec('Com fibra', ['fibra']), tec('Com acrigel', ['polygel'])]),
      sv('Banho de gel', 60, ['banho em gel', 'capa de gel', 'gel na unha natural', 'nivelamento'], ['gel']),
      sv('Manutenção de banho de gel', 60, ['manutenção banho de gel'], ['gel', 'manutencao']),
    ]),
    ('Manutenção e remoção', ['manutenção', 'remoção', 'tirar o gel'], [
      sv('Manutenção de gel', 60, ['manutenção em gel', 'manutenção de esmaltação em gel', 'manutenção'], ['gel', 'manutencao']),
      sv('Manutenção de alongamento', 120, ['manutenção do alongamento', 'manutenção de unha de gel', 'manutenção de fibra'], ['alongamento', 'manutencao']),
      sv('Remoção de gel', 30, ['remoção de esmalte em gel', 'tirar o gel', 'remoção gel', 'remover gel'], ['gel', 'remocao']),
      sv('Remoção de alongamento', 45, ['tirar alongamento', 'remoção de fibra', 'remoção de acrílico', 'remover alongamento'], ['alongamento', 'remocao']),
      sv('Manutenção de blindagem', 60, ['manutenção da blindagem'], ['gel', 'manutencao']),
    ]),
    ('Nail art', ['decoração de unhas', 'unha decorada', 'desenho na unha', 'arte'], [
      sv('Nail art', 30, ['decoração', 'decoração de unhas', 'desenho', 'unha decorada', 'adesivo'], ['nail art'], [
        tec('Francesinha decorada', ['francesinha colorida']), tec('Pedrarias', ['strass', 'pedras', 'cristais']), tec('Encapsulada', ['aquário', 'encapsulamento']),
        tec('Cromada', ['efeito espelhado', 'espelhada', 'cromado', 'chrome', 'glitter']), tec('Baby boomer', ['babyboomer']), tec('Jelly', ['efeito jelly', 'gelatina']),
        tec('Ombré', ['degradê', 'ombre']), tec('Nail piercing', ['piercing na unha']), tec('Desenho à mão livre', ['mão livre', 'desenho livre']), tec('Adesivos', ['películas', 'película'])]),
      sv('Decoração por unha', 10, ['uma unha decorada', 'desenho em uma unha', 'por unha'], ['nail art']),
      sv('Unha de festa', 45, ['unha para casamento', 'unha de noiva', 'unha de formatura'], ['nail art', 'noivas']),
    ]),
    ('Spa e cuidados', ['cuidados com as unhas', 'parafina', 'esfoliação'], [
      sv('Banho de parafina', 30, ['parafina', 'parafina nas mãos', 'parafina nos pés'], ['spa']),
      sv('Esfoliação de mãos e pés', 20, ['esfoliação', 'esfoliar'], ['spa']),
      sv('Tratamento para unhas fracas', 30, ['unhas fracas', 'fortalecedor', 'tratamento de unha'], ['tratamento']),
    ]),
  ]),
  # =====================================================================
  ('Cílios', 'Extensão, volume, lifting e manutenção', ['cílio', 'cilios', 'lash', 'lash designer', 'cílios'], [
    ('Extensão de cílios', ['extensão', 'alongamento de cílios', 'cílios postiços permanentes', 'lash extension'], [
      sv('Extensão de cílios', 120, ['alongamento de cílios', 'aplicação de cílios', 'cílios fio a fio', 'extensão'], ['extensao'], [
        tec('Fio a fio', ['clássico', 'classic', 'fio por fio', '1 por 1']), tec('Volume brasileiro', ['brasileiro', 'efeito brasileiro']), tec('Volume russo', ['russo', '3d', '4d', '5d', 'volume 3d']),
        tec('Volume egípcio', ['egípcio', 'egipcio']), tec('Híbrido', ['hibrido', 'mix']), tec('Mega volume', ['megavolume', '6d', '8d']),
        tec('Fox eyes', ['fox', 'foxy', 'efeito fox', 'olho de raposa']), tec('Efeito molhado', ['wet', 'wet look', 'molhadinho']), tec('Efeito boneca', ['doll', 'boneca']),
        tec('Efeito gatinho', ['cat eye', 'gatinho']), tec('Efeito esquilo', ['squirrel', 'esquilo']), tec('Marrom', ['brown', 'cílios marrons', 'castanho']),
        tec('Colorido', ['cílios coloridos']), tec('Express', ['cílios express', 'rápido']), tec('Anime', ['efeito anime', 'spike', 'wispy']), tec('Personalizado', ['personalizado', 'mapping personalizado'])]),
      sv('Extensão de cílios inferiores', 30, ['cílios inferiores', 'cílios de baixo'], ['extensao']),
    ]),
    ('Manutenção', ['manutenção de cílios', 'reposição', 'retoque'], [
      sv('Manutenção de cílios', 60, ['manutenção', 'manutenção de extensão', 'reposição de cílios', 'retoque de cílios'], ['extensao', 'manutencao'], [
        tec('15 dias', ['manutenção 15 dias']), tec('21 dias', ['manutenção 21 dias']), tec('30 dias', ['manutenção 30 dias'])]),
    ]),
    ('Remoção', ['retirada', 'tirar cílios'], [
      sv('Remoção de extensão', 30, ['remoção de cílios', 'retirada de cílios', 'tirar extensão', 'remover cílios'], ['extensao', 'remocao']),
    ]),
    ('Lash lifting', ['lifting', 'lifting de cílios', 'curvatura'], [
      sv('Lash lifting', 60, ['lifting de cílios', 'lash', 'lash lift', 'curvatura de cílios', 'lifting', 'permanente de cílios'], ['lifting'], [
        tec('Com tintura', ['com coloração']), tec('Com botox', ['com botox de cílios', 'com nutrição']), tec('Natural')]),
      sv('Botox de cílios', 40, ['lash botox', 'nutrição de cílios', 'tratamento de cílios'], ['lifting', 'tratamento']),
      sv('Lash lifting e brow lamination', 110, ['lifting + lamination', 'combo lifting e lamination'], ['lifting', 'combo', 'sobrancelha']),
    ]),
    ('Coloração e postiços', ['tintura de cílios', 'cílios postiços'], [
      sv('Tintura de cílios', 30, ['coloração de cílios', 'tingimento de cílios', 'pintar os cílios'], ['cor']),
      sv('Aplicação de cílios postiços', 20, ['cílios postiços', 'postiços', 'tufinho', 'cílios de tufo', 'cílios para festa'], ['postico', 'maquiagem']),
    ]),
  ]),
  # =====================================================================
  ('Sobrancelhas', 'Design, henna, lamination e micropigmentação', ['sobrancelha', 'brow', 'designer de sobrancelhas', 'sobrancelhas'], [
    ('Design', ['design de sobrancelha', 'fazer a sobrancelha', 'limpeza de sobrancelha'], [
      sv('Design de sobrancelhas', 30, ['sobrancelha', 'design', 'fazer sobrancelha', 'limpeza de sobrancelha', 'design com pinça'], ['design'], [
        tec('Com pinça', ['pinça']), tec('Com linha', ['linha', 'egípcia', 'epilação egípcia', 'threading']), tec('Com cera', ['cera']), tec('Com navalha', ['navalha']),
        tec('Com paquímetro', ['paquímetro', 'visagismo', 'simetria']), tec('Com henna', ['design e henna'])]),
      sv('Manutenção de design', 15, ['manutenção de sobrancelha', 'retoque de sobrancelha', 'limpeza'], ['design', 'manutencao']),
      sv('Design de sobrancelhas masculino', 20, ['sobrancelha masculina'], ['design', 'masculino']),
    ]),
    ('Henna e coloração', ['henna', 'tintura de sobrancelha', 'colorir sobrancelha'], [
      sv('Design com henna', 40, ['henna', 'sobrancelha de henna', 'henna na sobrancelha', 'aplicação de henna'], ['henna', 'design']),
      sv('Tintura de sobrancelha', 30, ['coloração de sobrancelha', 'tingimento de sobrancelha', 'pintar a sobrancelha', 'tintura'], ['cor']),
      sv('Retoque de henna', 20, ['só a henna', 'reaplicação de henna'], ['henna', 'manutencao']),
    ]),
    ('Brow lamination', ['laminação', 'laminação de sobrancelhas', 'lamination'], [
      sv('Brow lamination', 60, ['laminação de sobrancelhas', 'laminação', 'lamination', 'sobrancelha laminada', 'alinhamento de sobrancelha'], ['lamination'], [
        tec('Com tintura', ['com coloração']), tec('Com henna'), tec('Com nutrição', ['com botox de sobrancelha']), tec('Natural')]),
      sv('Botox de sobrancelha', 30, ['nutrição de sobrancelha', 'tratamento de sobrancelha', 'brow botox'], ['lamination', 'tratamento']),
    ]),
    ('Micropigmentação', ['micro', 'microblading', 'micropigmentar', 'tatuagem de sobrancelha'], [
      sv('Micropigmentação de sobrancelhas', 150, ['micro', 'micropigmentação', 'sobrancelha definitiva', 'tatuagem de sobrancelha'], ['micropigmentacao'], [
        tec('Fio a fio', ['microblading', 'fio a fio', 'nanoblading', 'nano', 'fios realistas']), tec('Shadow', ['esfumada', 'sombreada', 'powder brows', 'ombré brows', 'shadow']),
        tec('Híbrida', ['hibrida', 'fio e shadow', 'combinada']), tec('Dermopigmentação', ['dermo'])]),
      sv('Retoque de micropigmentação', 90, ['retoque de micro', 'retoque'], ['micropigmentacao', 'manutencao']),
      sv('Remoção de micropigmentação', 60, ['remoção de micro', 'despigmentação', 'remoção de pigmento'], ['micropigmentacao', 'remocao']),
      sv('Micropigmentação labial', 120, ['micro labial', 'lábios', 'lip blush', 'revitalização labial'], ['micropigmentacao', 'labios']),
      sv('Micropigmentação de olhos', 90, ['delineado definitivo', 'micro de olhos', 'eyeliner definitivo'], ['micropigmentacao', 'olhos']),
    ]),
    ('Cuidados', ['tratamento de sobrancelha', 'reconstrução'], [
      sv('Reconstrução de sobrancelhas', 45, ['reconstrução', 'sobrancelha com falhas', 'preenchimento de falhas'], ['tratamento']),
      sv('Hidratação de sobrancelhas', 15, ['nutrição', 'hidratação'], ['tratamento']),
    ]),
  ]),
  # =====================================================================
  ('Maquiagem', 'Social, noiva, festa e cursos', ['make', 'maquiadora', 'maquiador', 'makeup'], [
    ('Maquiagem', ['make', 'maquiagem social', 'maquiagem de festa'], [
      sv('Maquiagem social', 60, ['make social', 'make', 'maquiagem de festa', 'maquiagem para evento'], ['maquiagem'], [
        tec('Natural', ['clean', 'make natural', 'leve']), tec('Glam', ['glamour', 'make glam']), tec('Esfumado', ['olho esfumado', 'smokey']),
        tec('Cut crease'), tec('Pele iluminada', ['glow', 'pele glow']), tec('Com cílios postiços', ['com cílios'])]),
      sv('Maquiagem para noiva', 120, ['make de noiva', 'noiva', 'maquiagem de casamento'], ['maquiagem', 'noivas']),
      sv('Maquiagem para madrinhas', 60, ['madrinha', 'make madrinha'], ['maquiagem', 'noivas']),
      sv('Maquiagem para formatura', 60, ['formanda', 'make de formatura'], ['maquiagem']),
      sv('Maquiagem para ensaio fotográfico', 60, ['ensaio', 'make para foto', 'book'], ['maquiagem']),
      sv('Maquiagem para debutante', 90, ['15 anos', 'debutante', 'make 15 anos'], ['maquiagem']),
      sv('Maquiagem artística', 90, ['carnaval', 'fantasia', 'caracterização', 'halloween', 'make artística'], ['maquiagem']),
      sv('Maquiagem infantil', 30, ['make infantil', 'maquiagem criança'], ['maquiagem', 'infantil']),
      sv('Maquiagem masculina', 30, ['make masculina', 'maquiagem para homem', 'pele masculina'], ['maquiagem', 'masculino']),
      sv('Teste de maquiagem', 60, ['prova de make', 'teste de make'], ['maquiagem', 'noivas']),
      sv('Maquiagem express', 30, ['make rápida', 'retoque de make', 'express'], ['maquiagem']),
    ]),
    ('Pele e preparação', ['preparação de pele', 'skin prep'], [
      sv('Preparação de pele', 30, ['skin prep', 'preparar a pele', 'pele para maquiagem'], ['maquiagem', 'pele']),
      sv('Limpeza de pele pré-make', 45, ['limpeza antes da make'], ['maquiagem', 'pele']),
    ]),
    ('Cursos', ['curso de maquiagem', 'aula', 'automaquiagem'], [
      sv('Curso de automaquiagem', 180, ['auto maquiagem', 'aula de maquiagem', 'automaquiagem', 'aprender a se maquiar'], ['maquiagem', 'curso']),
      sv('Aula particular de maquiagem', 120, ['aula individual', 'mentoria de make'], ['maquiagem', 'curso']),
    ]),
  ]),
  # =====================================================================
  ('Depilação', 'Cera, linha, laser e luz pulsada', ['depilar', 'depiladora', 'epilação', 'tirar pelo'], [
    ('Cera', ['depilação com cera', 'cera quente', 'cera roll-on', 'cera fria'], [
      sv('Depilação com cera', 40, ['cera', 'depilação', 'depilar'], ['cera'], [
        tec('Cera quente', ['quente']), tec('Cera roll-on', ['roll on', 'rolon', 'roll-on']), tec('Cera fria', ['fria']), tec('Cera espanhola', ['espanhola', 'cera elástica', 'elástica'])]),
      sv('Virilha completa', 30, ['virilha cavada', 'virilha total', 'íntima completa'], ['cera', 'virilha']),
      sv('Virilha simples', 20, ['virilha comum', 'virilha básica', 'contorno de virilha'], ['cera', 'virilha']),
      sv('Perna completa', 40, ['pernas completas', 'perna inteira', 'pernas'], ['cera', 'perna']),
      sv('Meia perna', 25, ['meia perna', 'perna até o joelho'], ['cera', 'perna']),
      sv('Axila', 15, ['axilas', 'sovaco'], ['cera']),
      sv('Buço', 10, ['buço', 'bigode', 'labio superior'], ['cera', 'rosto']),
      sv('Rosto completo', 25, ['face', 'rosto', 'depilação facial'], ['cera', 'rosto']),
      sv('Braço', 20, ['braços', 'braço completo'], ['cera']),
      sv('Costas', 30, ['costa', 'depilação de costas'], ['cera']),
      sv('Peito e abdômen', 30, ['peito', 'abdômen', 'barriga', 'tórax'], ['cera']),
      sv('Glúteos', 20, ['bumbum', 'nádegas', 'glúteo'], ['cera']),
      sv('Corpo inteiro', 120, ['depilação completa', 'corpo todo', 'completa'], ['cera', 'combo']),
      sv('Depilação masculina', 45, ['depilação masculina', 'cera masculina', 'homem'], ['cera', 'masculino'], [
        tec('Costas'), tec('Peito'), tec('Virilha masculina', ['íntima masculina']), tec('Perna'), tec('Corpo inteiro')]),
    ]),
    ('Linha', ['depilação com linha', 'egípcia', 'threading'], [
      sv('Depilação com linha', 20, ['linha', 'egípcia', 'epilação egípcia', 'threading'], ['linha']),
      sv('Buço com linha', 10, ['buço na linha'], ['linha', 'rosto']),
      sv('Rosto com linha', 25, ['rosto na linha', 'face na linha'], ['linha', 'rosto']),
    ]),
    ('Laser e luz pulsada', ['laser', 'depilação a laser', 'luz pulsada', 'ipl', 'fotodepilação', 'definitiva'], [
      sv('Depilação a laser', 30, ['laser', 'depilação definitiva', 'sessão de laser', 'a laser'], ['laser'], [
        tec('Diodo', ['laser de diodo']), tec('Alexandrite', ['alexandrita']), tec('Nd:YAG', ['nd yag', 'yag'])]),
      sv('Laser axila', 15, ['laser nas axilas'], ['laser']),
      sv('Laser virilha', 20, ['laser na virilha', 'laser íntimo'], ['laser', 'virilha']),
      sv('Laser perna completa', 40, ['laser nas pernas'], ['laser', 'perna']),
      sv('Laser rosto', 20, ['laser no buço', 'laser facial'], ['laser', 'rosto']),
      sv('Laser corpo inteiro', 90, ['laser completo', 'pacote laser'], ['laser', 'combo']),
      sv('Luz pulsada', 30, ['ipl', 'fotodepilação', 'luz intensa pulsada'], ['laser']),
    ]),
    ('Cuidados', ['pré-depilação', 'pós-depilação', 'foliculite'], [
      sv('Esfoliação pré-depilação', 15, ['esfoliação', 'esfoliar antes da cera'], ['cuidados']),
      sv('Tratamento de foliculite', 30, ['foliculite', 'pelo encravado', 'pelos encravados'], ['cuidados']),
      sv('Clareamento de virilha', 45, ['clareamento íntimo', 'clareamento de axilas', 'clareamento'], ['cuidados']),
    ]),
  ]),
  # =====================================================================
  ('Estética facial', 'Limpeza de pele, peeling, protocolos e tecnologias', ['rosto', 'facial', 'esteticista', 'skincare', 'pele'], [
    ('Limpeza de pele', ['limpeza facial', 'skin care', 'limpar a pele'], [
      sv('Limpeza de pele', 60, ['limpeza facial', 'limpeza de pele profunda', 'skincare', 'limpeza'], ['pele'], [
        tec('Profunda', ['com extração', 'extração de cravos']), tec('Com alta frequência', ['alta frequência']), tec('Com máscara', ['máscara calmante']),
        tec('Com LED', ['ledterapia']), tec('Express', ['limpeza rápida', 'limpeza simples'])]),
      sv('Hidradermoabrasão', 60, ['hydrafacial', 'hydra facial', 'hidra facial', 'hidro facial'], ['pele', 'tecnologia']),
      sv('Limpeza de pele com peeling', 90, ['limpeza + peeling', 'limpeza e peeling'], ['pele', 'combo']),
      sv('Limpeza de pele para adolescentes', 60, ['limpeza teen', 'acne juvenil'], ['pele', 'acne']),
    ]),
    ('Peeling', ['peelings', 'renovação celular', 'esfoliação química'], [
      sv('Peeling químico', 45, ['peeling', 'peeling de ácido', 'ácido'], ['peeling'], [
        tec('Ácido glicólico', ['glicólico']), tec('Ácido mandélico', ['mandélico']), tec('Ácido salicílico', ['salicílico']), tec('Ácido retinoico', ['retinoico', 'retinol']),
        tec('TCA', ['tricloroacético']), tec('Peeling de verão', ['verão', 'lático'])]),
      sv('Peeling de diamante', 45, ['peeling mecânico', 'microdermoabrasão', 'diamante'], ['peeling']),
      sv('Peeling de cristal', 45, ['cristal', 'peeling de cristal'], ['peeling']),
      sv('Peeling ultrassônico', 45, ['ultrassônico', 'espátula ultrassônica'], ['peeling']),
      sv('Dermaplaning', 45, ['dermaplaning', 'lâmina', 'esfoliação com lâmina', 'remoção de penugem'], ['peeling']),
    ]),
    ('Tratamentos', ['protocolo facial', 'tratamento de pele'], [
      sv('Hidratação facial', 45, ['hidratação da pele', 'hidratação profunda', 'hidratar o rosto'], ['tratamento']),
      sv('Revitalização facial', 60, ['revitalização', 'pele cansada', 'glow'], ['tratamento']),
      sv('Tratamento para acne', 60, ['acne', 'espinhas', 'cravos', 'pele oleosa'], ['tratamento', 'acne']),
      sv('Tratamento para manchas', 60, ['melasma', 'clareamento de manchas', 'manchas', 'clareador'], ['tratamento', 'manchas']),
      sv('Tratamento antienvelhecimento', 60, ['anti-idade', 'rugas', 'rejuvenescimento', 'linhas de expressão', 'antiaging'], ['tratamento', 'anti-idade']),
      sv('Tratamento para olheiras', 45, ['olheiras', 'bolsas nos olhos', 'área dos olhos'], ['tratamento', 'olhos']),
      sv('Máscara facial', 30, ['máscara', 'máscara de ouro', 'máscara de argila', 'máscara hidratante'], ['tratamento']),
      sv('Drenagem facial', 30, ['drenagem do rosto', 'drenagem linfática facial', 'inchaço no rosto'], ['tratamento']),
      sv('Massagem facial', 30, ['lifting manual', 'yoga facial', 'massagem no rosto', 'gua sha', 'kobido'], ['tratamento']),
      sv('Hidratação labial', 20, ['hidragloss', 'hidra gloss', 'lábios', 'hidratação dos lábios', 'lip glow'], ['tratamento', 'labios']),
    ]),
    ('Tecnologias', ['aparelhos', 'eletroterapia', 'estética avançada'], [
      sv('Microagulhamento', 60, ['dermaroller', 'dermapen', 'micro agulhamento', 'indução de colágeno'], ['tecnologia']),
      sv('Radiofrequência facial', 45, ['radiofrequência', 'rf facial', 'flacidez facial'], ['tecnologia']),
      sv('Ultrassom microfocado', 60, ['hifu', 'lifting sem cirurgia', 'ultraformer'], ['tecnologia']),
      sv('Ledterapia', 30, ['led', 'fototerapia', 'luz de led', 'máscara de led'], ['tecnologia']),
      sv('Alta frequência', 20, ['alta frequencia', 'ozônio'], ['tecnologia']),
      sv('Jato de plasma', 60, ['plasma', 'jett plasma', 'blefaroplastia sem corte'], ['tecnologia']),
      sv('Criofrequência facial', 45, ['criofrequência', 'crio facial'], ['tecnologia']),
      sv('Carboxiterapia facial', 30, ['carboxi', 'carboxiterapia', 'co2'], ['tecnologia']),
      sv('Eletroterapia facial', 30, ['corrente', 'microcorrentes', 'lifting elétrico'], ['tecnologia']),
    ]),
    ('Procedimentos injetáveis', ['injetáveis', 'harmonização', 'biomédica', 'habilitação'], [
      sv('Toxina botulínica', 30, ['botox', 'toxina', 'aplicação de botox', 'rugas de expressão'], ['injetavel', 'habilitacao']),
      sv('Preenchimento com ácido hialurônico', 60, ['preenchimento', 'preenchimento labial', 'ácido hialurônico', 'lábios', 'olheiras'], ['injetavel', 'habilitacao']),
      sv('Bioestimulador de colágeno', 60, ['bioestimulador', 'sculptra', 'radiesse', 'colágeno'], ['injetavel', 'habilitacao']),
      sv('Skinbooster', 45, ['skin booster', 'hidratação injetável'], ['injetavel', 'habilitacao']),
      sv('Fios de PDO', 60, ['fios de sustentação', 'fios', 'lifting com fios'], ['injetavel', 'habilitacao']),
      sv('Enzimas para papada', 30, ['lipo de papada', 'enzimas', 'papada'], ['injetavel', 'habilitacao']),
      sv('Harmonização facial', 90, ['harmonização', 'full face', 'harmonização orofacial'], ['injetavel', 'habilitacao', 'combo']),
    ]),
  ]),
  # =====================================================================
  ('Estética corporal', 'Drenagem, modeladora, gordura localizada e bronze', ['corpo', 'corporal', 'estética do corpo', 'emagrecimento'], [
    ('Massagens estéticas', ['massagem estética', 'drenagem', 'modeladora'], [
      sv('Drenagem linfática', 60, ['drenagem', 'drenagem corporal', 'inchaço', 'retenção de líquido'], ['massagem'], [
        tec('Manual', ['drenagem manual', 'método vodder', 'leduc']), tec('Com pressoterapia', ['pressoterapia', 'botas', 'drenagem mecânica']), tec('Gestante', ['drenagem para gestante'])]),
      sv('Massagem modeladora', 60, ['modeladora', 'massagem redutora', 'redutora', 'modelar'], ['massagem']),
      sv('Massagem turbinada', 60, ['turbinada', 'drenagem + modeladora'], ['massagem', 'combo']),
      sv('Drenagem pós-operatório', 60, ['pós operatório', 'pós cirúrgico', 'drenagem pós-cirúrgica', 'lipo'], ['massagem', 'pos-operatorio']),
      sv('Massagem relaxante corporal', 60, ['relaxante', 'massagem'], ['massagem']),
    ]),
    ('Gordura localizada', ['gordura', 'medidas', 'emagrecimento', 'barriga'], [
      sv('Criolipólise', 60, ['crio', 'criolipolise', 'congelamento de gordura'], ['tecnologia', 'gordura']),
      sv('Lipocavitação', 45, ['cavitação', 'ultracavitação', 'ultrassom de cavitação'], ['tecnologia', 'gordura']),
      sv('Radiofrequência corporal', 45, ['radiofrequência', 'rf corporal', 'flacidez corporal'], ['tecnologia', 'flacidez']),
      sv('Carboxiterapia corporal', 30, ['carboxi', 'carboxiterapia', 'estrias com carboxi'], ['tecnologia']),
      sv('Ultrassom corporal', 30, ['ultrassom', 'ultrassom estético'], ['tecnologia', 'gordura']),
      sv('Vacuoterapia', 45, ['vácuo', 'endermologia', 'endermoterapia', 'vacuo', 'lipomassagem'], ['tecnologia', 'celulite']),
      sv('Corrente russa', 30, ['eletroestimulação', 'eletro', 'tonificação muscular'], ['tecnologia', 'flacidez']),
      sv('Enzimas corporais', 30, ['intradermoterapia', 'lipo enzimática', 'lipo de enzimas', 'enzimas', 'lipo sem corte'], ['injetavel', 'habilitacao', 'gordura']),
      sv('Manta térmica', 30, ['manta', 'manta de emagrecimento'], ['tecnologia', 'gordura']),
      sv('Detox corporal', 60, ['bandagem', 'body wrap', 'bandagem redutora', 'detox'], ['gordura']),
      sv('Heccus / terapia combinada', 45, ['heccus', 'terapia combinada', 'ultrassom + corrente'], ['tecnologia', 'gordura']),
    ]),
    ('Celulite, flacidez e estrias', ['celulite', 'flacidez', 'estrias', 'protocolo corporal'], [
      sv('Tratamento para celulite', 60, ['celulite', 'anticelulite', 'furinhos'], ['protocolo', 'celulite']),
      sv('Tratamento para flacidez', 60, ['flacidez', 'firmeza', 'tonificar'], ['protocolo', 'flacidez']),
      sv('Tratamento para estrias', 60, ['estrias', 'estria', 'clareamento de estrias'], ['protocolo']),
      sv('Microagulhamento corporal', 60, ['microagulhamento', 'estrias com microagulhamento'], ['tecnologia']),
      sv('Tratamento para glúteos', 60, ['bumbum up', 'glúteo', 'bumbum', 'levantamento de glúteos', 'empina bumbum'], ['protocolo', 'gluteos']),
      sv('Protocolo corporal completo', 90, ['pacote corporal', 'protocolo', 'sessão completa'], ['protocolo', 'combo']),
    ]),
    ('Bronzeamento', ['bronze', 'bronzeado', 'bronzear'], [
      sv('Bronzeamento artificial', 40, ['bronze artificial', 'bronzeamento a jato', 'spray tan', 'bronze de spray', 'jato'], ['bronze'], [
        tec('Jato', ['spray', 'airbrush']), tec('Cabine', ['cabine de bronzeamento', 'câmara']), tec('Com marquinha', ['marquinha artificial'])]),
      sv('Bronze natural com marquinha', 90, ['marquinha', 'fita', 'bronze de fita', 'bronzeamento natural', 'bronze na laje', 'marquinha de biquíni'], ['bronze']),
      sv('Esfoliação pré-bronze', 20, ['esfoliação', 'preparação para bronze'], ['bronze']),
    ]),
    ('Cuidados com a pele do corpo', ['peeling corporal', 'hidratação corporal', 'esfoliação'], [
      sv('Peeling corporal', 45, ['peeling de corpo', 'peeling nas costas', 'peeling de axila', 'clareamento'], ['pele']),
      sv('Hidratação corporal', 45, ['hidratação do corpo', 'hidratar'], ['pele']),
      sv('Esfoliação corporal', 30, ['esfoliação', 'esfoliar o corpo'], ['pele']),
      sv('Tratamento para foliculite corporal', 30, ['foliculite', 'pelos encravados'], ['pele']),
    ]),
  ]),
  # =====================================================================
  ('Bem-estar e spa', 'Massagens, terapias e relaxamento', ['massagem', 'spa', 'massoterapia', 'terapias', 'relaxar'], [
    ('Massagens', ['massagem relaxante', 'massoterapia', 'massagista'], [
      sv('Massagem relaxante', 60, ['massagem', 'relaxante', 'relaxar', 'massagem de relaxamento'], ['massagem'], [
        tec('Com pedras quentes', ['pedras quentes', 'hot stone']), tec('Com velas', ['candle massage', 'massagem com velas']), tec('Com aromaterapia', ['aromaterapia', 'óleos essenciais']),
        tec('Sueca', ['massagem sueca']), tec('Com bambu', ['bambuterapia', 'bambu']), tec('Com pindas', ['pindas', 'trouxinhas'])]),
      sv('Massagem terapêutica', 60, ['massoterapia', 'massagem para dor', 'dor nas costas', 'tensão'], ['massagem']),
      sv('Massagem desportiva', 60, ['esportiva', 'massagem para atleta', 'pós-treino'], ['massagem']),
      sv('Quick massage', 20, ['massagem rápida', 'massagem na cadeira', 'massagem expressa'], ['massagem']),
      sv('Massagem para gestante', 60, ['gestante', 'grávida', 'massagem na gravidez'], ['massagem']),
      sv('Massagem tailandesa', 90, ['tailandesa', 'thai', 'thai massage'], ['massagem']),
      sv('Shiatsu', 60, ['shiatsu', 'massagem japonesa'], ['massagem']),
      sv('Massagem ayurvédica', 90, ['ayurveda', 'ayurvédica', 'abhyanga'], ['massagem']),
      sv('Massagem nos pés', 30, ['massagem podal', 'pés cansados'], ['massagem']),
      sv('Massagem para casal', 60, ['casal', 'massagem a dois'], ['massagem', 'combo']),
    ]),
    ('Terapias', ['terapia', 'terapias integrativas', 'holístico'], [
      sv('Reflexologia', 45, ['reflexologia podal', 'reflexo', 'pontos nos pés'], ['terapia']),
      sv('Ventosaterapia', 45, ['ventosa', 'ventosas', 'cupping'], ['terapia']),
      sv('Auriculoterapia', 30, ['auricular', 'sementes na orelha', 'acupuntura auricular'], ['terapia']),
      sv('Acupuntura', 60, ['agulhas', 'acupuntura chinesa'], ['terapia', 'habilitacao']),
      sv('Reiki', 60, ['reiki', 'energização'], ['terapia']),
      sv('Liberação miofascial', 60, ['miofascial', 'liberação', 'fáscia'], ['terapia']),
      sv('Drenagem relaxante', 60, ['drenagem', 'drenagem linfática relaxante'], ['terapia']),
      sv('Terapia com pedras quentes', 60, ['pedras quentes', 'hot stone therapy'], ['terapia']),
    ]),
    ('Spa', ['day spa', 'ritual', 'pacote spa'], [
      sv('Day spa', 180, ['dia de spa', 'dia no spa', 'pacote spa', 'spa day'], ['spa', 'combo']),
      sv('Ritual de spa', 120, ['ritual', 'ritual relaxante', 'experiência spa'], ['spa', 'combo']),
      sv('Banho de ofurô', 45, ['ofurô', 'ofuro', 'banheira'], ['spa']),
      sv('Sauna', 30, ['sauna seca', 'sauna a vapor'], ['spa']),
      sv('Escalda-pés', 30, ['escalda pés', 'escaldapés', 'banho de pés'], ['spa']),
      sv('Esfoliação e hidratação corporal', 60, ['esfoliação com hidratação', 'ritual corporal'], ['spa']),
      sv('Spa das noivas', 240, ['noiva spa', 'pacote noiva relaxante'], ['spa', 'noivas', 'combo']),
    ]),
  ]),
]

def montar():
  saida = { 'versao': 1, 'gerado_por': 'supabase/catalogo/gerar_catalogo.py', 'categorias': [] }
  tot = { 'categorias': 0, 'familias': 0, 'servicos': 0, 'tecnicas': 0 }
  for ci, (cnome, cdesc, caliases, familias) in enumerate(CATALOGO):
    cat = { 'slug': slug(cnome), 'nome': cnome, 'descricao': cdesc, 'aliases': caliases, 'imagem': f'/imagens/catalogo/{slug(cnome)}.webp', 'ordem': (ci + 1) * 10, 'ativa': True, 'familias': [] }
    tot['categorias'] += 1
    for fi, (fnome, faliases, servicos) in enumerate(familias):
      fam = { 'slug': slug(fnome), 'nome': fnome, 'aliases': faliases, 'ordem': (fi + 1) * 10, 'ativa': True, 'servicos': [] }
      tot['familias'] += 1
      for si, (snome, dur, saliases, stags, tecnicas) in enumerate(servicos):
        s = { 'slug': slug(snome), 'nome': snome, 'duracao_sugerida': dur, 'aliases': saliases, 'tags': stags, 'ordem': (si + 1) * 10, 'ativa': True, 'tecnicas': [] }
        tot['servicos'] += 1
        for ti, (tnome, taliases, tdur) in enumerate(tecnicas):
          s['tecnicas'].append({ 'slug': slug(tnome), 'nome': tnome, 'aliases': taliases, 'duracao_sugerida': tdur, 'ordem': (ti + 1) * 10, 'ativa': True })
          tot['tecnicas'] += 1
        fam['servicos'].append(s)
      cat['familias'].append(fam)
    saida['categorias'].append(cat)
  saida['totais'] = tot
  return saida

if __name__ == '__main__':
  dados = montar()
  aqui = os.path.dirname(os.path.abspath(__file__))
  with open(os.path.join(aqui, 'catalogo_v1.json'), 'w', encoding='utf-8') as f:
    json.dump(dados, f, ensure_ascii=False, indent=2)
  print(dados['totais'])
  # slugs repetidos dentro da mesma família denunciam duplicata
  vistos = set()
  for c in dados['categorias']:
    for fam in c['familias']:
      for s in fam['servicos']:
        k = (c['slug'], fam['slug'], s['slug'])
        assert k not in vistos, k
        vistos.add(k)
