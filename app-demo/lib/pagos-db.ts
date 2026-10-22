// Consulta y mapeo de un pago (compartido por las actions de Aprobación de
// pagos y del Consolidado). Archivo plano: no es una Server Action.

import { ETIQUETA_TIPO_CUENTA, documentoFormateado } from "@/lib/terceros"
import type { Pago } from "@/lib/pagos"

// Los embeds usan el nombre real de cada llave foránea cuando hay más de una
// hacia la misma tabla (perfiles).
export const CAMPOS_PAGO = `
  id, tipo, fuente, estado, valor, concepto, novedad, fecha_programada, anio, semana, item,
  solicitado_en, aprobado_en, motivo_rechazo, consolidado_id, tercero_id, cuenta_tercero_id,
  orden_compra_id, acta_id, requisicion_admin_item_id, numero_factura, valor_documento, base_gravable, iva,
  descuento_anticipos, retencion_garantia, otros_descuentos,
  orden:ordenes_compra(numero),
  req_admin:requisiciones_admin(numero),
  acta:actas(numero, valor_bruto, contrato:contratos(numero_contrato)),
  proyecto:proyectos(codigo, nombre),
  empresa:empresas(razon_social),
  tercero:terceros(razon_social, tipo_documento, numero_documento, dv),
  cuenta:terceros_cuentas(numero_cuenta, tipo_cuenta, estado, banco:bancos(nombre)),
  aprobador:perfiles!pagos_aprobado_por_fkey(nombre),
  rechazador:perfiles!pagos_rechazado_por_fkey(nombre),
  solicitante:perfiles!pagos_solicitado_por_fkey(nombre)
`

// Igual, pero con el join !inner al tercero (para filtrar por su nombre en la
// misma consulta, sin traer ids para mandarlos en un IN).
export const CAMPOS_PAGO_TERCERO_INNER = CAMPOS_PAGO.replace("tercero:terceros(", "tercero:terceros!inner(")

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export function mapPago(f: any): Pago {
  const t = f.tercero
  return {
    id: f.id,
    tipo: f.tipo,
    estado: f.estado,
    valor: Number(f.valor),
    concepto: f.concepto,
    novedad: f.novedad,
    fechaProgramada: f.fecha_programada,
    anio: f.anio,
    semana: f.semana,
    item: f.item,
    solicitadoEn: f.solicitado_en,
    aprobadoEn: f.aprobado_en,
    aprobadoPorNombre: f.aprobador?.nombre ?? null,
    rechazadoPorNombre: f.rechazador?.nombre ?? null,
    motivoRechazo: f.motivo_rechazo,
    ordenNumero: f.orden?.numero ?? null,
    ordenCompraId: f.orden_compra_id ?? null,
    actaId: f.acta_id ?? null,
    requisicionAdminItemId: f.requisicion_admin_item_id ?? null,
    // De dónde sale el pago: una orden de compra, un acta de contrato o una
    // requisición administrativa. Quien
    // no tiene pestañas de Contratos no lee el acta (RLS): entonces "Acta".
    origen: f.orden?.numero != null
      ? `OC ${f.orden.numero}`
      : f.acta
        ? `Acta ${f.acta.numero}${f.acta.contrato?.numero_contrato ? ` · ${f.acta.contrato.numero_contrato}` : ""}`
        : f.fuente === "requisicion_admin"
          ? `Req. administrativa${f.req_admin?.numero != null ? ` N° ${f.req_admin.numero}` : ""}`
          : f.fuente === "acta"
          ? "Acta"
          : "",
    // Valor bruto del acta (antes de descuentos); el pago es el neto. Null si
    // no es de acta o quien consulta no lee el acta (RLS).
    actaBruto: f.acta?.valor_bruto != null ? Number(f.acta.valor_bruto) : null,
    proyectoCodigo: f.proyecto?.codigo ?? null,
    proyectoNombre: f.proyecto?.nombre ?? null,
    empresaNombre: f.empresa?.razon_social ?? null,
    consolidadoId: f.consolidado_id,
    terceroId: f.tercero_id,
    terceroNombre: t?.razon_social ?? null,
    terceroDocumento: t
      ? `${t.tipo_documento} ${documentoFormateado({
          tipoDocumento: t.tipo_documento,
          numeroDocumento: t.numero_documento,
          dv: t.dv,
        })}`
      : null,
    cuentaId: f.cuenta_tercero_id,
    cuentaTexto: f.cuenta
      ? `${f.cuenta.banco?.nombre ?? ""} · ${ETIQUETA_TIPO_CUENTA[f.cuenta.tipo_cuenta as keyof typeof ETIQUETA_TIPO_CUENTA] ?? f.cuenta.tipo_cuenta} · ${f.cuenta.numero_cuenta}`
      : null,
    cuentaVerificada: f.cuenta?.estado === "ACTIVO",
    numeroFactura: f.numero_factura ?? null,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    valorDocumento: num(f.valor_documento),
    baseGravable: num(f.base_gravable),
    iva: num(f.iva),
    descuentoAnticipos: Number(f.descuento_anticipos ?? 0),
    retencionGarantia: Number(f.retencion_garantia ?? 0),
    otrosDescuentos: Number(f.otros_descuentos ?? 0),
  }
}
