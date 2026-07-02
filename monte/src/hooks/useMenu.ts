import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { mapCategoria } from '../lib/categoryMap'
import { ORDEM_GRUPOS, type Grupo, type Prato } from '../lib/types'

interface UseMenuResult {
  pratos: Prato[]
  gruposComItens: Grupo[]
  loading: boolean
  error: string | null
}

export function useMenu(): UseMenuResult {
  const [pratos, setPratos] = useState<Prato[]>([])
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

      const norm: Prato[] = (data ?? [])
        .map((row: any): Prato | null => {
          const cat = Array.isArray(row.categorias) ? row.categorias[0] : row.categorias
          const categoriaNome: string = cat?.nome ?? ''
          const grupo = mapCategoria(categoriaNome)
          if (!grupo) return null
          const preco = Number(row.preco_promocional ?? row.preco_base ?? 0)
          return {
            id: String(row.id),
            nome: String(row.nome ?? ''),
            preco: Number.isFinite(preco) ? preco : 0,
            foto: row.foto_url ?? null,
            grupo,
            categoriaNome,
            ordem: (Number(cat?.ordem ?? 99) * 1000) + Number(row.ordem ?? 0),
          }
        })
        .filter((p): p is Prato => p !== null)
        .sort((a, b) => a.ordem - b.ordem)

      setPratos(norm)
      setLoading(false)
    })()
    return () => { vivo = false }
  }, [])

  const gruposComItens = ORDEM_GRUPOS.filter((g) => pratos.some((p) => p.grupo === g))

  return { pratos, gruposComItens, loading, error }
}
