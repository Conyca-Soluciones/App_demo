"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Eraser, ImageUp, Loader2, PenLine, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatearFechaHora } from "@/lib/fechas"
import {
  EVENTO_FIRMA_GUARDADA,
  MAXIMO_CARACTERES_FIRMA,
  escalaFirma,
  firmaMuyPequena,
  limpiarFondoFirma,
  recorteDeTrazo,
  type Recorte,
} from "@/lib/firmas"
import { borrarMiFirma, guardarMiFirma, obtenerMiFirma, type MiFirma } from "@/app/(app)/firma/actions"

// Mi firma: cada usuario la registra una vez (dibujada en pantalla o foto de
// la firma en papel, con el fondo limpio) y sale en los documentos que
// apruebe. Cambiarla no cambia los documentos ya firmados.

const ANCHO_LIENZO = 600
const ALTO_LIENZO = 220
const ANCHO_MAXIMO_FOTO = 1600
const FONDO_CUADRICULA = "bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:16px_16px]"

type Modo = "dibujar" | "foto"

// Recorta y escala a PNG (data URL).
function exportar(origen: CanvasImageSource, r: Recorte): string {
  const k = escalaFirma(r.ancho, r.alto)
  const c = document.createElement("canvas")
  c.width = Math.max(1, Math.round(r.ancho * k))
  c.height = Math.max(1, Math.round(r.alto * k))
  const ctx = c.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(origen, r.x, r.y, r.ancho, r.alto, 0, 0, c.width, c.height)
  return c.toDataURL("image/png")
}

