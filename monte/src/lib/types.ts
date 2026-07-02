export interface Prato {
  id: string
  nome: string
  preco: number
  foto: string | null
  categoria: string // label de exibicao (ex.: "Massas")
  cor: string // cor da secao
  catOrdem: number // ordem para ordenar pratos e secoes
}

export interface CategoriaView {
  label: string
  icon: string
  cor: string
}
