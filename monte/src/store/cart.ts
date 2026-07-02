import { create } from 'zustand'
import type { Prato } from '../lib/types'

export interface ItemCarrinho {
  prato: Prato
  qtd: number
}

interface CartState {
  itens: ItemCarrinho[]
  add: (prato: Prato) => void
  dec: (id: string) => void
  remove: (id: string) => void
  clear: () => void
}

export const useCart = create<CartState>((set) => ({
  itens: [],
  add: (prato) =>
    set((s) => {
      const i = s.itens.findIndex((it) => it.prato.id === prato.id)
      if (i >= 0) {
        const itens = s.itens.slice()
        itens[i] = { ...itens[i], qtd: itens[i].qtd + 1 }
        return { itens }
      }
      return { itens: [...s.itens, { prato, qtd: 1 }] }
    }),
  dec: (id) =>
    set((s) => {
      const i = s.itens.findIndex((it) => it.prato.id === id)
      if (i < 0) return s
      const item = s.itens[i]
      const itens = s.itens.slice()
      if (item.qtd <= 1) itens.splice(i, 1)
      else itens[i] = { ...item, qtd: item.qtd - 1 }
      return { itens }
    }),
  remove: (id) => set((s) => ({ itens: s.itens.filter((it) => it.prato.id !== id) })),
  clear: () => set({ itens: [] }),
}))

export const selectSubtotal = (s: CartState) =>
  s.itens.reduce((acc, it) => acc + it.prato.preco * it.qtd, 0)

export const selectTotalItens = (s: CartState) =>
  s.itens.reduce((acc, it) => acc + it.qtd, 0)

export const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
