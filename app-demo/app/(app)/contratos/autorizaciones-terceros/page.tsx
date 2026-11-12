import { obtenerPermisosRol } from "@/lib/permisos"
import { AutorizacionesTerceroView } from "@/components/autorizaciones-tercero-view"

// Pestaña contratos.autorizar_terceros (middleware). Aprobar o rechazar exige
// además la acción aprobar_contratos (Jurídica); la base lo vuelve a revisar
// (resolver_autorizacion_acta). ?ver=<id del acta> la abre (campanita).
export default async function AutorizacionesTercerosPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_contratos"))
  return <AutorizacionesTerceroView puedeResolver={puedeResolver} verInicial={ver ?? null} />
}
