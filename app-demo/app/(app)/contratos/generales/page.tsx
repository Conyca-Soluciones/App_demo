import { obtenerPermisosRol } from "@/lib/permisos"
import { ContratosGeneralesView } from "@/components/contratos-generales-view"

// El acceso a la ruta lo controla la pestaña contratos.contratos (middleware).
// Elaborar contratos exige además la acción 'solicitar_contratos' (o ser
// Administrador), igual que crear_contrato_general y el bucket `contratos`.
// ?ver=<id> abre el detalle de un contrato (enlace de la campanita).
export default async function ContratosGeneralesPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeSolicitar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("solicitar_contratos"))

  return <ContratosGeneralesView puedeSolicitar={puedeSolicitar} verInicial={ver ?? null} />
}
