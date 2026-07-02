import { useState } from 'react'
import { useCart, selectSubtotal, selectTotalItens, fmtBRL } from '../store/cart'

// Fase 1: taxa e endereco/tempo sao placeholders (batem com o print).
// O calculo real de frete + endereco do cliente vem na Fase 2 (checkout).
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
                    <span className="order-item-name">{it.qtd}x {it.prato.nome}</span>
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

            <div className="order-deliver">
              <div className="order-deliver-label">Entrega em</div>
              <div className="order-address">
                <span className="pin" aria-hidden>📍</span>
                <div className="addr">
                  <b>Casa</b>
                  <span>Rua das Flores, 123 · Centro, Curitiba - PR</span>
                </div>
              </div>
            </div>

            <div className="order-eta">
              <span>⏱ Tempo estimado</span>
              <strong>30–40 min</strong>
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
        {itens.length > 0 && (
          <button className="order-finalize" type="button" onClick={() => alert('Fase 2: finalizar e enviar')}>
            Finalizar e enviar
          </button>
        )}
      </div>
    </aside>
  )
}
