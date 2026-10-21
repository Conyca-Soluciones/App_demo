"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Send, Undo2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { DetalleOtrosi } from "@/components/detalle-otrosi"
import { OtrosiEditor, otrosiEditable } from "@/components/otrosi-editor"
import { useProyectoActual } from "@/components/proyecto-provider"
import { hoyColombia } from "@/lib/fechas"
import { nombreTipoContrato } from "@/lib/contratos"
import { CLASE_ESTADO_OTROSI, ETIQUETA_ESTADO_OTROSI, contratoVencido, type EstadoOtrosi, type OtrosiDetalle, type OtrosiFila } from "@/lib/otrosi"
import { listarOtrosis, resolverOtrosiJuridica, resolverOtrosiSubgerencia } from "@/app/(app)/contratos/otrosi/actions"

// ---------------------------------------------------------------------------
// Aprobación de otrosí (ruta /contratos/aprobacion-otrosi), como Aprobación de
// contratos: tabla con los otrosí de todos los proyectos que el usuario ve y,
// al abrir uno, el diálogo con la solicitud y el otrosí (vista previa y
// editor). Jurídica lo arma y lo envía a Subgerencia (o lo devuelve al
// ingeniero, o lo rechaza); Subgerencia lo aprueba (recibe su número) o se lo
// devuelve a Jurídica.
// ---------------------------------------------------------------------------

type Filtro = "juridica" | "subgerencia" | "devueltos" | "aprobados" | "rechazados" | "todos"

const FILTROS: { valor: Filtro; etiqueta: string; estados?: EstadoOtrosi[] }[] = [
  { valor: "juridica", etiqueta: "Por revisar en Jurídica", estados: ["por_revisar", "devuelta_subgerencia"] },
  { valor: "subgerencia", etiqueta: "En Subgerencia", estados: ["en_revision"] },
  { valor: "devueltos", etiqueta: "Devueltos al ingeniero", estados: ["devuelta"] },
  { valor: "aprobados", etiqueta: "Aprobados", estados: ["aprobada"] },
  { valor: "rechazados", etiqueta: "Rechazados", estados: ["rechazada"] },
  { valor: "todos", etiqueta: "Todos" },
]

type Accion = "enviar" | "devolver" | "rechazar" | "aprobar" | "devolver_juridica"

const TEXTO_ACCION: Record<Accion, { titulo: string; explicacion: string; boton: string; pideMotivo: boolean; placeholder?: string }> = {
  enviar: {
    titulo: "Enviar a Subgerencia",
    explicacion:
      "Se envía el otrosí GUARDADO (guarda antes los cambios de la pestaña Otrosí). Mientras Subgerencia lo revisa no se puede editar.",
    boton: "Enviar",
    pideMotivo: false,
  },
  devolver: {
    titulo: "Devolver al ingeniero",
    explicacion: "Vuelve a quien lo pidió con este motivo; lo corrige y lo envía otra vez.",
    boton: "Devolver",
    pideMotivo: true,
    placeholder: "Qué debe corregir el ingeniero",
  },
  rechazar: {
    titulo: "Rechazar otrosí",
    explicacion: "Es definitivo: la solicitud se cierra.",
    boton: "Rechazar",
    pideMotivo: true,
    placeholder: "Por qué se rechaza",
  },
  aprobar: {
    titulo: "Aprobar otrosí",
    explicacion: "Es definitivo: el otrosí recibe su número. Jurídica y quien lo pidió reciben una notificación. El contrato no cambia en el sistema (plazo y valor siguen los iniciales).",
    boton: "Aprobar",
    pideMotivo: false,
  },
  devolver_juridica: {
    titulo: "Devolver a Jurídica",
    explicacion: "Vuelve a Jurídica con este motivo; lo corrige y lo envía otra vez.",
    boton: "Devolver",
    pideMotivo: true,
    placeholder: "Qué debe corregir Jurídica",
  },
}

