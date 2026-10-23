// Método de pago de una orden de compra (20261219000000): Transferencia o PSE,
// como en las requisiciones administrativas.
// - Transferencia: la cuenta del proveedor sale de Terceros (la que verifica
//   Financiera). Con una se elige sola, con varias se escoge, sin ninguna no
//   se genera la orden por transferencia. O la cuenta de un titular aparte
//   (casilla "El titular de la cuenta es otro tercero").
// - PSE: sin cuenta. Observaciones para A&F y, si el titular no es el
//   proveedor, su nombre, tipo y número de documento.
// La base vuelve a validar todo (_fijar_pago_orden). Archivo plano: lo usan la
// pantalla y la action; pruebas en tests/metodo-pago-oc.test.ts.

import { TIPOS_DOCUMENTO_PSE } from "@/lib/requisiciones-admin"

export type MetodoPagoOC = "transferencia" | "pse"

export const ETIQUETA_METODO_PAGO_OC: Record<MetodoPagoOC, string> = {
  transferencia: "Transferencia",
  pse: "PSE",
}

// Cuentas no inactivas del proveedor en Terceros (cuentas_proveedor_oc).
export type CuentaProveedorOC = {
  id: string
  banco: string
  tipoCuenta: string
  numero: string // enmascarado: solo los 4 últimos
  verificada: boolean
}

export type CuentasProveedorOC = {
  terceroId: string | null // null = el proveedor no está en Terceros
  razonSocial: string | null
  cuentas: CuentaProveedorOC[]
}

export type PagoOCForm = {
  metodo: MetodoPagoOC
  cuentaId: string | null // transferencia a la cuenta del proveedor
  observaciones: string
  titularDistinto: boolean // PSE: el titular no es el proveedor
  titularNombre: string
  titularTipoDocumento: string
  titularDocumento: string
}

export const pagoOCVacio = (): PagoOCForm => ({
  metodo: "transferencia",
  cuentaId: null,
  observaciones: "",
  titularDistinto: false,
  titularNombre: "",
  titularTipoDocumento: "",
  titularDocumento: "",
})

export const textoCuentaProveedor = (c: Pick<CuentaProveedorOC, "banco" | "tipoCuenta" | "numero">) =>
  `${c.banco} · ${c.tipoCuenta === "AHORROS" ? "Ahorros" : c.tipoCuenta === "CORRIENTE" ? "Corriente" : c.tipoCuenta} · ${c.numero}`

// La cuenta del proveedor que se usaría: la elegida o, si tiene una sola, esa.
export function cuentaProveedorElegida(p: PagoOCForm, info: CuentasProveedorOC | null): CuentaProveedorOC | null {
  if (!info) return null
  if (p.cuentaId) return info.cuentas.find((c) => c.id === p.cuentaId) ?? null
  return info.cuentas.length === 1 ? info.cuentas[0] : null
}

// Primer error (null = completo). conTitularAparte = la casilla "El titular de
// la cuenta es otro tercero" está marcada (su cuenta se valida aparte).
export function validarPagoOC(
  p: PagoOCForm,
  info: CuentasProveedorOC | null,
  conTitularAparte: boolean
): string | null {
  if (p.metodo === "pse") {
    if (conTitularAparte) return "Con PSE no se elige la cuenta de otro tercero: quita la casilla del titular de la cuenta."
    if (p.titularDistinto) {
      if (!p.titularNombre.trim()) return "Escribe el titular del pago PSE."
      if (!(TIPOS_DOCUMENTO_PSE as readonly string[]).includes(p.titularTipoDocumento))
        return "Elige el tipo de documento del titular: CC, NIT, PPT o CE."
      if (!p.titularDocumento.replace(/\D/g, "")) return "Escribe el NIT o CC del titular."
    }
    return null
  }
  if (conTitularAparte) return null
  if (!info) return "Espera a que carguen las cuentas del proveedor."
  if (!info.terceroId)
    return "El proveedor no está inscrito en Terceros: pídele a A&F que lo inscriba con su cuenta, o paga por PSE."
  if (info.cuentas.length === 0)
    return "El proveedor no tiene cuenta bancaria en Terceros: pídele a A&F que la registre, o paga por PSE."
  if (!cuentaProveedorElegida(p, info)) return "Elige en cuál cuenta del proveedor se paga."
  return null
}

// Lo que se manda a crear_orden_compra_con_soporte (p_pago).
export function pagoOCParaGuardar(p: PagoOCForm, info: CuentasProveedorOC | null, conTitularAparte: boolean) {
  const observaciones = p.observaciones.trim()
  if (p.metodo === "pse") {
    return {
      metodo: "pse" as const,
      observaciones,
      titular_distinto: p.titularDistinto,
      ...(p.titularDistinto
        ? {
            titular_nombre: p.titularNombre.trim(),
            titular_tipo_documento: p.titularTipoDocumento,
            titular_documento: p.titularDocumento.replace(/\D/g, ""),
          }
        : {}),
    }
  }
  return {
    metodo: "transferencia" as const,
    observaciones,
    cuenta_id: conTitularAparte ? null : (cuentaProveedorElegida(p, info)?.id ?? null),
  }
}

// Cómo se muestra el titular de un pago PSE: el escrito o, si no hay, el proveedor.
export function textoTitularPse(
  titular: { nombre: string | null; tipoDocumento: string | null; documento: string | null } | null,
  proveedor: string | null
): string {
  if (titular?.nombre) return `${titular.nombre}${titular.documento ? ` (${titular.tipoDocumento ?? ""} ${titular.documento})` : ""}`
  return proveedor ? `${proveedor} (el proveedor)` : "El proveedor"
}
