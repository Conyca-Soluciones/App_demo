"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as XLSX from "xlsx"
import { AlertTriangle, CheckCircle2, FileText, Loader2, Paperclip, Upload, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { pedirTexto } from "@/components/ui/confirmar"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { createClient } from "@/lib/supabase/client"
import { extensionArchivo, revisarArchivoTercero } from "@/lib/archivos-tercero"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  etapaPagoSinco,
  leerCuadroSinco,
  puedeCambiarSoporteSinco,
  type FilaCuadroSinco,
  type ResumenCuadroSinco,
} from "@/lib/cuadros-sinco"
import {
  anularCuadroSinco,
  cargarCuadroSinco,
  enlaceSoporteSinco,
  fijarPersonasCuadroSinco,
  guardarSoporteSinco,
  listarCuadrosSinco,
  obtenerCuadroSinco,
  personasParaCuadroSinco,
  revisarCuadroSinco,
  type CuadroSinco,
  type FilaSinco,
  type PersonaCuadro,
} from "@/app/(app)/cuadros-sinco/actions"

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// ============================================================ Lista de cuadros

export function CuadrosSincoView({ puedeCargar }: { puedeCargar: boolean }) {
  const router = useRouter()
  const [cuadros, setCuadros] = useState<CuadroSinco[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)

  const leer = useCallback(() => {
    listarCuadrosSinco()
      .then((c: CuadroSinco[]) => setCuadros(c))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los cuadros."))
  }, [])
  useEffect(leer, [leer])

  const columnas: ColumnaExcel<CuadroSinco>[] = useMemo(
    () => [
      { clave: "numero", titulo: "N°", ancho: 60, texto: (c) => String(c.numero), valorOrden: (c) => c.numero },
      { clave: "archivo", titulo: "Archivo", ancho: 300, flexible: true, texto: (c) => c.archivo },
      { clave: "cargado", titulo: "Cargado", ancho: 170, texto: (c) => formatearFechaHora(c.cargadoEn), valorOrden: (c) => c.cargadoEn },
      { clave: "por", titulo: "Por", ancho: 160, texto: (c) => c.cargadoPor ?? "—" },
      { clave: "pagos", titulo: "Pagos", ancho: 70, alinear: "right", texto: (c) => String(c.filas), valorOrden: (c) => c.filas },
      { clave: "total", titulo: "Total", ancho: 150, alinear: "right", texto: (c) => formatoMoneda(c.total), valorOrden: (c) => c.total },
      {
        clave: "soportes",
        titulo: "Soportes",
        ancho: 150,
        texto: (c) => (c.anuladoEn ? "Anulado" : c.sinSoporte > 0 ? `Faltan ${c.sinSoporte}` : "Completos"),
        valorOrden: (c) => (c.anuladoEn ? -1 : c.sinSoporte),
        celda: (c) =>
          c.anuladoEn ? (
            <Badge variant="outline">Anulado</Badge>
          ) : c.sinSoporte > 0 ? (
            <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Faltan {c.sinSoporte}</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Completos</Badge>
          ),
      },
      { clave: "personas", titulo: "Adjuntan soportes", ancho: 240, texto: (c) => c.personas ?? "—" },
    ],
    []
  )
  const { ordenadas, orden, ordenar } = useOrdenExcel(cuadros ?? [], columnas)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {puedeCargar && (
          <Button onClick={() => setCargando(true)}>
            <Upload className="mr-1 h-4 w-4" /> Cargar cuadro de SINCO
          </Button>
        )}
        <p className="text-sm text-muted-foreground">
          {puedeCargar
            ? "Los pagos entran aprobados a Preparación del Consolidado. Las personas que elijas adjuntan el soporte de cada pago; sin soporte no pasa a liquidar."
            : "Cuadros de pagos de SINCO en los que te pidieron adjuntar los soportes. Abre uno para subir la factura o cuenta de cobro de cada pago."}
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {cuadros == null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </p>
      ) : cuadros.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay cuadros.</p>
      ) : (
        <TablaExcel
          filas={ordenadas}
          columnas={columnas}
          claveFila={(c) => c.id}
          orden={orden}
          onOrdenar={ordenar}
          onDobleClickFila={(c) => router.push(`/cuadros-sinco/${c.id}`)}
          tituloFila="Doble clic para abrir el cuadro"
          tarjeta={{
            titulo: (c) => `N° ${c.numero} · ${c.archivo}`,
            esquina: (c) => (
              <Link href={`/cuadros-sinco/${c.id}`} className="text-sm text-primary hover:underline">
                Abrir
              </Link>
            ),
            campos: ["cargado", "pagos", "total", "soportes", "personas"],
          }}
        />
      )}
      {cuadros && cuadros.length > 0 && <p className="text-xs text-muted-foreground">Doble clic en un cuadro para abrirlo.</p>}
      {cargando && (
        <CargarCuadroDialogo
          onCerrar={() => setCargando(false)}
          onCargado={(id) => {
            setCargando(false)
            router.push(`/cuadros-sinco/${id}`)
          }}
        />
      )}
    </div>
  )
}

