"use client"

import { useRef, useState } from "react"
import { FileCheck2, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { VisorDocumento } from "@/components/visor-documento"
import { createClient } from "@/lib/supabase/client"
import { formatearFechaSinHora } from "@/lib/fechas"
import { rutaArchivoFirmado, validarArchivoFirmado, type ArchivoFirmado } from "@/lib/contratos-firmados"
import type { ColumnaExcel } from "@/components/tabla-excel"
import type { SolicitudContratoFila } from "@/lib/contratos"
import { enlaceFirmado, subirContratoFirmado, subirOtrosiFirmado } from "@/app/(app)/contratos/firmados/actions"

// ---------------------------------------------------------------------------
// Botones de la copia firmada por el contratista (contrato u otrosí,
// 20270101001900): ver y adjuntar o cambiar. Los usan el detalle del
// contrato, la lista de otrosí y las tablas de contratos.
// ---------------------------------------------------------------------------

const mensaje = (e: unknown, otro: string) => (e instanceof Error ? e.message : otro)

// Sube el archivo al bucket y lo registra; si la base no lo acepta, lo borra.
async function subirArchivo(contratoId: string, archivo: File, registrar: (a: { ruta: string; nombre: string; mime: string; tamano: number }) => Promise<string | null>) {
  const problema = validarArchivoFirmado(archivo)
  if (problema) throw new Error(problema)
  const supabase = createClient()
  const ruta = rutaArchivoFirmado(contratoId, archivo.name, Date.now())
  const { error } = await supabase.storage.from("contratos").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`)
  try {
    const anterior = await registrar({ ruta, nombre: archivo.name, mime: archivo.type, tamano: archivo.size })
    if (anterior) await supabase.storage.from("contratos").remove([anterior])
  } catch (e) {
    await supabase.storage.from("contratos").remove([ruta])
    throw e
  }
}

// Botón para elegir el archivo y subirlo.
export function BotonSubirFirmado({
  contratoId,
  otrosiId,
  hay,
  onSubido,
  compacto = false,
}: {
  contratoId: string
  otrosiId?: string
  hay: boolean
  onSubido: () => void
  compacto?: boolean
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function elegido(archivo: File | undefined) {
    if (!archivo) return
    setSubiendo(true)
    setError(null)
    try {
      await subirArchivo(contratoId, archivo, (a) => (otrosiId ? subirOtrosiFirmado(otrosiId, a) : subirContratoFirmado(contratoId, a)))
      onSubido()
    } catch (e) {
      setError(mensaje(e, "No se pudo subir la copia firmada."))
    } finally {
      setSubiendo(false)
      if (entrada.current) entrada.current.value = ""
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => elegido(e.target.files?.[0])}
      />
      <Button
        type="button"
        size="xs"
        variant={hay ? "outline" : "default"}
        disabled={subiendo}
        onClick={(e) => {
          e.stopPropagation()
          entrada.current?.click()
        }}
        title={hay ? "Cambiar la copia firmada por el contratista" : "Adjuntar la copia firmada por el contratista"}
      >
        {subiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {compacto ? (hay ? "Cambiar" : "Adjuntar") : hay ? "Cambiar copia firmada" : "Adjuntar copia firmada"}
      </Button>
      {error && <span className="max-w-64 text-xs text-destructive">{error}</span>}
    </span>
  )
}

// Abre la copia firmada en un visor.
export function BotonVerFirmado({ contratoId, archivo, titulo, compacto = false }: { contratoId: string; archivo: ArchivoFirmado; titulo: string; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation()
          setAbierto(true)
        }}
        title={`${titulo} · subida el ${formatearFechaSinHora(archivo.subidoAt)}${archivo.subidoPorNombre ? ` por ${archivo.subidoPorNombre}` : ""}`}
      >
        <FileCheck2 className="size-3.5" /> {compacto ? "Ver" : "Copia firmada"}
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-[min(1200px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>
          {abierto && (
            <VisorDocumento
              titulo={titulo}
              nombreArchivo={archivo.nombre}
              mime={archivo.mime}
              cargarUrl={() => enlaceFirmado(contratoId, archivo.ruta)}
              onVolver={() => setAbierto(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}


// Columna "Firmado" de Contratos por grupos y generales: ver la copia firmada
// por el contratista o adjuntarla (solo contratos aprobados).
export function columnaFirmado(puedeSubir: boolean, onSubido: () => void): ColumnaExcel<SolicitudContratoFila> {
  const aprobado = (s: SolicitudContratoFila) => s.estado === "aprobada" && s.minutaEstado === "aprobada"
  return {
    clave: "firmado",
    titulo: "Firmado",
    ancho: 170,
    alinear: "center",
    texto: (s) => (!aprobado(s) ? "" : s.firmado ? "Copia firmada" : "Falta"),
    celda: (s) =>
      !aprobado(s) ? null : (
        <span className="inline-flex flex-wrap items-center justify-center gap-1">
          {s.firmado ? (
            <BotonVerFirmado contratoId={s.id} archivo={s.firmado} titulo={`Contrato ${s.numeroContrato ?? s.codigo} firmado por el contratista`} compacto />
          ) : (
            !puedeSubir && <span className="text-xs text-amber-700">Falta</span>
          )}
          {puedeSubir && <BotonSubirFirmado contratoId={s.id} hay={Boolean(s.firmado)} onSubido={onSubido} compacto />}
        </span>
      ),
  }
}
