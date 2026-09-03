import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Patrón oficial de Supabase para Next.js: tu middleware.ts de la raíz es
// un wrapper delgado que solo llama a esto. Toda la lógica de refrescar
// la sesión + proteger rutas vive acá.
//
// Rutas protegidas por SCOPE (no solo es_admin general): cada ruta bajo
// una de estas claves exige que el usuario tenga es_admin=true O el
// scope específico en perfiles. Agregar una ruta nueva es solo añadir
// una línea acá -- ej. cuando exista el scope admin_tecnica, cambiar la
// entrada de "/admin-tecnico" de "admin_proyectos" a "admin_tecnica".

const RUTAS_POR_SCOPE: Record<string, "admin_insumos" | "admin_proyectos" | "admin_usuarios"> = {
  "/admin-tecnico": "admin_proyectos", // TODO: migrar a admin_tecnica cuando exista ese scope
  "/presupuestos/admin-insumos": "admin_insumos",
}

const RUTAS_PUBLICAS = ["/login"]

export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)

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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const esRutaPublica = RUTAS_PUBLICAS.includes(request.nextUrl.pathname)

  if (!user && !esRutaPublica) {
    //No hay sesison y quiere acceder ruta privada redirecciona a login
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    return NextResponse.redirect(url)
  }

  if (user && esRutaPublica) {
    const url = request.nextUrl.clone()
    url.pathname = "/presupuestos"
    return NextResponse.redirect(url)
  }

  if (user) {
    requestHeaders.set("x-user-id", user.id)
  }

  // Cubre dos casos: rutas que literalmente empiezan con "/admin" (ej.
  // /admin, /admin-tecnico -- estas exigen es_admin salvo que además
  // tengan un scope específico en RUTAS_POR_SCOPE), Y rutas que están
  // en RUTAS_POR_SCOPE aunque NO empiecen con "/admin" (ej.
  // /presupuestos/admin-insumos, anidada bajo otra sección) -- sin
  // este segundo caso, esa ruta nunca entraba a este bloque en
  // absoluto y quedaba completamente sin proteger en el middleware
  // (la Server Action sí la protegía, pero solo con un 500 tardío en
  // vez de una redirección inmediata).
  const scopeDeRutaExacta = Object.entries(RUTAS_POR_SCOPE).find(([ruta]) =>
    request.nextUrl.pathname.startsWith(ruta)
  )?.[1]

  if (user && (request.nextUrl.pathname.startsWith("/admin") || scopeDeRutaExacta)) {
    const scopeRequerido = scopeDeRutaExacta

    // select FIJO (siempre las mismas 4 columnas) -- un .select() con
    // template string dinámico rompe la inferencia de tipos de Supabase
    // (ParserError). Cuál scope mirar se decide acá abajo, en JS, no en
    // la query.
    const { data: perfil } = await supabase
      .from("perfiles")
      .select("es_admin, admin_insumos, admin_proyectos, admin_usuarios")
      .eq("id", user.id)
      .single()

    const tienePermiso = scopeRequerido
      ? Boolean(perfil?.es_admin || perfil?.[scopeRequerido])
      : Boolean(perfil?.es_admin)

    if (!tienePermiso) {
      const url = request.nextUrl.clone()
      url.pathname = "/presupuestos"
      url.searchParams.set("error", "no-autorizado")
      return NextResponse.redirect(url)
    }

    requestHeaders.set("x-es-admin", String(Boolean(perfil?.es_admin)))
    if (scopeRequerido) {
      requestHeaders.set(`x-scope-${scopeRequerido}`, "true")
    }
  }
  //Mirar optimizacion porque esto es O(N2) creo 
  const respuestaFinal = NextResponse.next({
    request: { headers: requestHeaders },
  })
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    respuestaFinal.cookies.set(cookie)
  })

  return respuestaFinal
}