"use client"

import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

// Extraída de LogoutButton para poder reutilizarla desde app-sidebar.tsx
// (el ícono de logout integrado en el bloque de usuario) sin duplicar la
// lógica de signOut -- LogoutButton sigue existiendo igual que antes,
// por si se usa como botón suelto en algún otro lugar de la app.
export async function handleLogout() {
  const supabase = createClient()
  await supabase.auth.signOut()
  // Recarga completa a propósito: así no queda nada de la sesión en memoria.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/login"
}

export function LogoutButton() {
  const router = useRouter()

  async function onClick() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      Cerrar sesión
    </Button>
  )
}