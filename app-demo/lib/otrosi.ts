import { CONTRATANTE_POR_DEFECTO, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR, type TipoDocumentoArrendador } from "@/lib/minuta-arrendamiento"
import { leerNumero, nombreTipoContrato, pesos, type ClaseContrato, type ItemPresupuestoContrato } from "@/lib/contratos"

// ---------------------------------------------------------------------------
// Otrosí de contratos (plantilla "OTROSÍ" versión 04, 9/05/2025). El ingeniero
// pide qué cláusulas cambian y cómo quedan (Solicitud de otrosí); Jurídica
// arma el documento y lo envía a Subgerencia, que lo aprueba (Aprobación de
// otrosí). Es documento; aprobado, su prórroga y su nuevo valor (opcionales)
// pasan a ser el fin vigente y el tope de las actas. Base:
// supabase/migrations/20261119000000_otrosis.sql y 20261123000000_otrosi_prorroga_y_valor.sql.
// ---------------------------------------------------------------------------

// Pestañas desde las que se ven los otrosí (y su PDF): las de otrosí y las que
// ya dejan ver contratos (igual que _puede_ver_otrosis en la base).
export const PESTANAS_VER_OTROSI = [
  "contratos.solicitar_otrosi",
  "contratos.aprobar_otrosi",
  "contratos.solicitar",
  "contratos.contratos",
  "contratos.preaprobacion",
  "contratos.aprobar_minutas",
  "contratos.cortes",
  "contratos.aprobar_actas",
  "admin.visualizacion",
]

// Un otrosí visto desde su contrato (otrosis_de_contrato).
export type OtrosiDeContrato = {
  id: string
  numero: number | null
  estado: EstadoOtrosi
  clausulas: string
  solicitadoPorNombre: string | null
  createdAt: string
  aprobadoAt: string | null
  // Prórroga: nueva fecha de terminación (al aprobarse es la vigente del contrato).
  nuevaFechaFin: string | null
  // Nuevo valor total (al aprobarse es el tope de las actas).
  nuevoValor: number | null
  nActividades: number
}

// Actividad del otrosí (contratos por valores unitarios): adición de cantidad a
// una del contrato (a su valor pactado) o actividad nueva del presupuesto.
// Aprobado el otrosí, cada una es una fila nueva del anexo que cobran las actas.
export type ActividadOtrosi = {
  tipo: "adicion" | "nueva"
  anexoItemId: string | null
  presupuestoItemId: string
  codigo: string
  actividad: string
  unidad: string
  cantidad: number
  valorUnitario: number
  total: number
  sinManoObra: boolean
}

// Para el formulario (actividades_para_otrosi): las actividades del contrato y
// los ítems del presupuesto vigente que no tiene.
export type ActividadContratoOtrosi = {
  id: string
  codigo: string | null
  actividad: string
  unidad: string
  cantidad: number
  valorUnitario: number
  enPresupuesto: boolean
  disponible: number
}
export type ActividadesParaOtrosi = {
  anexoTipo: string | null
  tipo: string
  tienePresupuesto: boolean
  anexo: ActividadContratoOtrosi[]
  catalogo: ItemPresupuestoContrato[]
}

export type EstadoOtrosi = "por_revisar" | "devuelta" | "rechazada" | "en_revision" | "devuelta_subgerencia" | "aprobada"

export const ETIQUETA_ESTADO_OTROSI: Record<EstadoOtrosi, string> = {
  por_revisar: "En Jurídica",
  devuelta: "Devuelto al ingeniero",
  rechazada: "Rechazado",
  en_revision: "En Subgerencia",
  devuelta_subgerencia: "Devuelto por Subgerencia",
  aprobada: "Aprobado",
}

export const CLASE_ESTADO_OTROSI: Record<EstadoOtrosi, string> = {
  por_revisar: "border-transparent bg-amber-100 text-amber-800",
  devuelta: "border-transparent bg-orange-100 text-orange-800",
  rechazada: "border-transparent bg-red-100 text-red-800",
  en_revision: "border-transparent bg-sky-100 text-sky-800",
  devuelta_subgerencia: "border-transparent bg-orange-100 text-orange-800",
  aprobada: "border-transparent bg-emerald-100 text-emerald-800",
}

