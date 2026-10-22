// Bandeja "Mis pendientes" (T1). La base calcula los pendientes de cada persona
// (mis_pendientes, 20261127000000_mis_pendientes.sql) con su permiso en la
// matriz, sus proyectos y lo suyo; aquí van los tipos y cómo se nombra cada
// grupo en pantalla.

export type CategoriaPendiente = "hacer" | "seguimiento"

export type PendienteItem = {
  id: string
  proyectoId: string | null
  proyecto: string | null
  titulo: string
  detalle: string | null
  monto: number | null
  desde: string | null
  deQuien: string | null
  vence: string | null
  vencido: boolean
  url: string
}

export type GrupoPendientes = {
  tipo: string
  categoria: CategoriaPendiente
  total: number
  montoTotal: number | null
  vencidos: number
  masAntiguo: string | null
  items: PendienteItem[] // como mucho 20: los vencidos y los más viejos
}

type DefGrupo = { titulo: string; accion: string; orden: number }

// Orden = el del flujo (lo que más frena va primero dentro de cada etapa).
export const GRUPOS_PENDIENTES: Record<string, DefGrupo> = {
  mi_contrato_devuelto: { titulo: "Mis solicitudes de contrato devueltas", accion: "Corregir", orden: 1 },
  mi_otrosi_devuelto: { titulo: "Mis otrosí devueltos", accion: "Corregir", orden: 2 },
  mi_acta_rechazada: { titulo: "Mis actas rechazadas", accion: "Corregir", orden: 3 },
  mi_firma: { titulo: "Mi firma", accion: "Registrar", orden: 4 },
  mi_poliza_por_subir: { titulo: "Pólizas por subir", accion: "Subir póliza", orden: 5 },
  mi_req_admin_rechazada: { titulo: "Mis requisiciones administrativas rechazadas", accion: "Corregir", orden: 6 },
  req_por_aprobar: { titulo: "Requisiciones por aprobar", accion: "Aprobar", orden: 10 },
  insumo_por_aprobar: { titulo: "Insumos nuevos por aprobar", accion: "Revisar", orden: 11 },
  mo_por_aprobar: { titulo: "Mano de obra y equipos por aprobar", accion: "Revisar", orden: 12 },
  req_por_comprar: { titulo: "Requisiciones por comprar", accion: "Comprar", orden: 20 },
  oc_por_recibir: { titulo: "Órdenes de compra por recibir", accion: "Recibir", orden: 22 },
  contrato_por_preaprobar: { titulo: "Contratos por pre-aprobar", accion: "Revisar", orden: 30 },
  minuta_por_elaborar: { titulo: "Minutas por hacer o corregir", accion: "Hacer minuta", orden: 31 },
  minuta_por_aprobar: { titulo: "Minutas por aprobar", accion: "Aprobar", orden: 32 },
  otrosi_por_revisar: { titulo: "Otrosí por revisar", accion: "Revisar", orden: 33 },
  otrosi_por_aprobar: { titulo: "Otrosí por aprobar", accion: "Aprobar", orden: 34 },
  poliza_por_revisar: { titulo: "Pólizas por revisar", accion: "Revisar", orden: 36 },
  contrato_vencido: { titulo: "Contratos vencidos sin liquidar", accion: "Liquidar", orden: 35 },
  pago_por_aprobar: { titulo: "Pagos por aprobar", accion: "Aprobar", orden: 40 },
  req_admin_por_aprobar: { titulo: "Requisiciones administrativas por aprobar", accion: "Aprobar", orden: 40.5 },
  pago_sin_tercero: { titulo: "Pagos aprobados sin tercero o cuenta", accion: "Resolver", orden: 41 },
  cuenta_por_verificar: { titulo: "Cuentas de terceros por verificar", accion: "Verificar", orden: 42 },
  mi_req_atrasada: { titulo: "Mis requisiciones atrasadas", accion: "Ver", orden: 90 },
}

export const defGrupo = (tipo: string): DefGrupo =>
  GRUPOS_PENDIENTES[tipo] ?? { titulo: tipo, accion: "Abrir", orden: 99 }

// Días completos desde una fecha (0 = hoy).
export function diasDesde(iso: string | null, ahora: Date = new Date()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(Math.floor((ahora.getTime() - t) / 86_400_000), 0)
}

export function textoEspera(dias: number | null): string {
  if (dias == null) return ""
  if (dias === 0) return "hoy"
  if (dias === 1) return "hace 1 día"
  return `hace ${dias} días`
}

// Forma del JSON de mis_pendientes.
type ItemCrudo = {
  id: string; proyecto_id: string | null; proyecto: string | null; titulo: string | null; detalle: string | null
  monto: number | string | null; desde: string | null; de_quien: string | null; vence: string | null
  vencido: boolean | null; url: string | null
}
type GrupoCrudo = {
  tipo: string; categoria: string; total: number; monto_total: number | string | null; vencidos: number
  mas_antiguo: string | null; items: ItemCrudo[] | null
}

// Lo que devuelve la base -> tipos de pantalla, ordenado: primero lo que hay
// que hacer (por el orden del flujo), luego el seguimiento.
export function mapGrupos(crudo: unknown): GrupoPendientes[] {
  const lista = (Array.isArray(crudo) ? crudo : []) as GrupoCrudo[]
  return lista
    .map((g): GrupoPendientes => ({
      tipo: String(g.tipo),
      categoria: g.categoria === "seguimiento" ? "seguimiento" : "hacer",
      total: Number(g.total ?? 0),
      montoTotal: g.monto_total == null ? null : Number(g.monto_total),
      vencidos: Number(g.vencidos ?? 0),
      masAntiguo: g.mas_antiguo ?? null,
      items: (Array.isArray(g.items) ? g.items : []).map((i) => ({
        id: String(i.id),
        proyectoId: i.proyecto_id ?? null,
        proyecto: i.proyecto ?? null,
        titulo: String(i.titulo ?? ""),
        detalle: i.detalle ?? null,
        monto: i.monto == null ? null : Number(i.monto),
        desde: i.desde ?? null,
        deQuien: i.de_quien ?? null,
        vence: i.vence ?? null,
        vencido: Boolean(i.vencido),
        url: String(i.url ?? "/inicio"),
      })),
    }))
    .sort((a, b) =>
      a.categoria !== b.categoria ? (a.categoria === "hacer" ? -1 : 1) : defGrupo(a.tipo).orden - defGrupo(b.tipo).orden
    )
}
