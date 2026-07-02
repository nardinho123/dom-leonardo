import type { Prato } from '../lib/types'
import { DishCard } from './DishCard'

export function DishGrid({ pratos }: { pratos: Prato[] }) {
  if (!pratos.length) {
    return <div className="grid-empty">Nada nessa categoria ainda.</div>
  }
  return (
    <div className="dish-grid">
      {pratos.map((p) => (
        <DishCard key={p.id} prato={p} />
      ))}
    </div>
  )
}
