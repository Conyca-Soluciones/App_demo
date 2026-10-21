"use client"

import { useMemo, useRef, useState } from "react"
import { Banknote, Download, FileSpreadsheet, Globe, Loader2, Pencil, Plus, Send, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { columnasItemsReqAdmin } from "@/components/detalle-requisicion-admin"
import { ItemRequisicionAdminDialog } from "@/components/item-requisicion-admin-dialog"
import { formatoMoneda } from "@/lib/pagos"
import { descargarPlantillaReqAdminPse, leerFilasReqAdminPse, type ErrorFilaReqAdmin } from "@/lib/excel-req-admin-pse"
import {
  ETIQUETA_METODO_REQ_ADMIN,
  MAX_ITEMS_REQ_ADMIN,
  itemParaMetodo,
  itemVacio,
  totalItems,
  validarRequisicionAdmin,
  valorItem,
  type ItemFormReqAdmin,
  type MetodoReqAdmin,
  type OpcionesReqAdmin,
} from "@/lib/requisiciones-admin"
import { crearRequisicionAdmin, modificarRequisicionAdmin } from "@/app/(app)/ayf/requisiciones-administrativas/actions"

export type EdicionReqAdmin = {
  id: string
  numero: number | null
  rechazada: boolean
  metodo: MetodoReqAdmin
  items: ItemFormReqAdmin[]
}

const METODOS: { valor: MetodoReqAdmin; titulo: string; descripcion: string; icono: typeof Banknote }[] = [
  {
    valor: "transferencia",
    titulo: "Transferencia",
    descripcion: "El tercero tiene que estar inscrito en Terceros, con su cuenta bancaria.",
    icono: Banknote,
  },
  {
    valor: "pse",
    titulo: "PSE",
    descripcion: "Se escriben los datos de quien factura; no lleva banco ni cuenta.",
    icono: Globe,
  },
]

// Formulario de una requisición administrativa (formato GF-F-018): primero el
// método de pago, luego los ítems (máximo 50). En PSE los ítems también se
// pueden subir con la plantilla de Excel.
export function RequisicionAdminForm({
  opciones,
  edicion,
  onEnviada,
  onCancelarEdicion,
}: {
  opciones: OpcionesReqAdmin
  edicion?: EdicionReqAdmin | null
  onEnviada: (id: string) => void
  onCancelarEdicion?: () => void
}) {
  const [metodo, setMetodo] = useState<MetodoReqAdmin | null>(edicion?.metodo ?? null)
  const [cambioMetodo, setCambioMetodo] = useState<MetodoReqAdmin | null>(null)
  const [modoPse, setModoPse] = useState<"llenar" | "excel">("llenar")
  const [items, setItems] = useState<ItemFormReqAdmin[]>(edicion?.items ?? [])
  // Ítem abierto en el diálogo: su posición, o -1 para uno nuevo.
  const [editando, setEditando] = useState<{ indice: number; item: ItemFormReqAdmin } | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [erroresExcel, setErroresExcel] = useState<ErrorFilaReqAdmin[]>([])
  const [leyendoExcel, setLeyendoExcel] = useState(false)
  const [descargando, setDescargando] = useState(false)
  const archivoRef = useRef<HTMLInputElement>(null)

  const empresaPorId = useMemo(() => new Map(opciones.empresas.map((e) => [e.id, e.razonSocial])), [opciones])
  const proyectoPorId = useMemo(() => new Map(opciones.proyectos.map((p) => [p.id, p.codigo ?? p.nombre])), [opciones])

  const total = totalItems(items)
  const lleno = items.length >= MAX_ITEMS_REQ_ADMIN
  const errores = metodo ? validarRequisicionAdmin(items, metodo) : []
  const erroresPorIndice = new Map(errores.filter((e) => e.indice >= 0).map((e) => [e.indice, e.mensaje]))

  function elegirMetodo(m: MetodoReqAdmin) {
    if (m === metodo) return
    if (items.length > 0) {
      setCambioMetodo(m)
      return
    }
    setMetodo(m)
  }

  function confirmarCambioMetodo() {
    if (!cambioMetodo) return
    setItems((lista) => lista.map(itemParaMetodo))
    setMetodo(cambioMetodo)
    setCambioMetodo(null)
  }

  function guardarItem(item: ItemFormReqAdmin) {
    if (!editando) return
    setItems((lista) => (editando.indice < 0 ? [...lista, item] : lista.map((x, i) => (i === editando.indice ? item : x))))
    setEditando(null)
  }

  async function descargarPlantilla() {
    setDescargando(true)
    try {
      await descargarPlantillaReqAdminPse(opciones)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo armar la plantilla.")
    } finally {
      setDescargando(false)
    }
  }

  async function subirExcel(archivo: File) {
    setLeyendoExcel(true)
    setError(null)
    setErroresExcel([])
    try {
      const XLSX = await import("xlsx")
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null })
      const r = leerFilasReqAdminPse(filas, opciones)
      setErroresExcel(r.errores)
      if (r.items.length === 0) {
        if (r.errores.length === 0) setError("El archivo no trae filas llenas.")
        return
      }
      if (items.length + r.items.length > MAX_ITEMS_REQ_ADMIN) {
        setError(
          `Con este archivo la requisición quedaría con ${items.length + r.items.length} ítems; el máximo es ${MAX_ITEMS_REQ_ADMIN}. Divide los pagos en varias requisiciones.`
        )
        return
      }
      setItems((lista) => [...lista, ...r.items])
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.")
    } finally {
      setLeyendoExcel(false)
      if (archivoRef.current) archivoRef.current.value = ""
    }
  }

  async function enviar() {
    if (!metodo) return
    setEnviando(true)
    setError(null)
    try {
      if (edicion) {
        await modificarRequisicionAdmin(edicion.id, metodo, items)
        onEnviada(edicion.id)
      } else {
        onEnviada(await crearRequisicionAdmin(metodo, items))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la requisición.")
    } finally {
      setEnviando(false)
      setConfirmar(false)
    }
  }

  const columnas: ColumnaExcel<{ item: ItemFormReqAdmin; indice: number }>[] = metodo
    ? [
        ...columnasItemsReqAdmin<{ item: ItemFormReqAdmin; indice: number }>(metodo, ({ item: it, indice }) => {
          const [banco = null, tipoCuenta = null, numeroCuenta = null] = it.cuentaTexto ? it.cuentaTexto.split(" · ") : []
          return {
            orden: indice + 1,
            empresa: empresaPorId.get(it.empresaId) ?? "",
            facturaNombre: it.facturaNombre,
            facturaNit: it.facturaNit,
            titularNombre: it.titularNombre,
            titularTipoDocumento: it.titularTipoDocumento,
            titularDocumento: it.titularDocumento,
            banco,
            tipoCuenta,
            numeroCuenta,
            cuentaVerificada: it.cuentaVerificada,
            concepto: it.concepto,
            proyecto: proyectoPorId.get(it.proyectoId) ?? "",
            valor: valorItem(it),
            observaciones: it.observaciones || null,
          }
        }),
        {
          clave: "acciones",
          titulo: "Acciones",
          ancho: 120,
          ordenable: false,
          texto: () => "",
          celda: ({ item: it, indice }) => (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Editar ítem" aria-label="Editar ítem" onClick={() => setEditando({ indice, item: it })}>
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-destructive"
                title="Quitar ítem"
                aria-label="Quitar ítem"
                onClick={() => setItems((lista) => lista.filter((_, i) => i !== indice))}
              >
                <Trash2 className="size-4" />
              </Button>
              {erroresPorIndice.has(indice) && (
                <span className="text-xs text-destructive" title={erroresPorIndice.get(indice)}>
                  Incompleto
                </span>
              )}
            </div>
          ),
        },
      ]
    : []

  return (
    <div className="space-y-5">
      {edicion && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {edicion.rechazada ? "Corrigiendo" : "Modificando"} la requisición administrativa N° {edicion.numero}. Al enviarla vuelve a A&F con
            el mismo número.
          </span>
          {onCancelarEdicion && (
            <Button size="sm" variant="outline" onClick={onCancelarEdicion}>
              Salir sin guardar
            </Button>
          )}
        </div>
      )}

      <section className="space-y-2">
        <p className="text-sm font-medium">1. ¿Cómo se paga?</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {METODOS.map((m) => {
            const Icono = m.icono
            const activo = metodo === m.valor
            return (
              <button
                key={m.valor}
                type="button"
                onClick={() => elegirMetodo(m.valor)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  activo ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                }`}
              >
                <Icono className={`mt-0.5 size-5 shrink-0 ${activo ? "text-primary" : "text-muted-foreground"}`} />
                <span>
                  <span className="block font-medium">{m.titulo}</span>
                  <span className="block text-sm text-muted-foreground">{m.descripcion}</span>
                </span>
              </button>
            )
          })}
        </div>
        {cambioMetodo && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>
              Al cambiar a {ETIQUETA_METODO_REQ_ADMIN[cambioMetodo]} se borran los datos del tercero y de la cuenta de los {items.length}{" "}
              ítems (se conservan grupo, proyecto, concepto, valor y observaciones).
            </span>
            <Button size="sm" onClick={confirmarCambioMetodo}>
              Cambiar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCambioMetodo(null)}>
              No
            </Button>
          </div>
        )}
      </section>

      {metodo && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              2. Ítems{" "}
              <span className="font-normal text-muted-foreground">
                ({items.length} de {MAX_ITEMS_REQ_ADMIN})
              </span>
            </p>
            {metodo === "pse" && (
              <div className="flex gap-1.5 rounded-md border p-0.5">
                {(
                  [
                    { valor: "llenar", etiqueta: "Llenar la información" },
                    { valor: "excel", etiqueta: "Subir Excel (muchos pagos)" },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.valor}
                    type="button"
                    onClick={() => setModoPse(o.valor)}
                    className={`rounded px-3 py-1 text-sm ${modoPse === o.valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {o.etiqueta}
                  </button>
                ))}
              </div>
            )}
          </div>

          {metodo === "pse" && modoPse === "excel" && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="size-4" />
                Descarga la plantilla, llena una fila por pago (máximo {MAX_ITEMS_REQ_ADMIN}) y súbela. Los ítems se agregan a la tabla para
                revisarlos antes de enviar.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={descargarPlantilla} disabled={descargando}>
                  {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Descargar plantilla
                </Button>
                <Button size="sm" onClick={() => archivoRef.current?.click()} disabled={leyendoExcel || lleno}>
                  {leyendoExcel ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Subir Excel
                </Button>
                <input
                  ref={archivoRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) subirExcel(f)
                  }}
                />
              </div>
              {erroresExcel.length > 0 && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">
                  <p className="font-medium">Filas que no se cargaron (corrígelas en el Excel y súbelo otra vez):</p>
                  <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
                    {erroresExcel.map((e) => (
                      <li key={e.fila}>
                        Fila {e.fila}: {e.mensaje}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {items.length > 0 ? (
            <TablaExcel
              filas={items.map((item, indice) => ({ item, indice }))}
              columnas={columnas}
              claveFila={(f) => f.item.clave}
              onDobleClickFila={(f) => setEditando({ indice: f.indice, item: f.item })}
              tituloFila="Doble clic para editar"
              claseAltoMax="max-h-[55svh]"
              tarjeta={{
                titulo: (f) => `${f.indice + 1}. ${f.item.facturaNombre || "Sin empresa que factura"}`,
                subtitulo: (f) => f.item.concepto,
                esquina: (f) => <span className="text-sm font-medium tabular-nums">{formatoMoneda(valorItem(f.item) ?? 0)}</span>,
                campos: ["empresa", "titular", ...(metodo === "transferencia" ? ["banco", "numeroCuenta"] : []), "proyecto", "acciones"],
              }}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Todavía no hay ítems. {metodo === "pse" && modoPse === "excel" ? "Sube la plantilla llena o agrégalos uno a uno." : "Agrega el primero."}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setEditando({ indice: -1, item: itemVacio() })} disabled={lleno}>
              <Plus className="size-4" /> Agregar ítem
            </Button>
            <p className="text-sm">
              Total: <span className="text-base font-semibold tabular-nums">{formatoMoneda(total)}</span>
            </p>
          </div>
          {lleno && <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_ITEMS_REQ_ADMIN} ítems por requisición.</p>}
        </section>
      )}

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {metodo && (
        <div className="flex justify-end border-t pt-4">
          <Button
            onClick={() => {
              if (errores.length > 0) {
                const e = errores[0]
                setError(e.indice >= 0 ? `Ítem ${e.indice + 1}: ${e.mensaje}` : e.mensaje)
                return
              }
              setError(null)
              setConfirmar(true)
            }}
            disabled={enviando || items.length === 0}
          >
            <Send className="size-4" /> {edicion ? "Enviar otra vez a A&F" : "Enviar a A&F"}
          </Button>
        </div>
      )}

      {editando && metodo && (
        <ItemRequisicionAdminDialog
          key={editando.item.clave}
          abierto
          metodo={metodo}
          opciones={opciones}
          inicial={editando.item}
          numero={editando.indice < 0 ? items.length + 1 : editando.indice + 1}
          onGuardar={guardarItem}
          onCerrar={() => setEditando(null)}
        />
      )}

      <Dialog open={confirmar} onOpenChange={(a) => !a && !enviando && setConfirmar(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Enviar la requisición a A&F?</DialogTitle>
            <DialogDescription>
              {metodo ? ETIQUETA_METODO_REQ_ADMIN[metodo] : ""} · {items.length} {items.length === 1 ? "ítem" : "ítems"} ·{" "}
              {formatoMoneda(total)}. A&F la aprueba o la rechaza completa en Aprobación de pagos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmar(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando && <Loader2 className="size-4 animate-spin" />} Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
