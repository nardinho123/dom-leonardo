import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useMenu } from './hooks/useMenu'
import { useCart } from './store/cart'
import { CategoryRail } from './components/CategoryRail'
import { DishGrid } from './components/DishGrid'
import { Tray } from './components/Tray'
import { OrderPanel } from './components/OrderPanel'
import type { Grupo, Prato } from './lib/types'

export default function App() {
  const { pratos, gruposComItens, loading, error } = useMenu()
  const add = useCart((s) => s.add)
  const [grupo, setGrupo] = useState<Grupo>('Principais')
  const [arrastando, setArrastando] = useState<Prato | null>(null)

  // distancia de ativacao: um toque parado NAO arrasta (deixa o "+" e o scroll livres)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const grupoAtivo: Grupo = gruposComItens.includes(grupo) ? grupo : (gruposComItens[0] ?? 'Principais')
  const pratosDoGrupo = useMemo(
    () => pratos.filter((p) => p.grupo === grupoAtivo),
    [pratos, grupoAtivo],
  )

  function onDragStart(e: DragStartEvent) {
    setArrastando((e.active.data.current?.prato as Prato) ?? null)
  }
  function onDragEnd(e: DragEndEvent) {
    setArrastando(null)
    if (e.over?.id === 'tray') {
      const prato = e.active.data.current?.prato as Prato | undefined
      if (prato) add(prato)
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="app">
        <header className="topbar">
          <div className="brand">Monte do seu jeito</div>
          <div className="brand-sub">Arraste os pratos pra bandeja 🍽️</div>
        </header>

        <div className="stage">
          <CategoryRail grupos={gruposComItens} ativo={grupoAtivo} onSelect={setGrupo} />

          <main className="center">
            <Tray />
            {loading && <div className="grid-empty">Carregando o cardápio…</div>}
            {error && <div className="grid-empty erro">Erro ao carregar: {error}</div>}
            {!loading && !error && <DishGrid pratos={pratosDoGrupo} />}
          </main>

          <OrderPanel />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {arrastando ? (
          <div className="drag-ghost">
            {arrastando.foto ? <img src={arrastando.foto} alt="" /> : <span>🍽️</span>}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
