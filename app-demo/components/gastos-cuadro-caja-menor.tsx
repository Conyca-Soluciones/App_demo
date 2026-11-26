"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DialogoLegalizacion } from "@/components/detalle-legalizacion-caja-menor"

// En el detalle de un cuadro de pago de caja menor (el reembolso, 20270101007400):
// abre la legalización con sus gastos y el soporte de cada uno (Gerencia en
// Aprobación de pagos, Contabilidad desde el consolidado, el responsable).
export function GastosDeCuadroCajaMenor({ legalizacionId }: { legalizacionId: string }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
      <span>Reembolso de caja menor: el soporte es la relación de gastos y cada gasto tiene su factura.</span>
      <Button type="button" size="sm" variant="outline" onClick={() => setAbierto(true)}>
        Ver gastos y soportes
      </Button>
      <DialogoLegalizacion id={abierto ? legalizacionId : null} onCerrar={() => setAbierto(false)} />
    </div>
  )
}