export type ModificacionOtrosi = { clausula: string; redaccion: string }

// Contrato al que se le puede pedir otrosí (contratos_para_otrosi).
export type ContratoParaOtrosi = {
  id: string
  numero: number
  numeroContrato: string
  tipo: string
  clase: ClaseContrato
  tipoDetalle: string | null
  objeto: string
  valor: number // vigente (el del último otrosí aprobado que lo cambió)
  // Valores unitarios: las cantidades del anexo siguen siendo topes por actividad.
  anexoTipo: "valor_global" | "valores_unitarios" | null
  fechaFin: string | null
  proyectoCodigo: string | null
  proyectoNombre: string | null
  contratistaId: string
  contratistaNombre: string
  contratistaDocumento: string
  otrosisAprobados: number
  otrosisEnTramite: number
}

export type OtrosiFila = {
  id: string
  numero: number | null
  estado: EstadoOtrosi
  contratoId: string
  numeroContrato: string
  tipo: string
  clase: ClaseContrato
  tipoDetalle: string | null
  objeto: string
  valor: number
  proyectoId: string
  proyectoCodigo: string | null
  proyectoNombre: string | null
  contratistaNombre: string
  nModificaciones: number
  clausulas: string
  solicitadoPorNombre: string | null
  createdAt: string
  enviadoAt: string
  enviadaSubgerenciaAt: string | null
  enviadaSubgerenciaPorNombre: string | null
  aprobadoAt: string | null
  // Prórroga: nueva fecha de terminación (al aprobarse es la vigente del contrato).
  nuevaFechaFin: string | null
  // Nuevo valor total (al aprobarse es el tope de las actas).
  nuevoValor: number | null
  anexoTipo: string | null
  actividades: ActividadOtrosi[]
}

export type ContratistaOtrosi = {
  tipoPersona: "natural" | "juridica"
  tipoDocumento: string | null
  numeroDocumento: string | null
  digitoVerificacion: number | null
  representanteNombre: string | null
  representanteTipoDocumento: string | null
  representanteNumeroDocumento: string | null
  cedulaExpedidaEn: string | null
  ciudad: string | null
}

export type OtrosiDetalle = OtrosiFila & {
  modificaciones: ModificacionOtrosi[]
  justificacion: string
  motivo: string | null
  resueltoPorNombre: string | null
  resueltoAt: string | null
  aprobadoPorNombre: string | null
  minutaDatos: unknown
  minutaActualizadaAt: string | null
  minutaActualizadaPorNombre: string | null
  numeroProvisional: number
  fechaFin: string | null
  contratoMinuta: unknown
  proyectoCiudad: string | null
  empresaNombre: string | null
  empresaNit: string | null
  contratista: ContratistaOtrosi
}

// ---------------------------------------------------------------- lectura (jsonb de la base)
type Fila = Record<string, unknown>
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const textoONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v))
const numeroONulo = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v))

export function mapContratoParaOtrosi(x: Fila): ContratoParaOtrosi {
  return {
    id: texto(x.id),
    numero: Number(x.numero),
    numeroContrato: texto(x.numero_contrato),
    tipo: texto(x.tipo),
    clase: (x.clase === "general" ? "general" : "grupo") as ClaseContrato,
    tipoDetalle: textoONulo(x.tipo_detalle),
    objeto: texto(x.objeto),
    valor: Number(x.valor ?? 0),
    anexoTipo: x.anexo_tipo === "valores_unitarios" || x.anexo_tipo === "valor_global" ? x.anexo_tipo : null,
    fechaFin: textoONulo(x.fecha_fin),
    proyectoCodigo: textoONulo(x.proyecto_codigo),
    proyectoNombre: textoONulo(x.proyecto_nombre),
    contratistaId: texto(x.contratista_id),
    contratistaNombre: texto(x.contratista_nombre),
    contratistaDocumento: texto(x.contratista_documento),
    otrosisAprobados: Number(x.otrosis_aprobados ?? 0),
    otrosisEnTramite: Number(x.otrosis_en_tramite ?? 0),
  }
}

