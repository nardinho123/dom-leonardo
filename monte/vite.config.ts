import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App servido como estatico em /monte/ pelo mesmo nginx/EasyPanel.
export default defineConfig({
  base: '/monte/',
  plugins: [react()],
})
