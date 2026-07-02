import { useDroppable } from '@dnd-kit/core'
import { useCart } from '../store/cart'

// Bandeja = zona de "soltar". Mostra as fotos dos itens do carrinho com sombra.
export function Tray() {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' })
  const itens = useCart((s) => s.itens)
  const remove = useCart((s) => s.remove)

  return (
    <div ref={setNodeRef} className={`tray ${isOver ? 'is-over' : ''}`}>
      {itens.length === 0 ? (
        <div className="tray-hint">
          <span className="tray-hint-emoji" aria-hidden>🍽️</span>
          <span>Arraste os pratos pra cá</span>
        </div>
      ) : (
        <div className="tray-items">
          {itens.map((it) => (
            <div className="tray-item" key={it.prato.id} title={it.prato.nome}>
              {it.prato.foto
                ? <img src={it.prato.foto} alt={it.prato.nome} draggable={false} />
                : <div className="tray-noimg" aria-hidden>🍽️</div>}
              {it.qtd > 1 && <span className="tray-qtd">{it.qtd}</span>}
              <button
                className="tray-x"
                type="button"
                aria-label={`Remover ${it.prato.nome}`}
                onClick={() => remove(it.prato.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
