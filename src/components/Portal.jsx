import { createPortal } from 'react-dom'

// Folhas e modais saem do miolo que rola e vão para o fim do <body>:
// assim ficam por cima das barras de cima e de baixo em qualquer
// navegador (o iPhone recorta "position: fixed" dentro de área rolável).
export default function Portal({ children }) {
  return createPortal(children, document.body)
}
