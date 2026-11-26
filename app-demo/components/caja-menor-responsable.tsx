"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Download, Loader2, Paperclip, Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { DialogoLegalizacion, EtiquetaEstadoLegalizacion } from "@/components/detalle-legalizacion-caja-menor"
import { createClient } from "@/lib/supabase/client"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora, hoyColombia } from "@/lib/fechas"
import { rutaSoporte, validarArchivoSoporte } from "@/lib/soportes"
import { descargarPlantillaCajaMenor } from "@/lib/excel-caja-menor"
import {
  MAX_GASTOS_CAJA_MENOR,
  avisosLegalizacion,
  codigoListaProyectoCaja,
  gastoFormDesdeDetalle,
  gastoVacio,
  leerFilasCajaMenor,
  textoPorcentajeCaja,
  totalGastos,
  validarGasto,
  valorGasto,
  type CajaMenor,
  type ErrorFilaCajaMenor,
  type GastoForm,
  type LegalizacionDetalle,
  type LegalizacionFila,
  type ProyectoCajaMenor,
} from "@/lib/caja-menor"
import type { OpcionesReqAdmin } from "@/lib/requisiciones-admin"
import { opcionesRequisicionAdmin } from "@/app/(app)/ayf/pagos-administrativos/actions"
import {
  cancelarLegalizacion,
  enviarLegalizacion,
  listarMisLegalizaciones,
  miCajaMenor,
} from "@/app/(app)/ayf/cajas-menores/actions"

type Pestana = "nueva" | "mias"
type Edicion = { id: string; codigo: string; gastos: GastoForm[] }

// Caja menor del responsable (en Pagos administrativos): sube su legalización
// con todos los gastos (en la tabla o con el Excel) y el soporte de cada uno, y
// consulta las suyas. `abrir` = id de una legalización (aviso o Mis pendientes)
// o "nueva" (corte del 27).
export function CajaMenorResponsable({ abrir }: { abrir: string | null }) {
  const [caja, setCaja] = useState<CajaMenor | null | undefined>(undefined)
  const [proyectos, setProyectos] = useState<ProyectoCajaMenor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pestana, setPestana] = useState<Pestana>(abrir && abrir !== "nueva" ? "mias" : "nueva")
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [version, setVersion] = useState(0)
  const [verId, setVerId] = useState<string | null>(abrir && abrir !== "nueva" ? abrir : null)

  useEffect(() => {
    let vigente = true
    Promise.all([miCajaMenor(), opcionesRequisicionAdmin()])
      .then(([c, o]: [CajaMenor | null, OpcionesReqAdmin]) => {
        if (!vigente) return
        setCaja(c)
        const lista: ProyectoCajaMenor[] = o.proyectos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre }))
        if (c && !lista.some((p) => p.id === c.proyectoId))
          lista.unshift({ id: c.proyectoId, codigo: c.proyectoCodigo, nombre: c.proyectoNombre })
        setProyectos(lista)
      })
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudo cargar tu caja menor."))
    return () => {
      vigente = false
    }
  }, [])

  function corregir(d: LegalizacionDetalle) {
    setEdicion({ id: d.id, codigo: d.codigo, gastos: d.gastos.map(gastoFormDesdeDetalle) })
    setVerId(null)
    setPestana("nueva")
  }

  function alEnviar(id: string) {
    setEdicion(null)
    setVersion((v) => v + 1)
    setVerId(id)
    setPestana("mias")
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (caja === undefined)
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </p>
    )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {caja ? (
        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Mi caja menor</p>
            <p className="font-medium">
              N° {caja.numero} · {formatoMoneda(caja.monto)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Proyecto o área</p>
            <p className="truncate font-medium">
              {caja.proyectoCodigo || caja.proyectoNombre}
              {caja.descripcion ? ` · ${caja.descripcion}` : ""}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">El reembolso llega a</p>
            <p className="truncate font-medium" title={caja.cuentaTexto}>
              {caja.terceroNombre} · {caja.cuentaTexto}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Última legalización</p>
            <p className="truncate font-medium">
              {caja.ultimaLegalizacion ? `${caja.ultimaLegalizacion.codigo} · ${formatoMoneda(caja.ultimaLegalizacion.valorTotal)}` : "—"}
            </p>
          </div>
        </div>
      ) : (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          No tienes una caja menor abierta. Pídela a Financiera; aquí puedes consultar las legalizaciones que ya enviaste.
        </p>
      )}

      <div className="flex gap-1.5 border-b">
        {(
          [
            ...(caja ? [{ valor: "nueva" as const, etiqueta: edicion ? `Corregir ${edicion.codigo}` : "Nueva legalización" }] : []),
            { valor: "mias" as const, etiqueta: "Mis legalizaciones" },
          ] as const
        ).map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setPestana(p.valor)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pestana === p.valor ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pestana === "nueva" && caja ? (
          <FormularioLegalizacion
            key={`${edicion?.id ?? "nueva"}-${version}`}
            caja={caja}
            proyectos={proyectos}
            edicion={edicion}
            onEnviada={alEnviar}
            onCancelarEdicion={() => setEdicion(null)}
          />
        ) : (
          <MisLegalizaciones key={version} verId={verId} onVer={setVerId} onCerrarVer={() => setVerId(null)} onCorregir={corregir} />
        )}
      </div>
    </div>
  )
}

