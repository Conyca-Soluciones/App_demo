"use client"

import { useState } from "react"
import { TercerosView } from "@/components/terceros-view"
import { CuentasPorVerificar } from "@/components/cuentas-por-verificar"

// Terceros: la lista de siempre y "Cuentas por verificar" (20261231200000).
// ?vista=verificar abre la segunda (el enlace de Mis pendientes).
export function TercerosPestanas({
  puedeEditar,
  puedeVerificar,
  vistaInicial,
}: {
  puedeEditar: boolean
  puedeVerificar: boolean
  vistaInicial: "terceros" | "verificar"
}) {
  // Solo quien edita o verifica terceros revisa cuentas (Contabilidad solo consulta).
  const conVerificar = puedeEditar || puedeVerificar
  const [vista, setVista] = useState(conVerificar ? vistaInicial : "terceros")
  if (!conVerificar) return <TercerosView puedeEditar={puedeEditar} puedeVerificar={puedeVerificar} />
  const pestanas = [
    { valor: "terceros" as const, titulo: "Terceros" },
    { valor: "verificar" as const, titulo: "Cuentas por verificar" },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex gap-1 border-b">
        {pestanas.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setVista(p.valor)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              vista === p.valor ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {vista === "terceros" ? (
        <TercerosView puedeEditar={puedeEditar} puedeVerificar={puedeVerificar} />
      ) : (
        <CuentasPorVerificar puedeEditar={puedeEditar} puedeVerificar={puedeVerificar} />
      )}
    </div>
  )
}
