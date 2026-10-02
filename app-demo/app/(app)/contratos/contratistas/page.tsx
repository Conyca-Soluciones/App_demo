import { obtenerPermisosRol } from "@/lib/permisos"
import { ContratistasView } from "@/components/contratistas-view"

// El acceso a la ruta lo controla la pestaña contratos.contratistas
// (middleware). Crear exige además la acción 'gestionar_contratistas' (o ser
// Administrador), igual que crear_contratista y las políticas del bucket.
export default async function ContratistasPage() {
  const permisos = await obtenerPermisosRol()
  const puedeCrear = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("gestionar_contratistas"))

  return <ContratistasView puedeCrear={puedeCrear} />
}
