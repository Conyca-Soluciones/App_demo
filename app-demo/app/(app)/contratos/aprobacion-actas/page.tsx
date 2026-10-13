import { obtenerPermisosRol } from "@/lib/permisos"
import { AprobacionActasView } from "@/components/aprobacion-actas-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_actas
// (middleware). Aprobar o rechazar exige además la acción 'aprobar_actas' (o
// ser Administrador), igual que resolver_acta en la base.
export default async function AprobacionActasPage() {
  const permisos = await obtenerPermisosRol()
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_actas"))

  return <AprobacionActasView puedeResolver={puedeResolver} />
}
