// ---------------------------------------------------------------------------
// Registro de PESTAÑAS y ACCIONES del sistema de roles.
//
// Es la única fuente de verdad de: qué pestañas tiene el menú, a qué rutas
// da acceso cada una, y qué acciones se pueden asignar a un rol. La matriz de
// "Roles y permisos", el menú lateral y el middleware leen todos de acá.
//
// En la base (rol_permisos.permiso) se guardan como 'tab.<clave>' y
// 'accion.<clave>'. Agregar una pestaña o acción nueva = una entrada acá (y,
// si es una acción que valida la base, usarla en tiene_accion).
//
// Sin dependencias de servidor: se importa también desde componentes de
// cliente.
// ---------------------------------------------------------------------------

export type PermisosRol = {
  // true = usuario que todavía no tiene rol asignado: sigue con sus banderas
  // anteriores (es_admin, rol_compras...) y el menú no se filtra.
  sinRol: boolean
  rolId: string | null
  rolClave: string | null
  rolNombre: string | null
  esAdministrador: boolean
  pestanas: string[]
  acciones: string[]
  todosProyectos: boolean
}

export type Pestana = {
  clave: string
  titulo: string
  seccion: string
  // A dónde lleva en el menú.
  url: string
  // Rutas (y todo lo que cuelga de ellas) que esta pestaña habilita. Vacío =
  // no restringe ninguna ruta (pestañas todavía sin página propia).
  rutas: string[]
  nota?: string
}

// Orden = orden del menú y de las filas de la matriz.
export const PESTANAS: Pestana[] = [
  { clave: "presupuestos.elaboracion", titulo: "Elaboración de presupuestos", seccion: "Presupuestos", url: "/presupuestos", rutas: ["/presupuestos", "/presupuestos/apu", "/presupuestos/graficas"] },

  { clave: "tecnico.pedidos", titulo: "Pedidos", seccion: "Técnico", url: "/almacen", rutas: ["/almacen"] },
  { clave: "tecnico.aprobar_pedidos", titulo: "Aprobación de pedidos", seccion: "Técnico", url: "/admin-tecnico", rutas: ["/admin-tecnico"] },
  { clave: "tecnico.aprobar_mano_obra", titulo: "Aprobación de mano de obra", seccion: "Técnico", url: "/presupuestos/admin-mo", rutas: ["/presupuestos/admin-mo"] },

  { clave: "almacen.insumos", titulo: "Insumos maestro", seccion: "Almacén", url: "/presupuestos/insumos", rutas: ["/presupuestos/insumos"] },
  { clave: "almacen.aprobar_insumos", titulo: "Aprobación de insumos", seccion: "Almacén", url: "/presupuestos/admin-insumos", rutas: ["/presupuestos/admin-insumos"] },
  { clave: "almacen.proveedores", titulo: "Proveedores", seccion: "Almacén", url: "/almacen/proveedores", rutas: ["/almacen/proveedores"] },
  { clave: "almacen.entradas", titulo: "Entradas", seccion: "Almacén", url: "/almacen/entradas", rutas: ["/almacen/entradas"] },
  { clave: "almacen.inventario", titulo: "Inventario", seccion: "Almacén", url: "/almacen/inventario", rutas: ["/almacen/inventario"] },
  { clave: "almacen.salidas", titulo: "Salidas", seccion: "Almacén", url: "/almacen/salidas", rutas: ["/almacen/salidas"] },

  { clave: "compras.comprar_pedidos", titulo: "Comprar pedidos", seccion: "Compras", url: "/almacen/comprar-pedidos", rutas: ["/almacen/comprar-pedidos", "/almacen/generar-oc"] },
  { clave: "compras.ordenes", titulo: "Órdenes de compra", seccion: "Compras", url: "/almacen/ordenes-compra", rutas: ["/almacen/ordenes-compra"] },
  { clave: "compras.aprobar_oc", titulo: "Aprobación de órdenes de compra", seccion: "Compras", url: "/almacen/aprobar-oc", rutas: ["/almacen/aprobar-oc"] },

  { clave: "contratos.contratos", titulo: "Contratos", seccion: "Contratos", url: "/", rutas: [], nota: "Todavía sin página." },
  { clave: "contratos.cortes", titulo: "Cortes de proyectos", seccion: "Contratos", url: "/", rutas: [], nota: "Todavía sin página." },
  { clave: "contratos.informes", titulo: "Informes", seccion: "Contratos", url: "/", rutas: [], nota: "Todavía sin página." },

  { clave: "admin.visualizacion", titulo: "Visualización de proyectos", seccion: "Administración", url: "/admin/visualizacion", rutas: ["/admin/visualizacion"] },
]

