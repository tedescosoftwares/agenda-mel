// O contrato de parceria (101), nos termos da Lei 12.592/2012 com a
// redação da Lei 13.352/2016. Monta os blocos do documento a partir dos
// dados da parceria; o PDF e a tela renderizam os mesmos blocos, e é
// isso que fica congelado em `conteudo` quando o contrato é enviado.
//
// É um modelo. O texto passa pelo contador ou advogado do salão antes
// de valer, e convenções coletivas podem pedir cláusulas a mais.
export const VERSAO_MODELO = '2026-09-19'

export const PERIODICIDADES = { semanal: 'semanal', quinzenal: 'quinzenal', mensal: 'mensal' }
export const MATERIAIS = {
  salao: 'o salão fornece os produtos e materiais de consumo',
  profissional: 'a profissional fornece os próprios produtos e materiais de consumo',
  misto: 'os produtos e materiais são fornecidos pelas duas partes, conforme detalhado',
}
export const HOMOLOGACOES = { pendente: 'Pendente', homologado: 'Homologado', nao_obtida: 'Não obtida', dispensada: 'Dispensada' }
export const STATUS = { rascunho: 'Rascunho', enviado: 'Enviado', assinado: 'Assinado', vigente: 'Vigente', encerrado: 'Encerrado', sem_contrato: 'Sem contrato' }

export const soDigitos = (t) => String(t ?? '').replace(/\D/g, '')
export function formatarCpf(t) { const d = soDigitos(t).slice(0, 11); return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2') }
export function formatarCnpj(t) { const d = soDigitos(t).slice(0, 14); return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2') }
export const cpfValido = (t) => {
  const d = soDigitos(t); if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return (r === 10 ? 0 : r) === Number(d[n]) }
  return dv(9) && dv(10)
}
export const cnpjValido = (t) => {
  const d = soDigitos(t); if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  const dv = (n) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]; const r = s % 11; return (r < 2 ? 0 : 11 - r) === Number(d[n]) }
  return dv(12) && dv(13)
}

const dataLonga = (iso) => {
  if (!iso) return '____/____/______'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
  return `${Number(d)} de ${meses[Number(m) - 1]} de ${a}`
}
const pct = (n) => `${String(Number(n ?? 0)).replace('.', ',')}%`
const ou = (v, vazio = '____________________') => (v && String(v).trim() ? String(v).trim() : vazio)

// O que falta para o contrato ficar completo (a tela mostra antes de gerar)
export function pendenciasDoContrato(pc) {
  const f = []
  const s = pc.salao ?? {}, p = pc.prof ?? {}
  if (!s.nome) f.push('nome do salão')
  if (!s.cnpj) f.push('CNPJ do salão'); else if (!cnpjValido(s.cnpj)) f.push('CNPJ do salão inválido')
  if (!s.responsavel_nome) f.push('nome de quem assina pelo salão')
  if (!s.responsavel_cpf) f.push('CPF de quem assina pelo salão'); else if (!cpfValido(s.responsavel_cpf)) f.push('CPF de quem assina pelo salão inválido')
  if (!s.endereco || !s.cidade) f.push('endereço e cidade do salão')
  if (!p.nome) f.push('nome da profissional')
  if (!p.cpf) f.push('CPF da profissional'); else if (!cpfValido(p.cpf)) f.push('CPF da profissional inválido')
  if (p.cnpj && !cnpjValido(p.cnpj)) f.push('CNPJ do MEI inválido')
  if (!p.endereco || !p.cidade) f.push('endereço e cidade da profissional')
  if (!pc.inicio) f.push('data de início')
  if (!(Number(pc.cota_pct) > 0 && Number(pc.cota_pct) < 100)) f.push('percentual da profissional entre 1 e 99')
  if (!pc.funcoes) f.push('serviços que a profissional presta')
  if (Number(pc.aviso_previo_dias) < 30) f.push('aviso prévio de no mínimo 30 dias')
  return f
}

