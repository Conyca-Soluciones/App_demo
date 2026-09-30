import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import {
  permisosDesdeBanderas,
  puedeAccederRuta,
  puedeAccederRutaSinRol,
  rutaInicio,
  type PermisosRol,
} from "@/lib/pestanas"

// ---------------------------------------------------------------------------
// Patrón oficial de Supabase para Next.js: tu middleware.ts de la raíz es
// un wrapper delgado que solo llama a esto. Toda la lógica de refrescar
// la sesión + proteger rutas vive acá.
//
// PERMISOS: en cada request autenticado se consultan UNA vez los permisos del
// usuario (RPC permisos_rol_usuario: rol, pestañas, acciones). Con eso:
//   * se protege la ruta según la pestaña que la habilita (lib/pestanas.ts)
//   * se dejan los permisos en el header x-permisos, para que las Server
//     Actions (lib/permisos.ts) no tengan que volver a consultarlos.
// Un usuario SIN rol asignado sigue protegido por sus banderas anteriores
// (es_admin, admin_insumos...) exactamente como antes.
// ---------------------------------------------------------------------------

const RUTAS_PUBLICAS = ["/login"]

// Headers que SOLO el middleware puede escribir. Se borran siempre si vienen
// del cliente: si no, un usuario podría mandar "x-permisos" o "x-es-admin"
// falsos y pasar los chequeos de las Server Actions.
const HEADERS_DE_CONFIANZA = ["x-user-id", "x-permisos", "x-es-admin"]

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)

  for (const nombre of [...requestHeaders.keys()]) {
    if (HEADERS_DE_CONFIANZA.includes(nombre) || nombre.startsWith("x-scope-")) {
      requestHeaders.delete(nombre)
    }
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims() valida el JWT LOCALMENTE (firma ES256 contra la llave
  // pública del proyecto, que se descarga una vez y queda en caché) y
  // refresca la sesión si venció. Antes se usaba getUser(), que hace una
  // llamada de red a Supabase Auth en CADA request (navegación, server
  // action, prefetch). Diferencia a tener en cuenta: un usuario borrado o
  // bloqueado conserva acceso hasta que venza su token (1 h por defecto);
  // la base (RLS) sigue validando el mismo token en cada consulta.
  const { data: datosClaims } = await supabase.auth.getClaims()
  const userId = datosClaims?.claims?.sub ?? null

  const pathname = request.nextUrl.pathname
  const esRutaPublica = RUTAS_PUBLICAS.includes(pathname)

  if (!userId) {
    if (!esRutaPublica) {
      //No hay sesison y quiere acceder ruta privada redirecciona a login
      const url = request.nextUrl.clone()
      url.pathname = "/login"
      return NextResponse.redirect(url)
    }
    return conCookies(supabaseResponse, requestHeaders)
  }

  requestHeaders.set("x-user-id", userId)

  const permisos = await cargarPermisos(supabase, userId)
  requestHeaders.set("x-permisos", encodeURIComponent(JSON.stringify(permisos)))

  if (esRutaPublica) {
    // Con sesión, /login lleva a la landing de proyectos (/inicio), que
    // después manda a rutaInicio(permisos).
    const url = request.nextUrl.clone()
    url.pathname = "/inicio"
    return NextResponse.redirect(url)
  }

  const acceso = permisos.sinRol
    ? puedeAccederRutaSinRol(permisos, pathname)
    : puedeAccederRuta(permisos, pathname)

  if (!acceso) {
    const url = request.nextUrl.clone()
    const destino = rutaInicio(permisos)
    // Nunca redirigir a la misma ruta que se acaba de negar (bucle).
    url.pathname = destino === pathname ? "/sin-acceso" : destino
    url.search = ""
    if (url.pathname !== "/sin-acceso") url.searchParams.set("error", "no-autorizado")
    return NextResponse.redirect(url)
  }

  return conCookies(supabaseResponse, requestHeaders)
}

// Caché corto de permisos por usuario, en memoria del proceso. Una
// navegación dispara varios requests seguidos (página, RSC, server actions)
// y todos pedían el mismo RPC. Con 30 s de vida, un cambio de rol o de
// pestañas tarda como máximo eso en aplicarse (la base sigue validando las
// acciones con tiene_accion en cada función/política que las usa).
const PERMISOS_TTL_MS = 30_000
const MAX_USUARIOS_EN_CACHE = 1000
const cachePermisos = new Map<string, { permisos: PermisosRol; expira: number }>()

// Permisos del usuario. Si la función SQL no existe todavía (migración de
// roles sin correr) o falla, se cae a las banderas de perfiles: el código se
// puede desplegar antes que el SQL sin romper nada.
async function cargarPermisos(
  supabase: ReturnType<typeof createServerClient>,
  userId: string
): Promise<PermisosRol> {
  const ahora = Date.now()
  const enCache = cachePermisos.get(userId)
  if (enCache && enCache.expira > ahora) return enCache.permisos

  const permisos = await consultarPermisos(supabase, userId)
  // Tope de tamaño: si crece de más se vacía entero (O(1) amortizado, y la
  // próxima consulta de cada usuario simplemente vuelve a la base).
  if (cachePermisos.size >= MAX_USUARIOS_EN_CACHE) cachePermisos.clear()
  cachePermisos.set(userId, { permisos, expira: ahora + PERMISOS_TTL_MS })
  return permisos
}

async function consultarPermisos(
  supabase: ReturnType<typeof createServerClient>,
  userId: string
): Promise<PermisosRol> {
  const { data, error } = await supabase.rpc("permisos_rol_usuario", { p_usuario_id: userId })
  if (!error && data) return data as PermisosRol

  const { data: perfil } = await supabase
    .from("perfiles")
    .select("es_admin, admin_insumos, admin_proyectos, admin_mano_obra, rol_compras")
    .eq("id", userId)
    .single()

  return permisosDesdeBanderas(perfil)
}

function conCookies(supabaseResponse: NextResponse, requestHeaders: Headers) {
  // O(número de cookies), una pasada: copia las cookies de sesión refrescadas
  // a la respuesta final que lleva los headers del request.
  const respuestaFinal = NextResponse.next({
    request: { headers: requestHeaders },
  })
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    respuestaFinal.cookies.set(cookie)
  })

  return respuestaFinal
}
