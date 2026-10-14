// ---------------------------------------------------------------------------
// Control del proyecto (Control › Visualización): tipos y cálculos puros sobre
// lo que devuelve control_proyecto (20261112000000_control_proyecto.sql). Va
// en lib/ para que la vista no importe nada del servidor y para probarlo sin
// base de datos (tests/control-proyecto.test.ts).
// ---------------------------------------------------------------------------

export type CapituloControl = {
  id: string
  codigo: string
  descripcion: string
  presupuesto: number
  compras: number
  actas: number
}

export type ItemSobrePresupuesto = {
  codigo: string
  descripcion: string
  capitulo: string
  presupuesto: number
  gastado: number
  exceso: number
}

export type ProveedorControl = { id: string; nombre: string; total: number; ordenes: number; insumos: number }

// Lo comprado de UN insumo a UN proveedor en el proyecto.
export type PrecioProveedor = {
  proveedorId: string
  insumoId: string
  codigo: number | null
  descripcion: string
  um: string | null
  cantidad: number
  valor: number // con IVA
  precioPromedio: number // sin IVA, con descuento
  ultima: string | null
  precioPresupuesto: number | null // maestro, sin IVA
}

export type ContratoControl = {
  id: string
  numero: number
  numeroContrato: string | null
  tipo: string
  contratista: string
  valor: number
  minutaAprobada: boolean
  actasAprobadas: number
  actasPorAprobar: number
}

export type ControlProyecto = {
  tienePresupuesto: boolean
  presupuesto: number
  presupuestoMateriales: number
  presupuestoManoObra: number
  compras: number
  actas: number
  porComprar: number
  excedentes: number
  salidasValor: number
  contratado: number
  actasContratadas: number
  sinItem: number
  capitulos: CapituloControl[]
  itemsSobre: ItemSobrePresupuesto[]
  proveedores: ProveedorControl[]
  precios: PrecioProveedor[]
  contratos: ContratoControl[]
}

type Fila = Record<string, unknown>

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const t = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const tn = (v: unknown) => (v === null || v === undefined ? null : String(v))
const filas = (v: unknown) => (Array.isArray(v) ? (v as Fila[]) : [])

export function mapControlProyecto(datos: unknown): ControlProyecto {
  const r = (datos ?? {}) as Fila
  return {
    tienePresupuesto: Boolean(r.tiene_presupuesto),
    presupuesto: n(r.presupuesto),
    presupuestoMateriales: n(r.presupuesto_materiales),
    presupuestoManoObra: n(r.presupuesto_mano_obra),
    compras: n(r.compras),
    actas: n(r.actas),
    porComprar: n(r.por_comprar),
    excedentes: n(r.excedentes),
    salidasValor: n(r.salidas_valor),
    contratado: n(r.contratado),
    actasContratadas: n(r.actas_contratadas),
    sinItem: n(r.sin_item),
    capitulos: filas(r.capitulos).map((c) => ({
      id: t(c.id),
      codigo: t(c.codigo),
      descripcion: t(c.descripcion),
      presupuesto: n(c.presupuesto),
      compras: n(c.compras),
      actas: n(c.actas),
    })),
    itemsSobre: filas(r.items_sobre).map((i) => ({
      codigo: t(i.codigo),
      descripcion: t(i.descripcion),
      capitulo: t(i.capitulo),
      presupuesto: n(i.presupuesto),
      gastado: n(i.gastado),
      exceso: n(i.exceso),
    })),
    proveedores: filas(r.proveedores).map((p) => ({
      id: t(p.id),
      nombre: t(p.nombre) || "(sin nombre)",
      total: n(p.total),
      ordenes: n(p.ordenes),
      insumos: n(p.insumos),
    })),
    precios: filas(r.precios).map((p) => ({
      proveedorId: t(p.proveedor_id),
      insumoId: t(p.insumo_id),
      codigo: nn(p.codigo),
      descripcion: t(p.descripcion),
      um: tn(p.um),
      cantidad: n(p.cantidad),
      valor: n(p.valor),
      precioPromedio: n(p.precio_promedio),
      ultima: tn(p.ultima),
      precioPresupuesto: nn(p.precio_presupuesto),
    })),
    contratos: filas(r.contratos).map((c) => ({
      id: t(c.id),
      numero: n(c.numero),
      numeroContrato: tn(c.numero_contrato),
      tipo: t(c.tipo),
      contratista: t(c.contratista),
      valor: n(c.valor),
      minutaAprobada: Boolean(c.minuta_aprobada),
      actasAprobadas: n(c.actas_aprobadas),
      actasPorAprobar: n(c.actas_por_aprobar),
    })),
  }
}

