// ---------------------------------------------------------------------------
// Proyecto actual: el que el usuario escoge en la landing (/inicio) al
// iniciar sesión, y que después usan Presupuestos y Pedidos sin volver a
// preguntarlo. Se guarda en una cookie (no en localStorage) para que el
// layout del servidor lo lea en el primer render -- sin parpadeo de "sin
// proyecto" mientras hidrata el cliente.
//
// La cookie guarda id + código + nombre para poder pintar el header sin
// consultar la base en cada navegación. No es un permiso: cada Server Action
// sigue validando el acceso al proyecto por su cuenta, igual que cuando el
// proyecto venía de un <Select> del cliente.
//
// Sin dependencias de servidor: se importa desde componentes de cliente.
// ---------------------------------------------------------------------------

export type ProyectoActual = {
  id: string
  codigo: string | null
  nombre: string
}

export const COOKIE_PROYECTO_ACTUAL = "proyecto_actual"

export function parsearCookieProyecto(valor: string | undefined): ProyectoActual | null {
  if (!valor) return null
  try {
    const p = JSON.parse(decodeURIComponent(valor))
    if (typeof p?.id !== "string" || typeof p?.nombre !== "string") return null
    return { id: p.id, codigo: typeof p.codigo === "string" ? p.codigo : null, nombre: p.nombre }
  } catch {
    return null
  }
}

export function etiquetaProyecto(p: ProyectoActual): string {
  return p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre
}
