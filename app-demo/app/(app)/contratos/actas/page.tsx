import { obtenerPermisosRol } from "@/lib/permisos"
import { ActasContratosView } from "@/components/actas-contratos-view"

// El acceso a la ruta lo controla la pestaña contratos.cortes (middleware).
// Crear actas exige además la acción 'elaborar_actas' (o ser Administrador),
// igual que crear_acta en la base.
export default async function ElaboracionActasPage() {
  const permisos = await obtenerPermisosRol()
  const puedeElaborar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("elaborar_actas"))

  return <ActasContratosView puedeElaborar={puedeElaborar} />
}
