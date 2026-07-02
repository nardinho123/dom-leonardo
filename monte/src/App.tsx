import { useEffect, useMemo, useState } from 'react'
import { useMenu } from './hooks/useMenu'
import { useCart, fmtBRL } from './store/cart'
import { CategoryRail } from './components/CategoryRail'
import { OrderPanel } from './components/OrderPanel'
import { Scene3D, type FrameData } from './components/Scene3D'

export default function App() {
  const { pratos, categorias, loading, error } = useMenu()
  const add = useCart((s) => s.add)
  const [ativo, setAtivo] = useState<string>('')
  const [focusedId, setFocusedId] = useState<string | null>(null)

  useEffect(() => {
    if (!ativo && categorias.length) setAtivo(categorias[0].label)
  }, [categorias, ativo])

  const pratosDoGrupo = useMemo(() => pratos.filter((p) => p.categoria === ativo), [pratos, ativo])

  // Layout das molduras: fila levemente curvada, de frente pra câmera.
  const frames: FrameData[] = useMemo(
    () =>
      pratosDoGrupo.map((pr, i, arr) => {
        const t = i - (arr.length - 1) / 2
        return {
          id: pr.id,
          url: pr.foto,
          position: [t * 1.5, 0, -Math.abs(t) * 0.55],
          rotation: [0, -t * 0.14, 0],
        }
      }),
    [pratosDoGrupo],
  )

  const focusedPrato = focusedId ? pratos.find((p) => p.id === focusedId) ?? null : null

  function selecionarCategoria(label: string) {
    setAtivo(label)
    setFocusedId(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="top-enter" type="button">👤 Entrar</button>
        <div className="top-center">
          <div className="brand">Monte do seu jeito</div>
          <div className="brand-sub">🍽 Toque um prato pra ver</div>
        </div>
        <button className="top-bell" type="button" aria-label="Notificações">🔔</button>
      </header>

      <div className="stage3d">
        <CategoryRail categorias={categorias} ativo={ativo} onSelect={selecionarCategoria} />

        <div className="canvas-wrap">
          {loading && <div className="loading3d">Carregando o cardápio…</div>}
          {error && <div className="loading3d erro">Erro: {error}</div>}
          {!loading && !error && <Scene3D frames={frames} focusedId={focusedId} onFocus={setFocusedId} />}
        </div>

        {focusedPrato && (
          <div className="focus-card">
            <div className="focus-info">
              <div className="focus-name">{focusedPrato.nome}</div>
              <div className="focus-price">{fmtBRL(focusedPrato.preco)}</div>
            </div>
            <button className="focus-add" type="button" onClick={() => add(focusedPrato)}>
              Adicionar +
            </button>
          </div>
        )}

        <OrderPanel />
      </div>
    </div>
  )
}
