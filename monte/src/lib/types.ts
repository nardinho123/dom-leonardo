export type Grupo = 'Principais' | 'Acompanhamentos' | 'Bebidas' | 'Sobremesas'

export const ORDEM_GRUPOS: Grupo[] = ['Principais', 'Acompanhamentos', 'Bebidas', 'Sobremesas']

export interface Prato {
  id: string
  nome: string
  preco: number
  foto: string | null
  grupo: Grupo
  categoriaNome: string
  ordem: number
}
