import { obtenerPermisosRol } from "@/lib/permisos"
import { SolicitudesContratosView } from "@/components/solicitudes-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.solicitar (middleware).
// Mandar solicitudes exige además la acción 'solicitar_contratos' (o ser
// Administrador), igual que crear_solicitud_contrato y el bucket `contratos`.
export default async function SolicitarContratosPage() {
  const permisos = await obtenerPermisosRol()
  const puedeSolicitar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("solicitar_contratos"))

  return <SolicitudesContratosView puedeSolicitar={puedeSolicitar} />
}
