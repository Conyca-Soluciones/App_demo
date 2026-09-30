import { obtenerPermisosRol } from "@/lib/permisos"
import { rutaInicio } from "@/lib/pestanas"
import { InicioView } from "@/components/inicio-view"

// Landing después de iniciar sesión: se escoge el proyecto una vez y queda
// para Presupuestos y Pedidos (ver lib/proyecto-actual.ts). Ruta "libre" en
// lib/pestanas.ts (no pertenece a ninguna pestaña): cualquier usuario con
// sesión puede entrar.
export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const permisos = await obtenerPermisosRol()

  // `next` viene de la URL: solo se aceptan rutas internas ("/algo", nunca
  // "//otro-sitio.com") para no abrir un redirect a un dominio ajeno.
  const destino =
    next && next.startsWith("/") && !next.startsWith("//") && next !== "/inicio"
      ? next
      : permisos
        ? rutaInicio(permisos)
        : "/presupuestos"

  return <InicioView destino={destino} />
}