// Pestañas que SOLO ve el Administrador (no aparecen en la matriz).
export const PESTANAS_SOLO_ADMIN: { titulo: string; url: string }[] = [
  { titulo: "Control administrativo", url: "/admin" },
  { titulo: "Roles y permisos", url: "/admin/roles" },
  { titulo: "Usuarios y accesos", url: "/admin/accesos" },
]
const RUTA_SOLO_ADMIN = "/admin"

export type Accion = {
  clave: string
  titulo: string
  descripcion: string
  seccion: string
}

export const ACCIONES: Accion[] = [
  { clave: "editar_presupuestos", titulo: "Editar presupuestos", descripcion: "Crear y modificar presupuestos, APU y versiones de los proyectos a los que tiene acceso.", seccion: "Presupuestos" },
  { clave: "aprobar_pedidos", titulo: "Aprobar pedidos de insumos", descripcion: "Aprobar o rechazar los pedidos de insumos de los ingenieros (y ver los de todos los proyectos).", seccion: "Técnico" },
  { clave: "desaprobar_pedidos", titulo: "Desaprobar pedidos de insumos", descripcion: "Devolver un pedido aprobado a pendiente, si todavía no está en una orden de compra.", seccion: "Técnico" },
  { clave: "cancelar_pedidos", titulo: "Cancelar pedidos de insumos", descripcion: "Cancelar pedidos de otras personas y pedidos ya aprobados que no estén en una orden de compra. Quien hizo un pedido siempre puede cancelar el suyo mientras esté pendiente.", seccion: "Técnico" },
  { clave: "aprobar_mano_obra", titulo: "Aprobar mano de obra y equipos", descripcion: "Resolver las solicitudes de mano de obra y de equipo.", seccion: "Técnico" },
  { clave: "aprobar_insumos", titulo: "Aprobar insumos nuevos", descripcion: "Aprobar solicitudes de insumos y editar el maestro de insumos.", seccion: "Almacén" },
  { clave: "gestionar_almacen", titulo: "Gestionar bodega", descripcion: "Registrar, editar y anular entradas y salidas de almacén.", seccion: "Almacén" },
  { clave: "comprar", titulo: "Comprar", descripcion: "Comprar pedidos, crear órdenes de compra y marcarlas como enviadas.", seccion: "Compras" },
  { clave: "aprobar_oc", titulo: "Aprobar / rechazar órdenes de compra", descripcion: "Aprobar o rechazar órdenes de compra pendientes.", seccion: "Compras" },
  { clave: "desaprobar_oc", titulo: "Desaprobar órdenes de compra", descripcion: "Devolver una orden aprobada a pendiente.", seccion: "Compras" },
  { clave: "cancelar_oc", titulo: "Cancelar órdenes de compra", descripcion: "Cancelar órdenes aprobadas que todavía no tienen entregas.", seccion: "Compras" },
]

export const permisoPestana = (clave: string) => `tab.${clave}`
export const permisoAccion = (clave: string) => `accion.${clave}`

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export type EvaluacionRuta =
  | { tipo: "libre" }
  | { tipo: "solo_admin" }
  | { tipo: "pestanas"; claves: string[] }

// Gana la ruta más específica: "/almacen/entradas" pertenece a la pestaña
// Entradas y no a Pedidos ("/almacen"), aunque "/almacen" sea prefijo.
export function evaluarRuta(pathname: string): EvaluacionRuta {
  const coincide = (ruta: string) => pathname === ruta || pathname.startsWith(ruta + "/")

  let mejor = -1
  let claves: string[] = []
  let soloAdmin = false

  if (coincide(RUTA_SOLO_ADMIN)) {
    mejor = RUTA_SOLO_ADMIN.length
    soloAdmin = true
  }

  for (const p of PESTANAS) {
    for (const ruta of p.rutas) {
      if (!coincide(ruta)) continue
      if (ruta.length > mejor) {
        mejor = ruta.length
        claves = [p.clave]
        soloAdmin = false
      } else if (ruta.length === mejor && !soloAdmin) {
        claves.push(p.clave)
      }
    }
  }

  if (soloAdmin) return { tipo: "solo_admin" }
  if (claves.length > 0) return { tipo: "pestanas", claves }
  return { tipo: "libre" }
}

