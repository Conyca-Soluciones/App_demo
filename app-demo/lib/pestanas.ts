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

// MÓDULOS de la plataforma: AdPro (Administración de Proyectos), A&F
// (Administrativo y Financiero) y Admin (Administrador de la plataforma, solo
// para el rol Administrador; sus pestañas son PESTANAS_SOLO_ADMIN). Una pestaña
// pertenece a un módulo con `modulo` (por omisión, AdPro); las claves de
// permisos ('tab.<clave>') NO cambian al mover pestañas entre módulos.
export type ModuloClave = "adpro" | "ayf" | "admin"

export const MODULOS: { clave: ModuloClave; titulo: string; descripcion: string }[] = [
  { clave: "adpro", titulo: "AdPro", descripcion: "Administración de Proyectos" },
  { clave: "ayf", titulo: "A&F", descripcion: "Administrativo y Financiero" },
  { clave: "admin", titulo: "Admin", descripcion: "Administrador de la plataforma" },
]

export type Pestana = {
  clave: string
  titulo: string
  // Módulo al que pertenece (por omisión AdPro).
  modulo?: ModuloClave
  seccion: string
  // Subgrupo dentro de la sección (p. ej. "Actas" en Contratos): en el menú
  // sale como encabezado sobre sus pestañas. Las pestañas de un subgrupo van
  // seguidas en PESTANAS.
  subseccion?: string
  // A dónde lleva en el menú.
  url: string
  // Rutas (y todo lo que cuelga de ellas) que esta pestaña habilita. Vacío =
  // no restringe ninguna ruta (pestañas todavía sin página propia).
  rutas: string[]
  nota?: string
}

