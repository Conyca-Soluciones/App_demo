"use client"

// components/solicitud-extraordinaria-dialog.tsx
//
// "Solicitar requisición extraordinaria a Gerencia": uno o varios insumos por
// encima de lo que contempla el presupuesto. Cada línea es un insumo en un ítem
// del presupuesto vigente. Por defecto solo insumos de los APU (busca el insumo
// y luego el ítem donde aparece, como la requisición normal); con "Pedir
// insumo que no está en el presupuesto" se escoge primero el ítem y luego se
// busca en TODO el maestro (se rompió algo y hay que comprar pego para un ítem
// que no lo tenía). La aprueba Gerencia en Aprobación de requisiciones
// extraordinarias (20261226000000_requisiciones_extraordinarias.sql).

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, TriangleAlert } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import { puedeBuscar } from "@/lib/busqueda"
import { formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import {
  buscarInsumos,
  buscarInsumosMaestro,
  buscarItemsPresupuesto,
  crearRequisicionExtraordinaria,
  insumoEnItem,
  type InsumoEnItem,
  type InsumoMaestro,
  type ItemParaExtraordinaria,
} from "@/app/(app)/almacen/actions"
import { MAX_INSUMOS_POR_PEDIDO, type InsumoAgrupado } from "@/app/(app)/almacen/types"

export const TITULO_EXTRAORDINARIA = "Solicitar requisición extraordinaria a Gerencia"

// Abierto desde un ítem sin cupo de la requisición normal: esa línea ya va puesta.
export type InicialExtraordinaria = { insumo: InsumoAgrupado; presupuestoItemId: string }

type Linea = {
  insumo: InsumoMaestro
  item: ItemParaExtraordinaria
  info: InsumoEnItem
  cantidad: string
}

const esEntero = (texto: string) => texto.trim() !== "" && Number.isInteger(Number(texto))
const fmt = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })
const clave = (insumoId: string, itemId: string) => `${insumoId}|${itemId}`

function lineaDesdeInicial(inicial: InicialExtraordinaria): Linea | null {
  const it = inicial.insumo.items.find((i) => i.presupuestoItemId === inicial.presupuestoItemId)
  if (!it) return null
  return {
    insumo: {
      id: inicial.insumo.insumoId,
      codigo: inicial.insumo.insumoCodigo,
      descripcion: inicial.insumo.insumoDescripcion,
      um: inicial.insumo.insumoUm,
    },
    item: { id: it.presupuestoItemId, codigo: it.itemCodigo, descripcion: it.itemDescripcion, unidad: null },
    // presupuestado no viene en la búsqueda normal: 0 = no se muestra.
    info: { enApu: true, presupuestado: 0, disponible: it.cantidadDisponible },
    cantidad: "",
  }
}

// Buscador de texto con lista flotante (mismo patrón que el de requisiciones).
function Buscador<T>({
  placeholder,
  buscar,
  claveDe,
  render,
  onEscoger,
  vacio,
}: {
  placeholder: string
  buscar: (termino: string) => Promise<T[]>
  claveDe: (x: T) => string
  render: (x: T) => React.ReactNode
  onEscoger: (x: T) => void
  vacio: string
}) {
  const [texto, setTexto] = useState("")
  const [resultado, setResultado] = useState<{ termino: string; filas: T[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const activo = puedeBuscar(texto)
  const buscando = activo && resultado?.termino !== texto
  const filas = activo && resultado?.termino === texto ? resultado.filas : []

  useEffect(() => {
    if (!puedeBuscar(texto)) return
    const t = setTimeout(() => {
      buscar(texto)
        .then((f) => setResultado({ termino: texto, filas: f }))
        .catch((e) => {
          setError(e instanceof Error ? e.message : "No se pudo buscar.")
          setResultado({ termino: texto, filas: [] })
        })
    }, 300)
    return () => clearTimeout(t)
  }, [texto, buscar])

  return (
    <div ref={ref} className="relative">
      <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder} className="h-10" />
      <DropdownFlotante anchorRef={ref} abierto={activo}>
        <div className="max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-lg">
          {buscando && <div className="px-4 py-3 text-sm text-muted-foreground">Buscando…</div>}
          {!buscando && filas.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">{error ?? vacio}</div>
          )}
          {filas.map((x) => (
            <button
              key={claveDe(x)}
              type="button"
              onClick={() => {
                onEscoger(x)
                setTexto("")
              }}
              className="flex w-full flex-col items-start gap-0.5 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted"
            >
              {render(x)}
            </button>
          ))}
        </div>
      </DropdownFlotante>
    </div>
  )
}

