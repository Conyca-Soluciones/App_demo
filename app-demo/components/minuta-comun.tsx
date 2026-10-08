"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { ordinalClausula, type ClausulaAdicional, type OrigenDato } from "@/lib/minuta-mano-obra"

// ---------------------------------------------------------------------------
// Piezas comunes de los editores de minuta (mano de obra, arrendamiento...):
// origen de cada dato, campos, listas editables, cláusulas adicionales y la
// vista previa del PDF. Cada editor arma sus secciones con esto.
// ---------------------------------------------------------------------------

export const claseCampo =
  "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
export const claseArea =
  "w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"

// Origen de cada dato: plantilla (texto de Jurídica), solicitud (datos de la
// solicitud, el contratista o el proyecto) o falta (rojo). Lo escrito o
// cambiado a mano queda sin color.
export const ORIGEN: Record<OrigenDato, { etiqueta: string; chip: string; borde: string; ayuda: string }> = {
  plantilla: {
    etiqueta: "Plantilla",
    chip: "bg-slate-100 text-slate-700 ring-slate-300",
    borde: "border-l-4 border-l-slate-400",
    ayuda: "Texto que trae la plantilla de Jurídica.",
  },
  solicitud: {
    etiqueta: "Solicitud",
    chip: "bg-sky-100 text-sky-800 ring-sky-300",
    borde: "border-l-4 border-l-sky-500",
    ayuda: "Dato de la solicitud, el contratista o el proyecto.",
  },
  editado: {
    etiqueta: "Editado",
    chip: "",
    borde: "",
    ayuda: "Escrito o cambiado a mano en la minuta (sin color).",
  },
  vacio: {
    etiqueta: "Falta",
    chip: "bg-red-100 text-red-800 ring-red-300",
    borde: "border-l-4 border-l-red-500 bg-red-50/40",
    ayuda: "Falta llenarlo: en el PDF sale como raya.",
  },
}

export function ChipOrigen({ origen }: { origen: OrigenDato }) {
  if (origen === "editado") return null
  const o = ORIGEN[origen]
  return (
    <span title={o.ayuda} className={`inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-medium ring-1 ${o.chip}`}>
      {o.etiqueta}
    </span>
  )
}

export function LeyendaOrigen() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Origen de cada dato:</span>
      {(["plantilla", "solicitud", "vacio"] as OrigenDato[]).map((o) => (
        <span key={o} className="flex items-center gap-1">
          <ChipOrigen origen={o} /> {ORIGEN[o].ayuda}
        </span>
      ))}
    </div>
  )
}

export function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

// Campo de una línea o de varias (filas) con su etiqueta y el chip de origen.
export function CampoMinuta(props: {
  id: string
  etiqueta: string
  valor: string
  origen: OrigenDato
  onChange: (valor: string) => void
  disabled: boolean
  tipo?: string
  placeholder?: string
  ayuda?: string
  ancho?: boolean
  filas?: number
}) {
  const { id, etiqueta, valor, origen, onChange, disabled, tipo, placeholder, ayuda, ancho, filas } = props
  return (
    <div className={`min-w-0 space-y-1 ${ancho || filas ? "sm:col-span-2" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {etiqueta}
        </label>
        <ChipOrigen origen={origen} />
      </div>
      {filas ? (
        <textarea
          id={id}
          rows={filas}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${claseArea} ${ORIGEN[origen].borde}`}
        />
      ) : (
        <input
          id={id}
          type={tipo ?? "text"}
          value={valor}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={`${claseCampo} ${ORIGEN[origen].borde}`}
        />
      )}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  )
}

