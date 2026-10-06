import { MarcoPagina } from "@/components/encabezado-pagina"
import { SaldosPendientesView } from "@/components/saldos-pendientes-view"

// El acceso a la ruta lo controla la pestaña compras.saldos_pendientes
// (middleware); cerrar un saldo exige además ser de Compras (la base lo exige).
export default function SaldosPendientesPage() {
  return (
    <MarcoPagina titulo="Saldos pendientes" subtitulo="Requisiciones compradas a medias">
      <SaldosPendientesView />
    </MarcoPagina>
  )
}
