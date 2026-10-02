// ---------------------------------------------------------------------------
// Tipos y reglas de Terceros (A&F, /ayf/terceros). Archivo plano (sin
// "use server"/"use client") para que lo compartan actions.ts y los
// componentes de cliente -- la validación corre en los dos lados.
// ---------------------------------------------------------------------------

import { calcularDvNit } from "@/lib/contratistas"

export const TIPOS_DOCUMENTO_TERCERO = ["CC", "NIT", "CE", "PPT", "PA", "TI", "RC"] as const
export type TipoDocumentoTercero = (typeof TIPOS_DOCUMENTO_TERCERO)[number]

export const TIPOS_CUENTA_TERCERO = ["AHORROS", "CORRIENTE"] as const
export type TipoCuentaTercero = (typeof TIPOS_CUENTA_TERCERO)[number]

export type EstadoCuentaTercero = "ACTIVO" | "PENDIENTE" | "INACTIVO"

export const ETIQUETA_ESTADO_CUENTA: Record<EstadoCuentaTercero, string> = {
  ACTIVO: "Verificada",
  PENDIENTE: "Pendiente de verificar",
  INACTIVO: "Inactiva",
}

// Colores de las etiquetas de estado (mismo tamaño que el resto de la app).
export const CLASE_ESTADO_CUENTA: Record<EstadoCuentaTercero, string> = {
  ACTIVO: "border-green-300 bg-green-50 text-green-700",
  PENDIENTE: "border-amber-300 bg-amber-50 text-amber-700",
  INACTIVO: "border-gray-300 bg-gray-50 text-gray-600",
}

// El archivo bancario no acepta más de 17 posiciones en el número de cuenta
// (Bogotá y Bancolombia): un número más largo no se puede pagar.
export const MAX_DIGITOS_CUENTA = 17
export const MIN_DIGITOS_CUENTA = 5

export type Banco = { id: string; nombre: string }

export type CuentaTercero = {
  id: string
  bancoId: string
  bancoNombre: string
  tipoCuenta: TipoCuentaTercero
  numeroCuenta: string
  etiqueta: string | null
  estado: EstadoCuentaTercero
  verificadaEn: string | null
  verificadaPor: string | null
  observaciones: string | null
}

export type Tercero = {
  id: string
  tipoDocumento: TipoDocumentoTercero
  numeroDocumento: string
  dv: string | null
  razonSocial: string
  nombreBanco: string | null
  nombres: string | null
  apellidos: string | null
  observaciones: string | null
  cuentas: CuentaTercero[]
}

export type FiltrosTerceros = {
  documento?: string
  nombre?: string
  bancoId?: string
  estadoCuenta?: EstadoCuentaTercero
}

// ------------------------------------------------------------ presentación

// "901097443" + "4" -> "901.097.443-4"; una cédula no lleva dígito.
export function documentoFormateado(t: Pick<Tercero, "tipoDocumento" | "numeroDocumento" | "dv">): string {
  const n = t.numeroDocumento.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return t.tipoDocumento === "NIT" && t.dv ? `${n}-${t.dv}` : n
}

// ---------------------------------------------------------- normalización

// Mayúsculas y sin espacios dobles (como la base de dispersores).
export const normalizarTexto = (v: string) => v.replace(/\s+/g, " ").trim().toUpperCase()

// Solo dígitos ("1.020.304" -> "1020304").
export const soloDigitos = (v: string) => v.replace(/\D/g, "")

// ------------------------------------------------------------- validación

export type DatosTercero = {
  tipoDocumento: string
  numeroDocumento: string
  dv: string
  razonSocial: string
  nombreBanco: string
  nombres: string
  apellidos: string
  observaciones: string
}

export type DatosTerceroValidados = {
  tipoDocumento: TipoDocumentoTercero
  numeroDocumento: string
  dv: string | null
  razonSocial: string
  nombreBanco: string | null
  nombres: string | null
  apellidos: string | null
  observaciones: string | null
}

export type Errores<T> = Partial<Record<keyof T, string>>

export function validarTercero(
  crudo: DatosTercero
): { ok: true; datos: DatosTerceroValidados } | { ok: false; errores: Errores<DatosTercero> } {
  const errores: Errores<DatosTercero> = {}

  const tipo = crudo.tipoDocumento.trim().toUpperCase() as TipoDocumentoTercero
  if (!TIPOS_DOCUMENTO_TERCERO.includes(tipo)) errores.tipoDocumento = "Escoge el tipo de documento."

  const numero = soloDigitos(crudo.numeroDocumento)
  if (!numero) errores.numeroDocumento = "Escribe el número de documento (solo números)."
  else if (numero.length > 15) errores.numeroDocumento = "El documento no puede tener más de 15 dígitos."

  let dv: string | null = null
  if (tipo === "NIT" && numero) {
    dv = soloDigitos(crudo.dv)
    if (!/^[0-9]$/.test(dv)) errores.dv = "Escribe el dígito de verificación del NIT."
    else if (Number(dv) !== calcularDvNit(numero)) {
      errores.dv = "El dígito de verificación no corresponde a este NIT. Revisa el NIT y el DV."
    }
  }

  const razonSocial = normalizarTexto(crudo.razonSocial)
  if (!razonSocial) errores.razonSocial = "Escribe el nombre o razón social."
  else if (razonSocial.length > 150) errores.razonSocial = "El nombre es demasiado largo (máximo 150)."

  const nombreBanco = normalizarTexto(crudo.nombreBanco)
  if (nombreBanco.length > 40) errores.nombreBanco = "El nombre para el banco admite máximo 40 caracteres."

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      tipoDocumento: tipo,
      numeroDocumento: numero,
      dv,
      razonSocial,
      nombreBanco: nombreBanco || null,
      nombres: normalizarTexto(crudo.nombres) || null,
      apellidos: normalizarTexto(crudo.apellidos) || null,
      observaciones: crudo.observaciones.trim() || null,
    },
  }
}

export type DatosCuenta = {
  bancoId: string
  tipoCuenta: string
  numeroCuenta: string
  etiqueta: string
  observaciones: string
}

export type DatosCuentaValidados = {
  bancoId: string
  tipoCuenta: TipoCuentaTercero
  numeroCuenta: string
  etiqueta: string | null
  observaciones: string | null
}

export function validarCuenta(
  crudo: DatosCuenta
): { ok: true; datos: DatosCuentaValidados } | { ok: false; errores: Errores<DatosCuenta> } {
  const errores: Errores<DatosCuenta> = {}

  if (!crudo.bancoId) errores.bancoId = "Escoge el banco."

  const tipo = crudo.tipoCuenta.trim().toUpperCase() as TipoCuentaTercero
  if (!TIPOS_CUENTA_TERCERO.includes(tipo)) errores.tipoCuenta = "Escoge el tipo de cuenta."

  const numero = soloDigitos(crudo.numeroCuenta)
  if (numero.length < MIN_DIGITOS_CUENTA || numero.length > MAX_DIGITOS_CUENTA) {
    errores.numeroCuenta = `El número de cuenta debe tener entre ${MIN_DIGITOS_CUENTA} y ${MAX_DIGITOS_CUENTA} dígitos.`
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      bancoId: crudo.bancoId,
      tipoCuenta: tipo,
      numeroCuenta: numero,
      etiqueta: normalizarTexto(crudo.etiqueta) || null,
      observaciones: crudo.observaciones.trim() || null,
    },
  }
}
