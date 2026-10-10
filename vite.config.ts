import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = resolve(__dirname, 'src/renderer')

export default defineConfig({
  root,
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { pet: resolve(root, 'index.html'), settings: resolve(root, 'settings.html'), notice: resolve(root, 'notice.html'), arena: resolve(root, 'arena.html') },
    },
  },
})
