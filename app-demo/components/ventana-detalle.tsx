"use client"

import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ColumnaExcel } from "@/components/tabla-excel"

// ---------------------------------------------------------------------------
// Ventana de detalle de una fila, igual en todas las tablas (la de
// Contratistas): doble clic en la fila -> ventana con la información FIJA (no
// son campos editables) y, solo donde se puede editar, el botón "Editar"
// arriba a la derecha. Las acciones de la fila (Aprobar, Anular, PDF...) se
// repiten abajo, en `acciones`.
// ---------------------------------------------------------------------------

export type CampoDetalle = { etiqueta: string; valor: React.ReactNode; ancho?: "completo" }

// Texto de ayuda de las filas que se abren con doble clic.
export const AYUDA_DOBLE_CLIC = "Doble clic para ver el detalle"

// Clases de una fila de <Table> que se abre con doble clic.
export const CLASE_FILA_DOBLE_CLIC = "cursor-pointer"

// onDoubleClick de una fila: abre el detalle, salvo que el doble clic sea
// sobre un botón, enlace o campo de la misma fila (esos hacen lo suyo).
export function alDobleClic(abrir: () => void) {
  return (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label, [role=combobox]")) return
    abrir()
  }
}

export function VentanaDetalle({
  abierta,
  onCerrar,
  titulo,
  subtitulo,
  campos,
  onEditar,
  acciones,
  children,
  ancha,
}: {
  abierta: boolean
  onCerrar: () => void
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  campos: CampoDetalle[]
  // Solo donde se puede editar: sale "Editar" arriba a la derecha.
  onEditar?: () => void
  // Botones de abajo (las mismas acciones de la fila).
  acciones?: React.ReactNode
  // Contenido extra debajo de los campos (líneas, historial...).
  children?: React.ReactNode
  ancha?: boolean
}) {
  return (
    <Dialog open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className={`max-h-[92svh] overflow-y-auto ${ancha ? "sm:max-w-4xl" : "sm:max-w-2xl"}`}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 flex-1 break-words">{titulo}</span>
            {onEditar && (
              <Button size="sm" variant="outline" onClick={onEditar}>
                <Pencil className="size-4" /> Editar
              </Button>
            )}
          </DialogTitle>
          {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
        </DialogHeader>
        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {campos.map((c, i) => (
              <div key={`${c.etiqueta}-${i}`} className={`min-w-0 ${c.ancho === "completo" ? "sm:col-span-2" : ""}`}>
                <dt className="text-xs text-muted-foreground">{c.etiqueta}</dt>
                <dd className="break-words">{c.valor === "" || c.valor == null ? <span className="text-muted-foreground/60">—</span> : c.valor}</dd>
              </div>
            ))}
          </dl>
          {children}
        </div>
        {acciones && (
          <DialogFooter className="flex-wrap gap-2">
            {/* Un botón de acción abre su propio paso (confirmar, motivo...):
                esta ventana se cierra para no quedar una encima de otra. */}
            <div
              className="flex flex-wrap items-center justify-end gap-2"
              onClickCapture={(e) => {
                if ((e.target as HTMLElement).closest("button, a")) onCerrar()
              }}
            >
              {acciones}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// Los mismos botones de la fila (la celda de la columna "acciones"), para
// repetirlos abajo en la ventana.
export function accionesDeFila<T>(columnas: ColumnaExcel<T>[], fila: T | null, clave = "acciones"): React.ReactNode {
  if (!fila) return null
  const c = columnas.find((x) => x.clave === clave)
  return c?.celda ? c.celda(fila) : null
}

// Los campos de la ventana a partir de las columnas de una TablaExcel (mismo
// título y mismo contenido que la celda), sin las columnas de botones.
// `soloTexto`: columnas cuya celda es un botón o un campo (editar en la fila):
// en la ventana van como texto, para que la información quede fija.
export function camposDesdeColumnas<T>(
  columnas: ColumnaExcel<T>[],
  fila: T,
  quitar: string[] = ["acciones"],
  soloTexto: string[] = []
): CampoDetalle[] {
  return columnas
    .filter((c) => !quitar.includes(c.clave) && c.titulo.trim() !== "")
    .map((c) => ({ etiqueta: c.titulo, valor: c.celda && !soloTexto.includes(c.clave) ? c.celda(fila) : c.texto(fila) }))
}