export function SolicitudExtraordinariaDialog({
  open,
  onOpenChange,
  versionId,
  inicial = null,
  onCreada,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  versionId: string
  inicial?: InicialExtraordinaria | null
  onCreada?: (creada: { requisicionId: string; numero: number }) => void
}) {
  const [lineas, setLineas] = useState<Linea[]>([])
  // Cómo se arma la línea nueva: "presupuesto" = un insumo de los APU (busca el
  // insumo y luego escoge el ítem); "fuera" = un insumo que no está en el
  // presupuesto (escoge el ítem y luego busca en el maestro).
  const [modo, setModo] = useState<"presupuesto" | "fuera">("presupuesto")
  // Modo presupuesto: insumo de los APU y el ítem donde aparece.
  const [insumoApu, setInsumoApu] = useState<InsumoAgrupado | null>(null)
  const [itemApuId, setItemApuId] = useState<string | null>(null)
  // Modo fuera: ítem e insumo del maestro, y lo que dice el APU del ítem.
  const [item, setItem] = useState<ItemParaExtraordinaria | null>(null)
  const [insumo, setInsumo] = useState<InsumoMaestro | null>(null)
  const [info, setInfo] = useState<{ clave: string; info: InsumoEnItem } | null>(null)
  const [cantidadNueva, setCantidadNueva] = useState("")
  const [fechaRequerida, setFechaRequerida] = useState("")
  const [urgente, setUrgente] = useState(false)
  const [justificacion, setJustificacion] = useState("")
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Estables: el buscador vuelve a buscar cuando cambia la función.
  const buscarItems = useCallback((t: string) => buscarItemsPresupuesto(versionId, t), [versionId])
  const buscarInsumosApu = useCallback((t: string) => buscarInsumos(versionId, t), [versionId])

  function limpiarNueva() {
    setInsumoApu(null)
    setItemApuId(null)
    setItem(null)
    setInsumo(null)
    setInfo(null)
    setCantidadNueva("")
  }

  const [aperturaPrevia, setAperturaPrevia] = useState<{ open: boolean; inicial: InicialExtraordinaria | null } | null>(null)
  if (aperturaPrevia === null || aperturaPrevia.open !== open || aperturaPrevia.inicial !== inicial) {
    setAperturaPrevia({ open, inicial })
    if (open) {
      const primera = inicial ? lineaDesdeInicial(inicial) : null
      setLineas(primera ? [primera] : [])
      setModo("presupuesto")
      limpiarNueva()
      setFechaRequerida("")
      setUrgente(false)
      setJustificacion("")
      setError(null)
    }
  }

  // Modo fuera: al tener ítem e insumo, se pregunta si el insumo está en el APU del ítem.
  const claveFuera = item && insumo ? clave(insumo.id, item.id) : null
  const infoFuera = info && info.clave === claveFuera ? info.info : null
  useEffect(() => {
    if (!item || !insumo) return
    let activo = true
    const k = clave(insumo.id, item.id)
    insumoEnItem(item.id, insumo.id)
      .then((r: InsumoEnItem) => activo && setInfo({ clave: k, info: r }))
      .catch((e) => activo && setError(e instanceof Error ? e.message : "No se pudo revisar el APU del ítem."))
    return () => {
      activo = false
    }
  }, [item, insumo])

  // La línea que se agregaría con lo escogido (null = falta algo).
  const itemApu = insumoApu?.items.find((i) => i.presupuestoItemId === itemApuId) ?? null
  const nueva: Omit<Linea, "cantidad"> | null =
    modo === "presupuesto"
      ? insumoApu && itemApu
        ? {
            insumo: { id: insumoApu.insumoId, codigo: insumoApu.insumoCodigo, descripcion: insumoApu.insumoDescripcion, um: insumoApu.insumoUm },
            item: { id: itemApu.presupuestoItemId, codigo: itemApu.itemCodigo, descripcion: itemApu.itemDescripcion, unidad: null },
            info: { enApu: true, presupuestado: 0, disponible: itemApu.cantidadDisponible },
          }
        : null
      : item && insumo && infoFuera
        ? { insumo, item, info: infoFuera }
        : null

  const repetida = nueva !== null && lineas.some((l) => clave(l.insumo.id, l.item.id) === clave(nueva.insumo.id, nueva.item.id))
  const limite = lineas.length >= MAX_INSUMOS_POR_PEDIDO
  const cantidadNuevaValida = esEntero(cantidadNueva) && Number(cantidadNueva) > 0
  const puedeAgregar = nueva !== null && !repetida && !limite && cantidadNuevaValida

  function agregarLinea() {
    if (!puedeAgregar || !nueva) return
    setLineas((prev) => [...prev, { ...nueva, cantidad: cantidadNueva }])
    limpiarNueva()
  }

  function cambiarCantidad(k: string, cantidad: string) {
    setLineas((prev) => prev.map((l) => (clave(l.insumo.id, l.item.id) === k ? { ...l, cantidad } : l)))
  }

  const hoy = hoyColombia()
  const fechaPasada = !!fechaRequerida && fechaRequerida < hoy
  const sinCantidad = lineas.find((l) => !esEntero(l.cantidad) || Number(l.cantidad) <= 0)
  const motivoNoGuardar =
    lineas.length === 0
      ? "Agrega al menos un insumo."
      : sinCantidad
        ? `${sinCantidad.insumo.descripcion}: escribe la cantidad (número entero mayor que cero).`
        : !fechaRequerida
          ? "Falta la fecha requerida."
          : fechaPasada
            ? "La fecha requerida no puede ser anterior a hoy."
            : !justificacion.trim()
              ? "Escribe por qué se necesita más de lo presupuestado."
              : null

  async function handleEnviar() {
    if (motivoNoGuardar) return
    setGuardando(true)
    setError(null)
    try {
      const creada = await crearRequisicionExtraordinaria({
        lineas: lineas.map((l) => ({ presupuestoItemId: l.item.id, insumoId: l.insumo.id, cantidad: Number(l.cantidad) })),
        fechaRequerida,
        urgente,
        justificacion,
      })
      onCreada?.(creada)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !guardando && onOpenChange(v)}>
      <DialogContent className="w-[95vw] max-w-3xl p-0">
        <DialogHeader className="border-b px-8 py-5">
          <DialogTitle className="text-xl">{TITULO_EXTRAORDINARIA}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto px-8 py-6">
          <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Requisición extraordinaria: pide más de lo que contempla el presupuesto, o un material que el ítem no tiene
            en su APU. Se puede pedir por encima del cupo, pero lo pedido se descuenta del cupo del presupuesto como cualquier requisición. La aprueba Gerencia.
          </p>

          {/* Armar una línea */}
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {modo === "presupuesto" ? "Agregar insumo del presupuesto" : "Agregar insumo que no está en el presupuesto"}
              </p>
              <span className={`text-xs ${limite ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                {lineas.length} / {MAX_INSUMOS_POR_PEDIDO} insumos
              </span>
            </div>

            {modo === "presupuesto" ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Insumo (de los APU del presupuesto)</label>
                  {insumoApu ? (
                    <Escogido
                      titulo={insumoApu.insumoDescripcion}
                      detalle={`${insumoApu.insumoCodigo} · ${insumoApu.insumoUm ?? "sin unidad"}`}
                      onCambiar={() => {
                        setInsumoApu(null)
                        setItemApuId(null)
                      }}
                    />
                  ) : (
                    <Buscador<InsumoAgrupado>
                      placeholder="Código o descripción del insumo, o código del ítem..."
                      buscar={buscarInsumosApu}
                      claveDe={(x) => x.insumoId}
                      render={(x) => (
                        <>
                          <span className="font-medium">{x.insumoDescripcion}</span>
                          <span className="text-xs text-muted-foreground">
                            {x.insumoCodigo} · {x.insumoUm ?? "sin unidad"} · {x.items.length}{" "}
                            {x.items.length === 1 ? "ítem" : "ítems"} del presupuesto
                          </span>
                        </>
                      )}
                      onEscoger={(x) => {
                        setInsumoApu(x)
                        setItemApuId(x.items.length === 1 ? x.items[0].presupuestoItemId : null)
                      }}
                      vacio="Ningún insumo de los APU del presupuesto coincide."
                    />
                  )}
                </div>
                {insumoApu && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Ítem del presupuesto</label>
                    {insumoApu.items.map((it) => (
                      <label
                        key={it.presupuestoItemId}
                        className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 ${
                          itemApuId === it.presupuestoItemId ? "border-primary bg-accent" : "bg-background"
                        }`}
                      >
                        <input
                          type="radio"
                          name="item-extraordinaria"
                          checked={itemApuId === it.presupuestoItemId}
                          onChange={() => setItemApuId(it.presupuestoItemId)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">
                            <span className="font-mono text-muted-foreground">{it.itemCodigo}</span> {it.itemDescripcion}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Disponible en el presupuesto: {fmt(it.cantidadDisponible)}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">1. Ítem del presupuesto</label>
                  {item ? (
                    <Escogido
                      titulo={item.descripcion}
                      detalle={item.codigo}
                      onCambiar={() => {
                        setItem(null)
                        setInsumo(null)
                      }}
                    />
                  ) : (
                    <Buscador<ItemParaExtraordinaria>
                      placeholder="Código o descripción del ítem..."
                      buscar={buscarItems}
                      claveDe={(x) => x.id}
                      render={(x) => (
                        <>
                          <span className="font-medium">{x.descripcion}</span>
                          <span className="font-mono text-xs text-muted-foreground">{x.codigo}</span>
                        </>
                      )}
                      onEscoger={setItem}
                      vacio="Ningún ítem de la versión vigente coincide."
                    />
                  )}
                </div>
                {item && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">2. Insumo (maestro de insumos)</label>
                    {insumo ? (
                      <Escogido
                        titulo={insumo.descripcion}
                        detalle={`${insumo.codigo} · ${insumo.um ?? "sin unidad"}`}
                        onCambiar={() => setInsumo(null)}
                      />
                    ) : (
                      <Buscador<InsumoMaestro>
                        placeholder="Buscar en el maestro de insumos..."
                        buscar={buscarInsumosMaestro}
                        claveDe={(x) => x.id}
                        render={(x) => (
                          <>
                            <span className="font-medium">{x.descripcion}</span>
                            <span className="text-xs text-muted-foreground">
                              {x.codigo} · {x.um ?? "sin unidad"}
                            </span>
                          </>
                        )}
                        onEscoger={setInsumo}
                        vacio="Ningún insumo del maestro coincide."
                      />
                    )}
                  </div>
                )}
                {item && insumo && !infoFuera && (
                  <span className="flex items-center text-xs text-muted-foreground">
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" /> Revisando el APU del ítem…
                  </span>
                )}
                {infoFuera && insumo && <EtiquetaApu info={infoFuera} um={insumo.um} />}
              </>
            )}

            {/* Cantidad y Agregar */}
            {nueva && (
              <div className="flex flex-wrap items-end gap-3 border-t pt-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Cantidad adicional</label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={cantidadNueva}
                    onChange={(e) => setCantidadNueva(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && agregarLinea()}
                    placeholder={nueva.insumo.um ?? "Cantidad"}
                    className={`h-9 w-36 text-right ${
                      cantidadNueva.trim() !== "" && !cantidadNuevaValida ? "border-destructive" : ""
                    }`}
                  />
                </div>
                <Button size="sm" className="h-9" onClick={agregarLinea} disabled={!puedeAgregar}>
                  {repetida ? "Ya está en la requisición" : "Agregar"}
                </Button>
                {cantidadNueva.trim() !== "" && !cantidadNuevaValida && (
                  <p className="text-xs text-destructive">Solo números enteros mayores que cero.</p>
                )}
              </div>
            )}

            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  setModo(modo === "presupuesto" ? "fuera" : "presupuesto")
                  limpiarNueva()
                }}
                className="text-sm font-medium text-primary underline underline-offset-2"
              >
                {modo === "presupuesto"
                  ? "Pedir insumo que no está en el presupuesto"
                  : "Volver a insumos del presupuesto"}
              </button>
            </div>
          </div>

          {/* Insumos de la requisición */}
          {lineas.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Escoge el insumo, el ítem y la cantidad, y pulsa Agregar. Puedes pedir varios insumos en la misma requisición.
            </p>
          ) : (
            <div className="space-y-2">
              {lineas.map((l) => {
                const k = clave(l.insumo.id, l.item.id)
                const malaCantidad = l.cantidad.trim() !== "" && (!esEntero(l.cantidad) || Number(l.cantidad) <= 0)
                return (
                  <div key={k} className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-medium">{l.insumo.descripcion}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{l.item.codigo}</span> {l.item.descripcion}
                      </p>
                      <EtiquetaApu info={l.info} um={l.insumo.um} />
                    </div>
                    <div className="w-28 space-y-0.5">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={l.cantidad}
                        onChange={(e) => cambiarCantidad(k, e.target.value)}
                        placeholder={l.insumo.um ?? "Cantidad"}
                        className={`h-8 text-right text-xs ${malaCantidad ? "border-destructive" : ""}`}
                      />
                      {malaCantidad && <p className="text-right text-[10px] text-destructive">Solo enteros mayores que 0</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setLineas((prev) => prev.filter((x) => clave(x.insumo.id, x.item.id) !== k))}
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-destructive"
                    >
                      Quitar
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Fecha requerida</label>
              <CampoFecha
                value={fechaRequerida}
                min={hoy}
                onChange={(e) => setFechaRequerida(e.target.value)}
                className={`h-10 ${fechaPasada ? "border-destructive focus-visible:ring-destructive" : ""}`}
              />
              {fechaPasada && (
                <p className="text-xs text-destructive">
                  La fecha requerida no puede ser anterior a hoy ({formatearFechaSinHora(hoy)}).
                </p>
              )}
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox checked={urgente} onCheckedChange={(v) => setUrgente(v === true)} />
              <label className="text-sm font-medium">Marcar como urgente</label>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">¿Por qué se necesita más de lo presupuestado?</label>
            <Textarea
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              placeholder="Ej.: se rompió la tubería y hay que comprar pego, el área real es mayor que la del presupuesto…"
              className="min-h-[90px] resize-none"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
            {!guardando && motivoNoGuardar && <p className="mr-auto text-xs text-amber-800">{motivoNoGuardar}</p>}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={handleEnviar} disabled={!!motivoNoGuardar || guardando}>
              {guardando
                ? "Enviando…"
                : lineas.length > 1
                  ? `Enviar a Gerencia (${lineas.length} insumos)`
                  : "Enviar a Gerencia"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Escogido({ titulo, detalle, onCambiar }: { titulo: string; detalle: string; onCambiar: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border bg-background px-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{titulo}</p>
        <p className="truncate text-xs text-muted-foreground">{detalle}</p>
      </div>
      <button
        type="button"
        onClick={onCambiar}
        className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Cambiar
      </button>
    </div>
  )
}

// Si el insumo está en el APU del ítem (con lo presupuestado y disponible) o no.
function EtiquetaApu({ info, um }: { info: InsumoEnItem; um: string | null }) {
  if (!info.enApu) {
    return <p className="text-[11px] font-medium text-amber-700">No está en el APU de este ítem (material nuevo para el ítem)</p>
  }
  const u = um ? ` ${um}` : ""
  return (
    <p className="text-[11px] text-muted-foreground">
      En el APU del ítem ·{info.presupuestado > 0 ? ` presupuestado ${fmt(info.presupuestado)}${u} ·` : ""} disponible{" "}
      {fmt(info.disponible)}
      {u}
    </p>
  )
}
