import { useEffect, useState } from 'react'
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
import type { Prato } from './lib/types'

export default function App() {
  const { pratos, categorias, loading, error } = useMenu()
  const add = useCart((s) => s.add)
  const [ativo, setAtivo] = useState<string>('')
  const [arrastando, setArrastando] = useState<Prato | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    if (!ativo && categorias.length) setAtivo(categorias[0].label)
  }, [categorias, ativo])

  function irPara(label: string) {
    setAtivo(label)
    document.getElementById(`sec-${label}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function onDragStart(e: DragStartEvent) {
    setArrastando((e.active.data.current?.prato as Prato) ?? null)
  }
  function onDragEnd(e: DragEndEvent) {
    setArrastando(null)
    if (e.over?.id === 'tray') {
      const p = e.active.data.current?.prato as Prato | undefined
      if (p) add(p)
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

        <div className="wrap">
          <div className="scene">
            <div className="tray-wrap">
              <CategoryRail categorias={categorias} ativo={ativo} onSelect={irPara} />
              <Tray />
            </div>
            <OrderPanel />
          </div>

          <div className="menu">
            {loading && <div className="grid-empty">Carregando o cardápio…</div>}
            {error && <div className="grid-empty erro">Erro ao carregar: {error}</div>}
            {!loading && !error && categorias.map((c) => (
              <section key={c.label} id={`sec-${c.label}`} className="menu-section">
                <div className="section-title" style={{ color: c.cor }}>{c.label}</div>
                <DishGrid pratos={pratos.filter((p) => p.categoria === c.label)} />
              </section>
            ))}
          </div>
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