export function montarContrato(pc) {
  const s = pc.salao ?? {}, p = pc.prof ?? {}
  const cotaProf = Number(pc.cota_pct ?? 0), cotaSalao = Math.round((100 - cotaProf) * 100) / 100
  const base = pc.base_calculo === 'liquido' ? 'sobre o valor líquido de cada serviço, assim entendido o valor cobrado da cliente descontadas apenas as taxas do meio de pagamento utilizado' : 'sobre o valor bruto de cada serviço, assim entendido o valor efetivamente cobrado da cliente'
  const excecoes = Array.isArray(pc.excecoes) ? pc.excecoes.filter((e) => e?.nome && e?.cota_pct != null) : []
  const testemunhas = Array.isArray(pc.testemunhas) ? pc.testemunhas : []
  const cidadeForo = ou(s.cidade, '____________________')
  const rep = pc.periodicidade === 'mensal' ? 'mensal' : pc.periodicidade === 'quinzenal' ? 'quinzenal' : 'semanal'
  const B = []
  const h = (x) => B.push({ t: 'h', x })
  const par = (x) => B.push({ t: 'p', x })
  const lista = (itens) => B.push({ t: 'lista', itens })

  B.push({ t: 'titulo', x: 'CONTRATO DE PARCERIA' })
  B.push({ t: 'sub', x: 'Salão-parceiro e profissional-parceira · Lei nº 12.592/2012, com a redação da Lei nº 13.352/2016' })

  h('Partes')
  par(`SALÃO-PARCEIRO: ${ou(s.razao_social || s.nome)}${s.nome && s.razao_social && s.razao_social !== s.nome ? ` ("${s.nome}")` : ''}, pessoa jurídica inscrita no CNPJ sob o nº ${ou(formatarCnpj(s.cnpj))}, com sede em ${ou(s.endereco)}, ${ou(s.cidade)}, neste ato representado por ${ou(s.responsavel_nome)}, CPF nº ${ou(formatarCpf(s.responsavel_cpf))}.`)
  par(`PROFISSIONAL-PARCEIRA: ${ou(p.nome)}, CPF nº ${ou(formatarCpf(p.cpf))}${p.rg ? `, RG nº ${p.rg}` : ''}${p.cnpj ? `, inscrita como microempreendedora individual sob o CNPJ nº ${formatarCnpj(p.cnpj)}` : ', que se compromete a manter inscrição como microempreendedora individual, microempresária ou pequena empresária perante as autoridades fazendárias'}, residente em ${ou(p.endereco)}, ${ou(p.cidade)}${p.email ? `, e-mail ${p.email}` : ''}${p.telefone ? `, telefone ${p.telefone}` : ''}.`)
  par('As partes celebram este contrato de parceria, que se rege pelas cláusulas a seguir e pela Lei nº 12.592/2012, com as alterações da Lei nº 13.352/2016.')

  h('Cláusula 1ª · Objeto')
  par(`1.1. O objeto deste contrato é a parceria para a prestação, pela PROFISSIONAL-PARCEIRA, dos serviços de beleza a seguir, nas dependências do SALÃO-PARCEIRO: ${ou(pc.funcoes)}.`)
  par('1.2. A PROFISSIONAL-PARCEIRA presta os serviços com autonomia técnica e organizacional. A parceria não gera vínculo empregatício nem societário entre as partes enquanto observados os termos deste contrato e da lei (art. 1º-A, §§ 2º e 11, da Lei nº 12.592/2012).')
  par('1.3. A PROFISSIONAL-PARCEIRA não exercerá funções diferentes das descritas neste contrato, como atendimento de recepção, caixa, limpeza geral ou administração do salão (art. 1º-C, II).')

  h('Cláusula 2ª · Cotas-partes')
  par(`2.1. Do valor de cada serviço prestado pela PROFISSIONAL-PARCEIRA, calculado ${base}, caberá ${pct(cotaProf)} à PROFISSIONAL-PARCEIRA, a título de cota-parte pelos serviços prestados, e ${pct(cotaSalao)} ao SALÃO-PARCEIRO, a título de cota-parte pelo uso do espaço, da estrutura, dos equipamentos, do apoio administrativo e de recepção, da divulgação e das demais atividades de apoio.`)
  if (excecoes.length) {
    par('2.2. Ficam ajustadas as seguintes exceções ao percentual acima, para a cota-parte da PROFISSIONAL-PARCEIRA:')
    lista(excecoes.map((e) => `${e.nome}: ${pct(e.cota_pct)} para a profissional e ${pct(Math.round((100 - Number(e.cota_pct)) * 100) / 100)} para o salão.`))
  }
  par(`${excecoes.length ? '2.3' : '2.2'}. Descontos, promoções e cortesias concedidos à cliente pelo SALÃO-PARCEIRO ou com anuência da PROFISSIONAL-PARCEIRA reduzem proporcionalmente as duas cotas, salvo ajuste escrito em contrário. Gorjetas entregues diretamente à PROFISSIONAL-PARCEIRA pertencem a ela integralmente.`)

  h('Cláusula 3ª · Centralização, documento fiscal e repasse')
  par('3.1. O SALÃO-PARCEIRO centraliza os pagamentos e recebimentos dos serviços prestados pela PROFISSIONAL-PARCEIRA, em qualquer meio (dinheiro, cartão, PIX ou pagamento pelo aplicativo), e emite à cliente o documento fiscal, com a discriminação das cotas-partes de cada parte (art. 1º-A, §§ 4º e 5º).')
  par('3.2. A cota-parte destinada à PROFISSIONAL-PARCEIRA não integra a receita bruta do SALÃO-PARCEIRO, ainda que adotada a emissão de nota fiscal unificada (art. 1º-A, § 5º).')
  par(`3.3. O repasse da cota-parte da PROFISSIONAL-PARCEIRA será ${rep}${pc.dia_repasse ? `, ${pc.dia_repasse}` : ''}, acompanhado de demonstrativo com a relação dos atendimentos, os valores cobrados, as cotas de cada parte e as retenções aplicadas. O demonstrativo pode ser disponibilizado pelo aplicativo MIMO.`)
  par('3.4. Havendo estorno ou devolução à cliente de valor já repassado, a parcela correspondente à cota-parte da PROFISSIONAL-PARCEIRA será compensada no repasse seguinte.')

  h('Cláusula 4ª · Tributos e contribuições')
  if (pc.retencao === 'salao') {
    par('4.1. O SALÃO-PARCEIRO reterá da cota-parte da PROFISSIONAL-PARCEIRA e recolherá, em nome dela, os tributos e as contribuições sociais e previdenciárias devidos sobre essa cota-parte, na forma da legislação aplicável, discriminando as retenções no demonstrativo de repasse (art. 1º-A, §§ 4º e 6º).')
    par('4.2. Os tributos incidentes sobre a cota-parte do SALÃO-PARCEIRO são de sua exclusiva responsabilidade.')
  } else {
    par('4.1. A PROFISSIONAL-PARCEIRA, inscrita como microempreendedora individual, microempresária ou pequena empresária, responde pelos tributos e contribuições incidentes sobre a sua cota-parte, na forma do regime tributário a que estiver sujeita, mantendo a inscrição regular durante toda a parceria. O SALÃO-PARCEIRO reterá e recolherá apenas o que a legislação expressamente lhe atribuir, discriminando qualquer retenção no demonstrativo de repasse (art. 1º-A, §§ 4º e 6º).')
    par('4.2. Os tributos incidentes sobre a cota-parte do SALÃO-PARCEIRO são de sua exclusiva responsabilidade.')
  }

  h('Cláusula 5ª · Materiais, produtos e equipamentos')
  par(`5.1. Quanto aos produtos e materiais de consumo utilizados nos serviços, ${MATERIAIS[pc.materiais] ?? MATERIAIS.salao}${pc.materiais_detalhe ? `: ${pc.materiais_detalhe}` : '.'}`)
  par('5.2. Os equipamentos e o mobiliário disponibilizados pelo SALÃO-PARCEIRO permanecem de sua propriedade e devem ser usados com zelo pela PROFISSIONAL-PARCEIRA, que responde pelos danos causados por mau uso. Os instrumentos e equipamentos próprios da PROFISSIONAL-PARCEIRA permanecem de sua propriedade e sob sua responsabilidade.')

  h('Cláusula 6ª · Espaço e condições de trabalho')
  par('6.1. O SALÃO-PARCEIRO é responsável pela preservação e manutenção das adequadas condições de trabalho do espaço, especialmente quanto aos aspectos sanitários, e pelo cumprimento das normas de vigilância sanitária aplicáveis ao estabelecimento.')
  par('6.2. A PROFISSIONAL-PARCEIRA é responsável pela higiene do seu posto de trabalho, pela esterilização e conservação dos instrumentos que utiliza e pelo cumprimento das normas técnicas e sanitárias da sua atividade.')

  h('Cláusula 7ª · Autonomia e organização')
  par(`7.1. A PROFISSIONAL-PARCEIRA organiza a própria agenda, inclusive pelo aplicativo MIMO, definindo os dias e horários em que atende${pc.horario ? `, tendo como referência o funcionamento do espaço: ${pc.horario}` : ', dentro do horário de funcionamento do espaço'}. Não há controle de jornada, subordinação hierárquica nem exclusividade.`)
  par('7.2. A PROFISSIONAL-PARCEIRA pode recusar atendimentos, indicar substituta de sua confiança para períodos de ausência, com ciência do SALÃO-PARCEIRO, e atender clientes próprias, respeitadas as regras de uso do espaço.')

  h('Cláusula 8ª · Obrigações da profissional-parceira')
  lista([
    'manter regular sua inscrição fiscal e apresentar ao SALÃO-PARCEIRO, quando solicitado, os comprovantes correspondentes;',
    'prestar os serviços com qualidade técnica, cumprindo os horários que ela própria marcar com as clientes;',
    'guardar sigilo sobre os dados pessoais das clientes, usando-os apenas para a prestação dos serviços, nos termos da Lei nº 13.709/2018 (LGPD);',
    'registrar os atendimentos e recebimentos no sistema indicado pelo SALÃO-PARCEIRO, para a correta apuração das cotas;',
    'zelar pelo espaço, pelos equipamentos e pela imagem do estabelecimento.',
  ])

  h('Cláusula 9ª · Obrigações do salão-parceiro')
  lista([
    'repassar pontualmente a cota-parte da PROFISSIONAL-PARCEIRA, com o demonstrativo correspondente;',
    'emitir o documento fiscal à cliente com a discriminação das cotas-partes;',
    'disponibilizar o espaço, a estrutura e o apoio administrativo em condições adequadas de uso e higiene;',
    'respeitar a autonomia da PROFISSIONAL-PARCEIRA na organização da própria agenda e na execução técnica dos serviços;',
    'guardar sigilo sobre os dados pessoais das clientes e da PROFISSIONAL-PARCEIRA, nos termos da LGPD.',
  ])

  h('Cláusula 10ª · Prazo e rescisão')
  par(`10.1. Este contrato vigora por prazo indeterminado a partir de ${dataLonga(pc.inicio)}.`)
  par(`10.2. Qualquer das partes pode rescindi-lo, sem ônus, mediante aviso prévio escrito de ${Number(pc.aviso_previo_dias ?? 30)} dias, que pode ser enviado pelo aplicativo MIMO ou por outro meio que comprove o recebimento.`)
  par('10.3. O descumprimento grave de obrigação prevista neste contrato autoriza a rescisão imediata pela parte prejudicada, sem prejuízo da apuração dos valores devidos.')
  par('10.4. No encerramento, o SALÃO-PARCEIRO fará o acerto final das cotas-partes até a data da rescisão, com o demonstrativo correspondente, no prazo do repasse ordinário seguinte.')

  h('Cláusula 11ª · Homologação')
  par(`11.1. As partes submeterão este contrato à homologação do sindicato da categoria profissional e laboral${pc.sindicato ? ` (${pc.sindicato})` : ''} e, na ausência deste, ao órgão local competente do Ministério do Trabalho e Emprego, perante duas testemunhas (art. 1º-A, § 8º). A PROFISSIONAL-PARCEIRA, ainda que inscrita como pessoa jurídica, será assistida pelo sindicato ou pelo órgão competente na forma da lei (§ 9º).`)

  h('Cláusula 12ª · Disposições gerais')
  par('12.1. Alterações neste contrato só valem por escrito, assinadas pelas duas partes, e seguem para nova homologação quando alterarem as cotas-partes, o repasse ou as funções.')
  par('12.2. A assinatura eletrônica das partes, pelo aplicativo MIMO ou por meio de certificado ou conta gov.br, é válida nos termos da Lei nº 14.063/2020 e da MP nº 2.200-2/2001. O documento assinado fica guardado pelas duas partes.')
  if (pc.observacoes) par(`12.3. Condições específicas ajustadas pelas partes: ${pc.observacoes}`)
  par(`${pc.observacoes ? '12.4' : '12.3'}. Fica eleito o foro da comarca de ${cidadeForo} para dirimir as questões oriundas deste contrato.`)
  par(`E, por estarem de acordo, as partes assinam este contrato em duas vias de igual teor, na presença das testemunhas abaixo, em ${cidadeForo}, ${dataLonga(pc.assinado_em ?? pc.inicio)}.`)

  B.push({ t: 'assinaturas', partes: [
    { rotulo: 'SALÃO-PARCEIRO', nome: ou(s.razao_social || s.nome), sub: `${ou(s.responsavel_nome)} · CPF ${ou(formatarCpf(s.responsavel_cpf))}` },
    { rotulo: 'PROFISSIONAL-PARCEIRA', nome: ou(p.nome), sub: `CPF ${ou(formatarCpf(p.cpf))}${p.cnpj ? ` · CNPJ ${formatarCnpj(p.cnpj)}` : ''}` },
    { rotulo: 'TESTEMUNHA 1', nome: ou(testemunhas[0]?.nome), sub: `CPF ${ou(formatarCpf(testemunhas[0]?.cpf))}` },
    { rotulo: 'TESTEMUNHA 2', nome: ou(testemunhas[1]?.nome), sub: `CPF ${ou(formatarCpf(testemunhas[1]?.cpf))}` },
  ] })
  return B
}
