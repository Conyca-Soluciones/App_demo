"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleActa } from "@/components/detalle-acta"
import { useProyectoActual } from "@/components/proyecto-provider"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import { CLASE_ESTADO_ACTA, ETIQUETA_ESTADO_ACTA, type ActaAprobacionFila, type ActaDetalle, type EstadoActa } from "@/lib/actas"
import { listarActasAprobacion, resolverActa, type AccionActa } from "@/app/(app)/contratos/aprobacion-actas/actions"

// ---------------------------------------------------------------------------
// Aprobación de actas: las actas de todos los proyectos que el usuario ve (no
// depende del proyecto actual). Se abre cada una para revisarla y aprobarla o
// rechazarla con motivo (rechazar devuelve su valor al cupo del contrato).
// ---------------------------------------------------------------------------

const FILTROS: { valor: EstadoActa | "todas"; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Por aprobar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
]

const TEXTO_ACCION: Record<AccionActa, { titulo: string; explicacion: string; boton: string; pideMotivo: boolean }> = {
  aprobar: {
    titulo: "Aprobar acta",
    explicacion: "Queda aprobada y su valor sigue descontado del contrato.",
    boton: "Aprobar",
    pideMotivo: false,
  },
  rechazar: {
    titulo: "Rechazar acta",
    explicacion: "Es definitivo: el acta se cierra y su valor vuelve al saldo del contrato.",
    boton: "Rechazar",
    pideMotivo: true,
  },
}

export function AprobacionActasView({ puedeResolver }: { puedeResolver: boolean }) {
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<EstadoActa | "todas">("pendiente")
  const [proyectoId, setProyectoId] = useState("")
  const [actas, setActas] = useState<ActaAprobacionFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [accion, setAccion] = useState<{ tipo: AccionActa; acta: ActaDetalle } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    listarActasAprobacion({ estado: filtro === "todas" ? undefined : filtro, proyectoId: proyectoId || undefined })
      .then(setActas)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las actas."))
  }
  useEffect(cargar, [filtro, proyectoId])

  function cambiarFiltro(valor: EstadoActa | "todas") {
    setActas(null)
    setError(null)
    setFiltro(valor)
  }
  function cambiarProyecto(valor: string) {
    setActas(null)
    setError(null)
    setProyectoId(valor)
  }

  const columnas: ColumnaExcel<ActaAprobacionFila>[] = useMemo(
    () => [
      {
        clave: "acta",
        titulo: "Acta",
        ancho: 90,
        fija: true,
        texto: (a) => `Acta ${a.numero}`,
        celda: (a) => (
          <button
            type="button"
            onClick={() => setDetalleId(a.id)}
            title={`Revisar el acta ${a.numero} del contrato ${a.numeroContrato}`}
            className="cursor-pointer rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            Acta {a.numero}
          </button>
        ),
      },
      { clave: "contrato", titulo: "N° contrato", ancho: 130, texto: (a) => a.numeroContrato },
      { clave: "proyecto", titulo: "Proyecto", ancho: 140, texto: (a) => a.proyectoCodigo || a.proyectoNombre },
      { clave: "contratista", titulo: "Contratista", ancho: 220, flexible: true, texto: (a) => a.contratistaNombre },
      { clave: "total", titulo: "Total del acta", ancho: 150, alinear: "right", texto: (a) => pesos(a.total), claseCelda: "tabular-nums" },
      { clave: "valor", titulo: "Valor contrato", ancho: 150, alinear: "right", texto: (a) => pesos(a.contratoValor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 130,
        alinear: "center",
        texto: (a) => ETIQUETA_ESTADO_ACTA[a.estado],
        celda: (a) => <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[a.estado]}`}>{ETIQUETA_ESTADO_ACTA[a.estado]}</Badge>,
      },
      { clave: "elaborada", titulo: "Elaborada por", ancho: 150, texto: (a) => a.creadoPorNombre ?? "" },
      { clave: "fecha", titulo: "Fecha", ancho: 110, texto: (a) => formatearFechaSinHora(a.createdAt), claseCelda: "tabular-nums" },
    ],
    []
  )

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
      await resolverActa(accion.acta.id, accion.tipo, motivo)
      const nombre = `Acta ${accion.acta.numero} del contrato ${accion.acta.numeroContrato}`
      setAviso(accion.tipo === "aprobar" ? `${nombre} aprobada.` : `${nombre} rechazada.`)
      setAccion(null)
      setMotivo("")
      setDetalleId(null)
      cargar()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo completar la acción.")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo="Aprobación de actas" subtitulo="Revisa las actas de los contratos y apruébalas o recházalas." />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado">
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                size="sm"
                role="tab"
                aria-selected={filtro === f.valor}
                variant={filtro === f.valor ? "default" : "outline"}
                onClick={() => cambiarFiltro(f.valor)}
              >
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
          {actas && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {actas.length} {actas.length === 1 ? "acta" : "actas"}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {actas === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando actas...
          </div>
        ) : actas && actas.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            {filtro === "pendiente" ? "No hay actas por aprobar." : "No hay actas con este filtro."}
          </div>
        ) : (
          actas && (
            <TablaExcel
              filas={actas}
              columnas={columnas}
              claveFila={(a) => a.id}
              onDobleClickFila={(a) => setDetalleId(a.id)}
              tituloFila="Doble clic para revisar el acta"
              tarjeta={{
                titulo: (a) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(a.id)}>
                    Acta {a.numero} · {a.numeroContrato}
                  </button>
                ),
                subtitulo: (a) => `${a.contratistaNombre} · ${a.proyectoCodigo || a.proyectoNombre}`,
                esquina: (a) => columnas.find((c) => c.clave === "estado")!.celda!(a),
                campos: ["total", "valor", "elaborada", "fecha"],
              }}
            />
          )
        )}
      </main>

      <DetalleActa
        id={detalleId}
        onCerrar={() => setDetalleId(null)}
        acciones={(a) =>
          a.estado === "pendiente" && puedeResolver ? (
            <>
              <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setAccion({ tipo: "rechazar", acta: a })}>
                <XCircle className="size-4" /> Rechazar
              </Button>
              <Button onClick={() => setAccion({ tipo: "aprobar", acta: a })}>
                <CheckCircle2 className="size-4" /> Aprobar
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
                  {TEXTO_ACCION[accion.tipo].titulo} {accion.acta.numero} · {accion.acta.numeroContrato}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {accion.acta.contratistaNombre} · {pesos(accion.acta.total)}. {TEXTO_ACCION[accion.tipo].explicacion}
              </p>
              {TEXTO_ACCION[accion.tipo].pideMotivo && (
                <div className="space-y-1">
                  <label htmlFor="motivo-acta" className="text-xs font-medium text-muted-foreground">
                    Motivo *
                  </label>
                  <textarea
                    id="motivo-acta"
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    autoFocus
                    disabled={procesando}
                    placeholder="Por qué se rechaza"
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