// Porcentaje entero seguro (0 si no hay base).
export const porcentaje = (parte: number, total: number) => (total > 0 ? (parte / total) * 100 : 0)

export function totalesControl(c: ControlProyecto) {
  const gastado = c.compras + c.actas
  return {
    gastado,
    pctGastado: porcentaje(gastado, c.presupuesto),
    pctBodega: porcentaje(c.salidasValor, c.presupuestoMateriales),
    pctActas: porcentaje(c.actasContratadas, c.contratado),
    pctContratadoMo: porcentaje(c.contratado, c.presupuestoManoObra),
    disponible: Math.max(c.presupuesto - gastado - c.porComprar, 0),
  }
}

// Partes de la barra "a dónde va la plata", en % del ancho. La base es el
// presupuesto; si lo gastado + por comprar lo supera, la base es esa suma (la
// barra se llena y no se sale).
export function partesBarraPlata(c: ControlProyecto) {
  const usado = c.compras + c.actas + c.porComprar
  const base = Math.max(c.presupuesto, usado)
  const pct = (v: number) => (base > 0 ? (v / base) * 100 : 0)
  return {
    compras: pct(c.compras),
    actas: pct(c.actas),
    porComprar: pct(c.porComprar),
    disponible: pct(Math.max(c.presupuesto - usado, 0)),
    sobrepasa: usado > c.presupuesto && c.presupuesto > 0,
  }
}

// Comparación del precio promedio contra el del presupuesto (maestro):
// 'debajo' (o igual), 'encima', o 'sin_referencia'.
export function comparacionPrecio(promedio: number, presupuesto: number | null): "debajo" | "encima" | "sin_referencia" {
  if (presupuesto === null || presupuesto <= 0) return "sin_referencia"
  return promedio > presupuesto ? "encima" : "debajo"
}

// Índices en una sola pasada: insumos de cada proveedor (de mayor a menor
// valor) y, por insumo, sus proveedores (del precio más bajo al más alto).
export function indexarPrecios(precios: PrecioProveedor[]) {
  const porProveedor = new Map<string, PrecioProveedor[]>()
  const porInsumo = new Map<string, PrecioProveedor[]>()
  for (const p of precios) {
    const a = porProveedor.get(p.proveedorId)
    if (a) a.push(p)
    else porProveedor.set(p.proveedorId, [p])
    const b = porInsumo.get(p.insumoId)
    if (b) b.push(p)
    else porInsumo.set(p.insumoId, [p])
  }
  for (const lista of porProveedor.values()) lista.sort((x, y) => y.valor - x.valor)
  for (const lista of porInsumo.values()) lista.sort((x, y) => x.precioPromedio - y.precioPromedio)
  return { porProveedor, porInsumo }
}

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")

// Insumos que coinciden con la búsqueda (descripción o código), con sus
// proveedores. Mínimo 2 letras; los que más se han comprado primero.
export function buscarInsumosPrecios(porInsumo: Map<string, PrecioProveedor[]>, texto: string) {
  const q = normalizar(texto.trim())
  if (q.length < 2) return []
  const resultado: { insumoId: string; descripcion: string; codigo: number | null; um: string | null; precioPresupuesto: number | null; cantidad: number; valor: number; proveedores: PrecioProveedor[] }[] = []
  for (const [insumoId, lista] of porInsumo) {
    const p = lista[0]
    if (!normalizar(p.descripcion).includes(q) && !(p.codigo !== null && String(p.codigo).includes(q))) continue
    let cantidad = 0
    let valor = 0
    for (const x of lista) {
      cantidad += x.cantidad
      valor += x.valor
    }
    resultado.push({ insumoId, descripcion: p.descripcion, codigo: p.codigo, um: p.um, precioPresupuesto: p.precioPresupuesto, cantidad, valor, proveedores: lista })
  }
  return resultado.sort((a, b) => b.valor - a.valor)
}