// ============================================================ Elegir personas

function SelectorPersonas({
  elegidas,
  onCambiar,
}: {
  elegidas: string[]
  onCambiar: (ids: string[]) => void
}) {
  const [personas, setPersonas] = useState<PersonaCuadro[] | null>(null)
  const [buscar, setBuscar] = useState("")
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    personasParaCuadroSinco()
      .then((p: PersonaCuadro[]) => setPersonas(p))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las personas."))
  }, [])
  const elegidasSet = useMemo(() => new Set(elegidas), [elegidas])
  const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  const visibles = useMemo(() => {
    const q = sinTildes(buscar.trim())
    const lista = personas ?? []
    return q ? lista.filter((p) => sinTildes(`${p.nombre} ${p.rol ?? ""}`).includes(q)) : lista
  }, [personas, buscar])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!personas) return <p className="text-sm text-muted-foreground">Cargando personas…</p>
  return (
    <div className="space-y-2">
      <Input placeholder="Buscar por nombre o rol" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
      <div className="max-h-56 overflow-auto rounded-md border">
        {visibles.map((p) => (
          <label key={p.id} className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-b-0">
            <Checkbox
              checked={elegidasSet.has(p.id)}
              onCheckedChange={(v) => onCambiar(v === true ? [...elegidas, p.id] : elegidas.filter((x) => x !== p.id))}
            />
            <span className="flex-1">{p.nombre}</span>
            {p.rol && <span className="text-xs text-muted-foreground">{p.rol}</span>}
          </label>
        ))}
        {visibles.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Nadie con ese nombre.</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        {elegidas.length === 0
          ? "Elige quién adjunta los soportes."
          : `${plural(elegidas.length, "persona elegida", "personas elegidas")}: le${elegidas.length === 1 ? "" : "s"} llega un correo y queda en sus pendientes.`}
      </p>
    </div>
  )
}

// ============================================================ Cargar cuadro

