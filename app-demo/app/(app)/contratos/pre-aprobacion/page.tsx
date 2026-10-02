import { obtenerPermisosRol } from "@/lib/permisos"
import { PreaprobacionContratosView } from "@/components/preaprobacion-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.preaprobacion
// (middleware). Aprobar, devolver o rechazar exige además la acción
// 'aprobar_contratos' (o ser Administrador), igual que
// resolver_solicitud_contrato. ?ver=<id> abre una solicitud (campanita).
export default async function PreaprobacionContratosPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_contratos"))

  return <PreaprobacionContratosView puedeResolver={puedeResolver} verInicial={ver ?? null} />
}
