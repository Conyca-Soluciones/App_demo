// Editar un insumo de la Maestra de insumos (decisiones del usuario, 2026-11-27).
// Edita quien tiene la acción aprobar_insumos; el código queda fijo; el precio es
// el valor unitario SIN IVA y cambiarlo no toca los APU (las líneas con precio
// congelado siguen igual; las que no lo tienen lo toman cuando su APU se
// recalcula). Mismas reglas que al aprobar un insumo nuevo: tipo del catálogo,
// unidad con el texto estándar, agrupación de las que existen, IVA 0/5/19 y un
// nombre que no repita otro del maestro.
//
// Lógica pura (la usan la ventana y otra vez la server action); pruebas en
// tests/editar-insumo.test.ts.

import { CATEGORIAS_APU } from "@/app/(app)/presupuestos/categorias-apu"
import { leerNumeroOFormula } from "@/lib/formula-numero"
import { unidadMaestro } from "@/lib/unidades"

export const TIPOS_INSUMO: readonly string[] = CATEGORIAS_APU.flatMap((c) => c.tipos as readonly string[])
const TIPOS_VALIDOS = new Set(TIPOS_INSUMO)
export const IVAS_INSUMO = [0, 5, 19] as const

// Precios que se usaron como relleno ($0 / $1): no son un precio real.
const PRECIO_MINIMO = 1

/** Lo que guarda el maestro de un insumo y se puede editar (el código no). */
export type CamposInsumo = {
  descripcion: string
  tipo: string | null
  u_m: string | null
  agrupacion: string | null
  vr_unitario: number | null
  iva_porcentaje: number | null
  excluye_iva: boolean | null
  iva_descontable: boolean | null
}

/** Lo que llega del formulario (el precio como texto, con formato colombiano o fórmula). */
export type FormularioInsumo = {
  descripcion: string
  tipo: string
  uM: string
  agrupacion: string
  vrUnitario: string
  ivaPorcentaje: string
  excluyeIva: boolean
  ivaDescontable: boolean
}

export type ResultadoValidacionInsumo =
  | { ok: true; valores: CamposInsumo }
  | { ok: false; errores: Partial<Record<keyof FormularioInsumo, string>> }

/** Nombre como queda en el maestro: sin espacios de más y en mayúsculas. */
export function normalizarNombreInsumo(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ").toUpperCase()
}

/** El formulario lleno con lo que tiene hoy el insumo. */
export function formularioDesdeInsumo(i: CamposInsumo): FormularioInsumo {
  return {
    descripcion: i.descripcion ?? "",
    tipo: i.tipo ?? "",
    uM: unidadMaestro(i.u_m) ?? i.u_m ?? "",
    agrupacion: i.agrupacion ?? "",
    vrUnitario: i.vr_unitario == null ? "" : String(i.vr_unitario).replace(".", ","),
    ivaPorcentaje: i.iva_porcentaje == null ? "19" : String(i.iva_porcentaje),
    excluyeIva: i.excluye_iva === true,
    ivaDescontable: i.iva_descontable === true,
  }
}

/**
 * Revisa el formulario. `agrupaciones`: las que ya usa el maestro (si se pasa,
 * la agrupación tiene que ser una de ellas).
 */
export function validarEdicionInsumo(
  f: FormularioInsumo,
  agrupaciones?: ReadonlySet<string>
): ResultadoValidacionInsumo {
  const errores: Partial<Record<keyof FormularioInsumo, string>> = {}

  const descripcion = normalizarNombreInsumo(f.descripcion ?? "")
  if (!descripcion) errores.descripcion = "Escribe el nombre del insumo."
  else if (descripcion.length > 300) errores.descripcion = "El nombre no puede pasar de 300 caracteres."

  const tipo = (f.tipo ?? "").trim()
  if (!TIPOS_VALIDOS.has(tipo)) errores.tipo = "Elige el tipo de la lista."

  const uM = unidadMaestro(f.uM)
  if (!uM) errores.uM = "Elige la unidad de la lista."

  const agrupacion = (f.agrupacion ?? "").trim()
  if (!agrupacion) errores.agrupacion = "Elige la agrupación."
  else if (agrupaciones && !agrupaciones.has(agrupacion)) errores.agrupacion = "Elige una agrupación de la lista."

  const precio = leerNumeroOFormula(f.vrUnitario ?? "")
  if (precio == null) errores.vrUnitario = "Escribe el valor unitario (sin IVA)."
  else if (precio <= PRECIO_MINIMO) errores.vrUnitario = "El valor unitario tiene que ser un precio real (más de $ 1)."

  const iva = Number(f.ivaPorcentaje)
  if (!(IVAS_INSUMO as readonly number[]).includes(iva)) errores.ivaPorcentaje = "El IVA tiene que ser 0, 5 o 19 %."

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    valores: {
      descripcion,
      tipo,
      u_m: uM,
      agrupacion,
      vr_unitario: Math.round((precio as number) * 100) / 100,
      iva_porcentaje: iva,
      excluye_iva: f.excluyeIva === true,
      iva_descontable: f.ivaDescontable === true,
    },
  }
}

/** Valor con IVA, igual que el disparador maestro_insumos_vr_neto (la base lo recalcula). */
export function vrNetoInsumo(vrUnitario: number | null, iva: number | null, excluyeIva: boolean | null): number | null {
  if (vrUnitario == null) return null
  if (excluyeIva || !iva) return vrUnitario
  return Math.round(vrUnitario * (1 + iva / 100) * 100) / 100
}

const CAMPOS: (keyof CamposInsumo)[] = [
  "descripcion",
  "tipo",
  "u_m",
  "agrupacion",
  "vr_unitario",
  "iva_porcentaje",
  "excluye_iva",
  "iva_descontable",
]

// Para comparar: null y false son lo mismo en las casillas; números como número.
function normal(campo: keyof CamposInsumo, v: unknown): unknown {
  if (campo === "excluye_iva" || campo === "iva_descontable") return v === true
  if (campo === "vr_unitario" || campo === "iva_porcentaje") return v == null ? null : Number(v)
  return v ?? null
}

/** Solo los campos que cambiaron (lo que se manda en el UPDATE). Vacío = nada que guardar. */
export function cambiosInsumo(antes: CamposInsumo, despues: CamposInsumo): Partial<CamposInsumo> {
  const cambios: Partial<CamposInsumo> = {}
  for (const c of CAMPOS) {
    if (normal(c, antes[c]) !== normal(c, despues[c])) (cambios as Record<string, unknown>)[c] = despues[c]
  }
  return cambios
}
