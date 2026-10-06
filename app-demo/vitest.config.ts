import path from "node:path"
import { defineConfig } from "vitest/config"

// Pruebas de lógica pura (lib/): sin base de datos ni navegador.
// `npm test` las corre una vez; `npm run test:watch` las repite al guardar.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    // Las fechas "de hoy" se calculan en hora de Colombia: que las pruebas no
    // dependan de la zona horaria de la máquina que las corre.
    env: { TZ: "UTC" },
  },
})