export function mapOtrosiFila(x: Fila): OtrosiFila {
  return {
    id: texto(x.id),
    numero: numeroONulo(x.numero),
    estado: x.estado as EstadoOtrosi,
    contratoId: texto(x.contrato_id),
    numeroContrato: texto(x.numero_contrato),
    tipo: texto(x.tipo),
    clase: (x.clase === "general" ? "general" : "grupo") as ClaseContrato,
    tipoDetalle: textoONulo(x.tipo_detalle),
    objeto: texto(x.objeto),
    valor: Number(x.valor ?? 0),
    proyectoId: texto(x.proyecto_id),
    proyectoCodigo: textoONulo(x.proyecto_codigo),
    proyectoNombre: textoONulo(x.proyecto_nombre),
    contratistaNombre: texto(x.contratista_nombre),
    nModificaciones: Number(x.n_modificaciones ?? 0),
    clausulas: texto(x.clausulas),
    solicitadoPorNombre: textoONulo(x.solicitado_por_nombre),
    createdAt: texto(x.created_at),
    enviadoAt: texto(x.enviado_at),
    enviadaSubgerenciaAt: textoONulo(x.enviada_subgerencia_at),
    enviadaSubgerenciaPorNombre: textoONulo(x.enviada_subgerencia_por_nombre),
    aprobadoAt: textoONulo(x.aprobado_at),
    nuevaFechaFin: textoONulo(x.nueva_fecha_fin),
    nuevoValor: x.nuevo_valor == null ? null : Number(x.nuevo_valor),
    anexoTipo: textoONulo(x.anexo_tipo),
    actividades: mapActividadesOtrosi(x.actividades),
  }
}

export function mapActividadesOtrosi(v: unknown): ActividadOtrosi[] {
  return (Array.isArray(v) ? (v as Fila[]) : []).map((a) => ({
    tipo: a.tipo === "adicion" ? "adicion" : "nueva",
    anexoItemId: textoONulo(a.anexo_item_id),
    presupuestoItemId: texto(a.presupuesto_item_id),
    codigo: texto(a.codigo),
    actividad: texto(a.actividad),
    unidad: texto(a.unidad),
    cantidad: Number(a.cantidad ?? 0),
    valorUnitario: Number(a.valor_unitario ?? 0),
    total: Number(a.total ?? 0),
    sinManoObra: a.sin_mano_obra === true,
  }))
}

export function mapActividadesParaOtrosi(x: Fila): ActividadesParaOtrosi {
  return {
    anexoTipo: textoONulo(x.anexo_tipo),
    tipo: texto(x.tipo),
    tienePresupuesto: x.tiene_presupuesto === true,
    anexo: (Array.isArray(x.anexo) ? (x.anexo as Fila[]) : []).map((a) => ({
      id: texto(a.id),
      codigo: textoONulo(a.codigo),
      actividad: texto(a.actividad),
      unidad: texto(a.unidad),
      cantidad: Number(a.cantidad ?? 0),
      valorUnitario: Number(a.valor_unitario ?? 0),
      enPresupuesto: a.en_presupuesto === true,
      disponible: Number(a.disponible ?? 0),
    })),
    catalogo: (Array.isArray(x.catalogo) ? (x.catalogo as Fila[]) : []).map((c) => ({
      id: texto(c.presupuesto_item_id),
      codigo: texto(c.codigo),
      descripcion: texto(c.descripcion),
      unidad: textoONulo(c.unidad),
      cantidad: Number(c.cantidad ?? 0),
      valorUnitario: Number(c.valor_unitario ?? 0),
      valorManoObra: Number(c.valor_mano_obra ?? 0),
      contratado: Number(c.contratado ?? 0),
      disponible: Number(c.disponible ?? 0),
    })),
  }
}