// Selector con chip de origen (vacío = "Falta").
export function SelectorMinuta<T extends string>(props: {
  id: string
  etiqueta: string
  valor: T | ""
  opciones: { valor: T; titulo: string }[]
  origen: OrigenDato
  onChange: (valor: T | "") => void
  disabled: boolean
  ancho?: boolean
}) {
  const { id, etiqueta, valor, opciones, origen, onChange, disabled, ancho } = props
  return (
    <div className={`min-w-0 space-y-1 ${ancho ? "sm:col-span-2" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {etiqueta}
        </label>
        <ChipOrigen origen={origen} />
      </div>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value as T | "")} disabled={disabled} className={`${claseCampo} ${ORIGEN[origen].borde}`}>
        <option value="">— Elige —</option>
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.titulo}
          </option>
        ))}
      </select>
    </div>
  )
}

// Lista de renglones editables (obligaciones, requisitos, causales...): subir,
// bajar, quitar y agregar.
export function ListaEditable(props: {
  items: string[]
  onChange: (items: string[]) => void
  marcador: (i: number) => string
  origen: (texto: string) => OrigenDato
  textoAgregar: string
  editable: boolean
  guardando: boolean
}) {
  const { items, onChange, marcador, origen, textoAgregar, editable, guardando } = props
  const deshabilitado = !editable || guardando
  const mover = (i: number, d: -1 | 1) => {
    const copia = [...items]
    ;[copia[i], copia[i + d]] = [copia[i + d], copia[i]]
    onChange(copia)
  }
  return (
    <div className="space-y-2">
      {items.map((t, i) => {
        const o = origen(t)
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex w-16 shrink-0 flex-col items-end gap-1 pt-1.5">
              <span className="text-xs text-muted-foreground tabular-nums">{marcador(i)}</span>
              <ChipOrigen origen={o} />
            </div>
            <textarea
              rows={2}
              value={t}
              aria-label={`${textoAgregar} ${i + 1}`}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
              disabled={deshabilitado}
              className={`${claseArea} flex-1 ${ORIGEN[o].borde}`}
            />
            {editable && (
              <div className="flex flex-col">
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Subir" disabled={guardando || i === 0} onClick={() => mover(i, -1)}>
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Bajar" disabled={guardando || i === items.length - 1} onClick={() => mover(i, 1)}>
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="ghost" aria-label="Quitar" disabled={guardando} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        )
      })}
      {editable && (
        <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => onChange([...items, ""])}>
          <Plus className="size-4" /> {textoAgregar}
        </Button>
      )}
    </div>
  )
}

// Cláusulas que Jurídica agrega después de la última de la plantilla
// (`desde` = número de la primera adicional).
export function ClausulasAdicionalesEditor(props: {
  clausulas: ClausulaAdicional[]
  onChange: (clausulas: ClausulaAdicional[]) => void
  desde: number
  editable: boolean
  guardando: boolean
}) {
  const { clausulas, onChange, desde, editable, guardando } = props
  const deshabilitado = !editable || guardando
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Cláusulas adicionales (van después de la {ordinalClausula(desde - 1).toLowerCase()})</p>
      {clausulas.length === 0 && <p className="text-xs text-muted-foreground">No hay cláusulas adicionales.</p>}
      {clausulas.map((c, i) => {
        const cambiar = (cambio: Partial<ClausulaAdicional>) => onChange(clausulas.map((x, j) => (j === i ? { ...x, ...cambio } : x)))
        const vacia = !c.titulo.trim() || !c.texto.trim()
        return (
          <div key={i} className={`space-y-2 rounded-md border p-3 ${ORIGEN[vacia ? "vacio" : "editado"].borde}`}>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs font-semibold">{ordinalClausula(desde + i)}.</span>
              <input
                aria-label={`Título de la cláusula adicional ${i + 1}`}
                value={c.titulo}
                onChange={(e) => cambiar({ titulo: e.target.value })}
                placeholder="Título de la cláusula"
                disabled={deshabilitado}
                className={claseCampo}
              />
              <ChipOrigen origen={vacia ? "vacio" : "editado"} />
              {editable && (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Quitar cláusula"
                  disabled={guardando}
                  onClick={() => onChange(clausulas.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              )}
            </div>
            <textarea
              rows={3}
              aria-label={`Texto de la cláusula adicional ${i + 1}`}
              value={c.texto}
              onChange={(e) => cambiar({ texto: e.target.value })}
              placeholder="Texto de la cláusula"
              disabled={deshabilitado}
              className={claseArea}
            />
          </div>
        )
      })}
      {editable && (
        <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => onChange([...clausulas, { titulo: "", texto: "" }])}>
          <Plus className="size-4" /> Agregar cláusula
        </Button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- PDF
// El PDF se genera en el servidor con lo que está en pantalla (POST con la
// minuta): la vista previa y la descarga muestran cambios aún sin guardar. La
// ruta elige la plantilla según el tipo del contrato.
export async function generarPdfMinuta(id: string, minuta: unknown, signal?: AbortSignal): Promise<Blob> {
  const r = await fetch(`/contratos/pre-aprobacion/${id}/minuta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minuta }),
    signal,
  })
  const tipo = r.headers.get("Content-Type") ?? ""
  if (!r.ok || !tipo.includes("application/pdf")) {
    const cuerpo = tipo.includes("json") ? await r.json().catch(() => null) : null
    throw new Error(cuerpo?.error ?? "No se pudo generar el PDF.")
  }
  return r.blob()
}

