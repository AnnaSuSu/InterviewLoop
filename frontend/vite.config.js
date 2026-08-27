import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => {
  const apiTarget = process.env.TECHSPAR_API_TARGET || 'http://localhost:8000'

  return {
    // 仓库根目录的 .env 同时驱动后端与前端构建，省掉再维护一份 frontend/.env
    envDir: fileURLToPath(new URL('..', import.meta.url)),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': apiTarget,
        '/ws': {
          target: apiTarget,
          ws: true,
        },
      },
    },
  }
})
