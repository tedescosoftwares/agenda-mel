import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AdminShell from '../../components/AdminShell'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// A bancada: ensaiar a conversa inteira sem precisar de um segundo
// telefone.
//
// Testar o bot exige dois números de WhatsApp — um fazendo de cliente,
// outro de profissional. Quem está construindo raramente tem dois à mão,
// e quando tem, um cai. A construção inteira para por causa disso.
//
// Aqui você escolhe de qual número a mensagem "chegou" e digita o que
// ela diz. O sistema roda o caminho de verdade: a conversa avança, o
// horário é marcado, o pedido de aceite nasce. A única coisa fingida é
// o último centímetro — o que iria para o WhatsApp aparece na tela em
// vez de sair. É ensaio da ENTREGA, não do sistema.

const INTENCOES = [
  { v: '', r: 'a regra decide (sem IA)' },
  { v: 'agendar', r: 'quer marcar' },
  { v: 'confirmar', r: 'confirmar' },
  { v: 'cancelar', r: 'cancelar' },
  { v: 'remarcar', r: 'remarcar' },
  { v: 'outro', r: 'outra coisa' },
]

const ATALHOS = ['1', '2', '3', 'quero marcar um horário', 'confirmo', 'cancelar']

export default function AdminBancada() {
  const { salao } = useAuth()
  const salaoId = salao?.id

  const [numeros, setNumeros] = useState([])
  const [de, setDe] = useState('')
  const [texto, setTexto] = useState('')
  const [intencao, setIntencao] = useState('')
  const [linhas, setLinhas] = useState([])
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const fim = useRef(null)

  // Os números que fazem sentido testar: as clientes do salão e as
  // profissionais. Digitar um telefone à mão a cada teste é o tipo de
  // atrito que faz a pessoa desistir de testar.
  useEffect(() => {
    if (!salaoId) return
    let vivo = true
    ;(async () => {
      const [{ data: cli }, { data: pro }] = await Promise.all([
        supabase
          .from('profiles')
          .select('full_name, phone, role')
          .not('phone', 'is', null)
          .in('role', ['cliente', 'admin'])
          .limit(30),
        supabase
          .from('professionals')
          .select('name, user_id, profiles:user_id (phone)')
          .eq('salon_id', salaoId)
          .limit(30),
      ])
      if (!vivo) return
      const lista = [
        ...(cli ?? [])
          .filter((c) => c.phone)
          .map((c) => ({ tel: c.phone, quem: c.full_name || 'cliente', papel: 'cliente' })),
        ...(pro ?? [])
          .filter((p) => p.profiles?.phone)
          .map((p) => ({ tel: p.profiles.phone, quem: p.name, papel: 'profissional' })),
      ]
      setNumeros(lista)
      if (lista.length && !de) setDe(lista[0].tel)
    })()
    return () => {
      vivo = false
    }
  }, [salaoId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [linhas])

  const enviar = useCallback(
    async (oQue) => {
      const msg = (oQue ?? texto).trim()
      if (!msg || !salaoId || !de) return
      setEnviando(true)
      setErro('')
      setLinhas((L) => [...L, { lado: 'entrada', de, texto: msg }])
      setTexto('')

      const { data, error } = await supabase.rpc('simular_recebida', {
        salao: salaoId,
        tel: de,
        texto: msg,
        intencao: intencao || null,
      })

      if (error) {
        setErro(error.message)
      } else if (data?.erro) {
        setErro(data.erro)
      } else {
        setLinhas((L) => [...L, { lado: 'saida', ...data }])
      }
      setEnviando(false)
    },
    [texto, salaoId, de, intencao],
  )

  async function limpar() {
    if (!salaoId || !de) return
    if (!window.confirm(`Apagar os horários e mensagens que este ensaio criou para ${de}?`))
      return
    const { data, error } = await supabase.rpc('limpar_ensaio', { salao: salaoId, tel: de })
    if (error) setErro(error.message)
    else {
      setLinhas([])
      setErro('')
      window.alert(
        `Apagados: ${data?.agendamentos_apagados ?? 0} horário(s) e ` +
          `${data?.mensagens_apagadas ?? 0} mensagem(ns).`,
      )
    }
  }

  const quemE = numeros.find((n) => n.tel === de)

  return (
    <AdminShell>
      <div className="page-head">
        <h2>Bancada de testes</h2>
        <p className="muted">
          Ensaie a conversa inteira sem gastar um telefone. O que iria para o
          WhatsApp aparece aqui em vez de sair.
        </p>
      </div>

      {erro && <p className="erro">{erro}</p>}

      <div className="bc-controles">
        <label className="bc-campo">
          <span>a mensagem chegou de</span>
          <select value={de} onChange={(e) => setDe(e.target.value)}>
            {numeros.length === 0 && <option value="">nenhum número cadastrado</option>}
            {numeros.map((n) => (
              <option key={n.tel + n.quem} value={n.tel}>
                {n.quem} · {n.tel} ({n.papel})
              </option>
            ))}
          </select>
        </label>

        <label className="bc-campo">
          <span>a IA entendeu como</span>
          <select value={intencao} onChange={(e) => setIntencao(e.target.value)}>
            {INTENCOES.map((i) => (
              <option key={i.v} value={i.v}>
                {i.r}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="bc-nota">
        A IA de verdade lê o texto e escolhe uma dessas. Aqui você escolhe no
        lugar dela — dá para testar também o que acontece quando ela erra.
      </p>

      <div className="bc-tela">
        {linhas.length === 0 && (
          <p className="bc-vazio">
            Escreva algo como <em>quero marcar um horário</em> e veja o bot
            responder. Nada disso vai para o WhatsApp de ninguém.
          </p>
        )}

        {linhas.map((l, i) =>
          l.lado === 'entrada' ? (
            <div key={i} className="bc-balao bc-entrada">
              <span className="bc-de">{l.de}</span>
              {l.texto}
            </div>
          ) : (
            <div key={i} className="bc-resposta">
              {l.responder ? (
                <div className="bc-balao bc-saida">{l.responder}</div>
              ) : (
                <div className="bc-nada">
                  o bot não respondeu nada · <code>{l.acao || 'sem ação'}</code>
                  {l.motivo ? ` (${l.motivo})` : ''}
                </div>
              )}

              {(l.mensagens ?? []).length > 0 && (
                <div className="bc-saidas">
                  <strong className="bc-saidas-tit">
                    e sairia por WhatsApp {(l.mensagens ?? []).length === 1 ? '1 mensagem' : `${l.mensagens.length} mensagens`}:
                  </strong>
                  {l.mensagens.map((m, j) => (
                    <div key={j} className="bc-envio">
                      <span className="bc-envio-para">
                        {m.para} · {m.telefone} · <code>{m.tipo}</code>
                      </span>
                      <pre>{m.corpo}</pre>
                    </div>
                  ))}
                </div>
              )}

              {l.acao && <span className="bc-acao">ação: {l.acao}</span>}
            </div>
          ),
        )}
        <div ref={fim} />
      </div>

      <div className="bc-atalhos">
        {ATALHOS.map((a) => (
          <button key={a} className="btn-mini btn-mini-neutro" onClick={() => enviar(a)} disabled={enviando}>
            {a}
          </button>
        ))}
      </div>

      <form
        className="bc-escrever"
        onSubmit={(e) => {
          e.preventDefault()
          enviar()
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={quemE ? `escrever como ${quemE.quem}…` : 'escrever…'}
          disabled={enviando || !de}
        />
        <button className="btn" type="submit" disabled={enviando || !texto.trim()}>
          {enviando ? '…' : 'enviar'}
        </button>
      </form>

      <div className="bc-rodape">
        <button className="btn-mini btn-mini-neutro" onClick={() => setLinhas([])}>
          limpar a tela
        </button>
        <button className="btn-mini btn-mini-nao" onClick={limpar}>
          apagar o que o ensaio criou
        </button>
        <Link className="bc-link" to="/admin/whatsapp">
          voltar para WhatsApp
        </Link>
      </div>

      <p className="bc-aviso">
        O horário marcado aqui é de verdade e aparece na agenda — testar contra
        uma imitação seria testar a imitação. Use “apagar o que o ensaio criou”
        quando terminar.
      </p>
    </AdminShell>
  )
}
