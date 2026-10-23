// ---------------------------------------------------------------------------
// Requisiciones administrativas (A&F), formato GF-F-018 "Relación de pagos"
// (20261202000000_requisiciones_administrativas.sql). Las hace cualquier
// usuario; A&F las aprueba o rechaza completas en Aprobación de pagos y, al
// aprobarse, cada ítem es un pago aprobado en el consolidado.
//
// Transferencia: el tercero que factura y el titular de la cuenta están en
// Terceros (columnas B-J, L-N y observaciones). PSE: los datos se escriben y
// no lleva banco, tipo ni número de cuenta (H-J).
//
// Se aprueba en Aprobación de pagos como una orden de compra, el cuadro
// completo (20261203000000): cada ítem es un pago (una fila del consolidado),
// pero en Aprobación de pagos la requisición sale en una sola fila.
//
// Archivo plano: tipos, validación y mapeos (los usan las actions y los
// componentes; pruebas en tests/requisiciones-admin.test.ts).
// ---------------------------------------------------------------------------

import { leerNumero } from "@/lib/contratos"

export type MetodoReqAdmin = "transferencia" | "pse"
export type EstadoReqAdmin = "por_aprobar" | "aprobada" | "rechazada" | "cancelada"

export const MAX_ITEMS_REQ_ADMIN = 50

export const ETIQUETA_METODO_REQ_ADMIN: Record<MetodoReqAdmin, string> = {
  transferencia: "Transferencia",
  pse: "PSE",
}

export const ETIQUETA_ESTADO_REQ_ADMIN: Record<EstadoReqAdmin, string> = {
  por_aprobar: "Pagos por aprobar",
  aprobada: "Aprobada",
  rechazada: "Rechazada",
  cancelada: "Cancelada",
}

// Mismos colores que el resto de la app.
export const CLASE_ESTADO_REQ_ADMIN: Record<EstadoReqAdmin, string> = {
  por_aprobar: "border-amber-300 bg-amber-50 text-amber-700",
  aprobada: "border-green-300 bg-green-50 text-green-700",
  rechazada: "border-red-300 bg-red-50 text-red-700",
  cancelada: "border-gray-300 bg-gray-50 text-gray-500",
}

// Lista del formato (columna F) para PSE; en transferencia sale de Terceros.
export const TIPOS_DOCUMENTO_PSE = ["CC", "NIT", "PPT", "CE"] as const


// ---------------------------------------------------------------- opciones
export type EmpresaOpcion = { id: string; razonSocial: string; nit: string | null }
export type ProyectoOpcion = { id: string; codigo: string | null; nombre: string; empresaId: string | null }
export type OpcionesReqAdmin = { empresas: EmpresaOpcion[]; proyectos: ProyectoOpcion[] }

export const etiquetaProyecto = (p: Pick<ProyectoOpcion, "codigo" | "nombre">) =>
  p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre

export type CuentaReqAdmin = {
  id: string
  banco: string
  tipoCuenta: string
  numeroCuenta: string // enmascarado
  verificada: boolean
}

