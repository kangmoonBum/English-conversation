import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 상대 경로로 빌드해서 GitHub Pages 등 어떤 하위 경로에서도 동작하게 한다.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
})
