import { useDroppable } from '@dnd-kit/core'
import { useCart, fmtBRL } from '../store/cart'
import { Board3D } from './Board3D'

// Tabua 3D (WebGL) + os pratos (fotos) por cima, na regiao do tampo.
export function Tray() {
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' })
  const itens = useCart((s) => s.itens)
  const remove = useCart((s) => s.remove)

  return (
    <div ref={setNodeRef} className={`board ${isOver ? 'is-over' : ''}`}>
      <div className="board-3d">
        <Board3D />
      </div>

      <div className="board-items">
        {itens.map((it) => (
          <div className="plate" key={it.prato.id}>
            {it.qtd > 1 && <span className="plate-qtd">{it.qtd}</span>}
            <button
              className="plate-x"
              type="button"
              aria-label={`Remover ${it.prato.nome}`}
              onClick={() => remove(it.prato.id)}
            >
              ×
            </button>
            {it.prato.foto ? (
              <img className="plate-photo" src={it.prato.foto} alt={it.prato.nome} draggable={false} />
            ) : (
              <div className="plate-photo" style={{ display: 'grid', placeItems: 'center', fontSize: 28 }}>🍽️</div>
            )}
            <div className="plate-cap">
              <div className="plate-name">{it.prato.nome}</div>
              <div className="plate-price">{fmtBRL(it.prato.preco)}</div>
            </div>
          </div>
        ))}

        <div className="plate empty">
          <div className="plate-slot">Arraste mais algo aqui</div>
        </div>
      </div>
    </div>
  )
}
