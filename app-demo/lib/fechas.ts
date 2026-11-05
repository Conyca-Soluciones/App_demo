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

// Una marca de tiempo como "AAAA-MM-DD" en la zona dada. No usar
// toLocaleDateString("en-CA"): Safari lo da como "11/5/2026" y el campo de
// fecha quedaba vacío (formatToParts da las partes igual en todos).
export function fechaIsoEnZona(fecha: Date = new Date(), zona: string = ZONA_HORARIA): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? ""
  return `${p("year")}-${p("month")}-${p("day")}`
}

// Hoy en Colombia como "AAAA-MM-DD" (para <input type="date"> y para
// comparar con columnas `date`). Igual en el navegador y en el servidor
// (que corre en UTC).
export function hoyColombia(): string {
  return fechaIsoEnZona(new Date(), ZONA_HORARIA)
}

// "2026-10-20" - 3 días -> "2026-10-17", sin pasar por zona horaria (se
// calcula en UTC sobre la fecha sola).
export function sumarDiasFecha(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

// Marca de tiempo -> "05/10/2026, 3:04 p. m." en hora de Colombia (siempre
// dd/mm/aaaa; `dateStyle: "short"` daba "5/10/26").
export function formatearFechaHora(valor: string | null | undefined): string {
  if (!valor) return "—"
  const d = new Date(valor)
  return Number.isNaN(d.getTime())
    ? valor
    : d.toLocaleString("es-CO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: ZONA_HORARIA,
      })
}