// Actividades del formulario: cantidad adicional por actividad del contrato y
// actividades nuevas del presupuesto (texto en formato colombiano).
export type ActividadesOtrosiForm = {
  adiciones: Record<string, string>
  nuevas: { presupuestoItemId: string; cantidad: string; valorUnitario: string }[]
}
export type ActividadOtrosiEnvio = { anexo_item_id: string; cantidad: number } | { presupuesto_item_id: string; cantidad: number; valor_unitario: number }

// Revisa lo mismo que _normalizar_actividades_otrosi con lo que se ve en
// pantalla (disponible y tope); devuelve lo que se envía y el total, o el error.
export function leerActividadesOtrosi(
  f: ActividadesOtrosiForm,
  datos: { anexo: ActividadContratoOtrosi[]; catalogo: ItemPresupuestoContrato[]; topeDe: (item: ItemPresupuestoContrato) => number }
): { ok: true; envio: ActividadOtrosiEnvio[]; total: number } | { ok: false; error: string } {
  const envio: ActividadOtrosiEnvio[] = []
  let total = 0
  for (const a of datos.anexo) {
    const t = (f.adiciones[a.id] ?? "").trim()
    if (!t) continue
    const cantidad = leerNumero(t)
    if (cantidad === null || cantidad <= 0) return { ok: false, error: `"${a.actividad}": la cantidad adicional no es válida.` }
    if (!a.enPresupuesto) return { ok: false, error: `"${a.actividad}" ya no está en el presupuesto vigente: no se puede aumentar.` }
    if (cantidad > a.disponible + 1e-9) return { ok: false, error: `"${a.actividad}": la cantidad adicional supera lo disponible en el presupuesto.` }
    envio.push({ anexo_item_id: a.id, cantidad })
    total += Math.round(cantidad * a.valorUnitario * 100) / 100
  }
  const vistos = new Set<string>()
  for (const [i, n] of f.nuevas.entries()) {
    if (!n.presupuestoItemId && !n.cantidad.trim() && !n.valorUnitario.trim()) continue
    const item = datos.catalogo.find((c) => c.id === n.presupuestoItemId)
    if (!item) return { ok: false, error: `Escoge el ítem del presupuesto de la actividad nueva ${i + 1}.` }
    if (vistos.has(item.id)) return { ok: false, error: `El ítem ${item.codigo} está repetido.` }
    vistos.add(item.id)
    const cantidad = leerNumero(n.cantidad)
    const valorUnitario = leerNumero(n.valorUnitario)
    if (!cantidad || !valorUnitario) return { ok: false, error: `Ítem ${item.codigo}: cantidad y valor unitario mayores que cero.` }
    if (cantidad > item.disponible + 1e-9) return { ok: false, error: `Ítem ${item.codigo}: la cantidad supera lo disponible en el presupuesto.` }
    const tope = datos.topeDe(item)
    if (valorUnitario > tope) return { ok: false, error: `Ítem ${item.codigo}: el valor unitario supera el máximo (${pesos(tope)}).` }
    const vu = Math.round(valorUnitario * 100) / 100
    envio.push({ presupuesto_item_id: item.id, cantidad, valor_unitario: vu })
    total += Math.round(cantidad * vu * 100) / 100
  }
  if (envio.length > 50) return { ok: false, error: "Máximo 50 actividades por otrosí." }
  return { ok: true, envio, total: Math.round(total * 100) / 100 }
}

