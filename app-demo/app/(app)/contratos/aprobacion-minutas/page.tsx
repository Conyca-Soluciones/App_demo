import { obtenerPermisosRol } from "@/lib/permisos"
import { AprobacionMinutasView } from "@/components/aprobacion-minutas-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_minutas
// (middleware). Aprobar o devolver exige además la acción 'aprobar_minutas'
// (o ser Administrador), igual que resolver_minuta_contrato en la base.
// ?ver=<id> abre una minuta (campanita).
export default async function AprobacionMinutasPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_minutas"))

  return <AprobacionMinutasView puedeResolver={puedeResolver} verInicial={ver ?? null} />
}