export function AprobacionOtrosiView({
  puedeJuridica,
  puedeSubgerencia,
  verInicial,
}: {
  puedeJuridica: boolean
  puedeSubgerencia: boolean
  verInicial: string | null
}) {
  const router = useRouter()
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<Filtro>(puedeJuridica || !puedeSubgerencia ? "juridica" : "subgerencia")
  const [proyectoId, setProyectoId] = useState("")
  const [otrosis, setOtrosis] = useState<OtrosiFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)
  const [accion, setAccion] = useState<{ tipo: Accion; detalle: OtrosiDetalle } | null>(null)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  function cargar() {
    const estados = FILTROS.find((f) => f.valor === filtro)?.estados
    listarOtrosis({ estados, proyectoId: proyectoId || undefined })
      .then((lista: OtrosiFila[]) => setOtrosis(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los otrosí."))
  }
  useEffect(cargar, [filtro, proyectoId])

  function cambiarFiltro(valor: Filtro) {
    setOtrosis(null)
    setError(null)
    setFiltro(valor)
  }
  function cambiarProyecto(valor: string) {
    setOtrosis(null)
    setError(null)
    setProyectoId(valor)
  }

  const columnas: ColumnaExcel<OtrosiFila>[] = useMemo(
    () => [
      {
        clave: "contrato",
        titulo: "Contrato",
        ancho: 130,
        fija: true,
        texto: (o) => o.numeroContrato,
        celda: (o) => (
          <button
            type="button"
            onClick={() => setDetalleId(o.id)}
            title={`Revisar el otrosí al contrato ${o.numeroContrato}`}
            className="cursor-pointer rounded-sm font-medium tabular-nums text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {o.numeroContrato}
          </button>
        ),
      },
      { clave: "numero", titulo: "Otrosí N°", ancho: 90, alinear: "right", texto: (o) => (o.numero !== null ? String(o.numero) : "—") },
      { clave: "proyecto", titulo: "Proyecto", ancho: 140, texto: (o) => o.proyectoCodigo ?? o.proyectoNombre ?? "" },
      { clave: "tipo", titulo: "Tipo", ancho: 170, texto: (o) => nombreTipoContrato(o) },
      { clave: "contratista", titulo: "Contratista", ancho: 200, texto: (o) => o.contratistaNombre },
      { clave: "clausulas", titulo: "Cláusulas", ancho: 240, flexible: true, texto: (o) => o.clausulas },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 180,
        alinear: "center",
        texto: (o) => ETIQUETA_ESTADO_OTROSI[o.estado],
        celda: (o) => (
          <Badge variant="outline" className={CLASE_ESTADO_OTROSI[o.estado]}>
            {ETIQUETA_ESTADO_OTROSI[o.estado]}
          </Badge>
        ),
      },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 150, texto: (o) => o.solicitadoPorNombre ?? "" },
      { clave: "enviado", titulo: "Enviado", ancho: 110, texto: (o) => fechaContrato(o.enviadoAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/aprobacion-otrosi")
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
      const { tipo, detalle } = accion
      if (tipo === "aprobar" || tipo === "devolver_juridica") await resolverOtrosiSubgerencia(detalle.id, tipo, motivo)
      else await resolverOtrosiJuridica(detalle.id, tipo, motivo)
      const c = detalle.numeroContrato
      setAviso(
        tipo === "enviar"
          ? `Otrosí al contrato ${c} enviado a Subgerencia.`
          : tipo === "aprobar"
            ? `Otrosí al contrato ${c} aprobado.`
            : tipo === "rechazar"
              ? `Otrosí al contrato ${c} rechazado.`
              : tipo === "devolver"
                ? `Otrosí al contrato ${c} devuelto al ingeniero.`
                : `Otrosí al contrato ${c} devuelto a Jurídica.`
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

  function acciones(d: OtrosiDetalle) {
    const vencido = contratoVencido(d.fechaFin, hoyColombia())
    const avisoVencido = vencido && (d.estado === "por_revisar" || d.estado === "devuelta_subgerencia" || d.estado === "en_revision") && (
      <p className="mr-auto self-center text-xs text-destructive">El plazo del contrato ya terminó: no se puede enviar ni aprobar.</p>
    )
    if (puedeJuridica && otrosiEditable(d)) {
      return (
        <>
          {avisoVencido}
          <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => setAccion({ tipo: "rechazar", detalle: d })}>
            <XCircle className="size-4" /> Rechazar
          </Button>
          <Button variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-50" onClick={() => setAccion({ tipo: "devolver", detalle: d })}>
            <Undo2 className="size-4" /> Devolver al ingeniero
          </Button>
          <Button onClick={() => setAccion({ tipo: "enviar", detalle: d })} disabled={vencido}>
            <Send className="size-4" /> {d.estado === "devuelta_subgerencia" ? "Enviar otra vez a Subgerencia" : "Enviar a Subgerencia"}
          </Button>
        </>
      )
    }
    if (puedeSubgerencia && d.estado === "en_revision") {
      return (
        <>
          {avisoVencido}
          <Button variant="outline" className="border-orange-300 text-orange-800 hover:bg-orange-50" onClick={() => setAccion({ tipo: "devolver_juridica", detalle: d })}>
            <Undo2 className="size-4" /> Devolver a Jurídica
          </Button>
          <Button onClick={() => setAccion({ tipo: "aprobar", detalle: d })} disabled={vencido}>
            <CheckCircle2 className="size-4" /> Aprobar otrosí
          </Button>
        </>
      )
    }
    return null
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Aprobación de otrosí"
        subtitulo="Jurídica arma el otrosí y lo envía a Subgerencia; Subgerencia lo aprueba o lo devuelve para corregir."
      />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado del otrosí">
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
          {otrosis && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {otrosis.length} {otrosis.length === 1 ? "otrosí" : "otrosí"}
            </span>
          )}
        </div>

        {aviso && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            <CheckCircle2 className="size-4" /> {aviso}
          </div>
        )}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {otrosis === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando otrosí...
          </div>
        ) : otrosis && otrosis.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            No hay otrosí con este filtro.
          </div>
        ) : (
          otrosis && (
            <TablaExcel
              filas={otrosis}
              columnas={columnas}
              claveFila={(o) => o.id}
              onDobleClickFila={(o) => setDetalleId(o.id)}
              tituloFila="Doble clic para revisar el otrosí"
              tarjeta={{
                titulo: (o) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(o.id)}>
                    {o.numeroContrato} · {o.contratistaNombre}
                  </button>
                ),
                subtitulo: (o) => `${nombreTipoContrato(o)} · ${o.proyectoCodigo ?? o.proyectoNombre ?? ""}`,
                esquina: (o) => columnas.find((c) => c.clave === "estado")!.celda!(o),
                campos: ["clausulas", "solicitante", "enviado"],
              }}
            />
          )
        )}
      </main>

      <DetalleOtrosi
        id={detalleId}
        onCerrar={cerrarDetalle}
        documento={(d) => <OtrosiEditor detalle={d} puedeEditar={puedeJuridica} />}
        acciones={acciones}
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
                  {TEXTO_ACCION[accion.tipo].titulo} · contrato {accion.detalle.numeroContrato}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {accion.detalle.contratistaNombre}. {TEXTO_ACCION[accion.tipo].explicacion}
              </p>
              {TEXTO_ACCION[accion.tipo].pideMotivo && (
                <div className="space-y-1">
                  <label htmlFor="motivo-otrosi" className="text-xs font-medium text-muted-foreground">
                    Motivo *
                  </label>
                  <textarea
                    id="motivo-otrosi"
                    rows={3}
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    autoFocus
                    disabled={procesando}
                    placeholder={TEXTO_ACCION[accion.tipo].placeholder}
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
