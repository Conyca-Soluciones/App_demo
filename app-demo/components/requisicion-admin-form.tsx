"use client"

import { useMemo, useRef, useState } from "react"
import { Download, FileSpreadsheet, Loader2, Pencil, Plus, Send, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { columnasItemsReqAdmin } from "@/components/detalle-requisicion-admin"
import { ItemRequisicionAdminDialog } from "@/components/item-requisicion-admin-dialog"
import { formatoMoneda } from "@/lib/pagos"
import { descargarPlantillaReqAdminPse, leerFilasReqAdminPse, type ErrorFilaReqAdmin } from "@/lib/excel-req-admin-pse"
import {
  ETIQUETA_METODO_REQ_ADMIN,
  MAX_ITEMS_REQ_ADMIN,
  descuentosItem,
  etiquetaProyecto,
  itemVacio,
  metodoDelCuadro,
  totalItem,
  totalItems,
  validarRequisicionAdmin,
  valorItem,
  type ItemFormReqAdmin,
  type OpcionesReqAdmin,
  etiquetaCuadroPa,
} from "@/lib/requisiciones-admin"
import { crearRequisicionAdmin, modificarRequisicionAdmin } from "@/app/(app)/ayf/pagos-administrativos/actions"
import { createClient } from "@/lib/supabase/client"
import { rutaSoporte } from "@/lib/soportes"

export type EdicionReqAdmin = {
  id: string
  numero: number | null
  codigos: string[] // PA-001-0001 de cada pago
  rechazada: boolean
  items: ItemFormReqAdmin[]
}

// Formulario de un cuadro de pagos administrativos (formato GF-F-018): ítems
// (máximo 50), cada uno por transferencia o PSE. Los de PSE también se pueden
// subir con la plantilla de Excel.
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
  const [verExcel, setVerExcel] = useState(false)
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
  // "¿Todos los pagos son del mismo proyecto?": los ítems nuevos vienen con ese
  // proyecto (y su empresa); al escogerlo se pone también en los que ya hay.
  const [mismoProyecto, setMismoProyecto] = useState(false)
  const [proyectoComun, setProyectoComun] = useState("")

  function escogerProyectoComun(id: string) {
    setProyectoComun(id)
    const p = opciones.proyectos.find((x) => x.id === id)
    if (!p) return
    setItems((lista) => lista.map((it) => ({ ...it, proyectoId: p.id, empresaId: p.empresaId || it.empresaId })))
  }
  function itemNuevo(): ItemFormReqAdmin {
    const it = itemVacio()
    const p = mismoProyecto ? opciones.proyectos.find((x) => x.id === proyectoComun) : undefined
    return p ? { ...it, proyectoId: p.id, empresaId: p.empresaId ?? "" } : it
  }

  const empresaPorId = useMemo(() => new Map(opciones.empresas.map((e) => [e.id, e.razonSocial])), [opciones])
  const proyectoPorId = useMemo(() => new Map(opciones.proyectos.map((p) => [p.id, p.codigo ?? p.nombre])), [opciones])

  const total = totalItems(items)
  const lleno = items.length >= MAX_ITEMS_REQ_ADMIN
  const errores = validarRequisicionAdmin(items)
  const erroresPorIndice = new Map(errores.filter((e) => e.indice >= 0).map((e) => [e.indice, e.mensaje]))

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
          `Con este archivo el cuadro quedaría con ${items.length + r.items.length} ítems; el máximo es ${MAX_ITEMS_REQ_ADMIN}. Divide los pagos en varios cuadros.`
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

  // Sube los soportes elegidos (bucket privado requisiciones_admin, carpeta del
  // usuario) y devuelve los ítems listos para el servidor (sin el File).
  async function itemsConSoportes(subidas: string[]): Promise<ItemFormReqAdmin[]> {
    const pendientes = items.filter((it) => it.archivoSoporte)
    let uid: string | null = null
    if (pendientes.length > 0) {
      const { data } = await createClient().auth.getUser()
      uid = data.user?.id ?? null
      if (!uid) throw new Error("Inicia sesión otra vez para subir los soportes.")
    }
    const salida: ItemFormReqAdmin[] = []
    for (let i = 0; i < items.length; i++) {
      const { archivoSoporte, ...it } = items[i]
      if (archivoSoporte && uid) {
        const ruta = rutaSoporte(uid, `item-${i + 1}`, archivoSoporte)
        const { error: e } = await createClient().storage
          .from("requisiciones_admin")
          .upload(ruta, archivoSoporte, { contentType: archivoSoporte.type, upsert: false })
        if (e) throw new Error(`Ítem ${i + 1}: no se pudo subir el soporte (${e.message}).`)
        subidas.push(ruta)
        salida.push({
          ...it,
          soporte: { ruta, nombre: archivoSoporte.name, mime: archivoSoporte.type, tamano: archivoSoporte.size, tipo: it.tipoSoporte },
        })
      } else {
        salida.push(it)
      }
    }
    return salida
  }

  async function enviar() {
    setEnviando(true)
    setError(null)
    const subidas: string[] = []
    try {
      const listos = await itemsConSoportes(subidas)
      if (edicion) {
        await modificarRequisicionAdmin(edicion.id, listos)
        onEnviada(edicion.id)
      } else {
        onEnviada(await crearRequisicionAdmin(listos))
      }
    } catch (e) {
      // Lo que se alcanzó a subir no quedó en ningún ítem: se borra.
      if (subidas.length > 0) await createClient().storage.from("requisiciones_admin").remove(subidas)
      setError(e instanceof Error ? e.message : "No se pudo enviar el cuadro de pagos.")
    } finally {
      setEnviando(false)
      setConfirmar(false)
    }
  }

  const columnas: ColumnaExcel<{ item: ItemFormReqAdmin; indice: number }>[] = [
        ...columnasItemsReqAdmin<{ item: ItemFormReqAdmin; indice: number }>(({ item: it, indice }) => {
          const [banco = null, tipoCuenta = null, numeroCuenta = null] = it.cuentaTexto ? it.cuentaTexto.split(" · ") : []
          return {
            orden: indice + 1,
            metodo: it.metodo,
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
            descuentos: descuentosItem(it),
            observaciones: it.observaciones || null,
            soporte: it.archivoSoporte ? { nombre: it.archivoSoporte.name } : it.soporte ? { nombre: it.soporte.nombre } : null,
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

  return (
    <div className="space-y-5">
      {edicion && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {edicion.rechazada ? "Corrigiendo" : "Modificando"} el pago administrativo {etiquetaCuadroPa(edicion)}. Al enviarlo vuelve a Gerencia con
            los mismos códigos; sus pagos por aprobar se reemplazan por los nuevos.
          </span>
          {onCancelarEdicion && (
            <Button size="sm" variant="outline" onClick={onCancelarEdicion}>
              Salir sin guardar
            </Button>
          )}
        </div>
      )}

      <section className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox
            checked={mismoProyecto}
            onCheckedChange={(v) => {
              setMismoProyecto(v === true)
              if (v !== true) setProyectoComun("")
            }}
          />
          ¿Todos los pagos son del mismo proyecto?
        </label>
        {mismoProyecto && (
          <div className="w-80 max-w-full space-y-1">
            <Label className="text-xs">Proyecto de todos los pagos</Label>
            <Select value={proyectoComun} onValueChange={(v) => escogerProyectoComun(String(v ?? ""))}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue placeholder="Escoge el proyecto" />
              </SelectTrigger>
              <SelectContent>
                {opciones.proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {etiquetaProyecto(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <p className="basis-full text-xs text-muted-foreground">
          {mismoProyecto
            ? "Cada ítem nuevo viene con este proyecto y su grupo empresarial; en cada ítem se puede cambiar el grupo empresarial."
            : "Escoge el proyecto en cada ítem. El grupo empresarial se llena con el del proyecto y se puede cambiar."}
        </p>
      </section>

      <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Ítems{" "}
              <span className="font-normal text-muted-foreground">
                ({items.length} de {MAX_ITEMS_REQ_ADMIN})
              </span>
            </p>
            <Button size="sm" variant="outline" onClick={() => setVerExcel((v) => !v)}>
              <FileSpreadsheet className="size-4" /> {verExcel ? "Ocultar Excel" : "Subir Excel de pagos PSE"}
            </Button>
          </div>

          {verExcel && (
            <div className="space-y-2 rounded-lg border border-dashed p-3">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileSpreadsheet className="size-4" />
                Para muchos pagos por PSE: descarga la plantilla, llena una fila por pago (máximo {MAX_ITEMS_REQ_ADMIN}) y súbela. Los ítems
                se agregan a la tabla como PSE para revisarlos antes de enviar.
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
                esquina: (f) => <span className="text-sm font-medium tabular-nums">{formatoMoneda(totalItem(f.item) ?? 0)}</span>,
                campos: ["metodo", "empresa", "titular", "banco", "numeroCuenta", "proyecto", "acciones"],
              }}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Todavía no hay ítems. {verExcel ? "Sube la plantilla llena o agrégalos uno a uno." : "Agrega el primero."}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setEditando({ indice: -1, item: itemNuevo() })} disabled={lleno}>
              <Plus className="size-4" /> Agregar ítem
            </Button>
            <p className="text-sm">
              Total: <span className="text-base font-semibold tabular-nums">{formatoMoneda(total)}</span>
            </p>
          </div>
          {lleno && <p className="text-xs text-muted-foreground">Llegaste al máximo de {MAX_ITEMS_REQ_ADMIN} ítems por cuadro.</p>}
        </section>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

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
            <Send className="size-4" /> {edicion ? "Enviar otra vez a Gerencia" : "Enviar a Gerencia"}
          </Button>
        </div>

      {editando && (
        <ItemRequisicionAdminDialog
          key={editando.item.clave}
          abierto
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
            <DialogTitle>¿Enviar el cuadro de pagos a Gerencia?</DialogTitle>
            <DialogDescription>
              {items.length > 0 ? ETIQUETA_METODO_REQ_ADMIN[metodoDelCuadro(items)] : ""} · {items.length} {items.length === 1 ? "ítem" : "ítems"} ·{" "}
              {formatoMoneda(total)}. Pasa a Aprobación de pagos (Gerencia), que lo aprueba o rechaza completo.
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
