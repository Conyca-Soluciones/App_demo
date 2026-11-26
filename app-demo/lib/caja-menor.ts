// ---------------------------------------------------------------------------
// Caja menor (procedimiento GF-PR-001 v2; 20270101007400_caja_menor.sql).
// Financiera crea la caja (responsable, monto, tercero y cuenta del reembolso).
// El responsable sube su LEGALIZACIÓN con todos los gastos y sus soportes:
// Financiera revisa -> Líder Financiera da el okay -> la app crea el cuadro de
// pago (reembolso al responsable) y Gerencia lo aprueba en Aprobación de pagos.
// Las reglas del procedimiento (70 %, tope) solo avisan; no hay recordatorio del 27.
//
// Archivo plano: tipos, validación, avisos y lectura del Excel (pruebas en
// tests/caja-menor.test.ts).
// ---------------------------------------------------------------------------

import { leerNumero } from "@/lib/contratos"

const formatoPesos = (n: number) => "$ " + n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

export const MAX_GASTOS_CAJA_MENOR = 200
// Procedimiento: legalizar cuando se haya gastado como máximo el 70 %.
export const PORCENTAJE_LEGALIZAR = 70

export type EstadoLegalizacion = "borrador" | "por_revisar" | "por_aprobar" | "en_gerencia" | "aprobada" | "devuelta" | "cancelada"

export const ETIQUETA_ESTADO_LEGALIZACION: Record<EstadoLegalizacion, string> = {
  borrador: "Borrador",
  por_revisar: "En Financiera",
  por_aprobar: "En Líder Financiera",
  en_gerencia: "En Gerencia",
  aprobada: "Aprobada",
  devuelta: "Devuelta",
  cancelada: "Cancelada",
}

export const CLASE_ESTADO_LEGALIZACION: Record<EstadoLegalizacion, string> = {
  borrador: "border-gray-300 bg-gray-50 text-gray-600",
  por_revisar: "border-amber-300 bg-amber-50 text-amber-700",
  por_aprobar: "border-amber-300 bg-amber-50 text-amber-700",
  en_gerencia: "border-blue-300 bg-blue-50 text-blue-700",
  aprobada: "border-green-300 bg-green-50 text-green-700",
  devuelta: "border-red-300 bg-red-50 text-red-700",
  cancelada: "border-gray-300 bg-gray-50 text-gray-500",
}

export const esEstadoLegalizacion = (v: unknown): v is EstadoLegalizacion =>
  typeof v === "string" && v in ETIQUETA_ESTADO_LEGALIZACION

