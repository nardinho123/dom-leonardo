import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { catConfig } from '../lib/categorias'
import type { CategoriaView, Prato } from '../lib/types'

interface UseMenuResult {
  pratos: Prato[]
  categorias: CategoriaView[]
  loading: boolean
  error: string | null
}

export function useMenu(): UseMenuResult {
  const [pratos, setPratos] = useState<Prato[]>([])
  const [categorias, setCategorias] = useState<CategoriaView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      const { data, error } = await supabase
        .from('pratos')
        .select('id,nome,preco_base,preco_promocional,foto_url,ordem,ativo,categorias(nome,ordem)')
        .eq('ativo', true)

      if (!vivo) return
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }

      const iconePorLabel = new Map<string, string>()

      const norm: Prato[] = (data ?? [])
        .map((row: any): Prato | null => {
          const cat = Array.isArray(row.categorias) ? row.categorias[0] : row.categorias
          const cfg = catConfig(cat?.nome ?? '')
          if (!cfg) return null
          iconePorLabel.set(cfg.label, cfg.icon)
          const preco = Number(row.preco_promocional ?? row.preco_base ?? 0)
          return {
            id: String(row.id),
            nome: String(row.nome ?? ''),
            preco: Number.isFinite(preco) ? preco : 0,
            foto: row.foto_url ?? null,
            categoria: cfg.label,
            cor: cfg.cor,
            catOrdem: (Number(cat?.ordem ?? 99) * 1000) + Number(row.ordem ?? 0),
          }
        })
        .filter((p): p is Prato => p !== null)
        .sort((a, b) => a.catOrdem - b.catOrdem)

      // categorias distintas, na ordem de aparicao
      const cats: CategoriaView[] = []
      const vistos = new Set<string>()
      for (const p of norm) {
        if (!vistos.has(p.categoria)) {
          vistos.add(p.categoria)
          cats.push({ label: p.categoria, icon: iconePorLabel.get(p.categoria) ?? '🍽️', cor: p.cor })
        }
      }

      setPratos(norm)
      setCategorias(cats)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [])

  return { pratos, categorias, loading, error }
}