export const textoCuenta = (c: Pick<CuentaReqAdmin, "banco" | "tipoCuenta" | "numeroCuenta">) =>
  `${c.banco} · ${c.tipoCuenta === "AHORROS" ? "Ahorros" : c.tipoCuenta === "CORRIENTE" ? "Corriente" : c.tipoCuenta} · ${c.numeroCuenta}`

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapOpciones(raw: any): OpcionesReqAdmin {
  return {
    empresas: (Array.isArray(raw?.empresas) ? raw.empresas : []).map((e: any) => ({
      id: String(e.id),
      razonSocial: String(e.razon_social ?? ""),
      nit: e.nit ?? null,
    })),
    proyectos: (Array.isArray(raw?.proyectos) ? raw.proyectos : []).map((p: any) => ({
      id: String(p.id),
      codigo: p.codigo ?? null,
      nombre: String(p.nombre ?? ""),
      empresaId: p.empresa_id ?? null,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- ítem del formulario
// Un ítem como se edita en pantalla. En transferencia los datos del tercero
// que factura y del titular se muestran (vienen de Terceros) y la base los
// vuelve a tomar de ahí; en PSE se escriben.
// Soporte de un ítem (factura o cuenta de cobro), ya subido al bucket privado
// requisiciones_admin (<usuario>/<archivo>; 20261212000000). Opcional.
export type TipoSoporteReqAdmin = "factura" | "cuenta_cobro"
export const ETIQUETA_SOPORTE_REQ_ADMIN: Record<TipoSoporteReqAdmin, string> = {
  factura: "Factura",
  cuenta_cobro: "Cuenta de cobro",
}
export type SoporteReqAdmin = { ruta: string; nombre: string; mime: string | null; tamano: number | null; tipo: TipoSoporteReqAdmin }

export type ItemFormReqAdmin = {
  clave: string // llave de React
  empresaId: string // B
  terceroFacturaId: string | null // transferencia
  facturaNombre: string // C
  facturaNit: string // D
  titularTerceroId: string | null // transferencia; null = el mismo que factura
  titularNombre: string // E
  titularTipoDocumento: string // F
  titularDocumento: string // G
  cuentaId: string | null // H-J (transferencia)
  cuentaTexto: string
  cuentaVerificada: boolean
  concepto: string // L
  proyectoId: string // M
  valor: string // N, como se escribe ("1.250.000,50")
  observaciones: string
  soporte: SoporteReqAdmin | null // el ya subido
  // Archivo elegido que se sube al enviar (solo en el navegador: el formulario
  // lo quita antes de llamar al servidor).
  archivoSoporte?: File | null
  tipoSoporte: TipoSoporteReqAdmin
}

let contadorClaves = 0
export const nuevaClaveItem = () => `item-${Date.now().toString(36)}-${(contadorClaves++).toString(36)}`

export function itemVacio(): ItemFormReqAdmin {
  return {
    clave: nuevaClaveItem(),
    empresaId: "",
    terceroFacturaId: null,
    facturaNombre: "",
    facturaNit: "",
    titularTerceroId: null,
    titularNombre: "",
    titularTipoDocumento: "",
    titularDocumento: "",
    cuentaId: null,
    cuentaTexto: "",
    cuentaVerificada: false,
    concepto: "",
    proyectoId: "",
    valor: "",
    observaciones: "",
    soporte: null,
    archivoSoporte: null,
    tipoSoporte: "factura",
  }
}

// Al cambiar de método se conservan grupo, proyecto, concepto, valor y
// observaciones; los datos del tercero y la cuenta se vuelven a llenar.
export function itemParaMetodo(item: ItemFormReqAdmin): ItemFormReqAdmin {
  return {
    ...itemVacio(),
    clave: item.clave,
    empresaId: item.empresaId,
    concepto: item.concepto,
    proyectoId: item.proyectoId,
    valor: item.valor,
    observaciones: item.observaciones,
    soporte: item.soporte,
    archivoSoporte: item.archivoSoporte,
    tipoSoporte: item.tipoSoporte,
  }
}

const NIT_VALIDO = /^[0-9]+(-[0-9])?$/

// NIT como lo guarda la base: solo números y, si trae, "-DV" al final.
export function limpiarNit(v: string): string {
  return v.replace(/[^0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

export const valorItem = (item: Pick<ItemFormReqAdmin, "valor">): number | null => {
  const n = leerNumero(item.valor)
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100
}

// Primer error del ítem (null = completo). Mismas reglas que
// _guardar_requisicion_admin.
export function validarItemReqAdmin(item: ItemFormReqAdmin, metodo: MetodoReqAdmin): string | null {
  if (!item.empresaId) return "Elige el grupo empresarial."
  if (metodo === "transferencia") {
    if (!item.terceroFacturaId) return "Elige la empresa que factura (tiene que estar inscrita en Terceros)."
    if (!item.cuentaId) return "Elige la cuenta del titular (registrada en Terceros)."
  } else {
    if (!item.facturaNombre.trim()) return "Escribe la empresa que factura."
    if (!NIT_VALIDO.test(limpiarNit(item.facturaNit)))
      return "El NIT de la empresa que factura solo lleva números (y el dígito de verificación después de un guion)."
    if (!item.titularNombre.trim()) return "Escribe el titular de la cuenta."
    if (!(TIPOS_DOCUMENTO_PSE as readonly string[]).includes(item.titularTipoDocumento))
      return "Elige el tipo de documento del titular: CC, NIT, PPT o CE."
    if (!item.titularDocumento.replace(/\D/g, "")) return "Escribe el NIT o CC del titular."
  }
  if (!item.concepto.trim()) return "Escribe el concepto de la factura."
  if (!item.proyectoId) return "Elige el código de proyecto."
  const valor = valorItem(item)
  if (valor == null || valor <= 0) return "El valor debe ser mayor que cero."
  if (!item.soporte && !item.archivoSoporte) return "Adjunta el soporte (factura o cuenta de cobro)."
  return null
}

export type ErroresItems = { indice: number; mensaje: string }[]

export function validarRequisicionAdmin(items: ItemFormReqAdmin[], metodo: MetodoReqAdmin): ErroresItems {
  if (items.length === 0) return [{ indice: -1, mensaje: "Agrega al menos un ítem." }]
  if (items.length > MAX_ITEMS_REQ_ADMIN)
    return [{ indice: -1, mensaje: `Una requisición tiene como máximo ${MAX_ITEMS_REQ_ADMIN} ítems.` }]
  const errores: ErroresItems = []
  items.forEach((it, i) => {
    const e = validarItemReqAdmin(it, metodo)
    if (e) errores.push({ indice: i, mensaje: e })
  })
  return errores
}

export const totalItems = (items: Pick<ItemFormReqAdmin, "valor">[]) =>
  Math.round(items.reduce((s, it) => s + (valorItem(it) ?? 0), 0) * 100) / 100

// Lo que se manda a crear_requisicion_admin / modificar_requisicion_admin.
export function itemParaGuardar(item: ItemFormReqAdmin, metodo: MetodoReqAdmin) {
  const comun = {
    empresa_id: item.empresaId,
    proyecto_id: item.proyectoId,
    concepto: item.concepto.trim(),
    valor: valorItem(item),
    observaciones: item.observaciones.trim(),
    soporte: item.soporte
      ? { ruta: item.soporte.ruta, nombre: item.soporte.nombre, mime: item.soporte.mime, tamano: item.soporte.tamano, tipo: item.soporte.tipo }
      : null,
  }
  if (metodo === "transferencia") {
    return {
      ...comun,
      tercero_factura_id: item.terceroFacturaId,
      titular_tercero_id: item.titularTerceroId ?? item.terceroFacturaId,
      cuenta_tercero_id: item.cuentaId,
    }
  }
  return {
    ...comun,
    factura_nombre: item.facturaNombre.trim(),
    factura_nit: limpiarNit(item.facturaNit),
    titular_nombre: item.titularNombre.trim(),
    titular_tipo_documento: item.titularTipoDocumento,
    titular_documento: item.titularDocumento.replace(/\D/g, ""),
  }
}

// ---------------------------------------------------------------- lista y detalle
export type RequisicionAdminFila = {
  id: string
  numero: number | null
  metodo: MetodoReqAdmin
  estado: EstadoReqAdmin
  nItems: number
  valorTotal: number
  creadoPor: string
  creadoPorNombre: string | null
  creadoEn: string
  enviadaEn: string
  resueltaEn: string | null
  resueltaPorNombre: string | null
  motivoRechazo: string | null
  empresas: string | null
}

export type ItemReqAdmin = {
  id: string
  orden: number
  empresaId: string
  empresaNombre: string
  terceroFacturaId: string | null
  facturaNombre: string
  facturaNit: string
  titularTerceroId: string | null
  titularNombre: string
  titularTipoDocumento: string
  titularDocumento: string
  cuentaId: string | null
  banco: string | null
  tipoCuenta: string | null
  numeroCuenta: string | null
  cuentaVerificada: boolean
  concepto: string
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string
  valor: number
  observaciones: string | null
  soporte: SoporteReqAdmin | null
  // Del pago, cuando ya se aprobó.
  pagoItem: number | null
  pagoSemana: number | null
  pagoAnio: number | null
  pagoEstado: string | null
  pagoMotivoRechazo: string | null
}

export type RequisicionAdminDetalle = Omit<RequisicionAdminFila, "empresas"> & {
  esMia: boolean
  // Quien la hizo la modifica o la cancela mientras A&F no haya aprobado
  // ningún pago (lo calcula la base).
  editable: boolean
  motivoCancelacion: string | null
  items: ItemReqAdmin[]
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapFilaReqAdmin(r: any): RequisicionAdminFila {
  return {
    id: String(r.id),
    numero: r.numero == null ? null : Number(r.numero),
    metodo: r.metodo,
    estado: r.estado,
    nItems: Number(r.n_items ?? 0),
    valorTotal: Number(r.valor_total ?? 0),
    creadoPor: String(r.creado_por ?? ""),
    creadoPorNombre: r.creado_por_nombre ?? null,
    creadoEn: String(r.creado_en ?? ""),
    enviadaEn: String(r.enviada_en ?? r.creado_en ?? ""),
    resueltaEn: r.resuelta_en ?? null,
    resueltaPorNombre: r.resuelta_por_nombre ?? null,
    motivoRechazo: r.motivo_rechazo ?? null,
    empresas: r.empresas ?? null,
  }
}

export function mapDetalleReqAdmin(r: any): RequisicionAdminDetalle {
  const { empresas: _empresas, ...fila } = mapFilaReqAdmin(r)
  return {
    ...fila,
    esMia: Boolean(r.es_mia),
    editable: Boolean(r.editable),
    motivoCancelacion: r.motivo_cancelacion ?? null,
    items: (Array.isArray(r.items) ? r.items : []).map((i: any) => ({
      id: String(i.id),
      orden: Number(i.orden),
      empresaId: String(i.empresa_id),
      empresaNombre: String(i.empresa_nombre ?? ""),
      terceroFacturaId: i.tercero_factura_id ?? null,
      facturaNombre: String(i.factura_nombre ?? ""),
      facturaNit: String(i.factura_nit ?? ""),
      titularTerceroId: i.titular_tercero_id ?? null,
      titularNombre: String(i.titular_nombre ?? ""),
      titularTipoDocumento: String(i.titular_tipo_documento ?? ""),
      titularDocumento: String(i.titular_documento ?? ""),
      cuentaId: i.cuenta_tercero_id ?? null,
      banco: i.banco ?? null,
      tipoCuenta: i.tipo_cuenta ?? null,
      numeroCuenta: i.numero_cuenta ?? null,
      cuentaVerificada: Boolean(i.cuenta_verificada),
      concepto: String(i.concepto ?? ""),
      proyectoId: String(i.proyecto_id),
      proyectoCodigo: i.proyecto_codigo ?? null,
      proyectoNombre: String(i.proyecto_nombre ?? ""),
      valor: Number(i.valor ?? 0),
      observaciones: i.observaciones ?? null,
      soporte: i.soporte?.ruta
        ? {
            ruta: String(i.soporte.ruta),
            nombre: String(i.soporte.nombre ?? ""),
            mime: i.soporte.mime ?? null,
            tamano: i.soporte.tamano == null ? null : Number(i.soporte.tamano),
            tipo: i.soporte.tipo === "cuenta_cobro" ? "cuenta_cobro" : "factura",
          }
        : null,
      pagoItem: i.pago_item == null ? null : Number(i.pago_item),
      pagoSemana: i.pago_semana == null ? null : Number(i.pago_semana),
      pagoAnio: i.pago_anio == null ? null : Number(i.pago_anio),
      pagoEstado: i.pago_estado ?? null,
      pagoMotivoRechazo: i.pago_motivo_rechazo ?? null,
    })),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Para "Modificar" / "Corregir y enviar otra vez": el detalle vuelve al
// formulario.
export function itemFormDesdeDetalle(i: ItemReqAdmin): ItemFormReqAdmin {
  return {
    clave: nuevaClaveItem(),
    empresaId: i.empresaId,
    terceroFacturaId: i.terceroFacturaId,
    facturaNombre: i.facturaNombre,
    facturaNit: i.facturaNit,
    titularTerceroId: i.titularTerceroId && i.titularTerceroId !== i.terceroFacturaId ? i.titularTerceroId : null,
    titularNombre: i.titularNombre,
    titularTipoDocumento: i.titularTipoDocumento,
    titularDocumento: i.titularDocumento,
    cuentaId: i.cuentaId,
    cuentaTexto: i.banco && i.tipoCuenta && i.numeroCuenta ? textoCuenta({ banco: i.banco, tipoCuenta: i.tipoCuenta, numeroCuenta: i.numeroCuenta }) : "",
    cuentaVerificada: i.cuentaVerificada,
    concepto: i.concepto,
    proyectoId: i.proyectoId,
    valor: String(i.valor).replace(".", ","),
    observaciones: i.observaciones ?? "",
    soporte: i.soporte,
    archivoSoporte: null,
    tipoSoporte: i.soporte?.tipo ?? "factura",
  }
}
