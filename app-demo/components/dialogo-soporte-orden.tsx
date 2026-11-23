"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CampoSoporte } from "@/components/campo-soporte"
import { createClient } from "@/lib/supabase/client"
import { ETIQUETA_SOPORTE_ORDEN, rutaSoporte, type SoporteGuardado, type TipoSoporteOrden } from "@/lib/soportes"
import { agregarSoporteOrden, cambiarSoporteOrden } from "@/app/(app)/almacen/comprar-pedidos/actions"

// "Añadir soporte" o "Cambiar soporte" de una orden ya creada (20270101005800):
// sube el archivo al bucket y lo registra; al cambiar, el anterior se borra.
// Si la base no lo acepta, el archivo subido se borra.
export function DialogoSoporteOrden({
  ordenId,
  cambiando,
  abierto,
  onCerrar,
  onListo,
}: {
  ordenId: string
  // null = añadir uno más; un soporte = cambiar ese.
  cambiando: SoporteGuardado | null
  abierto: boolean
  onCerrar: () => void
  onListo: () => void
}) {
  const [tipo, setTipo] = useState<TipoSoporteOrden>((cambiando?.tipo as TipoSoporteOrden) ?? "factura")
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    if (!archivo) {
      setError("Elige el archivo del soporte.")
      return
    }
    setGuardando(true)
    setError(null)
    const supabase = createClient()
    const ruta = rutaSoporte(ordenId, tipo, archivo)
    let subido = false
    try {
      const { error: e } = await supabase.storage
        .from("ordenes_compra")
        .upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el soporte: ${e.message}`)
      subido = true
      const soporte = { tipo, ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type }
      if (cambiando) await cambiarSoporteOrden(cambiando.id, soporte)
      else await agregarSoporteOrden(ordenId, soporte)
      setArchivo(null)
      onListo()
    } catch (e) {
      if (subido) await supabase.storage.from("ordenes_compra").remove([ruta])
      setError(e instanceof Error ? e.message : "No se pudo guardar el soporte.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && !guardando && onCerrar()}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-md">
        <DialogHeader>
          <DialogTitle>{cambiando ? "Cambiar soporte" : "Añadir soporte"}</DialogTitle>
          <DialogDescription>
            {cambiando
              ? `Se borra "${cambiando.nombreArchivo}" y queda el archivo nuevo en su lugar. La orden y su pago no cambian.`
              : "La orden queda con un soporte más. La orden y su pago no cambian."}
          </DialogDescription>
        </DialogHeader>
        <CampoSoporte
          etiqueta="Soporte"
          obligatorio
          tipos={ETIQUETA_SOPORTE_ORDEN}
          tipo={tipo}
          onTipo={setTipo}
          archivo={archivo}
          onArchivo={setArchivo}
          onError={setError}
          disabled={guardando}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !archivo}>
            {guardando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {cambiando ? "Cambiar soporte" : "Añadir soporte"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
