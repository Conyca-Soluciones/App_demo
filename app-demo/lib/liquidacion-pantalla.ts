// Tipos de la pantalla de Liquidación de pagos (compartidos por las actions y
// el componente; archivo plano, sin "use server").

export type FiltrosLiquidacion = {
  // aprobado = por liquidar; liquidado = ya liquidados (corregir o deshacer).
  estado: "aprobado" | "liquidado"
  consolidadoId?: string
  anios?: number[]
  semanas?: number[]
  tercero?: string
}
