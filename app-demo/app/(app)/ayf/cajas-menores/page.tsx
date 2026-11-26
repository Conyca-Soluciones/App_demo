import { MarcoPagina } from "@/components/encabezado-pagina"
import { CajasMenoresView } from "@/components/cajas-menores-view"
import { obtenerPermisosRol } from "@/lib/permisos"

// Caja menor (20270101007400). El acceso a la ruta lo controla la pestaña
// ayf.cajas_menores (middleware); crear cajas y revisar soportes exige
// gestionar_cajas_menores (Financiera) y dar el okay aprobar_cajas_menores
// (Líder Financiera). La base lo vuelve a exigir. ?ver=<id> abre una legalización.
export default async function CajasMenoresPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams
  const permisos = await obtenerPermisosRol()
  const admin = Boolean(permisos?.esAdministrador)
  return (
    <MarcoPagina titulo="Cajas menores" subtitulo="Legalizaciones por revisar y aprobar, y las cajas de cada responsable (GF-PR-001)">
      <CajasMenoresView
        verInicial={ver ?? null}
        puedeGestionar={admin || Boolean(permisos?.acciones.includes("gestionar_cajas_menores"))}
        puedeAprobar={admin || Boolean(permisos?.acciones.includes("aprobar_cajas_menores"))}
      />
    </MarcoPagina>
  )
}
