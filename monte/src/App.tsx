import { useState } from 'react'
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
  const [ativo, setAtivo] = useState<Grupo>('Principais')
  const [arrastando, setArrastando] = useState<Prato | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function irPara(g: Grupo) {
    setAtivo(g)
    document.getElementById(`sec-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
          <button className="top-enter" type="button">👤 Entrar</button>
          <div className="top-center">
            <div className="brand">Monte do seu jeito</div>
            <div className="brand-sub">🍽 Arraste para a mesa</div>
          </div>
          <button className="top-bell" type="button" aria-label="Notificações">🔔</button>
        </header>

        <div className="stage">
          <CategoryRail
            grupos={gruposComItens.length ? gruposComItens : ['Principais']}
            ativo={ativo}
            onSelect={irPara}
          />

          <main className="center">
            <Tray />
            <div className="menu-hint">Arraste para a mesa</div>

            {loading && <div className="grid-empty">Carregando o cardápio…</div>}
            {error && <div className="grid-empty erro">Erro ao carregar: {error}</div>}

            {!loading && !error && gruposComItens.map((g) => (
              <section key={g} id={`sec-${g}`} className="menu-section">
                <div className="section-title">{g}</div>
                <DishGrid pratos={pratos.filter((p) => p.grupo === g)} />
              </section>
            ))}
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
