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

// Cómo se muestra el tipo de cuenta (igual en Contratistas y en Terceros).
export const ETIQUETA_TIPO_CUENTA: Record<TipoCuentaTercero, string> = {
  CORRIENTE: "CUENTA CORRIENTE",
  AHORROS: "CUENTA AHORROS",
}

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

// Lo básico de un tercero (crear_tercero y tercero_por_documento,
// 20261221000000): quien lo crea o lo busca desde otra pantalla (Contratistas,
// Proveedores...) no lee la tabla Terceros.
export type TerceroBasico = {
  id: string
  razonSocial: string
  tipoDocumento: string
  numeroDocumento: string
  dv: string | null
  // Contacto del tercero (20270101004300): contratistas y proveedores lo toman de aquí.
  contacto?: ContactoTercero
}

// Correo, teléfono, dirección (calle y número) y ciudad: viven en el tercero.
export type ContactoTercero = { correo: string; telefono: string; direccion: string; ciudad: string }
export const CONTACTO_VACIO: ContactoTercero = { correo: "", telefono: "", direccion: "", ciudad: "" }

export type Tercero = {
  id: string
  tipoDocumento: TipoDocumentoTercero
  numeroDocumento: string
  dv: string | null
  razonSocial: string
  // Casillas del nombre de una persona (20270101004300); null en terceros viejos.
  primerNombre: string | null
  segundoNombre: string | null
  primerApellido: string | null
  segundoApellido: string | null
  nombres: string | null
  apellidos: string | null
  contacto: ContactoTercero
  observaciones: string | null
  // Nombre del archivo del RUT (20270101000300); null = no lo tiene.
  rutNombre: string | null
  cuentas: CuentaTercero[]
}

// Una fila de "Cuentas por verificar" (20261231200000): la cuenta PENDIENTE con
// su tercero, quién la creó, su certificación (la de la cuenta o, si no tiene,
// la del contratista del tercero) y cuántos pagos la esperan.
export type CuentaPorVerificar = {
  cuentaId: string
  terceroId: string
  razonSocial: string
  tipoDocumento: TipoDocumentoTercero
  numeroDocumento: string
  dv: string | null
  banco: string
  tipoCuenta: TipoCuentaTercero
  numeroCuenta: string
  etiqueta: string | null
  observaciones: string | null
  creadoEn: string | null
  creadoPor: string | null
  certificacion: { origen: "cuenta" | "contratista"; nombre: string; mime: string } | null
  pagos: number
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

// Persona (no NIT): primer nombre y primer apellido obligatorios; la razón social
// la arma la base (apellidos + nombres) y el nombre para el banco (nombres +
// apellidos). NIT: razón social. El contacto es obligatorio al crear.
export type DatosTercero = {
  tipoDocumento: string
  numeroDocumento: string
  dv: string
  razonSocial: string
  primerNombre: string
  segundoNombre: string
  primerApellido: string
  segundoApellido: string
  correo: string
  telefono: string
  direccion: string
  ciudad: string
  observaciones: string
}

export type DatosTerceroValidados = {
  tipoDocumento: TipoDocumentoTercero
  numeroDocumento: string
  dv: string | null
  razonSocial: string
  primerNombre: string | null
  segundoNombre: string | null
  primerApellido: string | null
  segundoApellido: string | null
  contacto: ContactoTercero
  observaciones: string | null
}

export type Errores<T> = Partial<Record<keyof T, string>>

// Correo, teléfono (7 a 15 números), dirección y ciudad (la base valida igual).
export function validarContacto(c: ContactoTercero): { ok: true; datos: ContactoTercero } | { ok: false; errores: Errores<ContactoTercero> } {
  const errores: Errores<ContactoTercero> = {}
  const correo = c.correo.trim().toLowerCase()
  const telefono = c.telefono.replace(/[\s\-().]/g, "")
  const direccion = c.direccion.replace(/\s+/g, " ").trim()
  const ciudad = normalizarTexto(c.ciudad)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) errores.correo = "Escribe un correo válido."
  if (!/^\+?[0-9]{7,15}$/.test(telefono)) errores.telefono = "Escribe un teléfono de 7 a 15 números."
  if (!direccion) errores.direccion = "Escribe la dirección (calle y número)."
  else if (direccion.length > 200) errores.direccion = "La dirección es demasiado larga (máximo 200)."
  if (!ciudad) errores.ciudad = "Escribe la ciudad."
  else if (ciudad.length > 100) errores.ciudad = "La ciudad es demasiado larga (máximo 100)."
  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return { ok: true, datos: { correo, telefono, direccion, ciudad } }
}

// Razón social de una persona como la arma la base: apellidos + nombres.
export function razonSocialPersona(d: Pick<DatosTercero, "primerNombre" | "segundoNombre" | "primerApellido" | "segundoApellido">): string {
  return normalizarTexto([d.primerApellido, d.segundoApellido, d.primerNombre, d.segundoNombre].join(" "))
}

// Casillas a partir de "nombres" y "apellidos" de un tercero viejo (para editarlo):
// la primera palabra y el resto.
export function partirNombre(texto: string | null): [string, string] {
  const p = (texto ?? "").trim().split(/\s+/).filter(Boolean)
  return [p[0] ?? "", p.slice(1).join(" ")]
}

export function validarTercero(
  crudo: DatosTercero,
  opciones: { contacto?: boolean } = {}
): { ok: true; datos: DatosTerceroValidados } | { ok: false; errores: Errores<DatosTercero> } {
  const exigirContacto = opciones.contacto ?? true
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

  const persona = tipo !== "NIT"
  const primerNombre = normalizarTexto(crudo.primerNombre)
  const primerApellido = normalizarTexto(crudo.primerApellido)
  let razonSocial = normalizarTexto(crudo.razonSocial)
  if (persona) {
    if (!primerNombre) errores.primerNombre = "Escribe el primer nombre."
    if (!primerApellido) errores.primerApellido = "Escribe el primer apellido."
    razonSocial = razonSocialPersona(crudo)
  } else if (!razonSocial) {
    errores.razonSocial = "Escribe la razón social."
  }
  if (razonSocial.length > 150) errores[persona ? "primerNombre" : "razonSocial"] = "El nombre es demasiado largo (máximo 150)."

  let contacto: ContactoTercero = {
    correo: crudo.correo.trim().toLowerCase(),
    telefono: crudo.telefono.trim(),
    direccion: crudo.direccion.trim(),
    ciudad: normalizarTexto(crudo.ciudad),
  }
  if (exigirContacto) {
    const vc = validarContacto(crudo)
    if (!vc.ok) Object.assign(errores, vc.errores)
    else contacto = vc.datos
  }

  if (Object.keys(errores).length > 0) return { ok: false, errores }
  return {
    ok: true,
    datos: {
      tipoDocumento: tipo,
      numeroDocumento: numero,
      dv,
      razonSocial,
      primerNombre: persona ? primerNombre || null : null,
      segundoNombre: persona ? normalizarTexto(crudo.segundoNombre) || null : null,
      primerApellido: persona ? primerApellido || null : null,
      segundoApellido: persona ? normalizarTexto(crudo.segundoApellido) || null : null,
      contacto,
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
