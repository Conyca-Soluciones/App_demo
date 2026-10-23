import { redirect } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { createClient } from "@/lib/supabase/server"
import { ActasContratosView } from "@/components/actas-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.cortes (middleware).
// Crear actas exige además la acción 'elaborar_actas' (o ser Administrador),
// igual que crear_acta en la base. ?ver=<id> abre un acta (aviso de la
// campanita, Mis pendientes); si es de un contrato general, se abre en Actas
// generales.
export default async function ElaboracionActasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeElaborar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("elaborar_actas"))

  if (ver) {
    const supabase = await createClient()
    const { data } = await supabase.from("actas").select("contrato:contratos(clase)").eq("id", ver).maybeSingle()
    const contrato = (data as { contrato?: { clase?: string } | null } | null)?.contrato
    if (contrato?.clase === "general") redirect(`/contratos/actas-generales?ver=${encodeURIComponent(ver)}`)
  }

  return <ActasContratosView puedeElaborar={puedeElaborar} verInicial={ver ?? null} />
}
