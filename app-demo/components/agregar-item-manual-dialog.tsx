"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  buscarInsumos,
  buscarInsumosSimilares,
  crearSolicitudInsumo,
  type InsumoSugerido,
  type InsumoSimilar,
  type ItemPresupuesto,
} from "@/app/(app)/presupuestos/actions"
import { DropdownFlotante } from "@/components/dropdown-flotante"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const PREFIJO_CODIGO_PENDIENTE = "PEND-"

// pequeños avisos junto a cada sugerencia, para que el ingeniero vea
// POR QUÉ algo no es un match exacto en vez de que quede escondido --
// puede ser justo la opción correcta con otro tamaño/unidad.
function BadgesDiferencia({
  medidaDistinta,
  unidadDistinta,
}: {
  medidaDistinta?: boolean
  unidadDistinta?: boolean
}) {
  if (!medidaDistinta && !unidadDistinta) return null
  return (
    <span className="inline-flex gap-1">
      {medidaDistinta && (
        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
          medida distinta
        </span>
      )}
      {unidadDistinta && (
        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
          unidad distinta
        </span>
      )}
    </span>
  )
}


export function AgregarItemManualDialog({
  open,
  onOpenChange,
  itemsActuales,
  onAgregar,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemsActuales: ItemPresupuesto[]
  onAgregar: (item: ItemPresupuesto) => void
}) {
  const [busqueda, setBusqueda] = useState("")
  const [sugerencias, setSugerencias] = useState<InsumoSugerido[]>([])
  const [seleccionado, setSeleccionado] = useState<InsumoSugerido | null>(null)
  const [nivel, setNivel] = useState("1")
  const [padreId, setPadreId] = useState<string>("ninguno")
  const [cantidad, setCantidad] = useState("")
  const [buscando, setBuscando] = useState(false)
  const [similares, setSimilares] = useState<InsumoSimilar[] | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const inputRef = useRef<HTMLDivElement>(null)

  const padresPosibles = useMemo(
    () => itemsActuales.filter((i) => i.nivel === Number(nivel) - 1),
    [itemsActuales, nivel]
  )

  useEffect(() => {
    if (seleccionado) return
    if (busqueda.trim().length < 2) {
      setSugerencias([])
      return
    }

    setBuscando(true)
    const timeout = setTimeout(() => {
      buscarInsumos(busqueda)
        .then(setSugerencias)
        .catch((e) => console.error("Error buscando insumos:", e))
        .finally(() => setBuscando(false))
    }, 300)

    return () => clearTimeout(timeout)
  }, [busqueda, seleccionado])

  function elegirSugerencia(insumo: InsumoSugerido) {
    setSeleccionado(insumo)
    setBusqueda(insumo.descripcion)
    setSugerencias([])
    setSimilares(null)
    setMensaje(null)
  }

  function limpiarFormulario() {
    setBusqueda("")
    setSeleccionado(null)
    setSugerencias([])
    setCantidad("")
    setSimilares(null)
    setMensaje(null)
  }

  function agregarItemFinal(opts: {
    codigo: string
    descripcion: string
    unidad: string | null
    valorUnitario?: number | null
    pendienteAprobacion?: boolean
  }) {
    onAgregar({
      id: crypto.randomUUID(),
      padreId: padreId === "ninguno" ? null : padreId,
      nivel: Number(nivel),
      codigo: opts.codigo,
      descripcion: opts.descripcion,
      unidad: opts.unidad,
      cantidad: cantidad ? Number(cantidad) : null,
      valorUnitario: opts.valorUnitario ?? null,
      guardado: false,
      pendienteAprobacion: opts.pendienteAprobacion ?? false,
    })
    limpiarFormulario()
  }

  async function handleAgregar() {
    setMensaje(null)

    if (seleccionado) {
      agregarItemFinal({
        codigo: String(seleccionado.codigo),
        descripcion: seleccionado.descripcion,
        unidad: seleccionado.u_m,
        valorUnitario: seleccionado.vr_unitario,
      })
      return
    }

    const texto = busqueda.trim()
    if (texto.length < 2) {
      setMensaje("Escribe una descripción de al menos 2 caracteres.")
      return
    }

    setVerificando(true)
    try {
      const parecidos = await buscarInsumosSimilares(texto, 0.4)

      if (parecidos.length > 0) {
        setSimilares(parecidos)
        return
      }

      const codigoTemporal = `${PREFIJO_CODIGO_PENDIENTE}${crypto.randomUUID().slice(0, 8)}`
      await crearSolicitudInsumo({ descripcion: texto })

      agregarItemFinal({
        codigo: codigoTemporal,
        descripcion: texto,
        unidad: null,
        pendienteAprobacion: true,
      })
      setMensaje(
        "No existía nada parecido -- se envió como solicitud de insumo nuevo (pendiente de aprobación) y se agregó al presupuesto."
      )
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo verificar el insumo.")
    } finally {
      setVerificando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl sm:max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar ítem al presupuesto</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nivel</label>
              <Select value={nivel} onValueChange={(v) => setNivel(v ?? "1")}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Nivel {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {Number(nivel) > 1 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ítem padre</label>
                <Select value={padreId} onValueChange={(v) => setPadreId(v ?? "ninguno")}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Selecciona el padre" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguno">Sin padre</SelectItem>
                    {padresPosibles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo} — {p.descripcion.slice(0, 40)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div ref={inputRef} className="space-y-1.5">
            <label className="text-sm font-medium">Insumo</label>
            <Input
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value)
                setSeleccionado(null)
                setSimilares(null)
                setMensaje(null)
              }}
              placeholder="Busca un insumo o escribe uno nuevo..."
              className="h-10"
              autoFocus
            />
          </div>

          <DropdownFlotante anchorRef={inputRef} abierto={sugerencias.length > 0 && !seleccionado}>
            <div className="max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-lg">
              {sugerencias.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => elegirSugerencia(s)}
                  className="flex w-full flex-col items-start gap-0.5 border-b px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted"
                >
                  <span>{s.descripcion}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.codigo} · {s.u_m ?? "sin unidad"}
                  </span>
                </button>
              ))}
            </div>
          </DropdownFlotante>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Cantidad</label>
            <Input
              type="number"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="h-10 w-40"
            />
          </div>

          {similares && similares.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="font-medium text-amber-900">
                Ya existe algo parecido a "{busqueda}" -- ¿es el mismo insumo?
              </p>
              <div className="space-y-2">
                {similares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md bg-white/70 px-3 py-2"
                  >
                    <span>
                      {s.descripcion}{" "}
                      <span className="text-xs text-muted-foreground">
                        ({s.codigo} · {Math.round(s.similitud * 100)}% similar)
                      </span>{" "}
                      <BadgesDiferencia
                        medidaDistinta={s.medidaDistinta}
                        unidadDistinta={s.unidadDistinta}
                      />
                    </span>
                    <Button size="sm" variant="outline" onClick={() => elegirSugerencia(s)}>
                      Usar este
                    </Button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  const texto = busqueda.trim()
                  const codigoTemporal = `${PREFIJO_CODIGO_PENDIENTE}${crypto.randomUUID().slice(0, 8)}`
                  await crearSolicitudInsumo({ descripcion: texto })
                  agregarItemFinal({
                    codigo: codigoTemporal,
                    descripcion: texto,
                    unidad: null,
                    pendienteAprobacion: true,
                  })
                  setMensaje(
                    "Se envió como solicitud de insumo nuevo (pendiente de aprobación) y se agregó al presupuesto."
                  )
                }}
                className="text-xs text-amber-800 underline underline-offset-2 hover:text-amber-950"
              >
                No, es un ítem distinto -- continuar de todas formas
              </button>
            </div>
          )}

          {mensaje && <p className="text-sm text-muted-foreground">{mensaje}</p>}

          <div className="flex justify-end gap-3 border-t pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
            <Button
              onClick={handleAgregar}
              disabled={verificando || buscando || busqueda.trim().length < 2}
            >
              {verificando ? "Verificando..." : "Agregar al presupuesto"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}