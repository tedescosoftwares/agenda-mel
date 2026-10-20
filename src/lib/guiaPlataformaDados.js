// A leitura da lista do guia na Plataforma (3.36), para um guia de 20 mil salões.
//
// Antes, a lista vinha por OFFSET (range) em páginas de mil, e cada página fazia o banco reordenar a cidade inteira
// de novo, com as colunas pesadas (horarios, servicos, atributos, origem): Santos, com mais de 2 mil, demorava, e
// "Todas as cidades" estourava o tempo. Agora:
//   - fatias com chave: where id > último order by id limit 1000. Cada fatia custa o mesmo, do começo ao fim; a
//     tela recebe cada fatia assim que chega (aoReceber) e já mostra os primeiros mil enquanto o resto vem
//   - só o que a lista mostra: tem_horario e servicos_n (migração 181) em vez de horarios e servicos; sem atributos
//     nem origem. A linha inteira (com o texto) é lida quando se abre o salão (carregarTexto)
//   - "Todas as cidades" traz só a fila (sem página ou esperando revisão), até TETO_TODAS; a lista completa é por cidade
export const FATIA = 1000
export const TETO_TODAS = 5000
export const COLUNAS_LISTA = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, tem_horario, servicos_n, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, fotos, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em, tem_conteudo, tem_rascunho, resumo, meta, meta_rascunho'
// a view antes da 181 (sem as flags): as colunas de sempre, ainda sem atributos e origem
export const COLUNAS_LISTA_ANTIGAS = 'id, cidade, cidade_slug, uf, slug, categoria, nome, bairro, endereco, cep, telefone, whatsapp, instagram, site, horarios, servicos, place_id, cnpj, validado_receita, selecao, nota, avaliacoes, fontes, fotos, status, motivo, salon_id, gerado_em, publicado_em, criado_em, atualizado_em, tem_conteudo, tem_rascunho, resumo, meta, meta_rascunho'
// o banco ainda sem a 181: "column guia_lista.tem_horario does not exist"
export const colunaFalta = (erro) => /tem_horario|servicos_n/.test(String(erro?.message ?? erro)) && /column|does not exist|schema cache|could not find/i.test(String(erro?.message ?? erro))
// o filtro de "Todas as cidades": só a fila. Na view: status fora de publicado/descartado/removido, ou com versão nova
export const soAFila = (q) => q.or('status.not.in.(publicado,descartado,removido),tem_rascunho.eq.true')
export const soAFilaNaTabela = (q) => q.or('status.not.in.(publicado,descartado,removido),rascunho.not.is.null')

// lê uma tabela ou view por fatias com chave (id). aoReceber(listaAteAgora, terminou) a cada fatia.
// Devolve { lista, teto }: teto = parou no teto com mais por ler
export async function lerEmFatias({ cliente, tabela, colunas, filtro = (q) => q, fatia = FATIA, teto = Infinity, aoReceber }) {
  const todas = []
  let depois = null
  for (;;) {
    let q = filtro(cliente.from(tabela).select(colunas)).order('id')
    if (depois) q = q.gt('id', depois)
    const { data, error } = await q.limit(fatia)
    if (error) throw error
    const lote = Array.isArray(data) ? data : []
    todas.push(...lote)
    const ultimo = lote[lote.length - 1]
    const cheia = lote.length >= fatia && !!ultimo?.id
    const noTeto = todas.length >= teto
    const fim = !cheia || noTeto
    aoReceber?.(todas, fim)
    if (fim) return { lista: todas, teto: cheia && noTeto }
    depois = ultimo.id
  }
}

// as flags da lista valem para a linha magra e para a linha inteira (depois de carregarTexto)
export const temHorario = (l) => (l?.tem_horario != null ? !!l.tem_horario : Array.isArray(l?.horarios) && l.horarios.length > 0)
export const nServicos = (l) => (l?.servicos_n != null ? Number(l.servicos_n) : Array.isArray(l?.servicos) ? l.servicos.length : 0)
