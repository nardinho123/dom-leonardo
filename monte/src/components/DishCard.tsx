import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Prato } from '../lib/types'
import { useCart, fmtBRL } from '../store/cart'

// Card do prato: foto (arrastavel pra bandeja) + nome curto + preco. Botao "+" pra toque.
export function DishCard({ prato }: { prato: Prato }) {
  const add = useCart((s) => s.add)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: prato.id,
    data: { prato },
  })

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.35 : 1,
    zIndex: isDragging ? 40 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="dish" {...attributes} {...listeners}>
      <div className="dish-photo">
        {prato.foto
          ? <img src={prato.foto} alt={prato.nome} draggable={false} />
          : <div className="dish-noimg" aria-hidden>🍽️</div>}
        <button
          className="dish-add"
          type="button"
          aria-label={`Adicionar ${prato.nome}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); add(prato) }}
        >
          +
        </button>
      </div>
      <div className="dish-info">
        <span className="dish-name">{prato.nome}</span>
        <span className="dish-price">{fmtBRL(prato.preco)}</span>
      </div>
    </div>
  )
}