// Solo para usuarios CON rol. Los que no tienen rol se validan por sus
// banderas anteriores en el middleware.
export function puedeAccederRuta(permisos: PermisosRol, pathname: string): boolean {
  if (permisos.esAdministrador) return true
  const e = evaluarRuta(pathname)
  if (e.tipo === "libre") return true
  if (e.tipo === "solo_admin") return false
  return e.claves.some((c) => permisos.pestanas.includes(c))
}

// A dónde mandar al usuario cuando entra sin ruta o no puede ver la que pidió.
export function rutaInicio(permisos: PermisosRol): string {
  if (permisos.esAdministrador || permisos.sinRol) return "/presupuestos"
  const primera = PESTANAS.find((p) => permisos.pestanas.includes(p.clave) && p.url !== "/")
  return primera ? primera.url : "/sin-acceso"
}

// ---------------------------------------------------------------------------
// Menú lateral
// ---------------------------------------------------------------------------

export type GrupoMenu = { titulo: string; items: { titulo: string; url: string }[] }

export function construirMenu(permisos: PermisosRol): GrupoMenu[] {
  const veTodo = permisos.esAdministrador || permisos.sinRol
  const grupos = new Map<string, GrupoMenu>()

  for (const p of PESTANAS) {
    if (!veTodo && !permisos.pestanas.includes(p.clave)) continue
    // Sin rol y sin ser Administrador: la sección de administración no se
    // muestra (sus rutas les están bloqueadas).
    if (permisos.sinRol && !permisos.esAdministrador && p.seccion === "Administración") continue
    const g = grupos.get(p.seccion) ?? { titulo: p.seccion, items: [] }
    g.items.push({ titulo: p.titulo, url: p.url })
    grupos.set(p.seccion, g)
  }

  if (permisos.esAdministrador) {
    const g = grupos.get("Administración") ?? { titulo: "Administración", items: [] }
    // Control administrativo, Roles y Usuarios primero; Visualización después.
    g.items = [...PESTANAS_SOLO_ADMIN.map((x) => ({ titulo: x.titulo, url: x.url })), ...g.items]
    grupos.set("Administración", g)
  }

  return [...grupos.values()]
}

// ---------------------------------------------------------------------------
// Permisos de un usuario SIN rol, derivados de las banderas anteriores de
// perfiles. Los usa el middleware y lib/permisos.ts cuando la migración de
// roles todavía no está corrida (la función permisos_rol_usuario no existe).
// ---------------------------------------------------------------------------

export type BanderasPerfil = {
  es_admin?: boolean | null
  admin_insumos?: boolean | null
  admin_proyectos?: boolean | null
  admin_mano_obra?: boolean | null
  rol_compras?: boolean | null
}

export function permisosDesdeBanderas(b: BanderasPerfil | null | undefined): PermisosRol {
  const admin = Boolean(b?.es_admin)
  const acciones: string[] = []
  if (admin || b?.rol_compras) acciones.push("comprar")
  if (admin || b?.admin_insumos) acciones.push("aprobar_insumos", "gestionar_almacen")
  if (admin || b?.admin_proyectos || b?.admin_insumos) {
    acciones.push("aprobar_pedidos", "desaprobar_pedidos", "cancelar_pedidos")
  }
  if (admin || b?.admin_mano_obra) acciones.push("aprobar_mano_obra")
  if (admin) acciones.push("aprobar_oc", "desaprobar_oc", "cancelar_oc", "editar_presupuestos")

  return {
    sinRol: true,
    rolId: null,
    rolClave: null,
    rolNombre: null,
    esAdministrador: admin,
    pestanas: [],
    acciones,
    todosProyectos: admin,
  }
}

// Rutas que un usuario SIN rol puede abrir según sus banderas anteriores
// (mismo mapa que tenía el middleware). Todo lo demás bajo /admin exige ser
// Administrador.
const RUTAS_ACCION_SIN_ROL: Record<string, string> = {
  "/almacen/entradas": "gestionar_almacen",
  "/almacen/salidas": "gestionar_almacen",
  "/almacen/proveedores": "comprar",
  "/admin-tecnico": "aprobar_pedidos",
  "/presupuestos/admin-insumos": "aprobar_insumos",
}

export function puedeAccederRutaSinRol(permisos: PermisosRol, pathname: string): boolean {
  if (permisos.esAdministrador) return true

  const exacta = Object.entries(RUTAS_ACCION_SIN_ROL).find(([ruta]) => pathname.startsWith(ruta))
  if (exacta) return permisos.acciones.includes(exacta[1])

  return !pathname.startsWith("/admin")
}
