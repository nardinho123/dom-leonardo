import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  console.warn('[monte] Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em .env.local')
}

export const supabase = createClient(url, key)