// ---------------------------------------------------------------- caja
export type CajaMenor = {
  id: string
  numero: number
  estado: "abierta" | "cerrada"
  monto: number
  descripcion: string | null
  responsableId: string
  responsableNombre: string
  terceroId: string
  terceroNombre: string
  terceroDocumento: string
  cuentaId: string
  cuentaTexto: string
  cuentaVerificada: boolean
  empresaId: string
  empresaNombre: string
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string
  creadaEn: string
  creadaPorNombre: string | null
  cerradaEn: string | null
  motivoCierre: string | null
  ultimaLegalizacion: { id: string; codigo: string; estado: EstadoLegalizacion; enviadaEn: string; valorTotal: number } | null
  // Los gastos que el responsable lleva guardados sin enviar (solo se lo devuelve a él).
  borrador: { id: string; codigo: string; nGastos: number; valorTotal: number; actualizadoEn: string } | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapCajaMenor(c: any): CajaMenor {
  const u = c.ultima_legalizacion
  const b = c.borrador
  return {
    id: String(c.id),
    numero: Number(c.numero),
    estado: c.estado === "cerrada" ? "cerrada" : "abierta",
    monto: Number(c.monto ?? 0),
    descripcion: c.descripcion ?? null,
    responsableId: String(c.responsable_id),
    responsableNombre: String(c.responsable_nombre ?? ""),
    terceroId: String(c.tercero_id),
    terceroNombre: String(c.tercero_nombre ?? ""),
    terceroDocumento: String(c.tercero_documento ?? ""),
    cuentaId: String(c.cuenta_tercero_id),
    cuentaTexto: String(c.cuenta_texto ?? ""),
    cuentaVerificada: Boolean(c.cuenta_verificada),
    empresaId: String(c.empresa_id),
    empresaNombre: String(c.empresa_nombre ?? ""),
    proyectoId: String(c.proyecto_id),
    proyectoCodigo: c.proyecto_codigo ?? null,
    proyectoNombre: String(c.proyecto_nombre ?? ""),
    creadaEn: String(c.creada_en ?? ""),
    creadaPorNombre: c.creada_por_nombre ?? null,
    cerradaEn: c.cerrada_en ?? null,
    motivoCierre: c.motivo_cierre ?? null,
    ultimaLegalizacion: u
      ? {
          id: String(u.id),
          codigo: String(u.codigo),
          estado: esEstadoLegalizacion(u.estado) ? u.estado : "por_revisar",
          enviadaEn: String(u.enviada_en ?? ""),
          valorTotal: Number(u.valor_total ?? 0),
        }
      : null,
    borrador: b
      ? {
          id: String(b.id),
          codigo: String(b.codigo ?? ""),
          nGastos: Number(b.n_gastos ?? 0),
          valorTotal: Number(b.valor_total ?? 0),
          actualizadoEn: String(b.actualizado_en ?? ""),
        }
      : null,
  }
}

// Lo que devuelven las acciones que cambian algo (en producción Next.js esconde el
// mensaje de un error lanzado). `valorDe` lo vuelve a lanzar en el navegador.
export type ResultadoAccion<T> = { ok: true; valor: T } | { ok: false; error: string }
export function valorDe<T>(r: ResultadoAccion<T>): T {
  if (!r.ok) throw new Error(r.error)
  return r.valor
}

// Listas para crear una caja (opciones_caja_menor).
export type OpcionesCajaMenor = {
  personas: { id: string; nombre: string }[]
  empresas: { id: string; razonSocial: string }[]
  proyectos: { id: string; codigo: string | null; nombre: string; empresaId: string | null }[]
}

// Datos de la caja que llena Financiera.
export type CajaMenorForm = {
  responsableId: string
  terceroId: string | null
  terceroNombre: string
  cuentaId: string | null
  empresaId: string
  proyectoId: string
  monto: string
  descripcion: string
}

export function validarCajaMenor(c: CajaMenorForm): string | null {
  if (!c.responsableId) return "Elige el responsable de la caja."
  if (!c.terceroId) return "Elige el tercero a quien se reembolsa (tiene que estar en Terceros)."
  if (!c.cuentaId) return "Elige la cuenta del tercero."
  if (!c.empresaId) return "Elige el grupo empresarial."
  if (!c.proyectoId) return "Elige el proyecto o área de la caja."
  const monto = leerNumero(c.monto)
  if (monto == null || !Number.isFinite(monto) || monto <= 0) return "El monto de la caja debe ser mayor que cero."
  return null
}

export const cajaParaGuardar = (c: CajaMenorForm) => ({
  responsable_id: c.responsableId,
  tercero_id: c.terceroId,
  cuenta_tercero_id: c.cuentaId,
  empresa_id: c.empresaId,
  proyecto_id: c.proyectoId,
  monto: Math.round((leerNumero(c.monto) ?? 0) * 100) / 100,
  descripcion: c.descripcion.trim(),
})

// ---------------------------------------------------------------- gastos
export type SoporteGasto = { ruta: string; nombre: string; mime: string | null; tamano: number | null }

// Un gasto como se edita en pantalla.
export type GastoForm = {
  clave: string
  fecha: string // AAAA-MM-DD
  proyectoId: string
  numeroFactura: string
  documento: string // NIT o cédula
  nombre: string // nombre o razón social
  concepto: string
  destino: string
  valor: string // como se escribe ("150.000")
  soporte: SoporteGasto | null // ya subido
  archivoSoporte?: File | null // elegido, se sube al enviar
}

let contador = 0
export const nuevaClaveGasto = () => `gasto-${Date.now().toString(36)}-${(contador++).toString(36)}`

export function gastoVacio(proyectoId = ""): GastoForm {
  return {
    clave: nuevaClaveGasto(),
    fecha: "",
    proyectoId,
    numeroFactura: "",
    documento: "",
    nombre: "",
    concepto: "",
    destino: "",
    valor: "",
    soporte: null,
    archivoSoporte: null,
  }
}

// Como lo guarda la base: números y, si trae, "-DV".
export function limpiarDocumento(v: string): string {
  return v.replace(/[^0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "")
}

export const valorGasto = (g: Pick<GastoForm, "valor">): number | null => {
  const n = leerNumero(g.valor)
  return n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/

/** Fila sin nada escrito (la última fila en blanco del formulario): no se guarda. */
export const esGastoVacio = (g: GastoForm) =>
  !g.fecha && !g.numeroFactura.trim() && !g.documento.trim() && !g.nombre.trim() && !g.concepto.trim() &&
  !g.destino.trim() && !g.valor.trim() && !g.soporte && !g.archivoSoporte

/** Primer error del gasto (null = completo). Mismas reglas que _guardar_gastos_caja_menor. */
export function validarGasto(g: GastoForm, hoy: string): string | null {
  if (!FECHA_ISO.test(g.fecha)) return "Escribe la fecha."
  if (g.fecha > hoy) return "La fecha no puede ser futura."
  if (!g.proyectoId) return "Elige el proyecto."
  if (!g.numeroFactura.trim()) return "Escribe el número de la factura o recibo."
  if (!/^[0-9]+(-[0-9])?$/.test(limpiarDocumento(g.documento)))
    return "El NIT o cédula solo lleva números (y el dígito de verificación después de un guion)."
  if (!g.nombre.trim()) return "Escribe el nombre o razón social de quien vendió."
  if (!g.concepto.trim()) return "Escribe el concepto."
  if (!g.destino.trim()) return "Escribe el destino."
  const valor = valorGasto(g)
  if (valor == null || valor <= 0) return "El valor debe ser mayor que cero."
  if (!g.soporte && !g.archivoSoporte) return "Adjunta el soporte (factura, cuenta de cobro o recibo)."
  return null
}

export type ErrorGasto = { indice: number; mensaje: string }

export function validarLegalizacion(gastos: GastoForm[], hoy: string): ErrorGasto[] {
  if (gastos.length === 0) return [{ indice: -1, mensaje: "Agrega al menos un gasto." }]
  if (gastos.length > MAX_GASTOS_CAJA_MENOR)
    return [{ indice: -1, mensaje: `Una legalización tiene como máximo ${MAX_GASTOS_CAJA_MENOR} gastos.` }]
  const errores: ErrorGasto[] = []
  gastos.forEach((g, i) => {
    const e = validarGasto(g, hoy)
    if (e) errores.push({ indice: i, mensaje: e })
  })
  return errores
}

export const totalGastos = (gastos: Pick<GastoForm, "valor">[]) =>
  Math.round(gastos.reduce((s, g) => s + (valorGasto(g) ?? 0), 0) * 100) / 100

export function gastoParaGuardar(g: GastoForm) {
  return {
    fecha: g.fecha,
    proyecto_id: g.proyectoId,
    numero_factura: g.numeroFactura.trim(),
    documento: limpiarDocumento(g.documento),
    nombre: g.nombre.trim(),
    concepto: g.concepto.trim(),
    destino: g.destino.trim(),
    valor: valorGasto(g),
    soporte: g.soporte,
  }
}

// ---------------------------------------------------------------- avisos (no bloquean)
/** % que el total representa del monto de la caja (sin decimales). */
export const porcentajeDeCaja = (total: number, monto: number) => (monto > 0 ? Math.round((total / monto) * 100) : 0)

/**
 * Avisos del procedimiento para lo que se va a enviar. Ninguno bloquea
 * (decisión del usuario): gastos que pasan el monto de la caja o un gasto solo
 * más grande que la caja (el procedimiento no lo permite).
 */
export function avisosLegalizacion(valores: number[], monto: number): string[] {
  const avisos: string[] = []
  if (monto <= 0) return avisos
  const total = Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100
  if (total > monto) {
    avisos.push(
      `Los gastos suman el ${porcentajeDeCaja(total, monto)} % del monto de la caja. Revisa que no falte un reembolso anterior.`
    )
  }
  const grandes = valores.filter((v) => v > monto).length
  if (grandes > 0) {
    avisos.push(
      grandes === 1
        ? "Un gasto vale más que el monto de la caja: el procedimiento no permite gastos así por caja menor."
        : `${grandes} gastos valen más que el monto de la caja: el procedimiento no permite gastos así por caja menor.`
    )
  }
  return avisos
}

/** Texto informativo: cuánto de la caja se está legalizando. */
export const textoPorcentajeCaja = (total: number, monto: number) =>
  monto > 0
    ? `Estos gastos son el ${porcentajeDeCaja(total, monto)} % del monto de tu caja (${formatoPesos(monto)}). El procedimiento pide legalizar cuando se haya gastado como máximo el ${PORCENTAJE_LEGALIZAR} %.`
    : ""

// ---------------------------------------------------------------- legalización (lista y detalle)
export type LegalizacionFila = {
  id: string
  codigo: string
  estado: EstadoLegalizacion
  nGastos: number
  valorTotal: number
  cajaId: string
  cajaNumero: number
  cajaMonto: number
  responsableId: string
  responsableNombre: string
  proyectoCodigo: string | null
  proyectoNombre: string
  empresaNombre: string
  enviadaEn: string
  revisadaEn: string | null
  revisadaPorNombre: string | null
  aprobadaEn: string | null
  aprobadaPorNombre: string | null
  devueltaEn: string | null
  devueltaPorNombre: string | null
  motivoDevolucion: string | null
  canceladaEn: string | null
  motivoCancelacion: string | null
  requisicionAdminId: string | null
  cuadroNumero: number | null
  cuadroEstado: string | null
  cuadroCodigo: string | null
  esMia: boolean
}

export type GastoDetalle = {
  id: string
  orden: number
  fecha: string
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string
  solicitadoPorNombre: string | null
  numeroFactura: string
  documento: string
  nombre: string
  concepto: string
  destino: string
  valor: number
  soporte: SoporteGasto
  // Liquidación de Contabilidad (20270101007600); null = sin liquidar.
  liquidacion: LiquidacionGasto | null
}

export type LiquidacionGasto = {
  base: number | null
  iva: number | null
  retefuente: number
  reteiva: number
  reteica: number
  valorAPagar: number
  liquidadoEn: string | null
  liquidadoPorNombre: string | null
}

export type EventoLegalizacion = { evento: string; fecha: string; usuarioNombre: string | null; motivo: string | null }

export type LegalizacionDetalle = LegalizacionFila & {
  gastos: GastoDetalle[]
  eventos: EventoLegalizacion[]
  caja: CajaMenor | null
  // El pago del reembolso (cuando ya hay cuadro): Contabilidad liquida sus gastos.
  pago: { id: string; estado: string; liquidacionEstado: string | null; referencia: string | null } | null
}

export const ETIQUETA_EVENTO_LEGALIZACION: Record<string, string> = {
  enviada: "Enviada a Financiera",
  reenviada: "Corregida y enviada otra vez",
  revisada: "Financiera revisó los soportes",
  aprobada_lider: "Líder Financiera la aprobó (pasa a Gerencia)",
  aprobada_gerencia: "Gerencia aprobó el pago",
  liquidada: "Contabilidad liquidó todos los gastos (el pago queda liquidado)",
  devuelta: "Devuelta al responsable",
  cancelada: "Cancelada",
}

export function mapLegalizacionFila(r: any): LegalizacionFila {
  return {
    id: String(r.id),
    codigo: String(r.codigo ?? ""),
    estado: esEstadoLegalizacion(r.estado) ? r.estado : "por_revisar",
    nGastos: Number(r.n_gastos ?? 0),
    valorTotal: Number(r.valor_total ?? 0),
    cajaId: String(r.caja_id ?? ""),
    cajaNumero: Number(r.caja_numero ?? 0),
    cajaMonto: Number(r.caja_monto ?? 0),
    responsableId: String(r.responsable_id ?? ""),
    responsableNombre: String(r.responsable_nombre ?? ""),
    proyectoCodigo: r.proyecto_codigo ?? null,
    proyectoNombre: String(r.proyecto_nombre ?? ""),
    empresaNombre: String(r.empresa_nombre ?? ""),
    enviadaEn: String(r.enviada_en ?? ""),
    revisadaEn: r.revisada_en ?? null,
    revisadaPorNombre: r.revisada_por_nombre ?? null,
    aprobadaEn: r.aprobada_en ?? null,
    aprobadaPorNombre: r.aprobada_por_nombre ?? null,
    devueltaEn: r.devuelta_en ?? null,
    devueltaPorNombre: r.devuelta_por_nombre ?? null,
    motivoDevolucion: r.motivo_devolucion ?? null,
    canceladaEn: r.cancelada_en ?? null,
    motivoCancelacion: r.motivo_cancelacion ?? null,
    requisicionAdminId: r.requisicion_admin_id ?? null,
    cuadroNumero: r.cuadro_numero == null ? null : Number(r.cuadro_numero),
    cuadroEstado: r.cuadro_estado ?? null,
    cuadroCodigo: r.cuadro_codigo ?? null,
    esMia: Boolean(r.es_mia),
  }
}

export function mapLegalizacionDetalle(r: any): LegalizacionDetalle {
  return {
    ...mapLegalizacionFila(r),
    gastos: (Array.isArray(r.gastos) ? r.gastos : []).map((g: any) => ({
      id: String(g.id),
      orden: Number(g.orden),
      fecha: String(g.fecha ?? ""),
      proyectoId: String(g.proyecto_id ?? ""),
      proyectoCodigo: g.proyecto_codigo ?? null,
      proyectoNombre: String(g.proyecto_nombre ?? ""),
      solicitadoPorNombre: g.solicitado_por_nombre ?? null,
      numeroFactura: String(g.numero_factura ?? ""),
      documento: String(g.documento ?? ""),
      nombre: String(g.nombre ?? ""),
      concepto: String(g.concepto ?? ""),
      destino: String(g.destino ?? ""),
      valor: Number(g.valor ?? 0),
      soporte: {
        ruta: String(g.soporte?.ruta ?? ""),
        nombre: String(g.soporte?.nombre ?? ""),
        mime: g.soporte?.mime ?? null,
        tamano: g.soporte?.tamano == null ? null : Number(g.soporte.tamano),
      },
      liquidacion: g.liquidacion
        ? {
            base: g.liquidacion.base == null ? null : Number(g.liquidacion.base),
            iva: g.liquidacion.iva == null ? null : Number(g.liquidacion.iva),
            retefuente: Number(g.liquidacion.retefuente ?? 0),
            reteiva: Number(g.liquidacion.reteiva ?? 0),
            reteica: Number(g.liquidacion.reteica ?? 0),
            valorAPagar: Number(g.liquidacion.valor_a_pagar ?? 0),
            liquidadoEn: g.liquidacion.liquidado_en ?? null,
            liquidadoPorNombre: g.liquidacion.liquidado_por_nombre ?? null,
          }
        : null,
    })),
    eventos: (Array.isArray(r.eventos) ? r.eventos : []).map((e: any) => ({
      evento: String(e.evento),
      fecha: String(e.fecha ?? ""),
      usuarioNombre: e.usuario_nombre ?? null,
      motivo: e.motivo ?? null,
    })),
    caja: r.caja ? mapCajaMenor(r.caja) : null,
    pago: r.pago
      ? {
          id: String(r.pago.id),
          estado: String(r.pago.estado ?? ""),
          liquidacionEstado: r.pago.liquidacion_estado ?? null,
          referencia: r.pago.referencia ?? null,
        }
      : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** "Corregir y enviar otra vez": los gastos vuelven al formulario (conservan su soporte). */
export function gastoFormDesdeDetalle(g: GastoDetalle): GastoForm {
  return {
    clave: nuevaClaveGasto(),
    fecha: g.fecha,
    proyectoId: g.proyectoId,
    numeroFactura: g.numeroFactura,
    documento: g.documento,
    nombre: g.nombre,
    concepto: g.concepto,
    destino: g.destino,
    valor: String(g.valor).replace(".", ","),
    soporte: g.soporte,
    archivoSoporte: null,
  }
}

// ---------------------------------------------------------------- Excel (plantilla GF-F-016)
export const COLUMNAS_CAJA_MENOR = {
  fecha: "Fecha",
  proyecto: "Proyecto",
  factura: "Número de factura",
  documento: "NIT o cédula",
  nombre: "Nombre o razón social",
  concepto: "Concepto",
  destino: "Destino",
  valor: "Valor total pagado",
} as const

export type ClaveColumnaCajaMenor = keyof typeof COLUMNAS_CAJA_MENOR

export const ORDEN_COLUMNAS_CAJA_MENOR: { clave: ClaveColumnaCajaMenor; ancho: number }[] = [
  { clave: "fecha", ancho: 14 },
  { clave: "proyecto", ancho: 28 },
  { clave: "factura", ancho: 18 },
  { clave: "documento", ancho: 18 },
  { clave: "nombre", ancho: 32 },
  { clave: "concepto", ancho: 36 },
  { clave: "destino", ancho: 32 },
  { clave: "valor", ancho: 18 },
]

export type ProyectoCajaMenor = { id: string; codigo: string | null; nombre: string }

const normal = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")

const texto = (v: unknown) => (v == null ? "" : String(v).trim())

export const codigoListaProyectoCaja = (p: Pick<ProyectoCajaMenor, "codigo" | "nombre">) => p.codigo || p.nombre

const dos = (n: number) => String(n).padStart(2, "0")

/**
 * Fecha de una celda: Date (cellDates), número de serie de Excel o texto
 * dd/mm/aaaa (o AAAA-MM-DD). Devuelve AAAA-MM-DD o null.
 */
export function leerFechaCelda(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // XLSX entrega la fecha a medianoche UTC del día escrito.
    return `${v.getUTCFullYear()}-${dos(v.getUTCMonth() + 1)}-${dos(v.getUTCDate())}`
  }
  if (typeof v === "number" && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Serie de Excel (días desde 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
  }
  const t = texto(v)
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) {
    const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validaFecha(a, mes, d) ? `${a}-${dos(mes)}-${dos(d)}` : null
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return validaFecha(a, mes, d) ? t : null
  }
  return null
}

function validaFecha(a: number, m: number, d: number) {
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d
}

export type ErrorFilaCajaMenor = { fila: number; mensaje: string }

/**
 * Lee las filas del Excel (XLSX con `header: 1`). Busca la fila de encabezados
 * por "Fecha" y "Valor total pagado" y las columnas por nombre. Las filas
 * vacías se saltan; las demás tienen que venir completas. Los soportes se
 * adjuntan después en la pantalla.
 */
export function leerFilasCajaMenor(
  filas: unknown[][],
  proyectos: ProyectoCajaMenor[]
): { gastos: GastoForm[]; errores: ErrorFilaCajaMenor[] } {
  const iEncabezado = filas.findIndex(
    (f) =>
      (f ?? []).some((c) => normal(c) === normal(COLUMNAS_CAJA_MENOR.fecha)) &&
      (f ?? []).some((c) => normal(c) === normal(COLUMNAS_CAJA_MENOR.valor))
  )
  if (iEncabezado < 0) {
    throw new Error('No se encontraron las columnas "Fecha" y "Valor total pagado". Usa la plantilla descargada desde la app.')
  }
  const encabezado = filas[iEncabezado].map(normal)
  const claves = Object.keys(COLUMNAS_CAJA_MENOR) as ClaveColumnaCajaMenor[]
  const indices = Object.fromEntries(claves.map((k) => [k, encabezado.indexOf(normal(COLUMNAS_CAJA_MENOR[k]))])) as Record<
    ClaveColumnaCajaMenor,
    number
  >
  const faltan = claves.filter((k) => indices[k] < 0).map((k) => `"${COLUMNAS_CAJA_MENOR[k]}"`)
  if (faltan.length > 0) throw new Error(`Faltan las columnas ${faltan.join(", ")}. Usa la plantilla de la app.`)

  const proyectoPorCodigo = new Map<string, string>()
  for (const p of proyectos) {
    proyectoPorCodigo.set(normal(codigoListaProyectoCaja(p)), p.id)
    proyectoPorCodigo.set(normal(p.nombre), p.id)
  }
  const celda = (f: unknown[], k: ClaveColumnaCajaMenor) => f[indices[k]]

  const gastos: GastoForm[] = []
  const errores: ErrorFilaCajaMenor[] = []
  for (let i = iEncabezado + 1; i < filas.length; i++) {
    const f = filas[i] ?? []
    if (claves.every((k) => texto(celda(f, k)) === "")) continue
    const fila = i + 1
    const error = (mensaje: string) => errores.push({ fila, mensaje })

    const fecha = leerFechaCelda(celda(f, "fecha"))
    if (!fecha) {
      error("La fecha debe ser dd/mm/aaaa.")
      continue
    }
    const proyectoId = proyectoPorCodigo.get(normal(celda(f, "proyecto")))
    if (!proyectoId) {
      error("Elige el proyecto de la lista.")
      continue
    }
    const crudo = celda(f, "valor")
    const valor = typeof crudo === "number" ? crudo : leerNumero(texto(crudo))
    if (valor == null || !Number.isFinite(valor) || valor <= 0) {
      error("El valor debe ser un número mayor que cero.")
      continue
    }
    const documento = limpiarDocumento(texto(celda(f, "documento")))
    if (!/^[0-9]+(-[0-9])?$/.test(documento)) {
      error("El NIT o cédula solo lleva números (y el dígito de verificación después de un guion).")
      continue
    }
    const faltante = !texto(celda(f, "factura"))
      ? "el número de factura"
      : !texto(celda(f, "nombre"))
        ? "el nombre o razón social"
        : !texto(celda(f, "concepto"))
          ? "el concepto"
          : !texto(celda(f, "destino"))
            ? "el destino"
            : null
    if (faltante) {
      error(`Falta ${faltante}.`)
      continue
    }
    gastos.push({
      ...gastoVacio(proyectoId),
      fecha,
      numeroFactura: texto(celda(f, "factura")),
      documento,
      nombre: texto(celda(f, "nombre")),
      concepto: texto(celda(f, "concepto")),
      destino: texto(celda(f, "destino")),
      valor: String(Math.round(valor * 100) / 100).replace(".", ","),
    })
  }
  return { gastos, errores }
}

// ---------------------------------------------------------------- liquidación por gasto (Contabilidad)
// Contabilidad liquida cada gasto; cuando están todos, el pago del reembolso queda
// liquidado con la suma (liquidar_gastos_caja_menor, 20270101007600).
export const CAMPOS_LIQUIDACION_GASTO = [
  { clave: "base", titulo: "Base" },
  { clave: "iva", titulo: "IVA" },
  { clave: "retefuente", titulo: "Retefuente" },
  { clave: "reteiva", titulo: "ReteIVA" },
  { clave: "reteica", titulo: "ReteICA" },
  { clave: "valorAPagar", titulo: "Valor a pagar" },
] as const
export type ClaveLiquidacionGasto = (typeof CAMPOS_LIQUIDACION_GASTO)[number]["clave"]
export type FormLiquidacionGasto = Record<ClaveLiquidacionGasto, string>

const numTexto = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","))

export function formLiquidacionGasto(g: Pick<GastoDetalle, "liquidacion">): FormLiquidacionGasto {
  const l = g.liquidacion
  return {
    base: numTexto(l?.base),
    iva: numTexto(l?.iva),
    retefuente: numTexto(l?.retefuente),
    reteiva: numTexto(l?.reteiva),
    reteica: numTexto(l?.reteica),
    valorAPagar: numTexto(l?.valorAPagar),
  }
}

/** Lo que se manda a la base por gasto; error si un número no se entiende o pasa el valor del gasto. */
export function filaLiquidacionGasto(
  g: Pick<GastoDetalle, "id" | "orden" | "valor">,
  f: FormLiquidacionGasto,
  leer: (texto: string) => number | null = leerNumero
): { gasto_id: string; base: number | null; iva: number | null; retefuente: number | null; reteiva: number | null; reteica: number | null; valor_a_pagar: number | null } {
  const n: Partial<Record<ClaveLiquidacionGasto, number | null>> = {}
  for (const c of CAMPOS_LIQUIDACION_GASTO) {
    const t = f[c.clave].trim()
    if (!t) {
      n[c.clave] = null
      continue
    }
    const v = leer(t)
    if (v == null || !Number.isFinite(v) || v < 0) throw new Error(`Gasto ${g.orden}: "${c.titulo}" tiene que ser un número mayor o igual a cero.`)
    n[c.clave] = Math.round(v * 100) / 100
  }
  const algo = CAMPOS_LIQUIDACION_GASTO.some((c) => n[c.clave] != null)
  if (algo && n.valorAPagar == null) throw new Error(`Gasto ${g.orden}: escribe el valor a pagar (o usa «Sin retenciones»).`)
  if (n.valorAPagar != null && (n.valorAPagar <= 0 || n.valorAPagar > g.valor))
    throw new Error(`Gasto ${g.orden}: el valor a pagar debe ser mayor que cero y no más que el valor del gasto.`)
  return {
    gasto_id: g.id,
    base: n.base ?? null,
    iva: n.iva ?? null,
    retefuente: n.retefuente ?? null,
    reteiva: n.reteiva ?? null,
    reteica: n.reteica ?? null,
    valor_a_pagar: n.valorAPagar ?? null,
  }
}

/** "Sin retenciones": retenciones en 0 y valor a pagar = valor del gasto (base e IVA se conservan). */
export const sinRetencionesGasto = (g: Pick<GastoDetalle, "valor">, f: FormLiquidacionGasto): FormLiquidacionGasto => ({
  ...f,
  retefuente: "0",
  reteiva: "0",
  reteica: "0",
  valorAPagar: numTexto(g.valor),
})

/** Cuántos gastos van liquidados y la suma de lo que se paga (lo que quedará en el pago). */
export function resumenLiquidacionGastos(gastos: Pick<GastoDetalle, "liquidacion">[]) {
  const hechos = gastos.filter((g) => g.liquidacion != null)
  return {
    total: gastos.length,
    liquidados: hechos.length,
    valorAPagar: Math.round(hechos.reduce((s, g) => s + (g.liquidacion?.valorAPagar ?? 0), 0) * 100) / 100,
    retenciones:
      Math.round(
        hechos.reduce((s, g) => s + (g.liquidacion ? g.liquidacion.retefuente + g.liquidacion.reteiva + g.liquidacion.reteica : 0), 0) * 100
      ) / 100,
  }
}

export type ResultadoLiquidacionGastos = { gastos: number; liquidados: number; pagoLiquidado: boolean }

