import { useEffect, useMemo, useState } from 'react'
import { MessageSquareText, Eye, BarChart3 } from 'lucide-react'
import { InstagramIcon } from '../../icons'
import { supabase } from '../../../lib/supabase'
import { PADRAO_INSTA, DIAS_INSTA, lerConviteInsta } from '../../../lib/guiaInstagram'
import { ConviteInstagram } from '../../guia/SigaInstagram'
import { Bloco, Chave, BarraSalvar } from './PecasWa'
import '../../../landing.css'
import '../../../guia.css'

// 3.99.1: Plataforma › Guia › Instagram. O @ da MIMO (config_publica.instagram: o rodapé do site, o do login e o guia)
// e o convite que aparece antes de falar com um salão do guia (config_publica.guia_instagram, JSON): ligado, título,
// texto, as três linhas do que ela recebe e de quantos em quantos dias ele volta. A prévia ao lado é o modal de verdade.
// Os toques aparecem no Desempenho: "Convite do Instagram", "Seguir a MIMO no Instagram" e "Foi direto ao salão".

const limparHandle = (v) => String(v ?? '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').trim()
const handleOk = (h) => /^[A-Za-z0-9._]{1,30}$/.test(h)
const nada = () => {}
// o ícone do Instagram com o size dos ícones do lucide (as abas e os blocos passam size)
export const IconeInsta = ({ size = 18, ...p }) => <InstagramIcon width={size} height={size} {...p} />

