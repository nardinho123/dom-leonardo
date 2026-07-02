import { useState } from 'react'
import { useCart, selectSubtotal, selectTotalItens, fmtBRL } from '../store/cart'

// Fase 1: taxa fixa (placeholder). O calculo real de frete vem na Fase 2.
const TAXA_ENTREGA = 5.9

export function OrderPanel() {
  const itens = useCart((s) => s.itens)
  const dec = useCart((s) => s.dec)
  const add = useCart((s) => s.add)
  const subtotal = useCart(selectSubtotal)
  const totalItens = useCart(selectTotalItens)
  const total = subtotal + (itens.length ? TAXA_ENTREGA : 0)
  const [aberto, setAberto] = useState(false)

  return (
    <aside className={`order ${aberto ? 'is-open' : ''}`}>
      {/* Barra que aparece só no mobile; toca e expande a lista */}
      <button className="order-mobile-bar" type="button" onClick={() => setAberto((o) => !o)}>
        <span className="order-mobile-count">{totalItens} {totalItens === 1 ? 'item' : 'itens'}</span>
        <span className="order-mobile-total">{fmtBRL(total)}</span>
        <span className="order-mobile-caret" aria-hidden>{aberto ? '▾' : '▴'}</span>
      </button>

      <div className="order-body">
        <header className="order-head">
          <h2>Seu pedido</h2>
          <span className="order-bag" aria-hidden>🛍️</span>
        </header>

        {itens.length === 0 ? (
          <p className="order-empty">Sua bandeja está vazia. Monte do seu jeito 😋</p>
        ) : (
          <>
            <ul className="order-list">
              {itens.map((it) => (
                <li className="order-item" key={it.prato.id}>
                  <div className="order-item-main">
                    <span className="order-item-name">{it.prato.nome}</span>
                    <span className="order-item-price">{fmtBRL(it.prato.preco * it.qtd)}</span>
                  </div>
                  <div className="order-qty">
                    <button type="button" onClick={() => dec(it.prato.id)} aria-label="Menos">−</button>
                    <span>{it.qtd}</span>
                    <button type="button" onClick={() => add(it.prato)} aria-label="Mais">+</button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="order-values">
              <div className="order-row"><span>Subtotal</span><strong>{fmtBRL(subtotal)}</strong></div>
              <div className="order-row"><span>Taxa de entrega</span><strong>{fmtBRL(TAXA_ENTREGA)}</strong></div>
              <div className="order-row total"><span>Total</span><strong>{fmtBRL(total)}</strong></div>
            </div>
          </>
        )}

        <button
          className="order-cta"
          type="button"
          disabled={itens.length === 0}
          onClick={() => alert('Fase 2: aqui abre o checkout (sacola de papel) 🙂')}
        >
          Servir pedido →
        </button>
      </div>
    </aside>
  )
}
