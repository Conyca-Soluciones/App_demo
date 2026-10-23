// Titular de la cuenta distinto de quien factura (OC y actas, 20261214000000).
// El pago es de quien factura (proveedor o contratista); se consigna en la
// cuenta de este titular, inscrito en Terceros. La requisición administrativa
// tiene lo mismo dentro de su ítem.

export type TitularCuenta = {
  terceroId: string | null // null = falta elegirlo (la casilla está marcada)
  nombre: string
  documento: string
  cuentaId: string | null
  cuentaTexto: string
  cuentaVerificada: boolean
}

export const titularVacio = (): TitularCuenta => ({
  terceroId: null,
  nombre: "",
  documento: "",
  cuentaId: null,
  cuentaTexto: "",
  cuentaVerificada: false,
})

// null = la cuenta es del mismo que factura. Error si la casilla está marcada
// y falta el titular o su cuenta.
export function titularParaGuardar(
  t: TitularCuenta | null
): { ok: true; titular: { tercero_id: string; cuenta_id: string } | null } | { ok: false; error: string } {
  if (!t) return { ok: true, titular: null }
  if (!t.terceroId) return { ok: false, error: "Elige el titular de la cuenta (inscrito en Terceros) o quita la casilla." }
  if (!t.cuentaId) return { ok: false, error: "Elige la cuenta del titular." }
  return { ok: true, titular: { tercero_id: t.terceroId, cuenta_id: t.cuentaId } }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lo que devuelve titular_de_acta (null = sin titular aparte).
export function mapTitularCuenta(raw: any): TitularCuenta | null {
  if (!raw?.tercero_id) return null
  const tipo = raw.tipo_cuenta === "AHORROS" ? "Ahorros" : raw.tipo_cuenta === "CORRIENTE" ? "Corriente" : String(raw.tipo_cuenta ?? "")
  return {
    terceroId: String(raw.tercero_id),
    nombre: String(raw.razon_social ?? ""),
    documento: `${raw.tipo_documento ?? ""} ${raw.numero_documento ?? ""}${raw.dv ? `-${raw.dv}` : ""}`.trim(),
    cuentaId: raw.cuenta_id ? String(raw.cuenta_id) : null,
    cuentaTexto: raw.cuenta_id ? `${raw.banco ?? ""} · ${tipo} · ${raw.numero_cuenta ?? ""}` : "",
    cuentaVerificada: Boolean(raw.verificada),
  }
}
