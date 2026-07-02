import { useMenu } from './hooks/useMenu'

// Task 2: render temporario so pra validar que o menu real carrega e agrupa.
export default function App() {
  const { pratos, gruposComItens, loading, error } = useMenu()

  return (
    <div className="scaffold-check">
      <h1>Monte do seu jeito</h1>
      {loading && <p>Carregando menu…</p>}
      {error && <p style={{ color: 'salmon' }}>Erro: {error}</p>}
      {!loading && !error && (
        <>
          <p>{pratos.length} pratos · grupos: {gruposComItens.join(' · ')}</p>
          <ul style={{ listStyle: 'none', marginTop: 12, display: 'grid', gap: 4 }}>
            {pratos.map((p) => (
              <li key={p.id}>
                <b style={{ color: 'var(--gold)' }}>[{p.grupo}]</b> {p.nome} — R$ {p.preco.toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
