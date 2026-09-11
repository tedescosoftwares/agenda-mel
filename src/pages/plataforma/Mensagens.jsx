import { useEffect, useMemo, useRef, useState } from 'react'
import Shell from '../../components/plataforma/Shell'
import { Cabecalho, Painel, Pilula, Vazio } from '../../components/plataforma/Pecas'
import { supabase } from '../../lib/supabase'
import { useDialogo } from '../../context/DialogoContext'
import { MessageSquareText, Bot, Sparkles, Send, RotateCcw, Check, Plus, X } from 'lucide-react'

// Plataforma › Mensagens (068): tudo que o MIMO escreve no WhatsApp,
// editável aqui. Três abas: Textos (avisos), Bot (respostas e palavras)
// e IA (por salão). O texto de hoje é o "padrão"; editar cria uma
// versão sua, restaurar volta.
const GRUPO = { cliente: 'Para a cliente', profissional: 'Para a profissional', resposta: 'Respostas do bot', bot: 'Quando o bot ficaria quieto' }
const INTENCAO = { confirma: 'Confirmar', cancela: 'Cancelar / remarcar', sair: 'Sair dos avisos' }

export default function Mensagens() {
  const { confirmar, avisar } = useDialogo()
  const [aba, setAba] = useState('textos')
  const [modelos, setModelos] = useState(null)
  const [chave, setChave] = useState(null)
  const [erro, setErro] = useState('')

  const carregar = () => supabase.rpc('plataforma_modelos').then(({ data, error }) => { if (error) setErro(error.message); setModelos(data ?? []) })
  useEffect(() => { carregar() }, [])

  const doGrupo = (grupos) => (modelos ?? []).filter((m) => grupos.includes(m.grupo))
  const atual = (modelos ?? []).find((m) => m.chave === chave) ?? null

  return (
    <Shell>
      <Cabecalho titulo="Mensagens" sub="O que o MIMO escreve no WhatsApp. Edite, veja a prévia, mande um teste para o seu número." />
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="abas plat-abas-linha" style={{ marginBottom: '1rem' }}>
        {[['textos', 'Textos', MessageSquareText], ['bot', 'Bot', Bot], ['ia', 'IA', Sparkles]].map(([k, r, I]) => (
          <button key={k} className={aba === k ? 'ativo' : ''} onClick={() => { setAba(k); setChave(null) }}><I size={16} /> {r}</button>
        ))}
      </div>

      {aba !== 'ia' && (
        <div className="msg-duas">
          <Painel titulo={aba === 'textos' ? 'Avisos' : 'Respostas'} sub={aba === 'textos' ? 'Um por acontecimento. Verde = editado.' : 'O que o bot diz, e o que ele entende.'}>
            {modelos == null ? <p className="muted">Carregando…</p> : (
              (aba === 'textos' ? ['cliente', 'profissional'] : ['resposta', 'bot']).map((g) => (
                <div key={g} className="msg-grupo">
                  <h4>{GRUPO[g]}</h4>
                  {doGrupo([g]).map((m) => (
                    <button key={m.chave} className={'msg-item' + (chave === m.chave ? ' ativo' : '')} onClick={() => setChave(m.chave)}>
                      <span className="msg-item-tit">{m.titulo}</span>
                      <span className="msg-item-meta">
                        {m.texto ? <Pilula tom="menta">editado</Pilula> : <Pilula tom="cinza">padrão</Pilula>}
                        {m.envia === false && <Pilula tom="carmim">não envia</Pilula>}
                        {m.grupo === 'bot' && !m.texto && <Pilula tom="cinza">quieto</Pilula>}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
            {aba === 'bot' && <Palavras />}
          </Painel>

          <Painel titulo={atual ? atual.titulo : 'Escolha um item'} sub={atual?.descricao}>
            {atual ? <Editor key={atual.chave} modelo={atual} aoSalvar={carregar} confirmar={confirmar} avisar={avisar} /> : <Vazio>Toque num aviso ou resposta à esquerda para editar.</Vazio>}
          </Painel>
        </div>
      )}

      {aba === 'ia' && <IA />}
    </Shell>
  )
}

function Editor({ modelo, aoSalvar, confirmar, avisar }) {
  const [texto, setTexto] = useState(modelo.texto ?? modelo.padrao)
  const [previa, setPrevia] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [envia, setEnvia] = useState(modelo.envia !== false)
  const [sufixo, setSufixo] = useState(modelo.sufixo ?? '')
  const ref = useRef(null)
  const temRegra = modelo.grupo === 'cliente' || modelo.grupo === 'profissional'
  const mudou = (texto ?? '') !== (modelo.texto ?? modelo.padrao)

  useEffect(() => {
    const t = setTimeout(() => { supabase.rpc('plataforma_previa', { texto_: texto }).then(({ data }) => setPrevia(data ?? '')) }, 300)
    return () => clearTimeout(t)
  }, [texto])

  function inserir(v) {
    const el = ref.current; const tag = `{${v}}`
    if (!el) { setTexto((t) => t + tag); return }
    const a = el.selectionStart ?? texto.length, b = el.selectionEnd ?? texto.length
    const novo = texto.slice(0, a) + tag + texto.slice(b)
    setTexto(novo)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length) })
  }

  async function salvar() {
    setSalvando(true); setErro('')
    const { error } = await supabase.rpc('plataforma_salvar_modelo', { chave_: modelo.chave, texto_: texto })
    if (!error && temRegra) await supabase.rpc('plataforma_regra_whatsapp', { kind_: modelo.chave, envia_: envia, sufixo_: sufixo || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    aoSalvar?.()
  }
  async function restaurar() {
    if (!(await confirmar({ titulo: 'Voltar ao padrão?', texto: 'O texto que você escreveu some. O padrão continua o de sempre.', ok: 'Restaurar' }))) return
    setTexto(modelo.padrao)
    const { error } = await supabase.rpc('plataforma_salvar_modelo', { chave_: modelo.chave, texto_: null })
    if (error) setErro(error.message); else aoSalvar?.()
  }
  async function testar() {
    const { data, error } = await supabase.rpc('plataforma_testar_modelo', { texto_: texto })
    if (error) { setErro(error.message); return }
    await avisar({ titulo: 'Teste na fila', texto: `Vai para ${data?.para}. Chega em segundos pelo canal ligado.` })
  }

  return (
    <div className="msg-editor">
      {modelo.grupo === 'bot' && <p className="muted msg-nota">Deixe em branco para o bot ficar quieto nesse caso.</p>}
      <div className="msg-vars">
        {(modelo.variaveis ?? []).map((v) => <button key={v} type="button" className="plat-chip" onClick={() => inserir(v)}>{`{${v}}`}</button>)}
        {(modelo.variaveis ?? []).length === 0 && <span className="muted">Sem variáveis neste texto.</span>}
      </div>
      <textarea ref={ref} value={texto} onChange={(e) => setTexto(e.target.value)} rows={9} className="msg-textarea" placeholder={modelo.grupo === 'bot' ? 'Vazio = fica quieto' : ''} />
      <p className="muted msg-nota">*negrito* e _itálico_ como no WhatsApp. Linha com variável vazia some sozinha (sem link, some a linha do link).</p>
      {temRegra && (
        <div className="msg-regra">
          <label className="chave-linha"><button type="button" className={'switch' + (envia ? ' on' : '')} onClick={() => setEnvia(!envia)} role="switch" aria-checked={envia} /><span>Manda por WhatsApp</span></label>
          <label className="msg-sufixo">Frase colada no fim (só no WhatsApp)<input value={sufixo} onChange={(e) => setSufixo(e.target.value)} placeholder="Ex.: Responda 1 para confirmar ou 2 para remarcar." /></label>
        </div>
      )}
      <div className="msg-previa">
        <span className="msg-previa-tit">Prévia com dados de exemplo</span>
        <div className="msg-balao">{previa ? previa.split('\n').map((l, i) => <span key={i}>{formatar(l)}<br /></span>) : <span className="muted">(vazio: o bot fica quieto)</span>}</div>
      </div>
      {erro && <div className="alert alert-error">{erro}</div>}
      <div className="plat-botoes msg-acoes">
        <button className="btn btn-primary" onClick={salvar} disabled={salvando || (!mudou && !temRegra)}><Check size={16} /> {salvando ? 'Salvando…' : 'Salvar'}</button>
        <button className="btn btn-ghost" onClick={restaurar} disabled={!modelo.texto && texto === modelo.padrao}><RotateCcw size={16} /> Restaurar padrão</button>
        <button className="btn btn-ghost" onClick={testar}><Send size={16} /> Testar no meu WhatsApp</button>
      </div>
    </div>
  )
}

// *negrito* e _itálico_ do WhatsApp na prévia
function formatar(linha) {
  const partes = linha.split(/(\*[^*]+\*|_[^_]+_)/g)
  return partes.map((p, i) => p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <strong key={i}>{p.slice(1, -1)}</strong>
    : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p)
}

function Palavras() {
  const [lista, setLista] = useState(null)
  const [nova, setNova] = useState({})
  const [erro, setErro] = useState('')
  const carregar = () => supabase.rpc('plataforma_palavras').then(({ data }) => setLista(data ?? []))
  useEffect(() => { carregar() }, [])

  async function salvar(intencao, palavras) {
    const { error } = await supabase.rpc('plataforma_salvar_palavras', { intencao_: intencao, palavras_: palavras })
    if (error) setErro(error.message); else carregar()
  }

  return (
    <div className="msg-grupo">
      <h4>O que o bot entende</h4>
      <p className="muted msg-nota">Além de "1" e "2". Sem acento e sem pontuação; ele compara a frase inteira.</p>
      {erro && <div className="alert alert-error">{erro}</div>}
      {(lista ?? []).map((l) => (
        <div key={l.intencao} className="msg-palavras">
          <strong>{INTENCAO[l.intencao] ?? l.intencao}</strong>
          <div className="msg-chips">
            {(l.palavras ?? []).map((p) => <span key={p} className="msg-chip">{p}<button type="button" aria-label={`Tirar ${p}`} onClick={() => salvar(l.intencao, l.palavras.filter((x) => x !== p))}><X size={12} /></button></span>)}
            <form className="msg-chip-nova" onSubmit={(e) => { e.preventDefault(); const v = (nova[l.intencao] || '').trim(); if (!v) return; salvar(l.intencao, [...(l.palavras ?? []), v]); setNova((n) => ({ ...n, [l.intencao]: '' })) }}>
              <input value={nova[l.intencao] || ''} onChange={(e) => setNova((n) => ({ ...n, [l.intencao]: e.target.value }))} placeholder="nova palavra" />
              <button type="submit" aria-label="Adicionar"><Plus size={14} /></button>
            </form>
          </div>
        </div>
      ))}
    </div>
  )
}

function IA() {
  const [lista, setLista] = useState(null)
  const [erro, setErro] = useState('')
  const carregar = () => supabase.rpc('plataforma_ia').then(({ data, error }) => { if (error) setErro(error.message); setLista(data ?? []) })
  useEffect(() => { carregar() }, [])
  async function ligar(s, bot, ia) {
    const { error } = await supabase.rpc('plataforma_ligar_ia', { salao: s.salon_id, bot, ia })
    if (error) setErro(error.message); else carregar()
  }
  return (
    <Painel titulo="Bot e IA por salão" sub="O bot responde por regra (1, 2, palavras). A IA lê texto solto e classifica a intenção; tem teto por dia e por número.">
      {erro && <div className="alert alert-error">{erro}</div>}
      {lista == null ? <p className="muted">Carregando…</p> : lista.length === 0 ? <Vazio>Nenhum canal de WhatsApp cadastrado ainda.</Vazio> : (
        <div className="plat-tabela-wrap"><table className="plat-tabela">
          <thead><tr><th>Salão</th><th>Canal</th><th>Bot</th><th>IA</th><th>Hoje</th><th>Teto/dia</th><th>Teto/número</th></tr></thead>
          <tbody>
            {lista.map((s) => (
              <tr key={s.salon_id}>
                <td><strong>{s.salao}</strong></td>
                <td><Pilula tom={s.ativo && s.canal !== 'manual' ? 'menta' : 'cinza'}>{s.canal}{s.ativo ? '' : ' · desligado'}</Pilula></td>
                <td><button type="button" className={'switch' + (s.usa_bot ? ' on' : '')} onClick={() => ligar(s, !s.usa_bot, s.usa_ia)} role="switch" aria-checked={Boolean(s.usa_bot)} /></td>
                <td><button type="button" className={'switch' + (s.usa_ia ? ' on' : '')} onClick={() => ligar(s, s.usa_bot, !s.usa_ia)} role="switch" aria-checked={Boolean(s.usa_ia)} /></td>
                <td>{s.gastas_hoje}</td><td>{s.teto_ia_diario}</td><td>{s.teto_ia_por_numero}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      <p className="muted msg-nota">O texto de orientação da IA ainda mora na função <code>whatsapp-webhook</code>; vem para cá no próximo passo.</p>
    </Painel>
  )
}
