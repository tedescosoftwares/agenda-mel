import { Link } from 'react-router-dom'
import { MarcaIcon, Wordmark } from '../../components/icons'
import { TERMOS_VERSAO, EMAIL_CONTATO } from '../../lib/termos'

// Termos de Uso e Política de Privacidade. Texto em português claro,
// pensado para a LGPD (Lei 13.709/2018). Os dois vivem aqui para a
// versão andar junta: mudou algo que importa, troca TERMOS_VERSAO.
function Pagina({ titulo, children }) {
  return (
    <div className="legal-bg">
      <div className="legal">
        <Link to="/" className="brand legal-brand"><MarcaIcon width={34} height={30} id="legal" /><Wordmark tamanho={1.6} /></Link>
        <h1>{titulo}</h1>
        <p className="muted legal-versao">Versão de {new Date(TERMOS_VERSAO + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
        {children}
        <p className="legal-rodape muted">Dúvidas? <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a> · <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Privacidade</Link> · <Link to="/">Voltar ao MIMO</Link></p>
      </div>
    </div>
  )
}

export function Termos() {
  return (
    <Pagina titulo="Termos de uso">
      <h2>1. O que é o MIMO</h2>
      <p>O MIMO é um aplicativo de agendamento de serviços de beleza. Ele conecta <strong>clientes</strong> a <strong>profissionais</strong> e <strong>salões</strong>: a cliente entra na agenda de quem a atende por um QR code, código ou link, vê horários livres, marca, remarca, avalia e recebe avisos. O MIMO é operado por <strong>Tedesco Softwares</strong> ("nós"), e este documento vale para todo mundo que usa o app: clientes, profissionais e donas de salão.</p>

      <h2>2. Conta e acesso</h2>
      <p>Para usar o MIMO você cria uma conta com nome, e-mail, WhatsApp e senha. Você é responsável por manter a senha em sigilo e por tudo que for feito com a sua conta. Cliente só vê a agenda de quem a convidou (por QR, código ou link); nenhuma agenda é pública para todo mundo. Menores de 18 anos só podem usar o MIMO com autorização de um responsável.</p>

      <h2>3. O que cada um faz</h2>
      <p><strong>Profissionais e salões</strong> cadastram serviços, preços, horários e a própria vitrine, aceitam ou recusam pedidos, e podem mandar recados às suas clientes. São responsáveis pela veracidade do que publicam e pela qualidade do serviço prestado. O MIMO não presta o serviço de beleza, não cobra por ele e não intermedeia pagamentos entre cliente e profissional.</p>
      <p><strong>Clientes</strong> marcam horários de boa-fé. Faltar sem avisar prejudica a profissional; cada casa pode ter sua própria política de faltas e atrasos, informada na agenda dela.</p>

      <h2>4. Avisos e comunicações</h2>
      <p>O MIMO envia avisos sobre a sua agenda (confirmação, lembrete, remarcação, cancelamento) pelo próprio app, por notificação no celular, por e-mail e, quando a casa usa, por WhatsApp. Recados escritos por profissionais e salões chegam pelo app e pela notificação no celular. Você controla tudo isso em <strong>Perfil › Preferências</strong>: pode desligar avisos no celular, por e-mail e lembretes no WhatsApp a qualquer hora. Avisos essenciais de segurança da conta podem ser enviados mesmo assim.</p>

      <h2>5. Conteúdo e conduta</h2>
      <p>Fotos, textos, avaliações e recados publicados são de responsabilidade de quem publicou. Não é permitido usar o MIMO para spam, assédio, discriminação, conteúdo ilegal ou para coletar dados de outras pessoas. Podemos remover conteúdo e suspender contas que violem estes termos.</p>

      <h2>6. Disponibilidade</h2>
      <p>Trabalhamos para o MIMO estar sempre no ar, mas ele pode ficar indisponível por manutenção ou por falhas de terceiros (internet, servidores, serviços de notificação). O MIMO é oferecido "como está"; não garantimos que atenda a todo propósito específico.</p>

      <h2>7. Encerramento</h2>
      <p>Você pode sair do MIMO quando quiser, pelo app ou escrevendo para <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a>. Ao excluir a conta, seus dados pessoais são apagados ou anonimizados conforme a Política de Privacidade; o histórico de atendimentos pode ficar com a profissional de forma anonimizada, para fins fiscais e de gestão.</p>

      <h2>8. Mudanças nestes termos</h2>
      <p>Podemos atualizar estes termos. Quando a mudança for relevante, você verá a nova versão na próxima entrada e precisará aceitá-la para continuar. A data no topo indica a versão vigente.</p>

      <h2>9. Lei e foro</h2>
      <p>Estes termos seguem a legislação brasileira. Fica eleito o foro do domicílio da pessoa usuária, como manda o Código de Defesa do Consumidor.</p>
    </Pagina>
  )
}

export function Privacidade() {
  return (
    <Pagina titulo="Política de privacidade">
      <p>Esta política explica, em linguagem simples, quais dados o MIMO coleta, para quê, com quem compartilha e quais são os seus direitos, conforme a <strong>Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018)</strong>. Controlador dos dados: <strong>Tedesco Softwares</strong>. Contato do encarregado (DPO): <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a>.</p>

      <h2>1. Quais dados coletamos</h2>
      <ul>
        <li><strong>Cadastro</strong>: nome, e-mail, número de WhatsApp e senha (guardada de forma cifrada, ninguém do MIMO a vê).</li>
        <li><strong>Uso do app</strong>: agendamentos, remarcações, cancelamentos, avaliações, favoritos, fila de espera, recados recebidos e o vínculo com cada agenda (quem te convidou e por qual meio).</li>
        <li><strong>Profissionais e salões</strong>: além do cadastro, serviços, preços, horários, fotos da vitrine, redes sociais informadas e dados de faturamento que o próprio app calcula.</li>
        <li><strong>Notificações no celular</strong>: quando você liga "Avisos no celular", guardamos o endereço técnico de entrega gerado pelo seu aparelho (Apple, Google ou Mozilla). Ele não identifica você fora do MIMO e é apagado quando você desliga.</li>
        <li><strong>Técnicos</strong>: data e hora de acesso, tipo de navegador e versão do app, para segurança e para resolver problemas.</li>
      </ul>
      <p><strong>O que não coletamos</strong>: não pedimos nem usamos a sua localização. A câmera é usada só no momento de ler um QR code, no seu aparelho; nenhuma imagem é enviada ou guardada.</p>

      <h2>2. Para que usamos</h2>
      <ul>
        <li>Fazer a agenda funcionar: marcar, confirmar, lembrar, remarcar (execução do contrato com você).</li>
        <li>Enviar avisos sobre a sua agenda pelo app, celular, e-mail e WhatsApp (execução do contrato e, para recados e comunicações não essenciais, seu consentimento, que você pode retirar em Perfil › Preferências).</li>
        <li>Mostrar à profissional ou ao salão a lista de clientes vinculadas, quem trouxe cada uma e o histórico de atendimentos (legítimo interesse de gestão da casa).</li>
        <li>Segurança, prevenção a fraude e cumprimento de obrigações legais.</li>
      </ul>

      <h2>3. Com quem compartilhamos</h2>
      <p>Não vendemos dados. Compartilhamos só o necessário para o serviço funcionar:</p>
      <ul>
        <li><strong>Profissionais e salões</strong> aos quais você se vinculou veem seu nome, WhatsApp e histórico de atendimentos com eles. Uma profissional não vê seus atendimentos em outra casa.</li>
        <li><strong>Operadores</strong> que hospedam e entregam o serviço em nosso nome: Supabase (banco de dados e autenticação), Amazon Web Services (servidores), Resend (e-mails), Apple, Google e Mozilla (entrega das notificações no celular), Cloudflare (rede) e, quando a casa usa o canal, a API do WhatsApp para os avisos. Todos tratam os dados sob contrato e só para essa finalidade.</li>
        <li><strong>Autoridades</strong>, quando a lei exigir.</li>
      </ul>
      <p>Alguns desses operadores ficam fora do Brasil; a transferência segue as salvaguardas previstas na LGPD.</p>

      <h2>4. Armazenamento no seu aparelho</h2>
      <p>O MIMO não usa cookies de rastreio nem de publicidade. Guardamos no seu aparelho apenas: a sessão de acesso (para não pedir senha toda hora), preferências de tela, o convite pendente quando você entra por um link, e o cache do app para abrir mais rápido e funcionar sem sinal. Você pode apagar tudo isso limpando os dados do site ou removendo o app da tela inicial.</p>

      <h2>5. Por quanto tempo guardamos</h2>
      <p>Enquanto a sua conta existir. Ao excluir a conta, apagamos seus dados pessoais em até 30 dias, exceto o que a lei nos obriga a manter e o histórico de atendimentos, que fica com a profissional de forma anonimizada (sem nome, e-mail ou telefone). Endereços de notificação são apagados imediatamente quando você desliga os avisos ou remove o app.</p>

      <h2>6. Seus direitos</h2>
      <p>A qualquer momento você pode: confirmar que tratamos seus dados, acessá-los, corrigir o que estiver errado, pedir a exclusão, pedir a portabilidade, revogar consentimentos e saber com quem compartilhamos. Muito disso está no próprio app (Perfil). O resto, é só escrever para <a href={`mailto:${EMAIL_CONTATO}`}>{EMAIL_CONTATO}</a>; respondemos em até 15 dias. Se não ficar satisfeita, você pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

      <h2>7. Segurança</h2>
      <p>Os dados trafegam cifrados (HTTPS) e ficam em banco com controle de acesso por linha: cada pessoa só alcança o que é dela. Senhas são guardadas com hash. Chaves de serviço ficam fora do app. Se acontecer um incidente que traga risco a você, avisaremos você e a ANPD conforme a lei.</p>

      <h2>8. Crianças e adolescentes</h2>
      <p>O MIMO não é dirigido a menores de 18 anos. Se soubermos de uma conta criada por menor sem autorização de responsável, ela será removida.</p>

      <h2>9. Mudanças nesta política</h2>
      <p>Quando mudar algo relevante, avisaremos no app e pediremos novo aceite. A data no topo indica a versão vigente.</p>
    </Pagina>
  )
}