// Orden = orden del menú y de las filas de la matriz. Las claves NO cambian
// aunque se renombre o se mueva una pestaña (en la base están como
// 'tab.<clave>'): solo cambian título y sección.
export const PESTANAS: Pestana[] = [
  // Presupuestos: Elaboración y el subgrupo Insumos y APU (catálogos que usan
  // los APU; antes Maestra y Aprobación de insumos estaban en Compras y
  // Aprobación de mano de obra en Requisiciones).
  { clave: "presupuestos.elaboracion", titulo: "Elaboración de presupuestos", seccion: "Presupuestos", url: "/presupuestos", rutas: ["/presupuestos", "/presupuestos/apu", "/presupuestos/graficas"] },
  { clave: "almacen.insumos", titulo: "Maestra de insumos", seccion: "Presupuestos", subseccion: "Insumos y APU", url: "/presupuestos/insumos", rutas: ["/presupuestos/insumos"] },
  { clave: "almacen.aprobar_insumos", titulo: "Aprobación de insumos", seccion: "Presupuestos", subseccion: "Insumos y APU", url: "/presupuestos/admin-insumos", rutas: ["/presupuestos/admin-insumos"] },
  { clave: "tecnico.aprobar_mano_obra", titulo: "Aprobación de mano de obra y equipos", seccion: "Presupuestos", subseccion: "Insumos y APU", url: "/presupuestos/admin-mo", rutas: ["/presupuestos/admin-mo"] },

  { clave: "tecnico.pedidos", titulo: "Elaboración de requisiciones", seccion: "Requisiciones", url: "/almacen", rutas: ["/almacen"] },
  { clave: "tecnico.registro_pedidos", titulo: "Registro de requisiciones", seccion: "Requisiciones", url: "/almacen/registro-requisiciones", rutas: ["/almacen/registro-requisiciones"] },
  { clave: "tecnico.aprobar_pedidos", titulo: "Aprobación de requisiciones", seccion: "Requisiciones", url: "/admin-tecnico", rutas: ["/admin-tecnico"] },

  // Compras: subgrupo Requisiciones (lo que falta comprar), subgrupo Órdenes de
  // compra y Proveedores. comprar_pedidos = Requisiciones por comprar,
  // ordenes = Registro de órdenes de compra.
  { clave: "compras.comprar_pedidos", titulo: "Requisiciones por comprar", seccion: "Compras", subseccion: "Requisiciones", url: "/almacen/comprar-pedidos", rutas: ["/almacen/comprar-pedidos", "/almacen/generar-oc"] },
  { clave: "compras.saldos_pendientes", titulo: "Saldos pendientes", seccion: "Compras", subseccion: "Requisiciones", url: "/almacen/saldos-pendientes", rutas: ["/almacen/saldos-pendientes"], nota: "Requisiciones compradas a medias, para cerrar su saldo." },
  { clave: "compras.ordenes", titulo: "Registro de órdenes de compra", seccion: "Compras", subseccion: "Órdenes de compra", url: "/almacen/ordenes-compra", rutas: ["/almacen/ordenes-compra"] },
  { clave: "compras.aprobar_oc", titulo: "Aprobación de órdenes de compra", seccion: "Compras", subseccion: "Órdenes de compra", url: "/almacen/aprobar-oc", rutas: ["/almacen/aprobar-oc"] },
  { clave: "almacen.proveedores", titulo: "Proveedores", seccion: "Compras", url: "/almacen/proveedores", rutas: ["/almacen/proveedores"] },

  // Almacén en el orden en que se trabaja.
  { clave: "almacen.entradas", titulo: "Entradas", seccion: "Almacén", url: "/almacen/entradas", rutas: ["/almacen/entradas"] },
  { clave: "almacen.salidas", titulo: "Salidas", seccion: "Almacén", url: "/almacen/salidas", rutas: ["/almacen/salidas"] },
  { clave: "almacen.inventario", titulo: "Inventario", seccion: "Almacén", url: "/almacen/inventario", rutas: ["/almacen/inventario"] },

  // Contratos: Contratistas, el subgrupo Contratos, el subgrupo Actas e Informes.
  // Claves de antes con nombre nuevo: solicitar = Contratos por grupos,
  // contratos = Contratos generales, preaprobacion = Pre aprobación de contratos,
  // aprobar_minutas = Aprobación de contratos (Subgerencia),
  // cortes = Actas por grupos.
  { clave: "contratos.contratistas", titulo: "Contratistas", seccion: "Contratos", url: "/contratos/contratistas", rutas: ["/contratos/contratistas"] },
  { clave: "contratos.solicitar", titulo: "Contratos por grupos", seccion: "Contratos", subseccion: "Contratos", url: "/contratos/solicitar", rutas: ["/contratos/solicitar"] },
  { clave: "contratos.contratos", titulo: "Contratos generales", seccion: "Contratos", subseccion: "Contratos", url: "/contratos/generales", rutas: ["/contratos/generales"] },
  { clave: "contratos.preaprobacion", titulo: "Pre aprobación de contratos", seccion: "Contratos", subseccion: "Contratos", url: "/contratos/pre-aprobacion", rutas: ["/contratos/pre-aprobacion"] },
  { clave: "contratos.aprobar_minutas", titulo: "Aprobación de contratos", seccion: "Contratos", subseccion: "Contratos", url: "/contratos/aprobacion-minutas", rutas: ["/contratos/aprobacion-minutas"] },
  // Otrosí (20261119000000_otrosis.sql): el PDF va en una ruta de las dos pestañas.
  { clave: "contratos.solicitar_otrosi", titulo: "Solicitud de otrosí", seccion: "Contratos", subseccion: "Otrosí", url: "/contratos/otrosi", rutas: ["/contratos/otrosi", "/contratos/otrosi-pdf"] },
  { clave: "contratos.aprobar_otrosi", titulo: "Aprobación de otrosí", seccion: "Contratos", subseccion: "Otrosí", url: "/contratos/aprobacion-otrosi", rutas: ["/contratos/aprobacion-otrosi", "/contratos/otrosi-pdf"] },
  { clave: "contratos.cortes", titulo: "Actas por grupos", seccion: "Contratos", subseccion: "Actas", url: "/contratos/actas", rutas: ["/contratos/actas", "/contratos/acta-pdf"] },
  { clave: "contratos.actas_generales", titulo: "Actas generales", seccion: "Contratos", subseccion: "Actas", url: "/", rutas: [], nota: "Todavía sin página." },
  { clave: "contratos.aprobar_actas", titulo: "Aprobación de actas", seccion: "Contratos", subseccion: "Actas", url: "/contratos/aprobacion-actas", rutas: ["/contratos/aprobacion-actas", "/contratos/acta-pdf"] },
  { clave: "contratos.informes", titulo: "Informes", seccion: "Contratos", url: "/", rutas: [], nota: "Todavía sin página." },

  { clave: "admin.visualizacion", titulo: "Control del proyecto", seccion: "Control", url: "/admin/visualizacion", rutas: ["/admin/visualizacion"] },

  // A&F (Administrativo y Financiero)
  { clave: "ayf.aprobacion_pagos", titulo: "Aprobación de pagos", modulo: "ayf", seccion: "Pagos", url: "/ayf/aprobacion-pagos", rutas: ["/ayf/aprobacion-pagos"] },
  { clave: "ayf.consolidado", titulo: "Consolidado de pagos", modulo: "ayf", seccion: "Pagos", url: "/ayf/consolidado", rutas: ["/ayf/consolidado"] },
  { clave: "ayf.terceros", titulo: "Terceros", modulo: "ayf", seccion: "Terceros", url: "/ayf/terceros", rutas: ["/ayf/terceros"] },
]

