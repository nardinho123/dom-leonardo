import type { Grupo } from './types'

// Mapeia o nome da categoria real do Supabase -> grupo de exibicao da tela.
// Categorias sem entrada aqui sao ignoradas (ex.: "Test leo").
const MAP: Record<string, Grupo> = {
  'mais pedidos': 'Principais',
  'risotos cremosos do dom': 'Principais',
  'massas do dom': 'Principais',
  'monte seu nhoque': 'Principais',
  'dom recheou um pao italiano': 'Principais',
  'bebidas': 'Bebidas',
  'sobremesas italianas': 'Sobremesas',
}

// Remove acentos (faixa de diacriticos combinantes U+0300..U+036F).
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')

function normalizar(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .trim()
    .toLowerCase()
}

export function mapCategoria(nome: string): Grupo | null {
  return MAP[normalizar(nome)] ?? null
}