export function MiFirmaDialog({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const [actual, setActual] = useState<MiFirma | undefined>(undefined)
  const [modo, setModo] = useState<Modo>("dibujar")
  const [nueva, setNueva] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    obtenerMiFirma()
      .then((f) => vigente && setActual(f))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar tu firma."))
    return () => {
      vigente = false
    }
  }, [abierto])

  function cerrar() {
    setActual(undefined)
    setNueva(null)
    setError(null)
    setAviso(null)
    onCerrar()
  }

  async function guardar() {
    if (!nueva) return
    if (nueva.length > MAXIMO_CARACTERES_FIRMA) {
      setError("La firma pesa demasiado: usa una foto más pequeña o recórtala.")
      return
    }
    setOcupado(true)
    setError(null)
    try {
      const at = await guardarMiFirma(nueva)
      setActual({ imagen: nueva, actualizadaAt: at })
      window.dispatchEvent(new Event(EVENTO_FIRMA_GUARDADA))
      setNueva(null)
      setAviso("Firma guardada. Saldrá en los documentos que apruebes desde ahora.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la firma.")
    } finally {
      setOcupado(false)
    }
  }

  async function borrar() {
    if (!window.confirm("¿Borrar tu firma? Los documentos ya firmados no cambian, pero no podrás aprobar pólizas hasta registrar otra.")) return
    setOcupado(true)
    setError(null)
    try {
      await borrarMiFirma()
      setActual(null)
      window.dispatchEvent(new Event(EVENTO_FIRMA_GUARDADA))
      setAviso("Firma borrada.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la firma.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={(a) => !a && cerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mi firma</DialogTitle>
          <DialogDescription>
            Sale en los documentos que apruebes (actas, acta de aprobación de pólizas), con tu nombre, tu cargo, la fecha y
            la hora. Cambiarla no cambia los documentos que ya firmaste.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Firma registrada</p>
          {actual === undefined ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          ) : actual ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className={`flex h-24 w-64 items-center justify-center rounded-md border ${FONDO_CUADRICULA}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={actual.imagen} alt="Tu firma" className="max-h-20 max-w-60 object-contain" />
              </div>
              <div className="text-xs text-muted-foreground">
                Actualizada el {formatearFechaHora(actual.actualizadaAt)}
                <div>
                  <Button variant="ghost" size="sm" className="mt-1 px-2 text-destructive" onClick={borrar} disabled={ocupado}>
                    <Trash2 className="size-4" /> Borrar
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-amber-700">Todavía no tienes firma: regístrala abajo.</p>
          )}
        </div>

        <div className="space-y-3 border-t pt-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
            {(
              [
                ["dibujar", "Dibujar", PenLine],
                ["foto", "Subir foto", ImageUp],
              ] as const
            ).map(([m, etiqueta, Icono]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setModo(m)
                  setNueva(null)
                  setError(null)
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 ${modo === m ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                <Icono className="size-4" /> {etiqueta}
              </button>
            ))}
          </div>
          {modo === "dibujar" ? (
            <LienzoFirma onCambio={setNueva} onError={setError} />
          ) : (
            <FotoFirma onCambio={setNueva} onError={setError} />
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {aviso && !error && <p className="text-sm text-emerald-700">{aviso}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={cerrar}>
            Cerrar
          </Button>
          <Button onClick={guardar} disabled={!nueva || ocupado}>
            {ocupado && <Loader2 className="size-4 animate-spin" />}
            {actual ? "Reemplazar mi firma" : "Guardar mi firma"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- dibujar
function LienzoFirma({ onCambio, onError }: { onCambio: (png: string | null) => void; onError: (e: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const trazo = useRef<{ x: number; y: number }[]>([])
  const [vacio, setVacio] = useState(true)

  useEffect(() => {
    const c = ref.current!
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    c.width = ANCHO_LIENZO * dpr
    c.height = ALTO_LIENZO * dpr
    const ctx = c.getContext("2d")!
    ctx.scale(dpr, dpr)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = "#14215a"
  }, [])

  const punto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * ANCHO_LIENZO, y: ((e.clientY - r.top) / r.height) * ALTO_LIENZO }
  }

  function bajar(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    trazo.current = [punto(e)]
  }

  function mover(e: React.PointerEvent<HTMLCanvasElement>) {
    if (trazo.current.length === 0) return
    const ctx = e.currentTarget.getContext("2d")!
    const p = punto(e)
    const pts = trazo.current
    pts.push(p)
    ctx.lineWidth = e.pointerType === "pen" && e.pressure > 0 ? 1.2 + e.pressure * 2.6 : 2.4
    // Curva por los puntos medios: trazo suave sin esquinas.
    const n = pts.length
    if (n < 3) {
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
      return
    }
    const a = pts[n - 3]
    const b = pts[n - 2]
    ctx.beginPath()
    ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2)
    ctx.quadraticCurveTo(b.x, b.y, (b.x + p.x) / 2, (b.y + p.y) / 2)
    ctx.stroke()
  }

  function subir() {
    if (trazo.current.length === 0) return
    if (trazo.current.length === 1) {
      const ctx = ref.current!.getContext("2d")!
      const [p] = trazo.current
      ctx.beginPath()
      ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2)
      ctx.fillStyle = "#14215a"
      ctx.fill()
    }
    trazo.current = []
    setVacio(false)
    const c = ref.current!
    const datos = c.getContext("2d")!.getImageData(0, 0, c.width, c.height)
    const r = recorteDeTrazo(datos.data, c.width, c.height)
    if (!r || firmaMuyPequena(r)) {
      onCambio(null)
      return
    }
    onError(null)
    onCambio(exportar(c, r))
  }

  function limpiar() {
    const c = ref.current!
    const ctx = c.getContext("2d")!
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.restore()
    setVacio(true)
    onCambio(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={ref}
          onPointerDown={bajar}
          onPointerMove={mover}
          onPointerUp={subir}
          onPointerCancel={subir}
          className="aspect-[600/220] w-full cursor-crosshair touch-none rounded-md border bg-white"
        />
        <div className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-dashed border-slate-300" />
        {vacio && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Firma aquí con el mouse, el dedo o un lápiz
          </p>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={limpiar}>
        <Eraser className="size-4" /> Borrar el dibujo
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- foto
function FotoFirma({ onCambio, onError }: { onCambio: (png: string | null) => void; onError: (e: string | null) => void }) {
  const original = useRef<ImageData | null>(null)
  const [ajuste, setAjuste] = useState(0)
  const [vista, setVista] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const procesar = useCallback(
    (aj: number) => {
      const o = original.current
      if (!o) return
      const copia = new ImageData(new Uint8ClampedArray(o.data), o.width, o.height)
      const r = limpiarFondoFirma(copia.data, o.width, o.height, aj)
      if (!r || firmaMuyPequena(r)) {
        setVista(null)
        onCambio(null)
        onError("No se encontró la firma en la foto: usa papel blanco, buena luz y tinta oscura.")
        return
      }
      const c = document.createElement("canvas")
      c.width = o.width
      c.height = o.height
      c.getContext("2d")!.putImageData(copia, 0, 0)
      const png = exportar(c, r)
      onError(null)
      setVista(png)
      onCambio(png)
    },
    [onCambio, onError]
  )

  async function escoger(archivo: File | undefined) {
    if (!archivo) return
    if (!archivo.type.startsWith("image/")) {
      onError("Escoge una imagen (JPG o PNG).")
      return
    }
    setCargando(true)
    try {
      const bmp = await createImageBitmap(archivo)
      const k = Math.min(1, ANCHO_MAXIMO_FOTO / bmp.width)
      const c = document.createElement("canvas")
      c.width = Math.round(bmp.width * k)
      c.height = Math.round(bmp.height * k)
      const ctx = c.getContext("2d", { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      original.current = ctx.getImageData(0, 0, c.width, c.height)
      setAjuste(0)
      procesar(0)
    } catch {
      onError("No se pudo leer la imagen.")
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Firma en una hoja blanca con tinta oscura y toma la foto de cerca, con buena luz. El fondo se quita solo.
      </p>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => escoger(e.target.files?.[0])}
        className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
      />
      {cargando && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Limpiando el fondo…
        </p>
      )}
      {vista && (
        <>
          <div className={`flex h-36 items-center justify-center rounded-md border ${FONDO_CUADRICULA}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={vista} alt="Vista previa de la firma" className="max-h-32 max-w-full object-contain" />
          </div>
          <label className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">Menos tinta</span>
            <input
              type="range"
              min={-60}
              max={60}
              step={5}
              value={ajuste}
              onChange={(e) => {
                const v = Number(e.target.value)
                setAjuste(v)
                procesar(v)
              }}
              className="w-full"
            />
            <span className="shrink-0">Más tinta</span>
          </label>
        </>
      )}
    </div>
  )
}