export async function descargarPdfMinuta(id: string, minuta: unknown, nombreArchivo: string) {
  const blob = await generarPdfMinuta(id, minuta)
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// Vista previa: se vuelve a generar un momento después del último cambio.
// `refrescar` la genera otra vez con la misma minuta.
export function useVistaPreviaMinuta(id: string, minuta: unknown) {
  const [vista, setVista] = useState<{ url: string | null; cargando: boolean; error: string | null }>({ url: null, cargando: false, error: null })
  const [vuelta, setVuelta] = useState(0)
  const urlVista = useRef<string | null>(null)

  useEffect(() => {
    if (!minuta) return
    const control = new AbortController()
    const t = setTimeout(() => {
      setVista((v) => ({ ...v, cargando: true, error: null }))
      generarPdfMinuta(id, minuta, control.signal)
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          if (urlVista.current) URL.revokeObjectURL(urlVista.current)
          urlVista.current = url
          setVista({ url, cargando: false, error: null })
        })
        .catch((e) => {
          if (control.signal.aborted) return
          setVista((v) => ({ ...v, cargando: false, error: e instanceof Error ? e.message : "No se pudo generar la vista previa." }))
        })
    }, 900)
    return () => {
      clearTimeout(t)
      control.abort()
    }
  }, [minuta, id, vuelta])

  useEffect(
    () => () => {
      if (urlVista.current) URL.revokeObjectURL(urlVista.current)
    },
    []
  )

  return { vista, refrescar: () => setVuelta((n) => n + 1) }
}

export function PanelVistaPrevia({ vista, refrescar }: ReturnType<typeof useVistaPreviaMinuta>) {
  return (
    <div className="min-w-0">
      <div className="sticky top-0 flex h-[70svh] flex-col overflow-hidden rounded-lg border bg-muted/30 lg:h-[calc(94svh-9rem)]">
        <div className="flex items-center gap-2 border-b bg-background px-3 py-2 text-xs">
          <span className="flex-1 font-medium">Vista previa del PDF</span>
          {vista.cargando && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Actualizando...
            </span>
          )}
          {vista.url && (
            <a href={vista.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "ghost" })}>
              <ExternalLink className="size-4" /> Abrir
            </a>
          )}
          <Button size="sm" variant="ghost" aria-label="Actualizar vista previa" onClick={refrescar}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
        {vista.error ? (
          <p className="p-4 text-sm text-destructive">{vista.error}</p>
        ) : vista.url ? (
          <iframe src={vista.url} title="Vista previa de la minuta" className="min-h-0 flex-1 bg-white" />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Generando vista previa...
          </div>
        )}
      </div>
    </div>
  )
}
