"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Undo2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleSolicitudContrato, fechaContrato, tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { useProyectoActual } from "@/components/proyecto-provider"
import { MinutaManoObraEditor } from "@/components/minuta-mano-obra-editor"
import {
  CLASE_ESTADO_CONTRATO,
  ETIQUETA_ESTADO_CONTRATO,
  pesos,
  type EstadoContrato,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/lib/contratos"
import {
  listarSolicitudesPreaprobacion,
  resolverSolicitudContrato,
  type AccionPreaprobacion,
} from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Pre-aprobación: Jurídica revisa solicitudes de todos sus proyectos (no
// depende del proyecto actual) y las aprueba, devuelve o rechaza.
// ---------------------------------------------------------------------------

const FILTROS: { valor: EstadoContrato | "todas"; etiqueta: string }[] = [
  { valor: "pre_aprobacion", etiqueta: "Por revisar" },
  { valor: "devuelta", etiqueta: "Devueltas" },
  { valor: "aprobada", etiqueta: "Pre-aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
]

const TEXTO_ACCION: Record<AccionPreaprobacion, { titulo: string; explicacion: string; boton: string; pideMotivo: boolean }> = {
  aprobar: {
    titulo: "Pre-aprobar solicitud",
    explicacion: "Pasa a elaboración de la minuta. Quien la solicitó recibe una notificación.",
    boton: "Pre-aprobar",
    pideMotivo: false,
  },
  devolver: {
    titulo: "Devolver para corregir",
    explicacion: "Vuelve al director con este motivo; la corrige y la reenvía con el mismo número. Mientras tanto sigue reservando su cantidad del presupuesto.",
    boton: "Devolver",
    pideMotivo: true,
  },
  rechazar: {
    titulo: "Rechazar solicitud",
    explicacion: "Es definitivo: la solicitud se cierra y su cantidad vuelve a estar disponible en el presupuesto.",
    boton: "Rechazar",
    pideMotivo: true,
  },
}

export function PreaprobacionContratosView({ puedeResolver, verInicial }: { puedeResolver: boolean; verInicial: string | null }) {
  const router = useRouter()
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<EstadoContrato | "todas">("pre_aprobacion")
  const [proyectoId, setProyectoId] = useState("")
  const [solicitudes, setSolicitudes] = useState<SolicitudContratoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)
  const [accion, setAccion] = useState<{ tipo: AccionPreaprobacion; detalle: SolicitudContratoDetalle } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    listarSolicitudesPreaprobacion({ estado: filtro === "todas" ? undefined : filtro, proyectoId: proyectoId || undefined })
      .then((lista: SolicitudContratoFila[]) => setSolicitudes(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
  }
  useEffect(cargar, [filtro, proyectoId])

  // Al cambiar un filtro se vacía la lista (muestra "Cargando...") y el
  // efecto de arriba vuelve a consultar.
  function cambiarFiltro(valor: EstadoContrato | "todas") {
    setSolicitudes(null)
    setError(null)
    setFiltro(valor)
  }
  function cambiarProyecto(valor: string) {
    setSolicitudes(null)
    setError(null)
    setProyectoId(valor)
  }

  const columnas: ColumnaExcel<SolicitudContratoFila>[] = useMemo(
    () => [
      { clave: "numero", titulo: "N°", ancho: 70, fija: true, alinear: "right", texto: (s) => String(s.numero), claseCelda: "tabular-nums" },
      { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (s) => s.proyectoCodigo ?? s.proyectoNombre ?? "" },
      { clave: "tipo", titulo: "Tipo", ancho: 170, texto: (s) => tituloTipoContrato(s.tipo) },
      { clave: "contratista", titulo: "Contratista", ancho: 200, texto: (s) => s.contratistaNombre },
      { clave: "objeto", titulo: "Objeto", ancho: 240, flexible: true, texto: (s) => s.objeto },
      { clave: "valor", titulo: "Valor", ancho: 150, alinear: "right", texto: (s) => pesos(s.valor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 150,
        alinear: "center",
        texto: (s) => ETIQUETA_ESTADO_CONTRATO[s.estado],
        celda: (s) => (
          <Badge variant="outline" className={CLASE_ESTADO_CONTRATO[s.estado]}>
            {ETIQUETA_ESTADO_CONTRATO[s.estado]}
          </Badge>
        ),
      },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 150, texto: (s) => s.solicitadoPorNombre ?? "" },
      { clave: "enviada", titulo: "Enviada", ancho: 110, texto: (s) => fechaContrato(s.enviadoAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/pre-aprobacion")
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
      await resolverSolicitudContrato(accion.detalle.id, accion.tipo, motivo)
      const n = accion.detalle.numero
      setAviso(
        accion.tipo === "aprobar"
          ? `Solicitud N° ${n} pre-aprobada.`
          : accion.tipo === "devolver"
            ? `Solicitud N° ${n} devuelta al director.`
            : `Solicitud N° ${n} rechazada.`
      )
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
      <EncabezadoPagina
        titulo="Pre-aprobación de contratos"
        subtitulo="Revisa las solicitudes de los directores: pre-aprueba, devuelve para corregir o rechaza."
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado">
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
          {solicitudes && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {solicitudes.length} {solicitudes.length === 1 ? "solicitud" : "solicitudes"}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {solicitudes === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando solicitudes...
          </div>
        ) : solicitudes && solicitudes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            {filtro === "pre_aprobacion" ? "No hay solicitudes por revisar." : "No hay solicitudes con este filtro."}
          </div>
        ) : (
          solicitudes && (
            <TablaExcel
              filas={solicitudes}
              columnas={columnas}
              claveFila={(s) => s.id}
              onDobleClickFila={(s) => setDetalleId(s.id)}
              tituloFila="Doble clic para revisar la solicitud"
              tarjeta={{
                titulo: (s) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(s.id)}>
                    N° {s.numero} · {s.contratistaNombre}
                  </button>
                ),
                subtitulo: (s) => `${tituloTipoContrato(s.tipo)} · ${s.proyectoCodigo ?? s.proyectoNombre ?? ""}`,
                esquina: (s) => columnas.find((c) => c.clave === "estado")!.celda!(s),
                campos: ["objeto", "valor", "solicitante", "enviada"],
              }}
            />
          )
        )}
      </main>

      <DetalleSolicitudContrato
        id={detalleId}
        onCerrar={cerrarDetalle}
        minuta={(d) =>
          d.tipo === "mano_obra" ? (
            <MinutaManoObraEditor detalle={d} puedeEditar={puedeResolver} />
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Por ahora solo está la plantilla de la minuta de mano de obra (GJ-F-003). Las de {tituloTipoContrato(d.tipo).toLowerCase()} se agregan
              cuando Jurídica las entregue.
            </p>
          )
        }
        acciones={(d) =>
          d.estado === "pre_aprobacion" && puedeResolver ? (
            <>
              <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setAccion({ tipo: "rechazar", detalle: d })}>
                <XCircle className="size-4" /> Rechazar
              </Button>
              <Button variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-50" onClick={() => setAccion({ tipo: "devolver", detalle: d })}>
                <Undo2 className="size-4" /> Devolver
              </Button>
              <Button onClick={() => setAccion({ tipo: "aprobar", detalle: d })}>
                <CheckCircle2 className="size-4" /> Pre-aprobar
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
                  {TEXTO_ACCION[accion.tipo].titulo} N° {accion.detalle.numero}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {accion.detalle.contratistaNombre} · {pesos(accion.detalle.valor)}. {TEXTO_ACCION[accion.tipo].explicacion}
              </p>
              {TEXTO_ACCION[accion.tipo].pideMotivo && (
                <div className="space-y-1">
                  <label htmlFor="motivo-preaprobacion" className="text-xs font-medium text-muted-foreground">
                    Motivo *
                  </label>
                  <textarea
                    id="motivo-preaprobacion"
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    autoFocus
                    disabled={procesando}
                    placeholder={accion.tipo === "devolver" ? "Qué debe corregir el director" : "Por qué se rechaza"}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              )}
              {errorAccion && <p className="text-sm text-destructive">{errorAccion}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setAccion(null)} disabled={procesando}>
                  Cancelar
                </Button>
                <Button
                  variant={accion.tipo === "rechazar" ? "destructive" : "default"}
                  onClick={confirmar}
                  disabled={procesando || (TEXTO_ACCION[accion.tipo].pideMotivo && !motivo.trim())}
                >
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
