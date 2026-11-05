import { redirect } from "next/navigation"
import { obtenerPermisosRol } from "@/lib/permisos"
import { createClient } from "@/lib/supabase/server"
import { SolicitudesContratosView } from "@/components/solicitudes-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.solicitar (middleware).
// Mandar solicitudes exige además la acción 'solicitar_contratos' (o ser
// Administrador), igual que crear_solicitud_contrato y el bucket `contratos`.
// ?ver=<id> abre el detalle de una solicitud (enlace de la campanita y de Mis
// pendientes); si es un contrato general, se abre en Contratos generales.
export default async function SolicitarContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeSolicitar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("solicitar_contratos"))

  if (ver) {
    const supabase = await createClient()
    const { data } = await supabase.from("contratos").select("clase").eq("id", ver).maybeSingle()
    if ((data as { clase?: string } | null)?.clase === "general") redirect(`/contratos/generales?ver=${encodeURIComponent(ver)}`)
  }

  return <SolicitudesContratosView puedeSolicitar={puedeSolicitar} verInicial={ver ?? null} />
}
