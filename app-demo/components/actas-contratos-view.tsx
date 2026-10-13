"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos, numero } from "@/lib/contratos"
import {
  CLASE_ESTADO_ACTA,
  ETIQUETA_ESTADO_ACTA,
  MAX_LINEAS_ACTA,
  calculoLineaForm,
  lineaActaVacia,
  totalActa,
  validarActa,
  type ActaResumen,
  type ContratoParaActa,
  type InsumoParaActa,
  type ItemParaActa,
  type LineaActaForm,
} from "@/lib/actas"
import {
  buscarContratistasParaActa,
  buscarContratosParaActa,
  buscarItemsParaActa,
  contratosDeContratista,
  guardarActa,
  insumosDeItemParaActa,
  listarActasDeContrato,
} from "@/app/(app)/contratos/actas/actions"

// Elaboración de actas: se busca el contrato o el contratista (con un solo
// contrato aprobado se escoge solo; con varios, se elige en la lista). Del
// contrato se ve su información y sus actas, y "Crear acta nueva" abre la
// tabla para llenar (hasta 20 líneas). El acta queda por aprobar.

const mensaje = (e: unknown, otro: string) => (e instanceof Error ? e.message : otro)

export function ActasContratosView({ puedeElaborar }: { puedeElaborar: boolean }) {
  const [contratista, setContratista] = useState<OpcionBuscador | null>(null)
  // Contratos aprobados del contratista elegido (null = no se ha elegido o se buscó por contrato y aún carga).
  const [contratosContratista, setContratosContratista] = useState<ContratoParaActa[] | null>(null)
  const [contrato, setContrato] = useState<ContratoParaActa | null>(null)
  const [cargandoContratos, setCargandoContratos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Los resultados de la última búsqueda de contratos, para pasar de la opción al contrato.
  const ultimosContratos = useRef(new Map<string, ContratoParaActa>())

  const buscarContratistas = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratistasParaActa(t)
    return lista.map((k) => ({
      id: k.id,
      etiqueta: k.nombre,
      subetiqueta: `${k.documento} · ${k.contratos} ${k.contratos === 1 ? "contrato" : "contratos"}`,
    }))
  }, [])

  const buscarContratos = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratosParaActa(t)
    ultimosContratos.current = new Map(lista.map((c) => [c.id, c]))
    return lista.map((c) => ({
      id: c.id,
      etiqueta: `${c.numeroContrato} · ${c.contratistaNombre}`,
      subetiqueta: `${c.proyectoCodigo} · ${c.objeto}`,
    }))
  }, [])

  function cargarContratosDe(contratistaId: string, elegido: ContratoParaActa | null) {
    setCargandoContratos(true)
    setError(null)
    contratosDeContratista(contratistaId)
      .then((lista) => {
        setContratosContratista(lista)
        if (!elegido) setContrato(lista.length === 1 ? lista[0] : null)
      })
      .catch((e) => setError(mensaje(e, "No se pudieron cargar los contratos.")))
      .finally(() => setCargandoContratos(false))
  }

  function elegirContratista(op: OpcionBuscador | null) {
    setContratista(op)
    setContrato(null)
    setContratosContratista(null)
    if (op) cargarContratosDe(op.id, null)
  }

  function elegirContrato(c: ContratoParaActa | null) {
    setContrato(c)
    if (c && c.contratistaId !== contratista?.id) {
      setContratista({ id: c.contratistaId, etiqueta: c.contratistaNombre, subetiqueta: c.contratistaDocumento })
      setContratosContratista(null)
      cargarContratosDe(c.contratistaId, c)
    }
  }

  const variosContratos = contratosContratista != null && contratosContratista.length > 1

  return (
    <MarcoPagina titulo="Elaboración de actas" subtitulo="Busca el contrato o el contratista y crea sus actas." scroll>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <section className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contratista</label>
            <BuscadorAsync
              placeholder="Buscar por nombre o documento..."
              valorSeleccionado={contratista}
              onSeleccionar={elegirContratista}
              buscar={buscarContratistas}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contrato</label>
            {cargandoContratos ? (
              <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando contratos...
              </div>
            ) : variosContratos ? (
              <Select
                value={contrato?.id ?? ""}
                onValueChange={(v) => elegirContrato(contratosContratista.find((c) => c.id === v) ?? null)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={`Escoge uno de sus ${contratosContratista.length} contratos`} />
                </SelectTrigger>
                <SelectContent>
                  {contratosContratista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.numeroContrato} · {c.objeto.length > 70 ? `${c.objeto.slice(0, 70)}…` : c.objeto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : contratista && contratosContratista?.length === 0 ? (
              <p className="flex h-10 items-center text-sm text-muted-foreground">Este contratista no tiene contratos aprobados.</p>
            ) : (
              <BuscadorAsync
                placeholder="Buscar por número de contrato u objeto..."
                valorSeleccionado={
                  contrato ? { id: contrato.id, etiqueta: contrato.numeroContrato, subetiqueta: `· ${contrato.objeto}` } : null
                }
                onSeleccionar={(op) => {
                  if (!op) {
                    // Quitar el contrato también suelta al contratista (se llenó con el contrato).
                    elegirContratista(null)
                    return
                  }
                  elegirContrato(ultimosContratos.current.get(op.id) ?? null)
                }}
                buscar={buscarContratos}
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
        </section>

        {contrato && <ContratoActas key={contrato.id} contrato={contrato} puedeElaborar={puedeElaborar} />}
      </div>
    </MarcoPagina>
  )
}

function ContratoActas({ contrato, puedeElaborar }: { contrato: ContratoParaActa; puedeElaborar: boolean }) {
  const [actas, setActas] = useState<ActaResumen[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = useCallback(() => {
    listarActasDeContrato(contrato.id)
      .then(setActas)
      .catch((e) => setError(mensaje(e, "No se pudieron cargar las actas.")))
  }, [contrato.id])
  useEffect(cargar, [cargar])

  const siguiente = (actas?.reduce((max, a) => Math.max(max, a.numero), 0) ?? 0) + 1

  return (
    <>
      <section className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody className="[&_th]:w-56 [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:px-4 [&_td]:py-2 [&_tr]:border-b last:[&_tr]:border-0">
            <tr>
              <th>Contratista</th>
              <td>
                {contrato.contratistaNombre} <span className="text-muted-foreground">({contrato.contratistaDocumento})</span>
              </td>
            </tr>
            <tr>
              <th>Número de contrato</th>
              <td className="font-medium">{contrato.numeroContrato}</td>
            </tr>
            <tr>
              <th>Valor del contrato</th>
              <td className="font-medium tabular-nums">{pesos(contrato.valor)}</td>
            </tr>
            <tr>
              <th>Tipo</th>
              <td>{tituloTipoContrato(contrato.tipo)}</td>
            </tr>
            <tr>
              <th>Proyecto</th>
              <td>
                {contrato.proyectoCodigo} · {contrato.proyectoNombre}
              </td>
            </tr>
            <tr>
              <th>Objeto</th>
              <td>{contrato.objeto}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {aviso && !creando && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </p>
      )}

      {creando ? (
        <FormularioActa
          contrato={contrato}
          numero={siguiente}
          onCancelar={() => setCreando(false)}
          onGuardada={(n) => {
            setCreando(false)
            setAviso(`Acta ${n} guardada. Queda por aprobar.`)
            cargar()
          }}
        />
      ) : (
        <section className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">Actas del contrato</h2>
            {puedeElaborar && (
              <Button
                onClick={() => {
                  setAviso(null)
                  setCreando(true)
                }}
                disabled={actas == null}
              >
                <Plus className="mr-1 h-4 w-4" /> Crear acta nueva
              </Button>
            )}
          </div>
          {error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : actas == null ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando actas...
            </p>
          ) : actas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Este contrato todavía no tiene actas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr className="[&_th]:px-4 [&_th]:py-2 [&_th]:font-medium">
                    <th>Acta</th>
                    <th>Fecha</th>
                    <th>Elaborada por</th>
                    <th className="text-right">Líneas</th>
                    <th className="text-right">Total</th>
                    <th className="text-center">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {actas.map((a) => (
                    <tr key={a.id} className="border-t [&_td]:px-4 [&_td]:py-2">
                      <td className="font-medium">Acta {a.numero}</td>
                      <td>{formatearFechaSinHora(a.createdAt)}</td>
                      <td>{a.creadoPorNombre ?? "—"}</td>
                      <td className="text-right tabular-nums">{a.lineas}</td>
                      <td className="text-right tabular-nums">{pesos(a.total)}</td>
                      <td className="text-center">
                        <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[a.estado]}`}>{ETIQUETA_ESTADO_ACTA[a.estado]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}

function FormularioActa({
  contrato,
  numero: numeroActa,
  onCancelar,
  onGuardada,
}: {
  contrato: ContratoParaActa
  numero: number
  onCancelar: () => void
  onGuardada: (numero: number) => void
}) {
  const [lineas, setLineas] = useState<LineaActaForm[]>([lineaActaVacia()])
  // Clave estable de cada fila (al quitar una, las de abajo no heredan los insumos cargados de otra).
  const siguienteClave = useRef(1)
  const [claves, setClaves] = useState<number[]>([0])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (i: number, cambios: Partial<LineaActaForm>) =>
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, ...cambios } : l)))

  async function guardar() {
    const r = validarActa(lineas)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      const creada = await guardarActa(contrato.id, lineas)
      onGuardada(creada.numero)
    } catch (e) {
      setError(mensaje(e, "No se pudo guardar el acta."))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">Acta {numeroActa}</h2>
        <p className="text-sm text-muted-foreground">
          Busca el ítem, escoge el insumo y escribe la cantidad. El precio y el IVA salen del APU del presupuesto.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-muted/50 text-left">
            <tr className="[&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
              <th className="w-10 text-center">#</th>
              <th className="w-[30%]">Ítem</th>
              <th className="w-[26%]">Insumo</th>
              <th className="w-28 text-right">Cantidad</th>
              <th className="w-32 text-right">Precio</th>
              <th className="w-32 text-right">Base IVA</th>
              <th className="w-20 text-right">IVA %</th>
              <th className="w-36 text-right">Total</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l, i) => (
              <FilaActa
                key={claves[i]}
                indice={i}
                linea={l}
                contratoId={contrato.id}
                onCambiar={(c) => cambiar(i, c)}
                onQuitar={
                  lineas.length > 1
                    ? () => {
                        setLineas((ls) => ls.filter((_, k) => k !== i))
                        setClaves((cs) => cs.filter((_, k) => k !== i))
                      }
                    : undefined
                }
              />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30">
              <td colSpan={7} className="px-2 py-3 text-right font-semibold">
                Total del acta
              </td>
              <td className="px-2 py-3 text-right text-base font-semibold tabular-nums">{pesos(totalActa(lineas))}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <Button
          variant="outline"
          onClick={() => {
            setLineas((ls) => [...ls, lineaActaVacia()])
            setClaves((cs) => [...cs, siguienteClave.current++])
          }}
          disabled={lineas.length >= MAX_LINEAS_ACTA || guardando}
        >
          <Plus className="mr-1 h-4 w-4" /> Agregar línea ({lineas.length}/{MAX_LINEAS_ACTA})
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar acta
          </Button>
        </div>
      </div>
      {error && <p className="px-4 pb-3 text-sm text-destructive">{error}</p>}
    </section>
  )
}

function FilaActa({
  indice,
  linea,
  contratoId,
  onCambiar,
  onQuitar,
}: {
  indice: number
  linea: LineaActaForm
  contratoId: string
  onCambiar: (cambios: Partial<LineaActaForm>) => void
  onQuitar?: () => void
}) {
  const [insumos, setInsumos] = useState<InsumoParaActa[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ultimosItems = useRef(new Map<string, ItemParaActa>())
  const itemId = linea.item?.id ?? null

  // Al cambiar el ítem se cargan los insumos de su APU.
  useEffect(() => {
    if (!itemId) return
    let vigente = true
    insumosDeItemParaActa(contratoId, itemId)
      .then((lista) => vigente && setInsumos(lista))
      .catch((e) => vigente && setError(mensaje(e, "No se pudieron cargar los insumos.")))
    return () => {
      vigente = false
    }
  }, [contratoId, itemId])

  const buscarItems = useCallback(
    async (t: string): Promise<OpcionBuscador[]> => {
      const lista = await buscarItemsParaActa(contratoId, t)
      ultimosItems.current = new Map(lista.map((it) => [it.id, it]))
      return lista.map((it) => ({ id: it.id, etiqueta: `${it.codigo} ${it.descripcion}`, subetiqueta: it.unidad }))
    },
    [contratoId]
  )

  const calculo = calculoLineaForm(linea)
  const insumosDelItem = itemId ? insumos : null

  return (
    <tr className="border-t align-top [&_td]:px-2 [&_td]:py-2">
      <td className="pt-4 text-center text-muted-foreground">{indice + 1}</td>
      <td>
        <BuscadorAsync
          flotante
          placeholder="Buscar ítem por código o descripción..."
          valorSeleccionado={linea.item ? { id: linea.item.id, etiqueta: `${linea.item.codigo} ${linea.item.descripcion}` } : null}
          onSeleccionar={(op) => {
            setInsumos(null)
            setError(null)
            onCambiar({ item: op ? (ultimosItems.current.get(op.id) ?? null) : null, insumo: null })
          }}
          buscar={buscarItems}
        />
      </td>
      <td>
        {!linea.item ? (
          <p className="pt-2 text-xs text-muted-foreground">Escoge primero el ítem.</p>
        ) : error ? (
          <p className="pt-2 text-xs text-destructive">{error}</p>
        ) : insumosDelItem == null ? (
          <p className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Cargando insumos...
          </p>
        ) : insumosDelItem.length === 0 ? (
          <p className="pt-2 text-xs text-muted-foreground">El APU de este ítem no tiene insumos.</p>
        ) : (
          <Select
            value={linea.insumo?.itemApuId ?? ""}
            onValueChange={(v) => onCambiar({ insumo: insumosDelItem.find((x) => x.itemApuId === v) ?? null })}
          >
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Escoge el insumo" />
            </SelectTrigger>
            <SelectContent>
              {insumosDelItem.map((x) => (
                <SelectItem key={x.itemApuId} value={x.itemApuId}>
                  {x.insumoCodigo != null ? `${x.insumoCodigo} · ` : ""}
                  {x.descripcion}
                  {x.unidad ? ` (${x.unidad})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>
      <td>
        <Input
          inputMode="decimal"
          className="h-10 text-right tabular-nums"
          placeholder="0"
          value={linea.cantidad}
          onChange={(e) => onCambiar({ cantidad: e.target.value })}
          aria-label={`Cantidad de la línea ${indice + 1}`}
        />
        {linea.insumo?.unidad && <p className="mt-0.5 text-right text-xs text-muted-foreground">{linea.insumo.unidad}</p>}
      </td>
      <td className="pt-4 text-right tabular-nums">
        {linea.insumo ? (linea.insumo.precio != null ? pesos(linea.insumo.precio) : "Sin precio") : "—"}
      </td>
      <td className="pt-4 text-right tabular-nums">{calculo ? pesos(calculo.base) : "—"}</td>
      <td className="pt-4 text-right tabular-nums">{linea.insumo ? `${numero(linea.insumo.ivaPorcentaje)} %` : "—"}</td>
      <td className="pt-4 text-right font-medium tabular-nums">{calculo ? pesos(calculo.total) : "—"}</td>
      <td className="pt-2">
        {onQuitar && (
          <Button variant="ghost" size="icon" onClick={onQuitar} aria-label={`Quitar la línea ${indice + 1}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </td>
    </tr>
  )
}