export function mapOtrosiDetalle(x: Fila): OtrosiDetalle {
  const k = (x.contratista ?? {}) as Fila
  const mods = Array.isArray(x.modificaciones) ? (x.modificaciones as Fila[]) : []
  return {
    ...mapOtrosiFila(x),
    modificaciones: mods.map((m) => ({ clausula: texto(m.clausula), redaccion: texto(m.redaccion) })),
    justificacion: texto(x.justificacion),
    motivo: textoONulo(x.motivo),
    resueltoPorNombre: textoONulo(x.resuelto_por_nombre),
    resueltoAt: textoONulo(x.resuelto_at),
    aprobadoPorNombre: textoONulo(x.aprobado_por_nombre),
    minutaDatos: x.minuta_datos ?? null,
    minutaActualizadaAt: textoONulo(x.minuta_actualizada_at),
    minutaActualizadaPorNombre: textoONulo(x.minuta_actualizada_por_nombre),
    numeroProvisional: Number(x.numero_provisional ?? 1),
    fechaFin: textoONulo(x.fecha_fin),
    contratoMinuta: x.contrato_minuta ?? null,
    proyectoCiudad: textoONulo(x.proyecto_ciudad),
    empresaNombre: textoONulo(x.empresa_nombre),
    empresaNit: textoONulo(x.empresa_nit),
    contratista: {
      tipoPersona: k.tipo_persona === "juridica" ? "juridica" : "natural",
      tipoDocumento: textoONulo(k.tipo_documento),
      numeroDocumento: textoONulo(k.numero_documento),
      digitoVerificacion: numeroONulo(k.digito_verificacion),
      representanteNombre: textoONulo(k.representante_nombre),
      representanteTipoDocumento: textoONulo(k.representante_tipo_documento),
      representanteNumeroDocumento: textoONulo(k.representante_numero_documento),
      cedulaExpedidaEn: textoONulo(k.cedula_expedida_en),
      ciudad: textoONulo(k.ciudad),
    },
  }
}

// ---------------------------------------------------------------- solicitud
export const MAXIMO_MODIFICACIONES_OTROSI = 20

// Lo mismo que revisa la base (_normalizar_modificaciones_otrosi y crear_otrosi).
// `prorroga` (opcional): la nueva fecha de terminación, que tiene que quedar
// después del fin vigente del contrato y de hoy (_validar_prorroga_otrosi).
// `cambioValor` (opcional): el nuevo valor total, distinto del vigente
// (_validar_valor_otrosi; lo ya cobrado en actas lo revisa la base).
export function validarSolicitudOtrosi(s: {
  contratoId: string | null
  modificaciones: ModificacionOtrosi[]
  justificacion: string
  prorroga?: { nuevaFechaFin: string | null; finVigente: string | null; hoy: string }
  cambioValor?: { nuevoValor: number | null; valorVigente: number }
}): string | null {
  if (!s.contratoId) return "Escoge el contrato."
  const mods = s.modificaciones
  if (mods.length === 0) return "Agrega al menos una cláusula a modificar."
  if (mods.length > MAXIMO_MODIFICACIONES_OTROSI) return `Máximo ${MAXIMO_MODIFICACIONES_OTROSI} cláusulas por otrosí.`
  for (const [i, m] of mods.entries()) {
    if (!m.clausula.trim()) return `Modificación ${i + 1}: indica qué cláusula se modifica.`
    if (!m.redaccion.trim()) return `Modificación ${i + 1}: escribe cómo queda la cláusula.`
    if (m.clausula.trim().length > 200) return `Modificación ${i + 1}: el nombre de la cláusula es muy largo (máximo 200 caracteres).`
    if (m.redaccion.trim().length > 20000) return `Modificación ${i + 1}: la redacción es muy larga.`
  }
  if (!s.justificacion.trim()) return "Escribe por qué se necesita el otrosí."
  if (s.justificacion.trim().length > 5000) return "La justificación es muy larga (máximo 5.000 caracteres)."
  const p = s.prorroga
  if (p?.nuevaFechaFin) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.nuevaFechaFin)) return "La nueva fecha de terminación no es válida."
    if (p.finVigente && p.nuevaFechaFin <= p.finVigente) return "La nueva fecha de terminación tiene que ser posterior a la vigente."
    if (p.nuevaFechaFin <= p.hoy) return "La nueva fecha de terminación tiene que ser posterior a hoy."
  }
  const v = s.cambioValor
  if (v && v.nuevoValor !== null) {
    if (!(v.nuevoValor > 0) || v.nuevoValor >= 1e16) return "El nuevo valor del contrato no es válido."
    if (Math.abs(Math.round(v.nuevoValor * 100) - v.nuevoValor * 100) > 1e-6) return "El nuevo valor del contrato tiene más de dos decimales."
    if (v.nuevoValor === v.valorVigente) return "El nuevo valor es igual al vigente."
  }
  return null
}

