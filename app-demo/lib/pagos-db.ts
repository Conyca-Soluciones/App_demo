// Consulta y mapeo de un pago (compartido por las actions de Aprobación de
// pagos y del Consolidado). Archivo plano: no es una Server Action.

import { ETIQUETA_TIPO_CUENTA, documentoFormateado } from "@/lib/terceros"
import type { Pago } from "@/lib/pagos"

// Los embeds usan el nombre real de cada llave foránea cuando hay más de una
// hacia la misma tabla (perfiles; terceros: el que factura y el titular de la
// cuenta, 20261214000000).
export const CAMPOS_PAGO = `
  id, tipo, fuente, estado, valor, concepto, novedad, fecha_programada, anio, semana, item,
  solicitado_en, aprobado_en, motivo_rechazo, consolidado_id, tercero_id, cuenta_tercero_id, titular_tercero_id,
  orden_compra_id, acta_id, requisicion_admin_item_id, numero_factura, valor_documento, base_gravable, iva,
  descuento_anticipos, retencion_garantia, otros_descuentos,
  liquidacion_estado, liq_base, liq_iva, retefuente, reteiva, reteica, asumidas, liquidaciones,
  liq_anticipos_descuentos, valor_a_pagar, comentario:ultimo_comentario,
  requisicion_admin_id, requisicion_admin_principal, lote:lote_requisicion_admin,
  orden:ordenes_compra(numero, metodo_pago, pago_observaciones, pse_titular_nombre, pse_titular_tipo_documento, pse_titular_documento),
  acta:actas(numero, valor_bruto, contrato:contratos(numero_contrato)),
  req:requisiciones_admin!pagos_requisicion_admin_id_fkey(numero, metodo),
  req_item:requisicion_admin_items!pagos_requisicion_admin_item_id_fkey(titular_nombre, titular_tipo_documento, titular_documento),
  proyecto:proyectos(codigo, nombre),
  empresa:empresas(razon_social),
  tercero:terceros!pagos_tercero_id_fkey(razon_social, tipo_documento, numero_documento, dv),
  titular:terceros!pagos_titular_tercero_id_fkey(razon_social),
  cuenta:terceros_cuentas(numero_cuenta, tipo_cuenta, estado, banco:bancos(nombre)),
  aprobador:perfiles!pagos_aprobado_por_fkey(nombre),
  rechazador:perfiles!pagos_rechazado_por_fkey(nombre),
  solicitante:perfiles!pagos_solicitado_por_fkey(nombre)
`

// Igual, pero con el join !inner al tercero (para filtrar por su nombre en la
// misma consulta, sin traer ids para mandarlos en un IN).
export const CAMPOS_PAGO_TERCERO_INNER = CAMPOS_PAGO.replace("tercero:terceros!pagos_tercero_id_fkey(", "tercero:terceros!pagos_tercero_id_fkey!inner(")

const num = (v: unknown): number | null => (v == null ? null : Number(v))

export function mapPago(f: any): Pago {
  const t = f.tercero
  // Orden de compra pagada por PSE: sin cuenta; el titular, si no es el proveedor.
  const ocPse = f.orden?.metodo_pago === "pse"
  const pse = ocPse || f.req?.metodo === "pse"
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
    requisicionAdminId: f.requisicion_admin_id ?? null,
    requisicionAdminLote:
      f.requisicion_admin_principal && f.lote
        ? { items: Number(f.lote.items ?? 0), total: Number(f.lote.total ?? 0) }
        : null,
    // De dónde sale el pago: una orden de compra, un acta de contrato o una
    // requisición administrativa. Quien
    // no tiene pestañas de Contratos no lee el acta (RLS): entonces "Acta".
    origen: f.orden?.numero != null
      ? `OC ${f.orden.numero}${ocPse ? " · PSE" : ""}`
      : f.acta
        ? `Acta ${f.acta.numero}${f.acta.contrato?.numero_contrato ? ` · ${f.acta.contrato.numero_contrato}` : ""}`
        : f.fuente === "acta"
          ? "Acta"
          : f.fuente === "requisicion_admin"
            ? `Req. admin.${f.req?.numero != null ? ` N° ${f.req.numero}` : ""}${f.req?.metodo === "pse" ? " · PSE" : ""}`
            : "",
    // Valor bruto del acta (antes de descuentos); el pago es el neto. Null si
    // no es de acta o quien consulta no lee el acta (RLS).
    actaBruto: f.acta?.valor_bruto != null ? Number(f.acta.valor_bruto) : null,
    proyectoCodigo: f.proyecto?.codigo ?? null,
    proyectoNombre: f.proyecto?.nombre ?? null,
    empresaNombre: f.empresa?.razon_social ?? null,
    consolidadoId: f.consolidado_id,
    terceroId: f.tercero_id,
    // PSE (requisición administrativa): el titular escrito, sin tercero en la app.
    terceroNombre: t?.razon_social ?? f.req_item?.titular_nombre ?? null,
    terceroDocumento: t
      ? `${t.tipo_documento} ${documentoFormateado({
          tipoDocumento: t.tipo_documento,
          numeroDocumento: t.numero_documento,
          dv: t.dv,
        })}`
      : f.req_item
        ? `${f.req_item.titular_tipo_documento} ${f.req_item.titular_documento}`
        : null,
    cuentaId: f.cuenta_tercero_id,
    cuentaTexto: ocPse
      ? "PSE"
      : f.cuenta
      ? `${f.cuenta.banco?.nombre ?? ""} · ${ETIQUETA_TIPO_CUENTA[f.cuenta.tipo_cuenta as keyof typeof ETIQUETA_TIPO_CUENTA] ?? f.cuenta.tipo_cuenta} · ${f.cuenta.numero_cuenta}`
      : null,
    cuentaVerificada: ocPse || f.cuenta?.estado === "ACTIVO",
    cuentaTitular: ocPse
      ? f.orden.pse_titular_nombre
        ? `${f.orden.pse_titular_nombre} (${f.orden.pse_titular_tipo_documento ?? ""} ${f.orden.pse_titular_documento ?? ""})`.replace(" ( )", "")
        : null
      : f.titular_tercero_id
        ? (f.titular?.razon_social ?? "otro tercero")
        : null,
    metodoPago: pse ? "pse" : "transferencia",
    pagoObservaciones: f.orden?.pago_observaciones ?? null,
    numeroFactura: f.numero_factura ?? null,
    solicitadoPorNombre: f.solicitante?.nombre ?? null,
    valorDocumento: num(f.valor_documento),
    baseGravable: num(f.base_gravable),
    iva: num(f.iva),
    descuentoAnticipos: Number(f.descuento_anticipos ?? 0),
    retencionGarantia: Number(f.retencion_garantia ?? 0),
    otrosDescuentos: Number(f.otros_descuentos ?? 0),
    liquidacionEstado: f.liquidacion_estado ?? null,
    liqBase: num(f.liq_base),
    liqIva: num(f.liq_iva),
    retefuente: num(f.retefuente),
    reteiva: num(f.reteiva),
    reteica: num(f.reteica),
    asumidas: num(f.asumidas),
    liquidaciones: num(f.liquidaciones),
    liqAnticiposDescuentos: num(f.liq_anticipos_descuentos),
    valorAPagar: num(f.valor_a_pagar),
    ultimoComentario: f.comentario?.texto
      ? {
          texto: String(f.comentario.texto),
          tipo: f.comentario.tipo,
          autor: f.comentario.autor ?? null,
          creadoEn: f.comentario.creado_en,
          total: Number(f.comentario.total ?? 1),
        }
      : null,
  }
}
