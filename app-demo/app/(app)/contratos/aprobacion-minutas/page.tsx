import { obtenerPermisosRol } from "@/lib/permisos"
import { AprobacionMinutasView } from "@/components/aprobacion-minutas-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_minutas
// (middleware). Aprobar o devolver exige además la acción 'aprobar_minutas'
// (o ser Administrador), igual que resolver_minuta_contrato en la base.
// ?ver=<id> abre una minuta (campanita).
export default async function AprobacionMinutasPage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string; vista?: string }>
}) {
  const [permisos, { ver, vista }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeResolver = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("aprobar_minutas"))
  // Contratos por encima del tope (20270101004200): acción aparte.
  const puedeAutorizarTope = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("autorizar_contratos_sobre_tope"))

  return (
    <AprobacionMinutasView
      puedeResolver={puedeResolver}
      puedeAutorizarTope={puedeAutorizarTope}
      verInicial={ver ?? null}
      vistaInicial={vista === "tope" ? "sobre_tope" : null}
    />
  )
}
