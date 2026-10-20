import { useEffect, useMemo, useRef, useState } from 'react'
import Portal from '../../Portal'
import { useDialogo } from '../../../context/DialogoContext'
import { PreviaGoogle } from './Previa'
import EscreverFora from './EscreverFora'
import { GUIA_CATEGORIAS, conteudoSeguro, telefoneBonito, canaisDoSite, rotaDoLugar } from '../../../lib/guia'
import { seoDoLugar } from '../../../lib/guiaSeo'
import { enviarFotoDoGuia, MAX_FOTOS } from '../../../lib/guiaFotos'
import { X, Plus, Trash2, FileText, Store, LoaderCircle, ImagePlus, ChevronLeft, ChevronRight } from 'lucide-react'

// Editar um salão: os fatos (gravados com fontes[campo] = 'manual', para a
// próxima importação não desfazer o que foi corrigido à mão), as fotos (3.14:
// vão para o bucket 'guia' e a lista de endereços fica em guia_lugares.fotos;
// a primeira é a capa) e o texto da página (gravado no rascunho: o que está
// no ar só muda quando aprovar).


const FATOS = ['nome', 'categoria', 'bairro', 'endereco', 'cep', 'telefone', 'whatsapp', 'instagram', 'site', 'servicos', 'selecao', 'salon_id']
// os campos que a importação mexe (são os que ganham a marca de "manual")
const DA_IMPORTACAO = ['nome', 'categoria', 'bairro', 'endereco', 'cep', 'telefone', 'whatsapp', 'instagram', 'site', 'horarios', 'servicos', 'selecao']
const DIAS = [[1, 'Segunda'], [2, 'Terça'], [3, 'Quarta'], [4, 'Quinta'], [5, 'Sexta'], [6, 'Sábado'], [0, 'Domingo']]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const hh = (h, m) => `${String(Math.min(24, Number(h))).padStart(2, '0')}:${m ?? '00'}`
// '9h às 12h, 14h–18h' -> [['09:00','12:00'], ['14:00','18:00']]
function faixasDoTexto(t) {
  if (/24\s*h/i.test(t)) return [['00:00', '24:00']]
  const faixas = []
  for (const parte of String(t).split(/[,;/]|\s+e\s+/)) {
    const horas = [...parte.matchAll(/(\d{1,2})\s*(?:[:hH]\s*(\d{2}))?/g)].map((m) => hh(m[1], m[2]))
    if (horas.length >= 2 && horas[0] < horas[1]) faixas.push([horas[0], horas[1]])
  }
  return faixas
}
const textoDasFaixas = (faixas) => (faixas ?? []).map(([a, b]) => (a === '00:00' && b === '24:00' ? '24 horas' : `${a}–${b}`)).join(', ')

function horarioInicial(h) {
  const por = new Map((Array.isArray(h) ? h : []).map((d) => [d.dia, d.faixas]))
  return {
    conhecido: Array.isArray(h),
    dias: Object.fromEntries(DIAS.map(([d]) => [d, { aberto: por.has(d), texto: por.has(d) ? textoDasFaixas(por.get(d)) : '09:00–18:00' }])),
  }
}
function montarHorarios(hor) {
  if (!hor.conhecido) return null
  return DIAS.map(([d]) => d).sort((a, b) => a - b)
    .map((d) => ({ dia: d, faixas: hor.dias[d].aberto ? faixasDoTexto(hor.dias[d].texto) : [] }))
    .filter((d) => d.faixas.length)
}

const vazioTexto = () => ({ seo_title: '', meta_description: '', chamada: '', resumo: '', sobre: [''], destaques: [], dicas: { titulo: '', itens: [''] }, faq: [], _meta: {} })
function textoInicial(l) {
  const c = conteudoSeguro(l.rascunho ?? l.conteudo)
  if (!c) return vazioTexto()
  return { seo_title: c.seo_title, meta_description: c.meta_description, chamada: c.chamada, resumo: c.resumo, sobre: c.sobre.length ? c.sobre : [''], destaques: c.destaques, dicas: { titulo: c.dicas.titulo, itens: c.dicas.itens.length ? c.dicas.itens : [''] }, faq: c.faq, _meta: c._meta }
}
// o que vai para o banco: sem campo vazio, sem espaço sobrando
function limparTexto(t) {
  const s = (v) => String(v ?? '').trim()
  return {
    seo_title: s(t.seo_title), meta_description: s(t.meta_description), chamada: s(t.chamada), resumo: s(t.resumo),
    sobre: t.sobre.map(s).filter(Boolean),
    destaques: t.destaques.map((d) => ({ titulo: s(d.titulo), texto: s(d.texto) })).filter((d) => d.titulo && d.texto),
    dicas: { titulo: s(t.dicas.titulo), itens: t.dicas.itens.map(s).filter(Boolean) },
    faq: t.faq.map((f) => ({ pergunta: s(f.pergunta), resposta: s(f.resposta) })).filter((f) => f.pergunta && f.resposta),
  }
}
const palavras = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean).length

