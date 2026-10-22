"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleRequisicionAdmin, EtiquetaEstadoReqAdmin } from "@/components/detalle-requisicion-admin"
import { RequisicionAdminForm, type EdicionReqAdmin } from "@/components/requisicion-admin-form"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  ETIQUETA_ESTADO_REQ_ADMIN,
  ETIQUETA_METODO_REQ_ADMIN,
  itemFormDesdeDetalle,
  type EstadoReqAdmin,
  type OpcionesReqAdmin,
  type RequisicionAdminDetalle,
  type RequisicionAdminFila,
} from "@/lib/requisiciones-admin"
import {
  cancelarRequisicionAdmin,
  listarMisRequisicionesAdmin,
  obtenerRequisicionAdmin,
  opcionesRequisicionAdmin,
} from "@/app/(app)/ayf/requisiciones-administrativas/actions"

type Pestana = "nueva" | "mias"

const ESTADOS: EstadoReqAdmin[] = ["por_aprobar", "rechazada", "parcial", "aprobada", "cancelada"]

// Requisiciones administrativas: realizar una (o corregirla) y consultar las
// mías. ?ver=<id> abre una (aviso de la campanita o Mis pendientes).
export function RequisicionesAdminPagina({ verInicial }: { verInicial: string | null }) {
  const [pestana, setPestana] = useState<Pestana>(verInicial ? "mias" : "nueva")
  const [opciones, setOpciones] = useState<OpcionesReqAdmin | null>(null)
  const [errorOpciones, setErrorOpciones] = useState<string | null>(null)
  const [edicion, setEdicion] = useState<EdicionReqAdmin | null>(null)
  // Cambia al enviar: el formulario vuelve a empezar y la lista se recarga.
  const [version, setVersion] = useState(0)
  const [verId, setVerId] = useState<string | null>(verInicial)

  useEffect(() => {
    let vigente = true
    opcionesRequisicionAdmin()
      .then((o: OpcionesReqAdmin) => vigente && setOpciones(o))
      .catch((e) => vigente && setErrorOpciones(e instanceof Error ? e.message : "No se pudieron cargar las opciones."))
    return () => {
      vigente = false
    }
  }, [])

  function editar(d: RequisicionAdminDetalle) {
    setEdicion({
      id: d.id,
      numero: d.numero,
      rechazada: d.estado === "rechazada",
      metodo: d.metodo,
      items: d.items.map(itemFormDesdeDetalle),
    })
    setVerId(null)
    setPestana("nueva")
  }

  function alEnviar(id: string) {
    setEdicion(null)
    setVersion((v) => v + 1)
    setVerId(id)
    setPestana("mias")
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex gap-1.5 border-b">
        {(
          [
            { valor: "nueva", etiqueta: edicion ? `Corregir requisición N° ${edicion.numero}` : "Realizar requisición" },
            { valor: "mias", etiqueta: "Mis requisiciones" },
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
        {pestana === "nueva" ? (
          errorOpciones ? (
            <p className="text-sm text-destructive">{errorOpciones}</p>
          ) : !opciones ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          ) : (
            <RequisicionAdminForm
              key={`${edicion?.id ?? "nueva"}-${version}`}
              opciones={opciones}
              edicion={edicion}
              onEnviada={alEnviar}
              onCancelarEdicion={() => setEdicion(null)}
            />
          )
        ) : (
          <MisRequisicionesAdmin key={version} verId={verId} onCerrarVer={() => setVerId(null)} onVer={setVerId} onEditar={editar} />
        )}
      </div>
    </div>
  )
}

function MisRequisicionesAdmin({
  verId,
  onVer,
  onCerrarVer,
  onEditar,
}: {
  verId: string | null
  onVer: (id: string) => void
  onCerrarVer: () => void
  onEditar: (d: RequisicionAdminDetalle) => void
}) {
  const [filas, setFilas] = useState<RequisicionAdminFila[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [estado, setEstado] = useState<EstadoReqAdmin | "todas">("todas")
  const [numero, setNumero] = useState("")
  const [ultimos, setUltimos] = useState<{ estado?: EstadoReqAdmin; numero?: number }>({})

  function cargar(filtros = ultimos, pag = pagina) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    listarMisRequisicionesAdmin(filtros, pag)
      .then((r: { filas: RequisicionAdminFila[]; hayMas: boolean }) => {
        setFilas(r.filas)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargando(false))
  }

  function consultar(): boolean {
    const n = Number(numero.replace(/\D/g, ""))
    cargar({ estado: estado === "todas" ? undefined : estado, numero: numero.trim() && n > 0 ? n : undefined }, 0)
    return true
  }

  const columnas: ColumnaExcel<RequisicionAdminFila>[] = [
    { clave: "numero", titulo: "N°", ancho: 70, fija: true, alinear: "center", texto: (r) => (r.numero != null ? String(r.numero) : "") },
    { clave: "metodo", titulo: "Método", ancho: 120, texto: (r) => ETIQUETA_METODO_REQ_ADMIN[r.metodo] },
    { clave: "empresas", titulo: "Grupo empresarial", ancho: 240, flexible: true, texto: (r) => r.empresas ?? "" },
    { clave: "items", titulo: "Ítems", ancho: 70, alinear: "center", texto: (r) => String(r.nItems) },
    { clave: "total", titulo: "Total", ancho: 150, alinear: "right", claseCelda: "tabular-nums", texto: (r) => formatoMoneda(r.valorTotal) },
    { clave: "enviada", titulo: "Enviada", ancho: 150, texto: (r) => formatearFechaHora(r.enviadaEn) },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 260,
      texto: (r) => ETIQUETA_ESTADO_REQ_ADMIN[r.estado],
      celda: (r) => (
        <div className="flex min-w-0 items-center gap-2">
          <EtiquetaEstadoReqAdmin estado={r.estado} />
          {r.estado === "rechazada" && r.motivoRechazo && (
            <span className="truncate text-xs text-muted-foreground" title={r.motivoRechazo}>
              {r.motivoRechazo}
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 90,
      ordenable: false,
      texto: () => "",
      celda: (r) => (
        <Button size="sm" variant="outline" className="h-8" onClick={() => onVer(r.id)}>
          <Eye className="size-4" /> Ver
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 gap-4">
      <PanelFiltros
        cargando={cargando}
        onConsultar={consultar}
        onLimpiar={() => {
          setEstado("todas")
          setNumero("")
        }}
      >
        <div className="space-y-1.5">
          <Label>Estado</Label>
          <Select value={estado} onValueChange={(v) => setEstado((v ?? "todas") as EstadoReqAdmin | "todas")}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {ESTADOS.map((e) => (
                <SelectItem key={e} value={e}>
                  {ETIQUETA_ESTADO_REQ_ADMIN[e]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="numero-req-admin">Número</Label>
          <Input id="numero-req-admin" inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} onKeyDown={(e) => e.key === "Enter" && consultar()} />
        </div>
      </PanelFiltros>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
        {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>}
        {filas === null && !cargando ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Presiona Consultar para ver tus requisiciones administrativas.
          </div>
        ) : filas === null ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : filas.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Ninguna requisición coincide con los filtros.
          </div>
        ) : (
          <TablaExcel
            filas={filas}
            columnas={columnas}
            claveFila={(r) => r.id}
            onDobleClickFila={(r) => onVer(r.id)}
            tarjeta={{
              titulo: (r) => `Requisición N° ${r.numero ?? ""}`,
              subtitulo: (r) => `${ETIQUETA_METODO_REQ_ADMIN[r.metodo]} · ${r.nItems} ítem(s)`,
              esquina: (r) => <EtiquetaEstadoReqAdmin estado={r.estado} />,
              campos: ["total", "empresas", "enviada", "acciones"],
            }}
          />
        )}
        {filas !== null && filas.length > 0 && (
          <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimos, n)} />
        )}
      </div>

      {verId && (
        <VerRequisicionAdmin
          id={verId}
          onCerrar={onCerrarVer}
          onEditar={onEditar}
          onCancelada={() => {
            onCerrarVer()
            if (filas !== null) cargar()
          }}
        />
      )}
    </div>
  )
}

function VerRequisicionAdmin({
  id,
  onCerrar,
  onEditar,
  onCancelada,
}: {
  id: string
  onCerrar: () => void
  onEditar: (d: RequisicionAdminDetalle) => void
  onCancelada: () => void
}) {
  const [carga, setCarga] = useState<{ id: string; detalle: RequisicionAdminDetalle | null; error: string | null } | null>(null)
  const [cancelando, setCancelando] = useState(false)
  const [motivo, setMotivo] = useState("")
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    obtenerRequisicionAdmin(id)
      .then((d: RequisicionAdminDetalle) => vigente && setCarga({ id, detalle: d, error: null }))
      .catch((e) => vigente && setCarga({ id, detalle: null, error: e instanceof Error ? e.message : "No se pudo cargar." }))
    return () => {
      vigente = false
    }
  }, [id])

  const actual = carga?.id === id ? carga : null
  const d = actual?.detalle ?? null
  const editable = d ? d.esMia && d.editable : false

  async function cancelar() {
    if (!motivo.trim()) return
    setProcesando(true)
    setErrorAccion(null)
    try {
      await cancelarRequisicionAdmin(id, motivo.trim())
      onCancelada()
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo cancelar.")
    } finally {
      setProcesando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Requisición administrativa {d?.numero != null ? `N° ${d.numero}` : ""}</DialogTitle>
          <DialogDescription>Formato GF-F-018 · Relación de pagos</DialogDescription>
        </DialogHeader>
        {!actual ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Cargando…
          </p>
        ) : actual.error ? (
          <p className="text-sm text-destructive">{actual.error}</p>
        ) : d ? (
          <DetalleRequisicionAdmin detalle={d} />
        ) : null}

        {cancelando && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="motivo-cancelar-req-admin">Motivo de la cancelación</Label>
            <Textarea id="motivo-cancelar-req-admin" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setCancelando(false)} disabled={procesando}>
                Volver
              </Button>
              <Button size="sm" variant="destructive" onClick={cancelar} disabled={procesando || !motivo.trim()}>
                {procesando && <Loader2 className="size-4 animate-spin" />} Cancelar requisición
              </Button>
            </div>
          </div>
        )}
        {errorAccion && <p className="text-sm text-destructive">{errorAccion}</p>}

        {d && editable && !cancelando && (
          <DialogFooter>
            <Button variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" onClick={() => setCancelando(true)}>
              <X className="size-4" /> Cancelar requisición
            </Button>
            <Button onClick={() => onEditar(d)}>
              <Pencil className="size-4" /> {d.estado === "rechazada" ? "Corregir y enviar otra vez" : "Modificar"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
