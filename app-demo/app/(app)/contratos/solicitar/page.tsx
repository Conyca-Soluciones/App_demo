import { obtenerPermisosRol } from "@/lib/permisos"
import { SolicitudesContratosView } from "@/components/solicitudes-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.solicitar (middleware).
// Mandar solicitudes exige además la acción 'solicitar_contratos' (o ser
// Administrador), igual que crear_solicitud_contrato y el bucket `contratos`.
// ?ver=<id> abre el detalle de una solicitud (enlace de la campanita).
export default async function SolicitarContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeSolicitar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("solicitar_contratos"))

  return <SolicitudesContratosView puedeSolicitar={puedeSolicitar} verInicial={ver ?? null} />
}