// Pestañas que SOLO ve el Administrador (no aparecen en la matriz): el módulo
// Admin del menú, con sus secciones.
export const PESTANAS_SOLO_ADMIN: { titulo: string; seccion: string; url: string }[] = [
  { titulo: "Control administrativo", seccion: "Empresas y proyectos", url: "/admin" },
  { titulo: "Roles y permisos", seccion: "Usuarios y permisos", url: "/admin/roles" },
  { titulo: "Usuarios y accesos", seccion: "Usuarios y permisos", url: "/admin/accesos" },
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
  { clave: "aprobar_insumos", titulo: "Aprobar insumos nuevos", descripcion: "Aprobar solicitudes de insumos y editar la maestra de insumos.", seccion: "Presupuestos" },
  { clave: "aprobar_mano_obra", titulo: "Aprobar mano de obra y equipos", descripcion: "Resolver las solicitudes de mano de obra y de equipo.", seccion: "Presupuestos" },
  { clave: "aprobar_pedidos", titulo: "Aprobar requisiciones", descripcion: "Aprobar o rechazar las requisiciones de insumos de los ingenieros (y ver las de todos los proyectos).", seccion: "Requisiciones" },
  { clave: "desaprobar_pedidos", titulo: "Desaprobar requisiciones", descripcion: "Devolver una requisición aprobada a pendiente, si todavía no está en una orden de compra.", seccion: "Requisiciones" },
  { clave: "comprar", titulo: "Comprar", descripcion: "Comprar requisiciones y crear órdenes de compra.", seccion: "Compras" },
  { clave: "editar_proveedores", titulo: "Editar proveedores", descripcion: "Crear proveedores y corregir sus datos, también desde la tarjeta del proveedor al generar una orden de compra.", seccion: "Compras" },
  { clave: "aprobar_oc", titulo: "Aprobar / rechazar órdenes de compra", descripcion: "Aprobar o rechazar órdenes de compra pendientes.", seccion: "Compras" },
  { clave: "desaprobar_oc", titulo: "Desaprobar órdenes de compra", descripcion: "Devolver una orden aprobada a pendiente.", seccion: "Compras" },
  { clave: "cancelar_oc", titulo: "Cancelar órdenes de compra", descripcion: "Cancelar órdenes aprobadas que todavía no tienen entregas.", seccion: "Compras" },
  { clave: "gestionar_almacen", titulo: "Gestionar bodega", descripcion: "Registrar, editar y anular entradas y salidas de almacén.", seccion: "Almacén" },
  { clave: "solicitar_contratos", titulo: "Solicitar contratos", descripcion: "Llenar y mandar a pre-aprobación solicitudes de contrato y de otrosí de los proyectos a los que tiene acceso.", seccion: "Contratos" },
  { clave: "aprobar_contratos", titulo: "Pre-aprobar contratos", descripcion: "Pre-aprobar (y enviar la minuta a Subgerencia), devolver con motivo o rechazar las solicitudes de contrato de los proyectos a los que tiene acceso. También arma el otrosí y lo envía a Subgerencia, lo devuelve o lo rechaza.", seccion: "Contratos" },
  { clave: "aprobar_minutas", titulo: "Aprobar contratos (Subgerencia)", descripcion: "Aprobar o devolver con motivo la minuta de los contratos que Jurídica pre-aprueba y envía a Subgerencia, de los proyectos a los que tiene acceso. Al aprobar, el contrato recibe su número y ya se le pueden hacer actas. También aprueba o devuelve los otrosí.", seccion: "Contratos" },
  { clave: "elaborar_actas", titulo: "Elaborar actas", descripcion: "Crear actas de los contratos con minuta aprobada de los proyectos a los que tiene acceso.", seccion: "Contratos" },
  { clave: "ver_datos_bancarios", titulo: "Ver datos bancarios de contratistas", descripcion: "Ver el banco, la cuenta y la certificación bancaria de los contratistas. Sin esta acción se ven como \"Restringido\".", seccion: "Contratos" },
  { clave: "gestionar_contratistas", titulo: "Gestionar contratistas", descripcion: "Crear contratistas con sus datos y documentos generales.", seccion: "Contratos" },
  { clave: "aprobar_pagos", titulo: "Aprobar pagos", descripcion: "Aprobar o rechazar los pagos pendientes (por ahora, los saldos de órdenes de compra con anticipo).", seccion: "A&F" },
  { clave: "gestionar_pagos", titulo: "Gestionar pagos", descripcion: "Elegir el tercero y la cuenta de un pago cuando no se resolvieron solos, y generar los pagos de una orden ya aprobada.", seccion: "A&F" },
  { clave: "editar_terceros", titulo: "Editar terceros", descripcion: "Crear terceros y agregar o corregir sus cuentas bancarias (las cuentas nuevas quedan pendientes de verificar).", seccion: "A&F" },
  { clave: "verificar_terceros", titulo: "Verificar cuentas de terceros", descripcion: "Confirmar que la cuenta bancaria de un tercero es correcta antes de poder pagarle. Ver el historial de cambios.", seccion: "A&F" },
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

// Landing (selección de proyecto): a donde se llega al iniciar sesión y a
// donde se manda a quien no puede ver la ruta que pidió. Es una ruta libre
// (no pertenece a ninguna pestaña), así que nunca se le niega a nadie.
export const RUTA_LANDING = "/inicio"

export function rutaInicio(_permisos?: PermisosRol): string {
  return RUTA_LANDING
}

// A dónde ir DESPUÉS de elegir un proyecto: la primera pestaña a la que el
// rol tiene acceso.
export function rutaPrimeraPestana(permisos: PermisosRol): string {
  if (permisos.esAdministrador || permisos.sinRol) return "/presupuestos"
  const primera = PESTANAS.find((p) => permisos.pestanas.includes(p.clave) && p.url !== "/")
  return primera ? primera.url : "/sin-acceso"
}

// ---------------------------------------------------------------------------
// Menú lateral
// ---------------------------------------------------------------------------

export type GrupoMenu = { titulo: string; items: { titulo: string; url: string; subseccion?: string }[] }

// Secciones y pestañas de UN módulo, filtradas por el rol del usuario.
export function construirMenu(permisos: PermisosRol, modulo: ModuloClave = "adpro"): GrupoMenu[] {
  const veTodo = permisos.esAdministrador || permisos.sinRol
  const grupos = new Map<string, GrupoMenu>()

  // Módulo Admin: solo el Administrador.
  if (modulo === "admin") {
    if (!permisos.esAdministrador) return []
    for (const p of PESTANAS_SOLO_ADMIN) {
      const g = grupos.get(p.seccion) ?? { titulo: p.seccion, items: [] }
      g.items.push({ titulo: p.titulo, url: p.url })
      grupos.set(p.seccion, g)
    }
    return [...grupos.values()]
  }

  for (const p of PESTANAS) {
    if ((p.modulo ?? "adpro") !== modulo) continue
    if (!veTodo && !permisos.pestanas.includes(p.clave)) continue
    // Sin rol y sin ser Administrador: la sección Control no se muestra (sus
    // rutas les están bloqueadas).
    if (permisos.sinRol && !permisos.esAdministrador && p.seccion === "Control") continue
    const g = grupos.get(p.seccion) ?? { titulo: p.seccion, items: [] }
    g.items.push({ titulo: p.titulo, url: p.url, subseccion: p.subseccion })
    grupos.set(p.seccion, g)
  }

  return [...grupos.values()]
}

export type ModuloMenu = {
  clave: ModuloClave
  titulo: string
  descripcion: string
  grupos: GrupoMenu[]
}

// Menú lateral completo: un bloque por módulo, cada uno con sus secciones.
// Un módulo sin pestañas todavía se devuelve con `grupos` vacío; Admin solo
// aparece para el Administrador.
export function construirModulos(permisos: PermisosRol): ModuloMenu[] {
  return MODULOS.filter((m) => m.clave !== "admin" || permisos.esAdministrador).map((m) => ({
    ...m,
    grupos: construirMenu(permisos, m.clave),
  }))
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
