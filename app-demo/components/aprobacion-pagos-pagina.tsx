"use client"

import { useState } from "react"
import { AprobacionPagosView } from "@/components/aprobacion-pagos-view"
import { AprobacionReqAdminView } from "@/components/aprobacion-req-admin-view"

type Vista = "pagos" | "requisiciones"

const VISTAS: { valor: Vista; etiqueta: string }[] = [
  { valor: "pagos", etiqueta: "Pagos" },
  { valor: "requisiciones", etiqueta: "Requisiciones administrativas" },
]

// Aprobación de pagos: los pagos (saldos de OC, actas) y las requisiciones
// administrativas, que se aprueban completas.
export function AprobacionPagosPagina({
  puedeAprobar,
  puedeResolicitar,
  vistaInicial,
}: {
  puedeAprobar: boolean
  puedeResolicitar: boolean
  vistaInicial: Vista
}) {
  const [vista, setVista] = useState<Vista>(vistaInicial)
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex gap-1.5 border-b">
        {VISTAS.map((v) => (
          <button
            key={v.valor}
            type="button"
            onClick={() => setVista(v.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              vista === v.valor ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {vista === "pagos" ? (
          <AprobacionPagosView puedeAprobar={puedeAprobar} puedeResolicitar={puedeResolicitar} />
        ) : (
          <AprobacionReqAdminView puedeAprobar={puedeAprobar} />
        )}
      </div>
    </div>
  )
}
