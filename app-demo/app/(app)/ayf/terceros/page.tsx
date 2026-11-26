import { obtenerPermisosRol } from "@/lib/permisos"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { TercerosPestanas } from "@/components/terceros-pestanas"

// El acceso a la ruta lo controla la pestaña ayf.terceros (middleware y RLS).
// Crear/editar exige además la acción 'editar_terceros' y verificar cuentas la
// acción 'verificar_terceros' (o ser Administrador): la base las vuelve a exigir.
// Cambiar RUT y certificación bancaria: acción 'cambiar_documentos_terceros'
// (20270101007200). ?tercero=<id> abre ese tercero (Mis pendientes: RUT por revisar).
export default async function TercerosPage({ searchParams }: { searchParams: Promise<{ vista?: string; tercero?: string }> }) {
  const { vista, tercero } = await searchParams
  const permisos = await obtenerPermisosRol()
  const puedeEditar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("editar_terceros"))
  const puedeVerificar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("verificar_terceros"))
  const puedeCambiarDocumentos = Boolean(
    permisos?.esAdministrador || permisos?.acciones.includes("cambiar_documentos_terceros")
  )

  return (
    <MarcoPagina titulo="Terceros" subtitulo="A quién se le paga: documentos y cuentas bancarias">
      <TercerosPestanas
        puedeEditar={puedeEditar}
        puedeVerificar={puedeVerificar}
        puedeCambiarDocumentos={puedeCambiarDocumentos}
        terceroInicial={tercero && /^[0-9a-f-]{36}$/i.test(tercero) ? tercero : null}
        vistaInicial={vista === "verificar" ? "verificar" : "terceros"}
      />
    </MarcoPagina>
  )
}
