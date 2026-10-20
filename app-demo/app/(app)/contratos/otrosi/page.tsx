import { obtenerPermisosRol } from "@/lib/permisos"
import { SolicitudOtrosiView } from "@/components/solicitud-otrosi-view"

// El acceso a la ruta lo controla la pestaña contratos.solicitar_otrosi
// (middleware). Pedir otrosí exige además la acción 'solicitar_contratos' (o
// ser Administrador), igual que crear_otrosi en la base. ?ver=<id> abre el
// detalle de un otrosí (campanita).
export default async function SolicitudOtrosiPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeSolicitar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("solicitar_contratos"))

  return <SolicitudOtrosiView puedeSolicitar={puedeSolicitar} verInicial={ver ?? null} />
}
