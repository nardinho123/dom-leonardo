// Config de exibicao por categoria real do Supabase: label curto, icone e cor da secao.
export interface CatConfig {
  label: string
  icon: string
  cor: string
}

const MAP: Record<string, CatConfig> = {
  'mais pedidos': { label: 'Mais Pedidos', icon: '🔥', cor: '#ef5a3a' },
  'massas do dom': { label: 'Massas', icon: '🍝', cor: '#f0973c' },
  'risotos cremosos do dom': { label: 'Risotos', icon: '🍚', cor: '#e9c23f' },
  'monte seu nhoque': { label: 'Nhoque', icon: '🥟', cor: '#54c0af' },
  'dom recheou um pao italiano': { label: 'Pães', icon: '🥖', cor: '#c98f52' },
  'sobremesas italianas': { label: 'Sobremesas', icon: '🍰', cor: '#ec6fa6' },
  'bebidas': { label: 'Bebidas', icon: '🥤', cor: '#5aa0e0' },
}

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')

function normalizar(s: string): string {
  return (s || '').normalize('NFD').replace(DIACRITICOS, '').trim().toLowerCase()
}

export function catConfig(nome: string): CatConfig | null {
  return MAP[normalizar(nome)] ?? null
}
