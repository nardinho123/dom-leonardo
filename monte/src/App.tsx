import { useEffect, useMemo, useState } from 'react'
import { useMenu } from './hooks/useMenu'
import { useCart } from './store/cart'
import { CategoryRail } from './components/CategoryRail'
import { OrderPanel } from './components/OrderPanel'
import { Scene3D } from './components/Scene3D'

export default function App() {
  const { pratos, categorias, loading, error } = useMenu()
  const add = useCart((s) => s.add)
  const cartPratos = useCart((s) => s.itens.map((i) => i.prato))
  const [ativo, setAtivo] = useState<string>('')

  useEffect(() => {
    if (!ativo && categorias.length) setAtivo(categorias[0].label)
  }, [categorias, ativo])

  const pratosDoGrupo = useMemo(() => pratos.filter((p) => p.categoria === ativo), [pratos, ativo])

  return (
    <div className="app">
      <header className="topbar">
        <button className="top-enter" type="button">👤 Entrar</button>
        <div className="top-center">
          <div className="brand">Monte do seu jeito</div>
          <div className="brand-sub">🍽 Toque o prato pra montar</div>
        </div>
        <button className="top-bell" type="button" aria-label="Notificações">🔔</button>
      </header>

      <div className="stage3d">
        <CategoryRail categorias={categorias} ativo={ativo} onSelect={setAtivo} />

        <div className="canvas-wrap">
          {loading && <div className="loading3d">Carregando o cardápio…</div>}
          {error && <div className="loading3d erro">Erro: {error}</div>}
          {!loading && !error && <Scene3D pratos={pratosDoGrupo} cart={cartPratos} onAdd={add} />}
        </div>

        <OrderPanel />
      </div>
    </div>
  )
}
