"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { exportarPlantillaExcel } from "@/lib/exportar-plantilla"

export function ExportTemplateButton({
  columnas,
  nombreArchivo,
  nombreHoja,
  filasEjemplo,
  etiqueta = "Plantilla",
}: {
  columnas: string[]
  nombreArchivo: string
  nombreHoja?: string
  filasEjemplo?: (string | number)[][]
  etiqueta?: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-10 gap-1.5 rounded-sm px-3 text-xs"
      onClick={() =>
        exportarPlantillaExcel({
          columnas,
          nombreArchivo,
          nombreHoja,
          filasEjemplo,
        })
      }
    >
      <Download className="size-3.5" />
      {etiqueta}
    </Button>
  )
}