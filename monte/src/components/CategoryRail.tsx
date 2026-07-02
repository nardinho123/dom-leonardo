import type { Grupo } from '../lib/types'

const ICON: Record<Grupo, string> = {
  Principais: '🍝',
  Acompanhamentos: '🍟',
  Bebidas: '🥤',
  Sobremesas: '🍰',
}

interface Props {
  grupos: Grupo[]
  ativo: Grupo
  onSelect: (g: Grupo) => void
}

export function CategoryRail({ grupos, ativo, onSelect }: Props) {
  return (
    <nav className="rail" aria-label="Categorias">
      {grupos.map((g) => (
        <button
          key={g}
          className={`rail-item ${g === ativo ? 'is-active' : ''}`}
          onClick={() => onSelect(g)}
          type="button"
        >
          <span className="rail-icon" aria-hidden>{ICON[g]}</span>
          <span className="rail-label">{g}</span>
        </button>
      ))}
    </nav>
  )
}
