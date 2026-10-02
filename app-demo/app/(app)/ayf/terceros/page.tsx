import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { TercerosView } from "@/components/terceros-view"

// El acceso a la ruta lo controla la pestaña ayf.terceros (middleware y RLS).
// Crear/editar exige además la acción 'editar_terceros' y verificar cuentas la
// acción 'verificar_terceros' (o ser Administrador): la base las vuelve a exigir.
export default async function TercerosPage() {
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("editar_terceros"))
  const puedeVerificar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("verificar_terceros"))

  return (
    <MarcoPagina titulo="Terceros" subtitulo="A quién se le paga: documentos y cuentas bancarias">
      <TercerosView puedeEditar={puedeEditar} puedeVerificar={puedeVerificar} />
    </MarcoPagina>
  )
}