function Conta({ n, max, min, unidade = '' }) {
  const classe = n > max ? 'muito' : min && n > 0 && n < min ? 'pouco' : ''
  return <small className={'pg-conta ' + classe}>{n}{min ? ` (${min}–${max})` : `/${max}`}{unidade}</small>
}

export default function EditarLugar({ lugar, g, onFechar }) {
  const { confirmar } = useDialogo()
  const temTexto = g.temTexto(lugar)
  const [aba, setAba] = useState(temTexto ? 'texto' : 'fatos')
  const inicial = useMemo(() => {
    const l = lugar ?? {}
    return {
      fatos: Object.fromEntries(FATOS.map((k) => [k, k === 'servicos' ? (l.servicos ?? []).join(', ') : k === 'selecao' ? !!l.selecao : (l[k] ?? '')])),
      horario: horarioInicial(l.horarios),
      texto: textoInicial(l),
      fotos: Array.isArray(l.fotos) ? l.fotos : [],
    }
  }, [lugar])
  const [fatos, setFatos] = useState(inicial.fatos)
  const [horario, setHorario] = useState(inicial.horario)
  const [texto, setTexto] = useState(inicial.texto)
  const [fotos, setFotos] = useState(inicial.fotos)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const caixa = useRef(null)

  const sujo = JSON.stringify({ fatos, horario, texto, fotos }) !== JSON.stringify(inicial)
  const textoMudou = JSON.stringify(texto) !== JSON.stringify(inicial.texto)

  async function fechar() {
    if (sujo && !(await confirmar({ titulo: 'Sair sem salvar?', texto: 'As mudanças feitas aqui se perdem.', ok: 'Sair sem salvar', cancelar: 'Continuar editando' }))) return
    onFechar()
  }

  // Esc fecha (perguntando, se mexeu); Ctrl+Enter salva
  const teclas = useRef(null)
  useEffect(() => {
    teclas.current = (e) => {
      if (document.querySelector('.dialogo-fundo')) return
      if (e.key === 'Escape') { e.preventDefault(); fechar() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salvar() }
    }
  })
  useEffect(() => {
    caixa.current?.focus()
    const ouvir = (e) => teclas.current?.(e)
    window.addEventListener('keydown', ouvir)
    return () => window.removeEventListener('keydown', ouvir)
  }, [])

  if (!lugar) return null
  const set = (k, v) => setFatos((f) => ({ ...f, [k]: v }))
  const setT = (k, v) => setTexto((t) => ({ ...t, [k]: v }))
  const setLista = (k, i, v) => setTexto((t) => ({ ...t, [k]: t[k].map((x, j) => (j === i ? v : x)) }))
  const tirar = (k, i) => setTexto((t) => ({ ...t, [k]: t[k].filter((_, j) => j !== i) }))

  // as fotos: reduzidas e enviadas ao bucket 'guia' pelo mesmo caminho da importação em lote (lib/guiaFotos.js)
  async function enviarFotos(e) {
    const arquivos = [...(e.target.files ?? [])].slice(0, MAX_FOTOS - fotos.length)
    e.target.value = ''
    if (!arquivos.length) return
    setEnviando(true); setErro('')
    const novas = []
    for (const f of arquivos) {
      try {
        const { url } = await enviarFotoDoGuia(lugar.id, f)
        novas.push(url)
      } catch (err) {
        setErro(`${f.name}: ${err.message}`)
      }
    }
    setFotos((fs) => [...fs, ...novas.filter((n) => !fs.includes(n))].slice(0, MAX_FOTOS))
    setEnviando(false)
  }
  const moverFoto = (i, d) => setFotos((fs) => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return fs; [n[i], n[j]] = [n[j], n[i]]; return n })

  async function salvar() {
    if (salvando) return
    setErro('')
    // ---- os fatos, já no formato do banco ----
    const f = fatos
    const nome = String(f.nome).trim()
    if (!nome) { setAba('fatos'); setErro('O nome não pode ficar vazio.'); return }
    const ig = String(f.instagram).trim()
    const novo = {
      nome,
      categoria: f.categoria || 'beleza',
      bairro: String(f.bairro).trim() || null,
      endereco: String(f.endereco).trim() || null,
      cep: String(f.cep).replace(/\D/g, '').length === 8 ? String(f.cep).replace(/\D/g, '').replace(/^(\d{5})/, '$1-') : (String(f.cep).trim() || null),
      telefone: String(f.telefone).trim() ? telefoneBonito(f.telefone) : null,
      whatsapp: String(f.whatsapp).trim() ? telefoneBonito(f.whatsapp) : null,
      instagram: ig ? (canaisDoSite(ig.includes('instagram.com') ? ig : '').instagram ?? ig.replace(/^@/, '').replace(/\/+$/, '')) : null,
      site: String(f.site).trim() ? (canaisDoSite(f.site).site ?? String(f.site).trim()) : null,
      servicos: String(f.servicos).split(',').map((s) => s.trim()).filter(Boolean),
      selecao: !!f.selecao,
      salon_id: String(f.salon_id ?? '').trim() || null,
    }
    const campos = {}
    for (const k of FATOS) {
      const antes = k === 'servicos' ? (lugar.servicos ?? []) : k === 'selecao' ? !!lugar.selecao : (lugar[k] ?? null)
      if (JSON.stringify(novo[k]) !== JSON.stringify(antes)) campos[k] = novo[k]
    }
    if ('salon_id' in campos && campos.salon_id && !UUID.test(campos.salon_id)) { setAba('fatos'); setErro('O id do salão na MIMO é um código longo (uuid), como aparece em Plataforma › Salões.'); return }
    const horarios = montarHorarios(horario)
    if (JSON.stringify(horarios) !== JSON.stringify(lugar.horarios ?? null)) campos.horarios = horarios
    const manuais = Object.keys(campos).filter((k) => DA_IMPORTACAO.includes(k))
    if (manuais.length) campos.fontes = { ...(lugar.fontes ?? {}), ...Object.fromEntries(manuais.map((k) => [k, 'manual'])) }
    if (JSON.stringify(fotos) !== JSON.stringify(inicial.fotos)) campos.fotos = fotos

    // ---- o texto vai para o rascunho (se não havia, nasce da versão no ar) ----
    if (textoMudou) {
      const limpo = limparTexto(texto)
      if (!limpo.sobre.length && !limpo.seo_title) { setAba('texto'); setErro('Escreva pelo menos o título e um parágrafo, ou deixe a IA gerar.'); return }
      campos.rascunho = { ...limpo, _meta: { ...(texto._meta ?? {}), editado_em: new Date().toISOString() } }
      if (lugar.status === 'importado' || lugar.status === 'descartado') campos.status = 'gerado'
    }
    if (!Object.keys(campos).length) { onFechar(); return }
    setSalvando(true)
    const r = await g.salvarLugar(lugar.id, campos)
    setSalvando(false)
    if (!r.ok) { setErro(r.erro); return }
    g.avisar(textoMudou ? `${nome}: texto salvo, esperando aprovação.` : `${nome}: dados salvos.`)
    onFechar()
  }

  const previo = { ...lugar, nome: fatos.nome || lugar.nome, bairro: fatos.bairro }
  const seo = seoDoLugar(previo, limparTexto(texto))

  return (
    <Portal>
      <div className="modal-fundo plat-modal-fundo" onClick={fechar} role="presentation">
        <div className="modal-caixa plat-modal pg-modal-editar" role="dialog" aria-modal="true" aria-labelledby="pg-ed-t" onClick={(e) => e.stopPropagation()}>
          <header className="pg-ed-topo">
            <div><h3 id="pg-ed-t">Editar {lugar.nome}</h3><small className="muted">{rotaDoLugar(lugar.cidade_slug, lugar.slug)} · o endereço da página não muda</small></div>
            <button type="button" className="pg-ed-x" onClick={fechar} aria-label="Fechar"><X size={20} /></button>
          </header>
          <div className="plat-abas-linha pg-ed-abas">
            <button type="button" className={aba === 'texto' ? 'ativo' : ''} onClick={() => setAba('texto')}><FileText size={15} /> Texto da página</button>
            <button type="button" className={aba === 'fatos' ? 'ativo' : ''} onClick={() => setAba('fatos')}><Store size={15} /> Fatos do salão</button>
          </div>

          <div className="pg-ed-corpo" ref={caixa} tabIndex={-1}>
            {aba === 'texto' ? (
              <div className="pg-form">
                {!temTexto && <p className="pg-nota">Ainda não há texto da IA. Dá para escrever à mão, colar o que o seu GPT escreveu (abaixo), ou fechar e tocar em Gerar.</p>}
                <EscreverFora tipo="lugar" id={lugar.id} g={g} onJson={(o) => setTexto({ ...textoInicial({ rascunho: o }), _meta: texto._meta })} />
                <PreviaGoogle titulo={seo.titulo} descricao={seo.descricao} caminho={seo.caminho} tituloBruto={texto.seo_title} descricaoBruta={texto.meta_description} />
                <label className="pg-campo">Título no Google <Conta n={texto.seo_title.length} max={60} />
                  <input value={texto.seo_title} onChange={(e) => setT('seo_title', e.target.value)} placeholder="Ex.: Rô Coiffeur em Itanhaém: unhas e cabelo no Centro" />
                </label>
                <label className="pg-campo">Descrição no Google <Conta n={texto.meta_description.length} max={155} min={120} />
                  <textarea rows={2} value={texto.meta_description} onChange={(e) => setT('meta_description', e.target.value)} />
                </label>
                <div className="pg-dupla">
                  <label className="pg-campo">Chamada (abaixo do nome) <Conta n={texto.chamada.length} max={140} />
                    <textarea rows={2} value={texto.chamada} onChange={(e) => setT('chamada', e.target.value)} />
                  </label>
                  <label className="pg-campo">Resumo (cartão nas listas) <Conta n={texto.resumo.length} max={170} />
                    <textarea rows={2} value={texto.resumo} onChange={(e) => setT('resumo', e.target.value)} />
                  </label>
                </div>

                <fieldset className="pg-grupo">
                  <legend>Sobre</legend>
                  {texto.sobre.map((p, i) => (
                    <div key={i} className="pg-linha-lista">
                      <label className="pg-campo">Parágrafo {i + 1} <Conta n={palavras(p)} min={45} max={110} unidade=" palavras" />
                        <textarea rows={4} value={p} onChange={(e) => setLista('sobre', i, e.target.value)} />
                      </label>
                      {texto.sobre.length > 1 && <button type="button" className="pg-tirar" onClick={() => tirar('sobre', i)} aria-label={`Tirar o parágrafo ${i + 1}`}><Trash2 size={15} /></button>}
                    </div>
                  ))}
                  {texto.sobre.length < 3 && <button type="button" className="plat-link" onClick={() => setT('sobre', [...texto.sobre, ''])}><Plus size={14} /> Parágrafo</button>}
                </fieldset>

                <fieldset className="pg-grupo">
                  <legend>Destaques</legend>
                  {texto.destaques.map((d, i) => (
                    <div key={i} className="pg-linha-lista">
                      <div className="pg-dupla pg-dupla-estreita">
                        <label className="pg-campo">Título <Conta n={d.titulo.length} max={40} />
                          <input value={d.titulo} onChange={(e) => setLista('destaques', i, { ...d, titulo: e.target.value })} />
                        </label>
                        <label className="pg-campo">Texto <Conta n={d.texto.length} max={170} />
                          <textarea rows={2} value={d.texto} onChange={(e) => setLista('destaques', i, { ...d, texto: e.target.value })} />
                        </label>
                      </div>
                      <button type="button" className="pg-tirar" onClick={() => tirar('destaques', i)} aria-label={`Tirar o destaque ${i + 1}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {texto.destaques.length < 4 && <button type="button" className="plat-link" onClick={() => setT('destaques', [...texto.destaques, { titulo: '', texto: '' }])}><Plus size={14} /> Destaque</button>}
                </fieldset>

                <fieldset className="pg-grupo">
                  <legend>Dicas</legend>
                  <label className="pg-campo">Título das dicas <Conta n={texto.dicas.titulo.length} max={50} />
                    <input value={texto.dicas.titulo} onChange={(e) => setT('dicas', { ...texto.dicas, titulo: e.target.value })} placeholder="Ex.: Antes de marcar sua extensão de cílios" />
                  </label>
                  {texto.dicas.itens.map((d, i) => (
                    <div key={i} className="pg-linha-lista">
                      <label className="pg-campo">Dica {i + 1} <Conta n={d.length} max={150} />
                        <input value={d} onChange={(e) => setT('dicas', { ...texto.dicas, itens: texto.dicas.itens.map((x, j) => (j === i ? e.target.value : x)) })} />
                      </label>
                      {texto.dicas.itens.length > 1 && <button type="button" className="pg-tirar" onClick={() => setT('dicas', { ...texto.dicas, itens: texto.dicas.itens.filter((_, j) => j !== i) })} aria-label={`Tirar a dica ${i + 1}`}><Trash2 size={15} /></button>}
                    </div>
                  ))}
                  {texto.dicas.itens.length < 5 && <button type="button" className="plat-link" onClick={() => setT('dicas', { ...texto.dicas, itens: [...texto.dicas.itens, ''] })}><Plus size={14} /> Dica</button>}
                </fieldset>

                <fieldset className="pg-grupo">
                  <legend>Perguntas frequentes</legend>
                  <p className="pg-nota">Sobre o serviço e a visita. Horário, endereço e “dá para marcar pela MIMO?” já entram sozinhos, a partir dos dados.</p>
                  {texto.faq.map((f, i) => (
                    <div key={i} className="pg-linha-lista">
                      <div className="pg-coluna">
                        <label className="pg-campo">Pergunta {i + 1}<input value={f.pergunta} onChange={(e) => setLista('faq', i, { ...f, pergunta: e.target.value })} /></label>
                        <label className="pg-campo">Resposta<textarea rows={2} value={f.resposta} onChange={(e) => setLista('faq', i, { ...f, resposta: e.target.value })} /></label>
                      </div>
                      <button type="button" className="pg-tirar" onClick={() => tirar('faq', i)} aria-label={`Tirar a pergunta ${i + 1}`}><Trash2 size={15} /></button>
                    </div>
                  ))}
                  {texto.faq.length < 5 && <button type="button" className="plat-link" onClick={() => setT('faq', [...texto.faq, { pergunta: '', resposta: '' }])}><Plus size={14} /> Pergunta</button>}
                </fieldset>
              </div>
            ) : (
              <div className="pg-form">
                <p className="pg-nota">O que você corrigir aqui fica marcado como manual: a próxima importação não desfaz.</p>
                <div className="pg-dupla">
                  <label className="pg-campo">Nome<input value={fatos.nome} onChange={(e) => set('nome', e.target.value)} /></label>
                  <label className="pg-campo">Categoria
                    <select value={fatos.categoria} onChange={(e) => set('categoria', e.target.value)}>{GUIA_CATEGORIAS.map((c) => <option key={c.slug} value={c.slug}>{c.rotulo}</option>)}</select>
                  </label>
                  <label className="pg-campo">Endereço<input value={fatos.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Av. Condessa de Vimieiros, 657" /></label>
                  <label className="pg-campo">Bairro<input value={fatos.bairro} onChange={(e) => set('bairro', e.target.value)} /></label>
                  <label className="pg-campo">CEP<input value={fatos.cep} onChange={(e) => set('cep', e.target.value)} inputMode="numeric" /></label>
                  <label className="pg-campo">Telefone<input value={fatos.telefone} onChange={(e) => set('telefone', e.target.value)} inputMode="tel" /></label>
                  <label className="pg-campo">WhatsApp<input value={fatos.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} inputMode="tel" placeholder="Só se for celular com WhatsApp" /></label>
                  <label className="pg-campo">Instagram<input value={fatos.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="o @, sem o link" /></label>
                  <label className="pg-campo">Site<input value={fatos.site} onChange={(e) => set('site', e.target.value)} placeholder="https://" /></label>
                  <label className="pg-campo">Na MIMO (id do salão, opcional)<input value={fatos.salon_id} onChange={(e) => set('salon_id', e.target.value)} placeholder="quando o salão já agenda pela MIMO" /></label>
                </div>
                <label className="pg-campo">Serviços (separados por vírgula)<input value={fatos.servicos} onChange={(e) => set('servicos', e.target.value)} placeholder="Manicure, Pedicure, Unhas em gel" /></label>
                <label className="pg-check"><input type="checkbox" checked={fatos.selecao} onChange={(e) => set('selecao', e.target.checked)} /> <span><b>Seleção MIMO</b> · a curadoria da casa, mostrada como selo na página</span></label>

                <fieldset className="pg-grupo">
                  <legend>Horário</legend>
                  <label className="pg-check"><input type="checkbox" checked={horario.conhecido} onChange={(e) => setHorario((h) => ({ ...h, conhecido: e.target.checked }))} /> <span>Sei o horário deste salão</span></label>
                  {horario.conhecido && (
                    <div className="pg-horario">
                      {DIAS.map(([d, rotulo]) => {
                        const dia = horario.dias[d]
                        const muda = (v) => setHorario((h) => ({ ...h, dias: { ...h.dias, [d]: { ...h.dias[d], ...v } } }))
                        const ruim = dia.aberto && !faixasDoTexto(dia.texto).length
                        return (
                          <div key={d} className="pg-horario-dia">
                            <label className="pg-check"><input type="checkbox" checked={dia.aberto} onChange={(e) => muda({ aberto: e.target.checked })} /> <span>{rotulo}</span></label>
                            {dia.aberto ? <input className={ruim ? 'ruim' : ''} value={dia.texto} onChange={(e) => muda({ texto: e.target.value })} placeholder="09:00–19:00 ou 9h às 12h, 14h às 18h" aria-label={`Horário de ${rotulo}`} /> : <span className="muted">Fechado</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </fieldset>

                <fieldset className="pg-grupo">
                  <legend>Fotos</legend>
                  <p className="pg-nota">Só foto que o salão mandou ou autorizou, ou que a equipe tirou. Nada copiado do Google ou do Instagram: a foto é de quem publicou. Até {MAX_FOTOS}; a primeira é a capa da página e a imagem do link no WhatsApp.</p>
                  <div className="pg-fotos">
                    {fotos.map((f, i) => (
                      <figure key={f} className="pg-foto">
                        <img src={f} alt="" />
                        <figcaption>
                          <button type="button" onClick={() => moverFoto(i, -1)} disabled={i === 0} aria-label="Mover para a esquerda"><ChevronLeft size={14} /></button>
                          <span>{i === 0 ? 'capa' : i + 1}</span>
                          <button type="button" onClick={() => moverFoto(i, 1)} disabled={i === fotos.length - 1} aria-label="Mover para a direita"><ChevronRight size={14} /></button>
                          <button type="button" className="pg-foto-tirar" onClick={() => setFotos((fs) => fs.filter((_, j) => j !== i))} aria-label="Tirar a foto"><Trash2 size={14} /></button>
                        </figcaption>
                      </figure>
                    ))}
                    {fotos.length < MAX_FOTOS && (
                      <label className="pg-foto-mais">
                        <input type="file" accept="image/*" multiple onChange={enviarFotos} disabled={enviando} />
                        {enviando ? <LoaderCircle size={18} className="pg-gira" /> : <ImagePlus size={18} />}
                        <span>{enviando ? 'Enviando…' : 'Enviar fotos'}</span>
                      </label>
                    )}
                  </div>
                  {lugar.salon_id && !fotos.length && <p className="pg-nota">Sem foto aqui, a página usa as fotos que o salão pôs na própria página dele na MIMO.</p>}
                </fieldset>
              </div>
            )}
          </div>

          {erro && <div className="alert alert-error pg-ed-erro">{erro}</div>}
          <footer className="pg-ed-pe">
            <small className="muted">{textoMudou ? 'O texto fica esperando aprovação: a página no ar não muda até aprovar.' : 'Ctrl+Enter salva · Esc fecha'}</small>
            <button type="button" className="btn btn-ghost" onClick={fechar}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || !sujo}>{salvando ? <><LoaderCircle size={15} className="pg-gira" /> Salvando…</> : 'Salvar'}</button>
          </footer>
        </div>
      </div>
    </Portal>
  )
}
