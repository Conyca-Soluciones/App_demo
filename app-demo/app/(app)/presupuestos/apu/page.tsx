"use client"

import { FileUpload } from "@/components/file-upload"
import { PresupuestoTable } from "@/components/presupuesto-table"
import { useState } from "react"
import { Button } from "@/components/ui/button"

// ---------------------------------------------------------------------------
// TODO: tu función de procesamiento de APU va aquí, mismo patrón que
// procesarPresupuesto — recibe el archivo, lo procesa, retorna el arreglo.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ruta: /presupuestos/apu
// ---------------------------------------------------------------------------

export default function Apu() {
  const [apu, setApu] = useState<any[]>([])

  async function handleFileSelected(file: File) {
    // TODO: reemplazar por procesarAPU(file) cuando exista
    console.log("Archivo de APU recibido:", file.name)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">APU</h1>
        <p className="text-sm text-muted-foreground">
          Plantillas de análisis de precios unitarios.
        </p>
      </div>

      {apu.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 shadow-sm">
          <FileUpload
            accept=".xlsx,.xls"
            onFileSelected={handleFileSelected}
          />

          <p className="mt-4 text-center text-sm text-muted-foreground">
            Carga la plantilla de APU. Será revisada antes de guardarse.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {apu.length} componentes — revisa y edita antes de guardar
          </p>

          <PresupuestoTable data={apu} onChange={setApu} />

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="outline" onClick={() => setApu([])}>
              Descartar y cargar otro
            </Button>
            <Button
              onClick={() => {
                /* TODO: guardar en base de datos */
              }}
            >
              Guardar en base de datos
            </Button>
          </div>
        </>
      )}
    </div>
  )
}