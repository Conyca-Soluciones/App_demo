import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Cliente con la SERVICE ROLE KEY -- permisos totales, se salta cualquier
// RLS. SOLO se puede llamar desde Server Actions o Route Handlers (nunca
// desde un componente de cliente ni exponerlo al navegador), y solo para
// operaciones de administración reales (crear usuarios, acá). Si esta key
// llega al navegador, cualquiera puede leer/escribir la base de datos
// entera sin restricción -- por eso vive en una variable de entorno SIN
// el prefijo NEXT_PUBLIC_ (agrégala en tu .env como
// SUPABASE_SERVICE_ROLE_KEY, la sacas del dashboard de Supabase en
// Project Settings > API > service_role -- NUNCA la subas a git).
// ---------------------------------------------------------------------------

export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}

//admin