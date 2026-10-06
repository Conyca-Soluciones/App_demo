// ---------------------------------------------------------------------------
// Fechas SIN hora (columnas `date` de la base: fecha_requerida, fecha_entrega,
// fecha_compra...). Vienen como "AAAA-MM-DD".
//
// `new Date("2026-10-05")` las interpreta como medianoche UTC; en Colombia
// (UTC-5) eso es el 4 de octubre a las 7 p. m., así que
// `toLocaleDateString` mostraba UN DÍA ANTES. Y
// `new Date().toISOString().slice(0, 10)` da el día en UTC: después de las
// 7 p. m. en Colombia ya es "mañana". Estas funciones evitan los dos errores.
// Sin dependencias de servidor: sirven en cliente y en server actions.
// ---------------------------------------------------------------------------

export const ZONA_HORARIA = "America/Bogota"

// "2026-10-05" -> "05/10/2026" sin pasar por zona horaria. Si llega una
// marca de tiempo completa, la muestra en la fecha local.
export function formatearFechaSinHora(valor: string | null | undefined): string {
  if (!valor) return "—"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim())
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(valor)
  return Number.isNaN(d.getTime())
    ? valor
    : d.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA_HORARIA })
}

// Hoy en Colombia como "AAAA-MM-DD" (para <input type="date"> y para
// comparar con columnas `date`). Igual en el navegador y en el servidor
// (que corre en UTC).
export function hoyColombia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA })
}

// "2026-10-20" - 3 días -> "2026-10-17", sin pasar por zona horaria (se
// calcula en UTC sobre la fecha sola).
export function sumarDiasFecha(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}
