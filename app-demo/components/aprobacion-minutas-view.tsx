"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleSolicitudContrato, fechaContrato, tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { MinutaSoloPdf } from "@/components/minuta-solo-pdf"
import { useProyectoActual } from "@/components/proyecto-provider"
import {
  CLASE_ESTADO_MINUTA,
  ETIQUETA_ESTADO_MINUTA,
  pesos,
  type EstadoMinuta,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/lib/contratos"
import { listarMinutasSubgerencia, resolverMinutaContrato, type AccionMinuta } from "@/app/(app)/contratos/aprobacion-minutas/actions"

// ---------------------------------------------------------------------------
// Aprobación de contratos (ruta /contratos/aprobacion-minutas): Subgerencia
// revisa las minutas que envía Jurídica, de
// todos sus proyectos (no depende del proyecto actual), y las aprueba o las
// devuelve con motivo. Al aprobar, el contrato recibe su número CJ y ya se le
// pueden hacer actas. La minuta se ve solo en PDF (sin el editor de Jurídica).
// ---------------------------------------------------------------------------

const FILTROS: { valor: EstadoMinuta | "todas"; etiqueta: string }[] = [
  { valor: "en_revision", etiqueta: "Por aprobar" },
  { valor: "devuelta", etiqueta: "Devueltas" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "todas", etiqueta: "Todas" },
]

const TEXTO_ACCION: Record<AccionMinuta, { titulo: string; explicacion: string; boton: string; pideMotivo: boolean }> = {
  aprobar: {
    titulo: "Aprobar minuta",
    explicacion: "Es definitivo: el contrato recibe su número y ya se le pueden hacer actas. Jurídica y quien pidió el contrato reciben una notificación.",
    boton: "Aprobar",
    pideMotivo: false,
  },
  devolver: {
    titulo: "Devolver minuta",
    explicacion: "Vuelve a Jurídica con este motivo; la corrige y la envía otra vez.",
    boton: "Devolver",
    pideMotivo: true,
  },
}

const etiquetaMinuta = (s: SolicitudContratoFila) => ETIQUETA_ESTADO_MINUTA[s.minutaEstado ?? "elaboracion"]

export function AprobacionMinutasView({ puedeResolver, verInicial }: { puedeResolver: boolean; verInicial: string | null }) {
  const router = useRouter()
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<EstadoMinuta | "todas">("en_revision")
  const [proyectoId, setProyectoId] = useState("")
  const [minutas, setMinutas] = useState<SolicitudContratoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)
  const [accion, setAccion] = useState<{ tipo: AccionMinuta; detalle: SolicitudContratoDetalle } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    listarMinutasSubgerencia({ estado: filtro === "todas" ? undefined : filtro, proyectoId: proyectoId || undefined })
      .then((lista: SolicitudContratoFila[]) => setMinutas(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las minutas."))
  }
  useEffect(cargar, [filtro, proyectoId])

  function cambiarFiltro(valor: EstadoMinuta | "todas") {
    setMinutas(null)
    setError(null)
    setFiltro(valor)
  }
  function cambiarProyecto(valor: string) {
    setMinutas(null)
    setError(null)
    setProyectoId(valor)
  }

  const columnas: ColumnaExcel<SolicitudContratoFila>[] = useMemo(
    () => [
      {
        clave: "numero",
        titulo: "N°",
        ancho: 70,
        fija: true,
        alinear: "right",
        texto: (s) => String(s.numero),
        celda: (s) => (
          <button
            type="button"
            onClick={() => setDetalleId(s.id)}
            title={`Revisar la minuta de la solicitud N° ${s.numero}`}
            className="cursor-pointer rounded-sm font-medium tabular-nums text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {s.numero}
          </button>
        ),
      },
      { clave: "contrato", titulo: "Contrato", ancho: 120, texto: (s) => s.numeroContrato ?? "" },
      { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (s) => s.proyectoCodigo ?? s.proyectoNombre ?? "" },
      { clave: "tipo", titulo: "Tipo", ancho: 190, texto: (s) => `${tituloTipoContrato(s.tipo)}${s.clase === "general" ? " · General" : ""}` },
      { clave: "contratista", titulo: "Contratista", ancho: 200, texto: (s) => s.contratistaNombre },
      { clave: "objeto", titulo: "Objeto", ancho: 240, flexible: true, texto: (s) => s.objeto },
      { clave: "valor", titulo: "Valor", ancho: 150, alinear: "right", texto: (s) => pesos(s.valor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Minuta",
        ancho: 170,
        alinear: "center",
        texto: etiquetaMinuta,
        celda: (s) => (
          <Badge variant="outline" className={CLASE_ESTADO_MINUTA[s.minutaEstado ?? "elaboracion"]}>
            {etiquetaMinuta(s)}
          </Badge>
        ),
      },
      { clave: "enviadaPor", titulo: "Enviada por", ancho: 150, texto: (s) => s.minutaEnviadaPorNombre ?? "" },
      { clave: "enviada", titulo: "Enviada", ancho: 110, texto: (s) => (s.minutaEnviadaAt ? fechaContrato(s.minutaEnviadaAt) : ""), claseCelda: "tabular-nums" },
    ],
    []
  )

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/aprobacion-minutas")
  }

  async function confirmar() {
    if (!accion) return
    const texto = TEXTO_ACCION[accion.tipo]
    if (texto.pideMotivo && !motivo.trim()) {
      setErrorAccion("Escribe el motivo.")
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      await resolverMinutaContrato(accion.detalle.id, accion.tipo, motivo)
      const n = accion.detalle.numero
      setAviso(accion.tipo === "aprobar" ? `Minuta de la solicitud N° ${n} aprobada.` : `Minuta de la solicitud N° ${n} devuelta a Jurídica.`)
      setAccion(null)
      setMotivo("")
      cerrarDetalle()
      cargar()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo completar la acción.")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo="Aprobación de contratos" subtitulo="Subgerencia: revisa la minuta de los contratos que pre-aprobó Jurídica y apruébala o devuélvela para corregir." />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado de la minuta">
            {FILTROS.map((f) => (
              <Button key={f.valor} size="sm" role="tab" aria-selected={filtro === f.valor} variant={filtro === f.valor ? "default" : "outline"} onClick={() => cambiarFiltro(f.valor)}>
                {f.etiqueta}
              </Button>
            ))}
          </div>
          <select
            aria-label="Proyecto"
            value={proyectoId}
            onChange={(e) => cambiarProyecto(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Todos los proyectos</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
              </option>
            ))}
          </select>
          {minutas && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {minutas.length} {minutas.length === 1 ? "minuta" : "minutas"}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {minutas === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando minutas...
          </div>
        ) : minutas && minutas.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            {filtro === "en_revision" ? "No hay minutas por aprobar." : "No hay minutas con este filtro."}
          </div>
        ) : (
          minutas && (
            <TablaExcel
              filas={minutas}
              columnas={columnas}
              claveFila={(s) => s.id}
              onDobleClickFila={(s) => setDetalleId(s.id)}
              tituloFila="Doble clic para revisar la minuta"
              tarjeta={{
                titulo: (s) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(s.id)}>
                    N° {s.numero} · {s.contratistaNombre}
                  </button>
                ),
                subtitulo: (s) => `${tituloTipoContrato(s.tipo)} · ${s.proyectoCodigo ?? s.proyectoNombre ?? ""}`,
                esquina: (s) => columnas.find((c) => c.clave === "estado")!.celda!(s),
                campos: ["objeto", "valor", "enviadaPor", "enviada"],
              }}
            />
          )
        )}
      </main>

      <DetalleSolicitudContrato
        id={detalleId}
        onCerrar={cerrarDetalle}
        minuta={(d) => <MinutaSoloPdf id={d.id} />}
        acciones={(d) =>
          d.estado === "aprobada" && d.minutaEstado === "en_revision" && puedeResolver ? (
            <>
              <Button variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-50" onClick={() => setAccion({ tipo: "devolver", detalle: d })}>
                <Undo2 className="size-4" /> Devolver
              </Button>
              <Button onClick={() => setAccion({ tipo: "aprobar", detalle: d })}>
                <CheckCircle2 className="size-4" /> Aprobar minuta
              </Button>
            </>
          ) : null
        }
      />

      <Dialog
        open={accion !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !procesando) {
            setAccion(null)
            setMotivo("")
            setErrorAccion(null)
          }
        }}
      >
        <DialogContent>
          {accion && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {TEXTO_ACCION[accion.tipo].titulo} · solicitud N° {accion.detalle.numero}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {accion.detalle.contratistaNombre} · {pesos(accion.detalle.valor)}. {TEXTO_ACCION[accion.tipo].explicacion}
              </p>
              {TEXTO_ACCION[accion.tipo].pideMotivo && (
                <div className="space-y-1">
                  <label htmlFor="motivo-minuta" className="text-xs font-medium text-muted-foreground">
                    Motivo *
                  </label>
                  <textarea
                    id="motivo-minuta"
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    autoFocus
                    disabled={procesando}
                    placeholder="Qué debe corregir Jurídica en la minuta"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              )}
              {errorAccion && <p className="text-sm text-destructive">{errorAccion}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setAccion(null)} disabled={procesando}>
                  Cancelar
                </Button>
                <Button onClick={confirmar} disabled={procesando || (TEXTO_ACCION[accion.tipo].pideMotivo && !motivo.trim())}>
                  {procesando && <Loader2 className="size-4 animate-spin" />}
                  {TEXTO_ACCION[accion.tipo].boton}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
