import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { chamar } from '../../lib/pagamento'
import { estadoEmPortugues, haQuanto, dia } from '../../lib/instanciaWhats'

// 4.12: a instância do salão na Evolution, ao vivo, na aba WhatsApp da página do salão (Plataforma). O que o banco
// anotou pode estar velho (a dona desconecta pelo celular e ninguém fica sabendo); isto pergunta para a Evolution.
export default function InstanciaWhatsapp({ salaoId, d, onConferir }) {
  const [erro, setErro] = useState('')
  const [copiou, setCopiou] = useState(false)
  const [apontando, setApontando] = useState(false)

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); setCopiou(true); setTimeout(() => setCopiou(false), 1500) } catch { /* sem área de transferência */ }
  }
  async function reapontar() {
    setApontando(true); setErro('')
    try { await chamar('assistente', { acao: 'reapontar', salao: salaoId }); onConferir?.() } catch (e) { setErro(e.message) }
    setApontando(false)
  }
  if (!d) return null
  const i = d.instancia ?? {}
  const w = d.webhook
  const c = d.canal
  const webhookRuim = w && (!w.existe || !w.ligado || !w.certo || w.falta_mensagens)

  return (
    <div className="inst-wa">
      {erro && <p className="erro">{erro}</p>}
      {!d.evolution && <p className="inst-wa-aviso">O servidor do WhatsApp não respondeu{d.erro ? `: ${d.erro}` : ''}. Os dados abaixo são só o que o banco anotou.</p>}

      <div className="inst-wa-grade">
        <section>
          <h4>Instância na Evolution</h4>
          <dl>
            <div><dt>Nome</dt><dd><code>{i.nome}</code><button className="inst-wa-copiar" onClick={() => copiar(i.nome)} aria-label="Copiar o nome da instância" title="Copiar">{copiou ? <Check size={13} /> : <Copy size={13} />}</button></dd></div>
            <div><dt>Estado agora</dt><dd>{!d.evolution ? 'sem resposta' : i.existe ? estadoEmPortugues(i.estado) : 'não existe (o salão nunca conectou, ou desconectou)'}</dd></div>
            {i.numero && <div><dt>Número</dt><dd>{i.numero}{i.perfil ? ` · ${i.perfil}` : ''}</dd></div>}
            {i.criada_em && <div><dt>Criada em</dt><dd>{dia(i.criada_em)}</dd></div>}
            {i.caiu_em && i.estado !== 'open' && <div><dt>Caiu em</dt><dd>{dia(i.caiu_em)}{i.motivo_queda ? ` · código ${i.motivo_queda}` : ''}</dd></div>}
            {i.mensagens != null && <div><dt>Guardado nela</dt><dd>{i.mensagens} mensagens · {i.conversas ?? 0} conversas</dd></div>}
            {w && (
              <div><dt>Webhook</dt><dd>
                {!w.existe ? 'não configurado' : !w.ligado ? 'desligado' : !w.certo ? 'aponta para outro endereço' : w.falta_mensagens ? 'sem o evento de mensagens' : 'aponta para a MIMO'}
                {webhookRuim && <button className="btn-mini" onClick={reapontar} disabled={apontando}>{apontando ? 'apontando…' : 'apontar de novo'}</button>}
              </dd></div>
            )}
          </dl>
        </section>

        <section>
          <h4>O que o banco anotou</h4>
          {!c ? <p className="muted">Este salão não tem canal cadastrado.</p> : (
            <dl>
              <div><dt>Canal</dt><dd>{c.canal === 'evolution' ? (c.numero_proprio ? 'número próprio' : 'número da casa') : c.canal === 'cloud' ? 'API oficial' : 'manual'}{c.ativo ? '' : ' · desligado'}</dd></div>
              <div><dt>Número</dt><dd>{c.numero_exibicao || '—'}</dd></div>
              {c.numero_proprio && <div><dt>Conectado desde</dt><dd>{dia(c.conectado_em) || '—'}</dd></div>}
              <div><dt>Assistente</dt><dd>{c.usa_bot ? 'ligada' : 'desligada'}{c.usa_ia ? ' · com IA' : ''}</dd></div>
              {d.casa && <div><dt>Número da casa</dt><dd><code>{d.casa.instancia}</code> · {d.casa.estado ? estadoEmPortugues(d.casa.estado) : 'sem resposta'}</dd></div>}
              <div><dt>Última que chegou</dt><dd>{haQuanto(d.ultima_recebida) || 'nenhuma ainda'}</dd></div>
              <div><dt>Última que saiu</dt><dd>{haQuanto(d.ultima_enviada) || 'nenhuma ainda'}</dd></div>
              {d.ultima_falha && <div><dt>Última falha</dt><dd>{haQuanto(d.ultima_falha.quando)} · {d.ultima_falha.tipo}{d.ultima_falha.erro ? `: ${String(d.ultima_falha.erro).slice(0, 90)}` : ''}</dd></div>}
            </dl>
          )}
        </section>
      </div>
    </div>
  )
}
