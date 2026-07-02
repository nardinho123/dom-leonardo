import type { CategoriaView } from '../lib/types'

interface Props {
  categorias: CategoriaView[]
  ativo: string
  onSelect: (label: string) => void
}

export function CategoryRail({ categorias, ativo, onSelect }: Props) {
  return (
    <nav className="rail" aria-label="Categorias">
      {categorias.map((c) => (
        <button
          key={c.label}
          type="button"
          className={`rail-item ${c.label === ativo ? 'is-active' : ''}`}
          style={{ ['--chip' as any]: c.cor }}
          onClick={() => onSelect(c.label)}
        >
          <span className="rail-icon" aria-hidden>{c.icon}</span>
          <span className="rail-label">{c.label}</span>
        </button>
      ))}
    </nav>
  )
}