function CargarCuadroDialogo({ onCerrar, onCargado }: { onCerrar: () => void; onCargado: (id: string) => void }) {
  const [archivo, setArchivo] = useState<string | null>(null)
  const [filas, setFilas] = useState<FilaCuadroSinco[]>([])
  const [resumen, setResumen] = useState<ResumenCuadroSinco | null>(null)
  const [personas, setPersonas] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function leerArchivo(f: File) {
    setOcupado(true)
    setError(null)
    setResumen(null)
    setFilas([])
    try {
      const libro = XLSX.read(await f.arrayBuffer(), { type: "array" })
      const hojas = libro.SheetNames.map(
        (n) => [n, XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n], { header: 1, raw: true, defval: null })] as [string, unknown[][]]
      )
      const { filas: leidas, error: e } = leerCuadroSinco(hojas)
      if (e) throw new Error(e)
      setArchivo(f.name)
      setFilas(leidas)
      setResumen(await revisarCuadroSinco(f.name, leidas))
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el cuadro.")
    } finally {
      setOcupado(false)
    }
  }

  async function cargar() {
    if (!archivo || !resumen) return
    setOcupado(true)
    setError(null)
    try {
      const r = await cargarCuadroSinco(archivo, filas, personas)
      if (r.errores.length > 0 || !r.cuadroId) {
        setResumen(r)
        throw new Error("El cuadro cambió al revisarlo otra vez: mira los errores.")
      }
      onCargado(r.cuadroId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el cuadro.")
    } finally {
      setOcupado(false)
    }
  }

  const hayErrores = (resumen?.errores.length ?? 0) > 0
  const lista = (titulo: string, items: { orden: number; mensaje: string }[], clase: string) =>
    items.length > 0 && (
      <div className={`rounded-md border p-2 text-sm ${clase}`}>
        <p className="font-medium">{titulo}</p>
        <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5">
          {items.map((x, i) => (
            <li key={i}>
              Fila {x.orden}: {x.mensaje}
            </li>
          ))}
        </ul>
      </div>
    )

  return (
    <Dialog open onOpenChange={(v) => !v && !ocupado && onCerrar()}>
      <DialogContent className="max-h-[90svh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cargar cuadro de SINCO</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Input
              type="file"
              accept=".xlsx,.xls"
              disabled={ocupado}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void leerArchivo(f)
              }}
            />
            <p className="text-xs text-muted-foreground">
              El cuadro de compras o el de un proyecto (formato GF-F-018). Todos sus proyectos deben existir en 360.
            </p>
          </div>
          {ocupado && !resumen && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Revisando el cuadro…
            </p>
          )}
          {resumen && (
            <div className="space-y-3">
              {hayErrores ? (
                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="h-4 w-4" /> No se puede cargar: corrige lo de abajo (o crea los proyectos en Admin) y vuelve a subirlo.
                </p>
              ) : resumen.pagos === 0 ? (
                <p className="text-sm font-medium">No hay pagos nuevos: todo el cuadro ya estaba cargado.</p>
              ) : (
                <div className="rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {plural(resumen.pagos, "pago", "pagos")} por{" "}
                    {formatoMoneda(resumen.total)}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {resumen.porProyecto.map((p) => (
                      <li key={p.proyecto}>
                        {p.proyecto}: {plural(p.pagos, "pago", "pagos")} · {formatoMoneda(p.total)}
                      </li>
                    ))}
                    {resumen.tercerosNuevos > 0 && <li>Se crean {plural(resumen.tercerosNuevos, "tercero nuevo", "terceros nuevos")} en Terceros.</li>}
                    {resumen.cuentasNuevas > 0 && (
                      <li>Se agregan {plural(resumen.cuentasNuevas, "cuenta", "cuentas")} pendientes de verificar.</li>
                    )}
                  </ul>
                </div>
              )}
              {lista("Errores", resumen.errores, "border-destructive/40 bg-destructive/5")}
              {lista("Se saltan (ya cargados)", resumen.repetidas, "bg-muted/40")}
              {lista("Avisos", resumen.avisos, "border-amber-300 bg-amber-50")}
              {!hayErrores && resumen.pagos > 0 && (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Users className="h-4 w-4" /> ¿Quién adjunta los soportes?
                  </p>
                  <SelectorPersonas elegidas={personas} onCambiar={setPersonas} />
                </div>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={cargar} disabled={ocupado || !resumen || hayErrores || resumen.pagos === 0 || personas.length === 0}>
            {ocupado && resumen ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
            Cargar {resumen && resumen.pagos > 0 ? plural(resumen.pagos, "pago", "pagos") : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================ Un cuadro

type Detalle = NonNullable<Awaited<ReturnType<typeof obtenerCuadroSinco>>>

export function CuadroSincoDetalle({ id }: { id: string }) {
  const [detalle, setDetalle] = useState<Detalle | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const [editandoPersonas, setEditandoPersonas] = useState(false)
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)
  const filaElegida = useRef<FilaSinco | null>(null)

  const leer = useCallback(() => {
    obtenerCuadroSinco(id)
      .then((d: Detalle | null) => setDetalle(d))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el cuadro."))
  }, [id])
  useEffect(leer, [leer])

  function elegirArchivo(f: FilaSinco) {
    filaElegida.current = f
    entrada.current?.click()
  }

  async function subir(archivo: File) {
    const f = filaElegida.current
    if (!f || !detalle) return
    const problema = revisarArchivoTercero(archivo, "El soporte")
    if (problema) {
      setError(problema)
      return
    }
    setSubiendo(f.id)
    setError(null)
    setAviso(null)
    const supabase = createClient()
    const ruta = `${detalle.cuadro.id}/${f.id}/${crypto.randomUUID()}.${extensionArchivo(archivo)}`
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("sinco").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el soporte: ${e.message}`)
      subido = true
      await guardarSoporteSinco(f.id, { ruta, nombre: archivo.name, mime: archivo.type })
      setAviso(`Soporte de ${f.facturaNombre} guardado.`)
      leer()
    } catch (err) {
      if (subido) await supabase.storage.from("sinco").remove([ruta])
      setError(err instanceof Error ? err.message : "No se pudo guardar el soporte.")
    } finally {
      setSubiendo(null)
    }
  }

  async function verSoporte(f: FilaSinco) {
    try {
      window.open(await enlaceSoporteSinco(f.id), "_blank", "noopener")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir el soporte.")
    }
  }

  async function anular() {
    if (!detalle) return
    const motivo = await pedirTexto(
      `Se anulan los ${detalle.cuadro.filas} pagos del cuadro N° ${detalle.cuadro.numero} (salen del Consolidado). Solo se puede si ninguno se envió a liquidar.`,
      { titulo: "Anular cuadro", etiqueta: "Motivo", boton: "Anular", peligro: true, minimo: 3 }
    )
    if (!motivo) return
    try {
      await anularCuadroSinco(detalle.cuadro.id, motivo)
      setAviso("Cuadro anulado.")
      leer()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular.")
    }
  }

  const columnas: ColumnaExcel<FilaSinco>[] = useMemo(
    () => [
      { clave: "item", titulo: "Ítem", ancho: 55, fija: true, texto: (f) => String(f.item ?? ""), valorOrden: (f) => f.item ?? 0 },
      {
        clave: "soporte",
        titulo: "Soporte",
        ancho: 190,
        fija: true,
        ordenable: true,
        texto: (f) => f.soporteNombre ?? "Falta",
        valorOrden: (f) => (f.soporteNombre ? 1 : 0),
        celda: (f) => {
          const cambia = puedeCambiarSoporteSinco(f) && !detalle?.cuadro.anuladoEn
          return (
            <div className="flex items-center gap-1">
              {f.soporteNombre ? (
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
                  title={f.soporteNombre}
                  onClick={() => verSoporte(f)}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{f.soporteNombre}</span>
                </button>
              ) : (
                <span className="text-xs font-medium text-amber-700">Falta</span>
              )}
              {cambia && (
                <Button
                  size="sm"
                  variant={f.soporteNombre ? "ghost" : "outline"}
                  className="ml-auto h-7 shrink-0 px-2"
                  disabled={subiendo != null}
                  onClick={() => elegirArchivo(f)}
                  title={f.soporteNombre ? "Cambiar el soporte" : "Adjuntar la factura o cuenta de cobro"}
                >
                  {subiendo === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                  {f.soporteNombre ? "" : " Adjuntar"}
                </Button>
              )}
            </div>
          )
        },
      },
      { clave: "proyecto", titulo: "Proyecto", ancho: 190, texto: (f) => f.proyecto },
      { clave: "factura", titulo: "Quien factura", ancho: 240, flexible: true, texto: (f) => `${f.facturaNombre} · ${f.facturaDocumento}` },
      { clave: "numero", titulo: "Factura", ancho: 110, texto: (f) => f.numeroFactura ?? "—" },
      { clave: "documento", titulo: "Valor documento", ancho: 140, alinear: "right", texto: (f) => (f.valorDocumento != null ? formatoMoneda(f.valorDocumento) : "—"), valorOrden: (f) => f.valorDocumento },
      { clave: "anticipos", titulo: "Anticipos y desc.", ancho: 130, alinear: "right", texto: (f) => (f.anticipos ? formatoMoneda(f.anticipos) : "—"), valorOrden: (f) => f.anticipos },
      { clave: "total", titulo: "Total", ancho: 140, alinear: "right", texto: (f) => formatoMoneda(f.total), valorOrden: (f) => f.total },
      {
        clave: "cuenta",
        titulo: "Cuenta",
        ancho: 220,
        texto: (f) => (f.numeroCuenta ? `${f.banco ?? ""} · ${f.tipoCuenta ?? ""} · ${f.numeroCuenta}` : "Sin cuenta"),
      },
      { clave: "solicita", titulo: "Solicita", ancho: 160, texto: (f) => f.solicita ?? "—" },
      { clave: "obs", titulo: "Observaciones", ancho: 220, texto: (f) => f.observaciones ?? "" },
      {
        clave: "etapa",
        titulo: "Pago",
        ancho: 130,
        texto: (f) => `${etapaPagoSinco(f)}${f.referencia ? ` · REF ${f.referencia}` : ""}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detalle, subiendo]
  )
  const filasVisibles = useMemo(
    () => (detalle ? (soloFaltantes ? detalle.filas.filter((f) => !f.soporteNombre) : detalle.filas) : []),
    [detalle, soloFaltantes]
  )
  const { ordenadas, orden, ordenar } = useOrdenExcel(filasVisibles, columnas)

  if (detalle === undefined)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </p>
    )
  if (detalle === null) return <p className="text-sm text-muted-foreground">El cuadro no existe o no tienes acceso.</p>

  const c = detalle.cuadro
  const faltan = detalle.filas.filter((f) => !f.soporteNombre && puedeCambiarSoporteSinco(f)).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/cuadros-sinco" className="text-primary hover:underline">
          ← Cuadros de SINCO
        </Link>
        <span className="font-medium">
          N° {c.numero} · {c.archivo}
        </span>
        <span className="text-muted-foreground">
          {plural(c.filas, "pago", "pagos")} · {formatoMoneda(c.total)} · cargado {formatearFechaHora(c.cargadoEn)}
          {c.cargadoPor ? ` por ${c.cargadoPor}` : ""}
        </span>
        {c.anuladoEn ? (
          <Badge variant="outline">Anulado: {c.motivoAnulacion}</Badge>
        ) : faltan > 0 ? (
          <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Faltan {faltan} soportes</Badge>
        ) : (
          <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">Soportes completos</Badge>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Adjuntan soportes: {c.personas ?? "—"}</span>
        {detalle.puedeAdministrar && !c.anuladoEn && (
          <>
            <Button size="sm" variant="outline" onClick={() => setEditandoPersonas(true)}>
              <Users className="mr-1 h-4 w-4" /> Cambiar personas
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={anular}>
              Anular cuadro
            </Button>
          </>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-2">
          <Checkbox checked={soloFaltantes} onCheckedChange={(v) => setSoloFaltantes(v === true)} /> Solo los que faltan
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Adjunta la factura o cuenta de cobro de cada pago (PDF, JPG o PNG de hasta 10 MB). Se puede cambiar hasta que Contabilidad liquide el pago.
      </p>
      {aviso && <p className="text-sm text-emerald-700">{aviso}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ""
          if (f) void subir(f)
        }}
      />
      <TablaExcel
        filas={ordenadas}
        columnas={columnas}
        claveFila={(f) => f.id}
        orden={orden}
        onOrdenar={ordenar}
        fondoFila={(f) => (!f.soporteNombre && puedeCambiarSoporteSinco(f) && !c.anuladoEn ? "bg-amber-50" : undefined)}
        tarjeta={{
          titulo: (f) => `${f.item ?? ""}. ${f.facturaNombre}`,
          subtitulo: (f) => `${f.proyecto} · factura ${f.numeroFactura ?? "—"}`,
          campos: ["soporte", "total", "cuenta", "etapa"],
        }}
      />
      {editandoPersonas && (
        <PersonasDialogo
          cuadroId={c.id}
          iniciales={detalle.personas}
          onCerrar={() => setEditandoPersonas(false)}
          onGuardado={() => {
            setEditandoPersonas(false)
            setAviso("Personas actualizadas: a las nuevas les llega el aviso.")
            leer()
          }}
        />
      )}
    </div>
  )
}

function PersonasDialogo({
  cuadroId,
  iniciales,
  onCerrar,
  onGuardado,
}: {
  cuadroId: string
  iniciales: string[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [elegidas, setElegidas] = useState<string[]>(iniciales)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function guardar() {
    setOcupado(true)
    setError(null)
    try {
      await fijarPersonasCuadroSinco(cuadroId, elegidas)
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setOcupado(false)
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !ocupado && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Quién adjunta los soportes?</DialogTitle>
        </DialogHeader>
        <SelectorPersonas elegidas={elegidas} onCambiar={setElegidas} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={ocupado || elegidas.length === 0}>
            {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