// El plazo vigente ya terminó (la base tampoco deja hacer otrosí).
export const contratoVencido = (fechaFin: string | null, hoy: string) => Boolean(fechaFin && fechaFin < hoy)

// ---------------------------------------------------------------- documento (minuta del otrosí)
export type MinutaOtrosi = {
  contratanteNombre: string
  contratanteNit: string
  contratanteRepresentante: string
  contratanteRepresentanteCedula: string
  contratanteRepresentanteExpedida: string
  contratistaTipoPersona: "natural" | "juridica"
  contratistaNombre: string
  contratistaNit: string // jurídica
  contratistaRepresentante: string // jurídica
  contratistaTipoDocumento: TipoDocumentoArrendador // natural: el suyo; jurídica: el del representante
  contratistaCedula: string
  contratistaCiudad: string
  numeroContrato: string
  // "contrato de mano de obra" (segunda: "Las demás cláusulas ... del contrato de ...").
  nombreContrato: string
  modificaciones: ModificacionOtrosi[]
  ciudadFirma: string
  fechaFirma: string // AAAA-MM-DD
}

// La plantilla dice "con cédula N° ... expedida en Arauca".
export const EXPEDIDA_PLANTILLA_OTROSI = "Arauca"

const CAMPOS_DE_PLANTILLA = new Set<keyof MinutaOtrosi>(["contratanteRepresentanteExpedida"])

// Lo que ya quedó escrito en la minuta aprobada del contrato (representante de
// la empresa, datos del contratista) gana sobre el directorio: es lo firmado.
function deMinuta(minuta: unknown, clave: string): string | null {
  if (!minuta || typeof minuta !== "object" || Array.isArray(minuta)) return null
  const v = (minuta as Record<string, unknown>)[clave]
  return typeof v === "string" && v.trim() ? v.trim() : null
}

const minuscula = (t: string) => t.charAt(0).toLowerCase() + t.slice(1)

export function minutaOtrosiPorDefecto(d: OtrosiDetalle, hoy: string): MinutaOtrosi {
  const k = d.contratista
  const juridica = k.tipoPersona === "juridica"
  const nitDirectorio =
    k.tipoDocumento === "NIT" && k.numeroDocumento ? `${k.numeroDocumento}${k.digitoVerificacion !== null ? `-${k.digitoVerificacion}` : ""}` : ""
  const tipoDocumento = juridica ? k.representanteTipoDocumento : k.tipoDocumento
  const cm = d.contratoMinuta
  return {
    contratanteNombre: deMinuta(cm, "contratanteNombre") ?? d.empresaNombre ?? CONTRATANTE_POR_DEFECTO.nombre,
    contratanteNit: deMinuta(cm, "contratanteNit") ?? d.empresaNit ?? CONTRATANTE_POR_DEFECTO.nit,
    contratanteRepresentante: deMinuta(cm, "contratanteRepresentante") ?? "",
    contratanteRepresentanteCedula: deMinuta(cm, "contratanteRepresentanteCedula") ?? "",
    contratanteRepresentanteExpedida: deMinuta(cm, "contratanteRepresentanteExpedida") ?? EXPEDIDA_PLANTILLA_OTROSI,
    contratistaTipoPersona: juridica ? "juridica" : "natural",
    contratistaNombre: deMinuta(cm, "contratistaNombre") ?? d.contratistaNombre,
    contratistaNit: deMinuta(cm, "contratistaNit") ?? nitDirectorio,
    contratistaRepresentante: juridica ? (deMinuta(cm, "contratistaRepresentante") ?? k.representanteNombre ?? "") : "",
    contratistaTipoDocumento: TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === tipoDocumento) ? (tipoDocumento as TipoDocumentoArrendador) : "CC",
    contratistaCedula: deMinuta(cm, "contratistaCedula") ?? (juridica ? (k.representanteNumeroDocumento ?? "") : (k.numeroDocumento ?? "")),
    contratistaCiudad: deMinuta(cm, "contratistaCiudad") ?? k.ciudad ?? "",
    numeroContrato: d.numeroContrato,
    nombreContrato: `contrato de ${minuscula(nombreTipoContrato(d))}`,
    modificaciones: d.modificaciones.map((m) => ({ ...m })),
    ciudadFirma: d.proyectoCiudad ?? "",
    fechaFirma: hoy,
  }
}

