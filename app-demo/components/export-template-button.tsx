"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { exportarPlantillaExcel } from "@/lib/exportar-plantilla"

export function ExportTemplateButton({
  columnas,
  nombreArchivo,
  nombreHoja,
  filasEjemplo,
  titulo,
  subtitulo,
  hojasAdicionales,
  etiqueta = "Plantilla",
}: {
  columnas: string[]
  nombreArchivo: string
  nombreHoja?: string
  filasEjemplo?: (string | number)[][]
  titulo?: string
  subtitulo?: string
  hojasAdicionales?: {
    nombreHoja: string
    titulo: string
    columnas: string[]
    filasEjemplo?: (string | number)[][]
  }[]
  etiqueta?: string
}) {
  // exportarPlantillaExcel ahora es async (arma el Excel con ExcelJS y
  // pide el logo por fetch) -- antes era síncrona con la librería
  // "xlsx", así que un click doble no tenía forma de pisarse a sí
  // mismo. Ahora sí, por eso el estado "generando" que deshabilita el
  // botón mientras arma el archivo.
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setGenerando(true)
    setError(null)
    try {
      await exportarPlantillaExcel({
        columnas,
        nombreArchivo,
        nombreHoja,
        filasEjemplo,
        titulo,
        subtitulo,
        hojasAdicionales,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar la plantilla.")
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-10 gap-1.5 rounded-sm px-3 text-xs"
        onClick={handleClick}
        disabled={generando}
      >
        <Download className="size-3.5" />
        {generando ? "Generando…" : etiqueta}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}