import { obtenerPermisosRol } from "@/lib/permisos"
import { ActasContratosView } from "@/components/actas-contratos-view"

// Actas generales: las actas de los contratos generales (pestaña
// contratos.actas_generales, middleware). Igual que Actas por grupos: crear
// exige la acción 'elaborar_actas'. Son de valor global: el acta es por % de
// ejecución y su pago es el neto de ese % (20261225000000_actas_generales.sql).
export default async function ActasGeneralesPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const [permisos, { ver }] = await Promise.all([obtenerPermisosRol(), searchParams])
  const puedeElaborar = Boolean(permisos?.esAdministrador || permisos?.acciones.includes("elaborar_actas"))

  return <ActasContratosView clase="general" puedeElaborar={puedeElaborar} verInicial={ver ?? null} />
}
