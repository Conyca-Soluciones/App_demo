import { PolizasView } from "@/components/polizas-view"

// El acceso a la ruta lo controla la pestaña contratos.polizas (middleware);
// subir la póliza lo vuelve a revisar subir_poliza en la base. ?ver=<id del
// contrato> abre ese contrato (aviso de la campanita).
export default async function PolizasPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams
  return <PolizasView verInicial={ver ?? null} />
}
