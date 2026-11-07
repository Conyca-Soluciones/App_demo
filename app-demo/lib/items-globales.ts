// ---------------------------------------------------------------------------
// Ítems globales del presupuesto (decisión del usuario, 2026-11-06).
//
// Un ítem hoja con unidad GL (GL, GLB, GLOBAL) que NO tiene bloque en la hoja
// APU es "global": su valor sale directo del Valor unitario del presupuesto
// oficial (columna del Excel), sin APU. Ej.: certificado RETIE, PMA, PMT,
// SST, compensación ambiental. Un ítem GL que SÍ tiene bloque APU sigue
// calculándose con su APU, como siempre.
//
// Archivo plano (pruebas en tests/items-globales.test.ts).
// ---------------------------------------------------------------------------

export function esUnidadGlobal(unidad: string | null | undefined): boolean {
  const u = String(unidad ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase()
  return u === "GL" || u === "GLB" || u === "GLOBAL"
}

type ItemImport = {
  id: string
  padreId: string | null
  codigo: string
  descripcion: string
  unidad: string | null
  cantidad?: number | null
  valorUnitario?: number | null
  valorTotal?: number | null
  precioOriginal: number | null
}

// Pone el valor a los ítems globales. Con hoja APU, un ítem global sin valor
// unitario es un error (si no, quedaría en $0 sin que nadie lo note); sin hoja
// APU se deja como antes.
export function aplicarItemsGlobales<T extends ItemImport>(
  items: T[],
  codigosConApu: Set<string>,
  tieneHojaApu: boolean
): { items: T[]; errores: string[] } {
  const conHijos = new Set<string>()
  for (const it of items) if (it.padreId) conHijos.add(it.padreId)

  const errores: string[] = []
  const resultado = items.map((it) => {
    if (conHijos.has(it.id) || !esUnidadGlobal(it.unidad) || codigosConApu.has(it.codigo)) return it
    if (it.precioOriginal == null || it.precioOriginal <= 0) {
      if (tieneHojaApu) {
        errores.push(
          `  "${it.codigo}" (${it.descripcion}): es un ítem global (unidad ${it.unidad}) sin bloque en la hoja APU y sin valor unitario.`
        )
      }
      return it
    }
    const valorUnitario = it.precioOriginal
    return {
      ...it,
      valorUnitario,
      valorTotal: it.cantidad != null ? it.cantidad * valorUnitario : null,
    }
  })
  return { items: resultado, errores }
}
