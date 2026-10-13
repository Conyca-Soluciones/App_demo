import { obtenerPermisosRol } from "@/lib/permisos"
import { ActasContratosView } from "@/components/actas-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.cortes (middleware).
// Crear actas exige además la acción 'elaborar_actas' (o ser Administrador),
// igual que crear_acta en la base. ?ver=<id> abre un acta (aviso de la campanita).
export default async function ElaboracionActasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeElaborar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("elaborar_actas"))

  return <ActasContratosView puedeElaborar={puedeElaborar} verInicial={ver ?? null} />
}
