// Consulta y mapeo de un pago (compartido por las actions de Aprobación de
// pagos y del Consolidado). Archivo plano: no es una Server Action.

import { documentoFormateado } from "@/lib/terceros"
import type { Pago } from "@/lib/pagos"

// Los embeds usan el nombre real de cada llave foránea cuando hay más de una
// hacia la misma tabla (perfiles).
export const CAMPOS_PAGO = `
  id, tipo, estado, valor, concepto, novedad, fecha_programada, anio, semana, item,
  solicitado_en, aprobado_en, motivo_rechazo, consolidado_id, tercero_id, cuenta_tercero_id,
  orden:ordenes_compra(numero),
  proyecto:proyectos(codigo, nombre),
  empresa:empresas(razon_social),
  tercero:terceros(razon_social, tipo_documento, numero_documento, dv),
  cuenta:terceros_cuentas(numero_cuenta, estado, banco:bancos(nombre)),
  aprobador:perfiles!pagos_aprobado_por_fkey(nombre),
  rechazador:perfiles!pagos_rechazado_por_fkey(nombre)
`

// Igual, pero con el join !inner al tercero (para filtrar por su nombre en la
// misma consulta, sin traer ids para mandarlos en un IN).
export const CAMPOS_PAGO_TERCERO_INNER = CAMPOS_PAGO.replace("tercero:terceros(", "tercero:terceros!inner(")

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
    cuentaTexto: f.cuenta ? `${f.cuenta.banco?.nombre ?? ""} · ${f.cuenta.numero_cuenta}` : null,
    cuentaVerificada: f.cuenta?.estado === "ACTIVO",
  }
}
