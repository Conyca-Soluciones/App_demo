import { MarcoPagina } from "@/components/encabezado-pagina"
import { SaldosBancariosView } from "@/components/balances-view"

// Balances › Saldos bancarios (pestaña ayf.balances_saldos): solo consulta.
export default function SaldosBancariosPage() {
  return (
    <MarcoPagina titulo="Saldos bancarios" subtitulo="Saldo de cada cuenta a debitar. Doble clic para ver el extracto.">
      <SaldosBancariosView />
    </MarcoPagina>
  )
}