const claseCampo = "h-8 text-sm"

function FormularioLegalizacion({
  caja,
  proyectos,
  edicion,
  onEnviada,
  onCancelarEdicion,
}: {
  caja: CajaMenor
  proyectos: ProyectoCajaMenor[]
  edicion: Edicion | null
  onEnviada: (id: string) => void
  onCancelarEdicion: () => void
}) {
  const [gastos, setGastos] = useState<GastoForm[]>(() => edicion?.gastos ?? [gastoVacio(caja.proyectoId)])
  const [errores, setErrores] = useState<Record<number, string>>({})
  const [erroresExcel, setErroresExcel] = useState<ErrorFilaCajaMenor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const excelRef = useRef<HTMLInputElement>(null)
  const hoy = hoyColombia()

  const total = totalGastos(gastos)
  const avisos = useMemo(
    () => avisosLegalizacion(gastos.map((g) => valorGasto(g) ?? 0), caja.monto),
    [gastos, caja.monto]
  )

  const cambiar = (i: number, cambios: Partial<GastoForm>) =>
    setGastos((lista) => lista.map((g, k) => (k === i ? { ...g, ...cambios } : g)))

  function elegirSoporte(i: number, archivo: File | null) {
    if (!archivo) return
    const e = validarArchivoSoporte(archivo)
    if (e) {
      setErrores((x) => ({ ...x, [i]: e }))
      return
    }
    setErrores((x) => {
      const { [i]: _quitado, ...resto } = x
      return resto
    })
    cambiar(i, { archivoSoporte: archivo, soporte: null })
  }

  async function subirExcel(archivo: File) {
    setLeyendo(true)
    setError(null)
    setErroresExcel([])
    try {
      const XLSX = await import("xlsx")
      const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array", cellDates: true })
      const hoja = libro.Sheets[libro.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null, raw: true })
      const r = leerFilasCajaMenor(filas, proyectos)
      setErroresExcel(r.errores)
      if (r.gastos.length === 0) {
        if (r.errores.length === 0) setError("El archivo no trae filas llenas.")
        return
      }
      // Las filas vacías del formulario se reemplazan por las del Excel.
      const llenas = gastos.filter((g) => g.numeroFactura || g.nombre || g.valor || g.archivoSoporte || g.soporte)
      if (llenas.length + r.gastos.length > MAX_GASTOS_CAJA_MENOR) {
        setError(`Quedarían ${llenas.length + r.gastos.length} gastos; el máximo es ${MAX_GASTOS_CAJA_MENOR}.`)
        return
      }
      setGastos([...llenas, ...r.gastos])
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.")
    } finally {
      setLeyendo(false)
      if (excelRef.current) excelRef.current.value = ""
    }
  }

  function revisar(): boolean {
    const e: Record<number, string> = {}
    gastos.forEach((g, i) => {
      const m = validarGasto(g, hoy)
      if (m) e[i] = m
    })
    setErrores(e)
    if (gastos.length === 0) {
      setError("Agrega al menos un gasto.")
      return false
    }
    if (Object.keys(e).length > 0) {
      setError(`Hay ${Object.keys(e).length} gasto(s) con datos por completar (en rojo).`)
      return false
    }
    setError(null)
    return true
  }

  async function enviar() {
    setEnviando(true)
    setError(null)
    const subidas: string[] = []
    try {
      let uid: string | null = null
      if (gastos.some((g) => g.archivoSoporte)) {
        const { data } = await createClient().auth.getUser()
        uid = data.user?.id ?? null
        if (!uid) throw new Error("Inicia sesión otra vez para subir los soportes.")
      }
      const listos: GastoForm[] = []
      for (let i = 0; i < gastos.length; i++) {
        const { archivoSoporte, ...g } = gastos[i]
        if (archivoSoporte && uid) {
          const ruta = rutaSoporte(uid, `gasto-${i + 1}`, archivoSoporte)
          const { error: e } = await createClient()
            .storage.from("cajas_menores")
            .upload(ruta, archivoSoporte, { contentType: archivoSoporte.type, upsert: false })
          if (e) throw new Error(`Gasto ${i + 1}: no se pudo subir el soporte (${e.message}).`)
          subidas.push(ruta)
          listos.push({ ...g, soporte: { ruta, nombre: archivoSoporte.name, mime: archivoSoporte.type, tamano: archivoSoporte.size } })
        } else {
          listos.push(g)
        }
      }
      onEnviada(await enviarLegalizacion(edicion?.id ?? null, listos))
    } catch (e) {
      // Lo que se alcanzó a subir no quedó en ningún gasto: se borra.
      if (subidas.length > 0) await createClient().storage.from("cajas_menores").remove(subidas)
      setError(e instanceof Error ? e.message : "No se pudo enviar la legalización.")
    } finally {
      setEnviando(false)
      setConfirmar(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Escribe todos los gastos de la caja (o llénalos en la plantilla de Excel y súbela) y adjunta el soporte de cada uno:
        factura, cuenta de cobro o recibo original, con nombre y NIT o cédula de quien vendió, número, fecha, detalle y valor.
        Va a Financiera, que revisa los soportes; después Líder Financiera la aprueba y el reembolso pasa a Gerencia.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => descargarPlantillaCajaMenor(proyectos)}>
          <Download className="mr-1 size-4" /> Descargar plantilla
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={leyendo} onClick={() => excelRef.current?.click()}>
          {leyendo ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Upload className="mr-1 size-4" />} Subir Excel
        </Button>
        <input
          ref={excelRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) subirExcel(f)
          }}
        />
        {edicion && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancelarEdicion}>
            Dejar de corregir
          </Button>
        )}
      </div>

      {erroresExcel.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <p className="font-medium">Estas filas del Excel no se cargaron:</p>
          <ul className="list-disc pl-5">
            {erroresExcel.slice(0, 20).map((e) => (
              <li key={e.fila}>
                Fila {e.fila}: {e.mensaje}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[1250px] text-sm">
          <thead>
            <tr>
              <th className="w-10 px-2 py-2">N°</th>
              <th className="w-36 px-2 py-2">Fecha</th>
              <th className="w-44 px-2 py-2">Proyecto</th>
              <th className="w-28 px-2 py-2">N° factura</th>
              <th className="w-32 px-2 py-2">NIT o cédula</th>
              <th className="px-2 py-2">Nombre o razón social</th>
              <th className="px-2 py-2">Concepto</th>
              <th className="px-2 py-2">Destino</th>
              <th className="w-36 px-2 py-2">Valor total pagado</th>
              <th className="w-40 px-2 py-2">Soporte</th>
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {gastos.map((g, i) => (
              <tr key={g.clave} className={errores[i] ? "bg-red-50/60" : undefined}>
                <td className="px-2 py-1.5 text-right align-top tabular-nums">{i + 1}</td>
                <td className="px-2 py-1.5 align-top">
                  <CampoFecha value={g.fecha} max={hoy} onChange={(e) => cambiar(i, { fecha: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <select
                    value={g.proyectoId}
                    onChange={(e) => cambiar(i, { proyectoId: e.target.value })}
                    className="h-8 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">Elige…</option>
                    {proyectos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {codigoListaProyectoCaja(p)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input value={g.numeroFactura} onChange={(e) => cambiar(i, { numeroFactura: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input value={g.documento} onChange={(e) => cambiar(i, { documento: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input value={g.nombre} onChange={(e) => cambiar(i, { nombre: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input value={g.concepto} onChange={(e) => cambiar(i, { concepto: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input value={g.destino} onChange={(e) => cambiar(i, { destino: e.target.value })} className={claseCampo} />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Input
                    value={g.valor}
                    inputMode="decimal"
                    onChange={(e) => cambiar(i, { valor: e.target.value })}
                    className={`${claseCampo} text-right tabular-nums`}
                  />
                </td>
                <td className="px-2 py-1.5 align-top">
                  <label className="flex h-8 cursor-pointer items-center gap-1 truncate rounded-md border px-2 text-xs hover:bg-muted">
                    <Paperclip className="size-3.5 shrink-0" />
                    <span className="truncate">{g.archivoSoporte?.name ?? g.soporte?.nombre ?? "Adjuntar"}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => elegirSoporte(i, e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {errores[i] && <p className="mt-1 text-xs text-red-700">{errores[i]}</p>}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    title="Quitar gasto"
                    onClick={() => setGastos((lista) => lista.filter((_, k) => k !== i))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={gastos.length >= MAX_GASTOS_CAJA_MENOR}
          onClick={() => setGastos((lista) => [...lista, gastoVacio(lista[lista.length - 1]?.proyectoId ?? caja.proyectoId)])}
        >
          <Plus className="mr-1 size-4" /> Agregar gasto
        </Button>
        <p className="text-sm">
          {gastos.length} gasto(s) · Total: <span className="font-semibold tabular-nums">{formatoMoneda(total)}</span>
        </p>
      </div>

      <p className="text-xs text-muted-foreground">{textoPorcentajeCaja(total, caja.monto)}</p>
      {avisos.map((a) => (
        <p key={a} className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {a}
        </p>
      ))}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" disabled={enviando} onClick={() => revisar() && setConfirmar(true)}>
          {edicion ? "Corregir y enviar otra vez" : "Enviar a Financiera"}
        </Button>
      </div>

      <Dialog open={confirmar} onOpenChange={(o) => !enviando && setConfirmar(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enviar la legalización</DialogTitle>
            <DialogDescription>
              {gastos.length} gasto(s) por {formatoMoneda(total)}. Va a Financiera para revisar los soportes.
            </DialogDescription>
          </DialogHeader>
          {avisos.length > 0 && <p className="text-sm text-amber-800">{avisos.join(" ")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={enviando} onClick={() => setConfirmar(false)}>
              Volver
            </Button>
            <Button type="button" disabled={enviando} onClick={enviar}>
              {enviando && <Loader2 className="mr-1 size-4 animate-spin" />} Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MisLegalizaciones({
  verId,
  onVer,
  onCerrarVer,
  onCorregir,
}: {
  verId: string | null
  onVer: (id: string) => void
  onCerrarVer: () => void
  onCorregir: (d: LegalizacionDetalle) => void
}) {
  const [filas, setFilas] = useState<LegalizacionFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [cancelando, setCancelando] = useState<LegalizacionDetalle | null>(null)
  const [motivo, setMotivo] = useState("")
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vigente = true
    listarMisLegalizaciones()
      .then((f: LegalizacionFila[]) => vigente && setFilas(f))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar tus legalizaciones."))
    return () => {
      vigente = false
    }
  }, [recarga])

  async function cancelar() {
    if (!cancelando) return
    setOcupado(true)
    try {
      await cancelarLegalizacion(cancelando.id, motivo)
      setCancelando(null)
      setMotivo("")
      onCerrarVer()
      setRecarga((r) => r + 1)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo cancelar.")
    } finally {
      setOcupado(false)
    }
  }

  const columnas: ColumnaExcel<LegalizacionFila>[] = [
    { clave: "codigo", titulo: "Código", ancho: 130, texto: (f) => f.codigo },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 170,
      texto: (f) => f.estado,
      celda: (f) => <EtiquetaEstadoLegalizacion estado={f.estado} />,
    },
    { clave: "enviada", titulo: "Enviada", ancho: 160, texto: (f) => formatearFechaHora(f.enviadaEn), valorOrden: (f) => f.enviadaEn },
    { clave: "gastos", titulo: "Gastos", ancho: 80, alinear: "right", texto: (f) => String(f.nGastos), valorOrden: (f) => f.nGastos },
    {
      clave: "total",
      titulo: "Total",
      ancho: 140,
      alinear: "right",
      texto: (f) => formatoMoneda(f.valorTotal),
      valorOrden: (f) => f.valorTotal,
    },
    { clave: "cuadro", titulo: "Cuadro de pago", ancho: 140, texto: (f) => f.cuadroCodigo ?? "" },
    { clave: "motivo", titulo: "Motivo de devolución", ancho: 260, flexible: true, texto: (f) => (f.estado === "devuelta" ? f.motivoDevolucion ?? "" : "") },
  ]

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!filas)
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </p>
    )

  return (
    <div className="space-y-2">
      {filas.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">Todavía no has enviado legalizaciones de caja menor.</p>
      ) : (
        <TablaExcel
          filas={filas}
          columnas={columnas}
          claveFila={(f) => f.id}
          onDobleClickFila={(f) => onVer(f.id)}
          tituloFila={AYUDA_DOBLE_CLIC}
          tarjeta={{
            titulo: (f) => f.codigo,
            subtitulo: (f) => formatearFechaHora(f.enviadaEn),
            esquina: (f) => <EtiquetaEstadoLegalizacion estado={f.estado} />,
            campos: ["gastos", "total", "cuadro", "motivo"],
          }}
        />
      )}

      <DialogoLegalizacion
        id={verId}
        onCerrar={onCerrarVer}
        acciones={(d) =>
          d.esMia && (d.estado === "devuelta" || d.estado === "por_revisar") ? (
            <>
              <Button type="button" variant="outline" onClick={() => setCancelando(d)}>
                Cancelar legalización
              </Button>
              {d.estado === "devuelta" && (
                <Button type="button" onClick={() => onCorregir(d)}>
                  Corregir y enviar otra vez
                </Button>
              )}
            </>
          ) : null
        }
      />

      <Dialog open={cancelando != null} onOpenChange={(o) => !o && !ocupado && setCancelando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar {cancelando?.codigo}</DialogTitle>
            <DialogDescription>Escribe el motivo. Los gastos quedan registrados, pero no se reembolsan.</DialogDescription>
          </DialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => setCancelando(null)}>
              Volver
            </Button>
            <Button type="button" variant="destructive" disabled={ocupado || !motivo.trim()} onClick={cancelar}>
              {ocupado && <Loader2 className="mr-1 size-4 animate-spin" />} Cancelar legalización
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
