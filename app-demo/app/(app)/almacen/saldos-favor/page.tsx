import { MarcoPagina } from "@/components/encabezado-pagina"
import { SaldosFavorView } from "@/components/saldos-favor-view"
import { obtenerPermisosRol } from "@/lib/permisos"

// Paquete C (20261231999200). El acceso a la ruta lo controla la pestaña
// compras.saldos_favor (middleware); cerrar un saldo exige además la acción
// Comprar (la base la vuelve a exigir).
export default async function SaldosFavorPage() {
  const permisos = await obtenerPermisosRol()
  const puedeCerrar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("comprar"))
  return (
    <MarcoPagina titulo="Saldos a favor" subtitulo="Lo que se le pagó de más a un proveedor, para usarlo en la siguiente compra">
      <SaldosFavorView puedeCerrar={puedeCerrar} />
    </MarcoPagina>
  )
}
