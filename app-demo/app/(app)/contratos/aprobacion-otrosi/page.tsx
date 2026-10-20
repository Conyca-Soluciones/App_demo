import { obtenerPermisosRol } from "@/lib/permisos"
import { AprobacionOtrosiView } from "@/components/aprobacion-otrosi-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_otrosi
// (middleware). Jurídica (acción aprobar_contratos) arma, envía, devuelve o
// rechaza; Subgerencia (aprobar_minutas) aprueba o devuelve a Jurídica; la
// base lo vuelve a revisar (resolver_otrosi). ?ver=<id> abre uno (campanita).
export default async function AprobacionOtrosiPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string }>
}) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeJuridica = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_contratos"))
  const puedeSubgerencia = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_minutas"))

  return <AprobacionOtrosiView puedeJuridica={puedeJuridica} puedeSubgerencia={puedeSubgerencia} verInicial={ver ?? null} />
}
