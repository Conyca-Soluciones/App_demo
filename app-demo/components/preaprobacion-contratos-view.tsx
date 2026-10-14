"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Send, Undo2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleSolicitudContrato, fechaContrato, tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { useProyectoActual } from "@/components/proyecto-provider"
import { MinutaSegunTipo } from "@/components/minuta-segun-tipo"
import {
  CLASE_ETAPA_CONTRATO,
  ETIQUETA_ETAPA_CONTRATO,
  TIPOS_CON_MINUTA,
  etapaContrato,
  minutaEditable,
  pesos,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/lib/contratos"
import {
  enviarMinutaSubgerencia,
  listarSolicitudesPreaprobacion,
  preaprobarYEnviarMinuta,
  resolverSolicitudContrato,
  type AccionPreaprobacion,
  type GrupoPreaprobacion,
} from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Pre-aprobación: Jurídica revisa solicitudes de todos sus proyectos (no
// depende del proyecto actual) y las devuelve, rechaza o pre-aprueba. Pre-aprobar
// envía también la minuta a Subgerencia (Aprobación de contratos) en el mismo
// paso; una minuta devuelta se corrige y se envía otra vez.
// ---------------------------------------------------------------------------

// Devueltas junta las devueltas al director y las minutas devueltas por
// Subgerencia; la columna Estado dice cuál es cuál.
const FILTROS: { valor: GrupoPreaprobacion | "todas"; etiqueta: string }[] = [
  { valor: "por_revisar", etiqueta: "Por revisar" },
  { valor: "devueltas", etiqueta: "Devueltas" },
  { valor: "en_subgerencia", etiqueta: "En Subgerencia" },
  { valor: "aprobados", etiqueta: "Aprobados" },
  { valor: "rechazadas", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
]

type AccionVista = AccionPreaprobacion | "enviar"

const TEXTO_ACCION: Record<AccionVista, { titulo: string; explicacion: string; boton: string; pideMotivo: boolean }> = {
  aprobar: {
    titulo: "Pre-aprobar y enviar a Subgerencia",
    explicacion:
      "La solicitud queda pre-aprobada y su minuta pasa a Subgerencia (Aprobación de contratos). Se envía la minuta GUARDADA: revisa la pestaña Minuta y guarda los cambios antes. Mientras Subgerencia la revisa no se puede editar.",
    boton: "Pre-aprobar y enviar",
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
  enviar: {
    titulo: "Enviar minuta otra vez a Subgerencia",
    explicacion:
      "Se envía la minuta GUARDADA (guarda antes los cambios que tengas en pantalla). Mientras Subgerencia la revisa no se puede editar; si la devuelve, la corriges y la envías otra vez.",
    boton: "Enviar",
    pideMotivo: false,
  },
}

export function PreaprobacionContratosView({ puedeResolver, verInicial }: { puedeResolver: boolean; verInicial: string | null }) {
  const router = useRouter()
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<GrupoPreaprobacion | "todas">("por_revisar")
  const [proyectoId, setProyectoId] = useState("")
  const [solicitudes, setSolicitudes] = useState<SolicitudContratoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)
  const [accion, setAccion] = useState<{ tipo: AccionVista; detalle: SolicitudContratoDetalle } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    listarSolicitudesPreaprobacion({ grupo: filtro === "todas" ? undefined : filtro, proyectoId: proyectoId || undefined })
      .then((lista: SolicitudContratoFila[]) => setSolicitudes(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las solicitudes."))
  }
  useEffect(cargar, [filtro, proyectoId])

  // Al cambiar un filtro se vacía la lista (muestra "Cargando...") y el
  // efecto de arriba vuelve a consultar.
  function cambiarFiltro(valor: GrupoPreaprobacion | "todas") {
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
      {
        clave: "numero",
        titulo: "N°",
        ancho: 70,
        fija: true,
        alinear: "right",
        texto: (s) => String(s.numero),
        // Enlace: abre la solicitud con un clic (la fila sigue abriendo con doble clic).
        celda: (s) => (
          <button
            type="button"
            onClick={() => setDetalleId(s.id)}
            title={`Revisar la solicitud N° ${s.numero}`}
            className="cursor-pointer rounded-sm font-medium tabular-nums text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {s.numero}
          </button>
        ),
      },
      { clave: "proyecto", titulo: "Proyecto", ancho: 150, texto: (s) => s.proyectoCodigo ?? s.proyectoNombre ?? "" },
      { clave: "tipo", titulo: "Tipo", ancho: 170, texto: (s) => tituloTipoContrato(s.tipo) },
      { clave: "contratista", titulo: "Contratista", ancho: 200, texto: (s) => s.contratistaNombre },
      { clave: "objeto", titulo: "Objeto", ancho: 240, flexible: true, texto: (s) => s.objeto },
      { clave: "valor", titulo: "Valor", ancho: 150, alinear: "right", texto: (s) => pesos(s.valor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 190,
        alinear: "center",
        texto: (s) => ETIQUETA_ETAPA_CONTRATO[etapaContrato(s)],
        celda: (s) => (
          <Badge variant="outline" className={CLASE_ETAPA_CONTRATO[etapaContrato(s)]}>
            {ETIQUETA_ETAPA_CONTRATO[etapaContrato(s)]}
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
      if (accion.tipo === "enviar") await enviarMinutaSubgerencia(accion.detalle.id)
      else if (accion.tipo === "aprobar") await preaprobarYEnviarMinuta(accion.detalle.id)
      else await resolverSolicitudContrato(accion.detalle.id, accion.tipo, motivo)
      const n = accion.detalle.numero
      setAviso(
        accion.tipo === "enviar"
          ? `Minuta de la solicitud N° ${n} enviada a Subgerencia.`
          : accion.tipo === "aprobar"
          ? `Solicitud N° ${n} pre-aprobada y enviada a Subgerencia.`
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
        titulo="Pre aprobación de contratos"
        subtitulo="Revisa las solicitudes de los directores: pre-aprueba y envía a Subgerencia, devuelve para corregir o rechaza."
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
            {filtro === "por_revisar" ? "No hay solicitudes por revisar." : "No hay solicitudes con este filtro."}
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
        minuta={(d) => <MinutaSegunTipo detalle={d} puedeEditar={puedeResolver && minutaEditable(d)} />}
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
                <CheckCircle2 className="size-4" /> Pre-aprobar y enviar a Subgerencia
              </Button>
            </>
          ) : d.estado === "aprobada" && puedeResolver && minutaEditable(d) && TIPOS_CON_MINUTA.has(d.tipo) ? (
            <Button onClick={() => setAccion({ tipo: "enviar", detalle: d })}>
              <Send className="size-4" /> {d.minutaEstado === "devuelta" ? "Enviar otra vez a Subgerencia" : "Enviar a Subgerencia"}
            </Button>
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
