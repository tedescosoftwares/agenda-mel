import { Link } from 'react-router-dom'

// Markdown do tamanho que o blog precisa: títulos (#, ##, ###), listas
// com - ou 1., parágrafos, negrito, itálico e links. Nada de HTML cru.
// Devolve elementos React; os links internos (/...) viram <Link>.

function inline(texto, chave) {
  const partes = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  let i = 0, m, k = 0
  while ((m = re.exec(texto))) {
    if (m.index > i) partes.push(texto.slice(i, m.index))
    const t = m[0]
    if (t.startsWith('**')) partes.push(<strong key={`${chave}-${k++}`}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('[')) {
      const [, rotulo, url] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)
      partes.push(url.startsWith('/') ? <Link key={`${chave}-${k++}`} to={url}>{rotulo}</Link> : <a key={`${chave}-${k++}`} href={url} target="_blank" rel="noopener noreferrer">{rotulo}</a>)
    } else partes.push(<em key={`${chave}-${k++}`}>{t.slice(1, -1)}</em>)
    i = m.index + t.length
  }
  if (i < texto.length) partes.push(texto.slice(i))
  return partes
}

export function idDoTitulo(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// os H2 do texto, para o índice do artigo
export function titulosDe(md) {
  return String(md || '').split('\n').filter((l) => /^## /.test(l)).map((l) => { const t = l.replace(/^## /, '').trim(); return { id: idDoTitulo(t), texto: t } })
}

export function Markdown({ texto }) {
  const linhas = String(texto || '').replace(/\r/g, '').split('\n')
  const saida = []
  let i = 0, k = 0
  while (i < linhas.length) {
    const l = linhas[i]
    if (!l.trim()) { i++; continue }
    let m
    if ((m = l.match(/^(#{1,3}) (.+)/))) {
      const nivel = m[1].length, t = m[2].trim()
      const props = { key: k++, id: idDoTitulo(t) }
      saida.push(nivel === 1 ? <h2 {...props}>{inline(t, k)}</h2> : nivel === 2 ? <h2 {...props}>{inline(t, k)}</h2> : <h3 {...props}>{inline(t, k)}</h3>)
      i++; continue
    }
    if (/^[-*] /.test(l)) {
      const itens = []
      while (i < linhas.length && /^[-*] /.test(linhas[i])) { itens.push(linhas[i].replace(/^[-*] /, '')); i++ }
      saida.push(<ul key={k++}>{itens.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ul>)
      continue
    }
    if (/^\d+\. /.test(l)) {
      const itens = []
      while (i < linhas.length && /^\d+\. /.test(linhas[i])) { itens.push(linhas[i].replace(/^\d+\. /, '')); i++ }
      saida.push(<ol key={k++}>{itens.map((t, j) => <li key={j}>{inline(t, `${k}-${j}`)}</li>)}</ol>)
      continue
    }
    if (/^> /.test(l)) {
      const ls = []
      while (i < linhas.length && /^> /.test(linhas[i])) { ls.push(linhas[i].replace(/^> /, '')); i++ }
      saida.push(<blockquote key={k++}>{inline(ls.join(' '), k)}</blockquote>)
      continue
    }
    // parágrafo: junta linhas seguidas até a linha em branco
    const ls = []
    while (i < linhas.length && linhas[i].trim() && !/^(#{1,3} |[-*] |\d+\. |> )/.test(linhas[i])) { ls.push(linhas[i].trim()); i++ }
    saida.push(<p key={k++}>{inline(ls.join(' '), k)}</p>)
  }
  return <>{saida}</>
}
