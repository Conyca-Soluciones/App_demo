import { obtenerPermisosRol } from "@/lib/permisos"
import { AprobacionPolizasView } from "@/components/aprobacion-polizas-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_polizas
// (middleware). Aprobar o devolver exige además la acción aprobar_contratos
// (Jurídica); la base lo vuelve a revisar (resolver_poliza). ?ver=<id del
// contrato> abre su póliza por revisar (aviso de la campanita).
export default async function AprobacionPolizasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_contratos"))
  return <AprobacionPolizasView puedeResolver={puedeResolver} verInicial={ver ?? null} />
}