export function minutaOtrosiVacia(): MinutaOtrosi {
  return {
    contratanteNombre: "",
    contratanteNit: "",
    contratanteRepresentante: "",
    contratanteRepresentanteCedula: "",
    contratanteRepresentanteExpedida: "",
    contratistaTipoPersona: "natural",
    contratistaNombre: "",
    contratistaNit: "",
    contratistaRepresentante: "",
    contratistaTipoDocumento: "CC",
    contratistaCedula: "",
    contratistaCiudad: "",
    numeroContrato: "",
    nombreContrato: "",
    modificaciones: [],
    ciudadFirma: "",
    fechaFirma: "",
  }
}

// Lo guardado gana campo por campo sobre lo calculado (como las minutas).
export function mezclarMinutaOtrosi(defecto: MinutaOtrosi, guardada: unknown): MinutaOtrosi {
  if (!guardada || typeof guardada !== "object" || Array.isArray(guardada)) return defecto
  const g = guardada as Record<string, unknown>
  const r: Record<string, unknown> = { ...defecto }
  for (const clave of Object.keys(defecto) as (keyof MinutaOtrosi)[]) {
    if (!(clave in g)) continue
    const valor = g[clave]
    if (clave === "modificaciones") {
      if (Array.isArray(valor))
        r.modificaciones = valor
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((x) => ({ clausula: String(x.clausula ?? ""), redaccion: String(x.redaccion ?? "") }))
    } else if (clave === "contratistaTipoPersona") {
      if (valor === "natural" || valor === "juridica") r[clave] = valor
    } else if (clave === "contratistaTipoDocumento") {
      if (TIPOS_DOCUMENTO_ARRENDADOR.some((t) => t.valor === valor)) r[clave] = valor
    } else if (typeof valor === "string") {
      r[clave] = valor
    }
  }
  return r as MinutaOtrosi
}

// Sin modificaciones vacías.
export const limpiarMinutaOtrosi = (m: MinutaOtrosi): MinutaOtrosi => ({
  ...m,
  modificaciones: m.modificaciones.filter((x) => x.clausula.trim() || x.redaccion.trim()),
})

export function origenCampoOtrosi(clave: keyof MinutaOtrosi, actual: string, defecto: MinutaOtrosi): OrigenDato {
  if (!actual.trim()) return "vacio"
  const inicial = defecto[clave]
  if (typeof inicial !== "string" || actual !== inicial) return "editado"
  if (CAMPOS_DE_PLANTILLA.has(clave)) return actual === EXPEDIDA_PLANTILLA_OTROSI ? "plantilla" : "solicitud"
  return "solicitud"
}

export const nombreArchivoOtrosi = (numeroContrato: string, numero: number) =>
  `otrosi-${numero}-${numeroContrato}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") + ".pdf"

export const mapOtrosiDeContrato = (x: Fila): OtrosiDeContrato => ({
  id: texto(x.id),
  numero: numeroONulo(x.numero),
  estado: x.estado as EstadoOtrosi,
  clausulas: texto(x.clausulas),
  solicitadoPorNombre: textoONulo(x.solicitado_por_nombre),
  createdAt: texto(x.created_at),
  aprobadoAt: textoONulo(x.aprobado_at),
  nuevaFechaFin: textoONulo(x.nueva_fecha_fin),
  nuevoValor: x.nuevo_valor == null ? null : Number(x.nuevo_valor),
  nActividades: Number(x.n_actividades ?? 0),
})
