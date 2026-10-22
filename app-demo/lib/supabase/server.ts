import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { fetchConReintento } from "@/lib/supabase/fetch-reintento"

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchConReintento() },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Se puede ignorar si tienes el middleware refrescando la sesión
            // (llamado desde un Server Component, que no puede escribir cookies).
          }
        },
      },
    }
  )
}

//server