export default function InstagramGuia() {
  const [salvo, setSalvo] = useState(null)   // { handle, convite }
  const [form, setForm] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [quando, setQuando] = useState(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('config_publica').then(({ data, error }) => {
      if (!vivo) return
      if (error) { setErro(error.message); return }
      const v = { handle: limparHandle(data?.instagram), convite: lerConviteInsta(data?.guia_instagram) }
      setSalvo(v); setForm(v)
    })
    return () => { vivo = false }
  }, [])

  const sujo = useMemo(() => !!form && !!salvo && JSON.stringify(form) !== JSON.stringify(salvo), [form, salvo])
  const mudar = (k, v) => setForm((f) => ({ ...f, convite: { ...f.convite, [k]: v } }))
  const mudarGanho = (i, v) => setForm((f) => { const g = [...f.convite.ganhos]; while (g.length < 3) g.push(''); g[i] = v; return { ...f, convite: { ...f.convite, ganhos: g } } })

  async function salvar() {
    const handle = limparHandle(form.handle)
    if (handle && !handleOk(handle)) { setErro('Confira o @: só letras, números, ponto e sublinhado (ex.: mimo.com.vc).'); return }
    setSalvando(true); setErro(''); setAviso('')
    const c = form.convite
    const convite = { ligado: !!c.ligado, titulo: c.titulo.trim(), texto: c.texto.trim(), ganhos: c.ganhos.map((g) => g.trim()).filter(Boolean).slice(0, 3), dias: Number(c.dias) }
    const r1 = await supabase.rpc('definir_config_publica', { chave_: 'instagram', valor_: handle })
    const r2 = r1.error ? r1 : await supabase.rpc('definir_config_publica', { chave_: 'guia_instagram', valor_: JSON.stringify(convite) })
    setSalvando(false)
    if (r1.error || r2.error) { setErro((r1.error ?? r2.error).message); return }
    const v = { handle, convite: lerConviteInsta(convite) }
    setSalvo(v); setForm(v); setQuando(new Date().toISOString())
    setAviso(handle ? 'Salvo. O site passa a usar isso na próxima página que a pessoa abrir.' : 'Salvo sem @: nada do Instagram aparece no site.')
  }

  if (!form) return <div className="pg-wa pg-wa-v2">{erro ? <div className="alert alert-error">{erro}</div> : <p className="muted">Carregando…</p>}</div>

  const handle = limparHandle(form.handle)
  const previa = handle && handleOk(handle) ? { handle, url: `https://instagram.com/${handle}`, convite: lerConviteInsta(form.convite) } : null
  const c = form.convite
  return (
    <div className="pg-wa pg-wa-v2 pg-insta" data-teste="insta-guia">
      {erro && <div className="alert alert-error">{erro}</div>}
      {aviso && <div className="alert alert-ok">{aviso}</div>}
      <div className="pg-insta-grade">
        <div className="pg-wa-blocos pg-wa-form">
          <Bloco id="perfil" aoMontar={nada} Icon={IconeInsta} titulo="O Instagram da MIMO" sub="O @ que aparece no rodapé do site, no login, no guia e no convite. Vazio: nada do Instagram aparece.">
            <label>@ no Instagram<input value={form.handle} onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))} placeholder="mimo.com.vc" autoComplete="off" data-teste="insta-handle" /></label>
          </Bloco>

          <Bloco id="convite" aoMontar={nada} Icon={MessageSquareText} titulo="O convite antes de falar com o salão" sub="Na página de um salão do guia, o toque em WhatsApp ou Ligar abre este convite antes. Uma vez por aparelho; quem toca em Seguir não vê mais.">
            <Chave checked={c.ligado} onChange={(v) => mudar('ligado', v)} teste="insta-ligado"><b>Ligado</b> <span className="muted">(desligado, o contato abre direto, como antes)</span></Chave>
            <label>Título<input value={c.titulo} onChange={(e) => mudar('titulo', e.target.value)} maxLength={90} placeholder={PADRAO_INSTA.titulo} /></label>
            <label>Texto antes da lista<input value={c.texto} onChange={(e) => mudar('texto', e.target.value)} maxLength={120} placeholder={PADRAO_INSTA.texto} /></label>
            <fieldset className="pg-insta-ganhos">
              <legend>O que ela recebe seguindo <span className="muted">(até 3 linhas; use {'{cidade}'} para o nome da cidade)</span></legend>
              {[0, 1, 2].map((i) => <input key={i} value={c.ganhos[i] ?? ''} onChange={(e) => mudarGanho(i, e.target.value)} maxLength={110} placeholder={PADRAO_INSTA.ganhos[i]} aria-label={`Linha ${i + 1}`} />)}
            </fieldset>
            <label>Mostrar de novo depois de
              <select className="plat-select" value={c.dias} onChange={(e) => mudar('dias', Number(e.target.value))}>
                {DIAS_INSTA.map((d) => <option key={d} value={d}>{d} dias</option>)}
              </select>
            </label>
            <p className="muted pg-wa-nota">Só prometa o que vai mesmo aparecer no Instagram da MIMO. Os cartões fixos (página do salão, lista da cidade, “Pedido anotado!”, fim do artigo e rodapé) usam o mesmo @.</p>
          </Bloco>

          <Bloco id="medir" aoMontar={nada} Icon={BarChart3} titulo="Como medir" sub="No Desempenho do guia, nos tipos de toque:">
            <ul className="pg-insta-lista">
              <li><b>Convite do Instagram</b>: quantas vezes o convite apareceu.</li>
              <li><b>Seguir a MIMO no Instagram</b>: tocou em Seguir (no convite, nos cartões ou no rodapé).</li>
              <li><b>Foi direto ao salão</b>: tocou em “Agora não”. Se esse número for alto e os contatos com salões caírem, desligue o convite.</li>
            </ul>
          </Bloco>
        </div>

        <aside className="pg-insta-previa" aria-label="Prévia do convite">
          <h4><Eye size={15} /> Como fica no celular</h4>
          <div className="ld">
            {previa ? <ConviteInstagram previa insta={previa} salao="Studio Lírio" cidade="Santos" destino={{ href: '#', tipo: 'whatsapp' }} />
              : <p className="muted">Preencha o @ para ver a prévia.</p>}
          </div>
          {!c.ligado && <p className="muted">O convite está desligado: a prévia é só para você ver os textos.</p>}
        </aside>
      </div>
      <BarraSalvar sujo={sujo} salvando={salvando} atualizadoEm={quando} onSalvar={salvar} onDescartar={() => { setForm(salvo); setErro('') }} teste="insta-salvar" />
    </div>
  )
}
