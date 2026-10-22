"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, VentanaDetalle, camposDesdeColumnas } from "@/components/ventana-detalle"
import {
  COLOR_TONO_EVENTO,
  NOMBRE_TIPO_HISTORIAL,
  definicionEvento,
  detalleEvento,
  quienHizo,
} from "@/components/historial-timeline"
import { listarAuditoria, type FilaAuditoria, type FiltrosAuditoria } from "@/app/(app)/admin/auditoria/actions"
import { listarUsuariosAcceso } from "@/app/(app)/admin/accesos/actions"
import type { TipoHistorial } from "@/app/(app)/almacen/historial/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"

// ---------------------------------------------------------------------------
// Auditoría (solo Administrador): todo el historial de la plataforma, más
// reciente primero, con filtros por tipo, persona y fechas. Las etiquetas y el
// detalle de cada evento son los mismos de la línea de tiempo de cada pantalla.
// ---------------------------------------------------------------------------

const formatoFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

const TIPOS = (Object.entries(NOMBRE_TIPO_HISTORIAL) as [TipoHistorial, string][]).sort((a, b) =>
  a[1].localeCompare(b[1], "es")
)

export function AuditoriaView() {
  const [tipo, setTipo] = useState<TipoHistorial | "todos">("todos")
  const [usuarioId, setUsuarioId] = useState<string>("todos")
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string }[]>([])

  const [filas, setFilas] = useState<FilaAuditoria[] | null>(null)
  const [aplicados, setAplicados] = useState<FiltrosAuditoria>({})
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viendo, setViendo] = useState<FilaAuditoria | null>(null)

  useEffect(() => {
    let activo = true
    listarUsuariosAcceso()
      .then((lista) => {
        if (activo) setUsuarios(lista.map((u) => ({ id: u.id, nombre: u.nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")))
      })
      .catch(() => {})
    return () => {
      activo = false
    }
  }, [])

  function cargar(filtros: FiltrosAuditoria, pag: number) {
    setCargando(true)
    setError(null)
    listarAuditoria(filtros, pag)
      .then((r) => {
        setFilas(r.filas)
        setHayMas(r.hayMas)
        setPagina(pag)
        setAplicados(filtros)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la auditoría."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    if (desde && hasta && desde > hasta) {
      setError("La fecha Desde no puede ser posterior a Hasta.")
      return false
    }
    cargar(
      {
        tipo: tipo === "todos" ? undefined : tipo,
        usuarioId: usuarioId === "todos" ? undefined : usuarioId,
        desde: desde || undefined,
        hasta: hasta || undefined,
      },
      0
    )
    return true
  }

  function limpiar() {
    setTipo("todos")
    setUsuarioId("todos")
    setDesde("")
    setHasta("")
    setFilas(null)
    setError(null)
  }

  const columnas: ColumnaExcel<FilaAuditoria>[] = [
    { clave: "fecha", titulo: "Fecha", ancho: 150, texto: (f) => formatoFechaHora(f.createdAt), claseCelda: "tabular-nums" },
    { clave: "quien", titulo: "Quién", ancho: 220, texto: (f) => quienHizo(f) },
    {
      clave: "que",
      titulo: "Qué",
      ancho: 260,
      texto: (f) => `${NOMBRE_TIPO_HISTORIAL[f.tipo] ?? f.tipo}${f.referencia ? ` · ${f.referencia}` : ""}`,
      celda: (f) => (
        <div className="min-w-0">
          <div className="truncate text-xs text-muted-foreground">{NOMBRE_TIPO_HISTORIAL[f.tipo] ?? f.tipo}</div>
          <div className="truncate" title={f.referencia ?? undefined}>
            {f.referencia ?? "—"}
          </div>
        </div>
      ),
    },
    {
      clave: "evento",
      titulo: "Evento",
      ancho: 230,
      texto: (f) => definicionEvento(f.tipo, f.evento).etiqueta,
      celda: (f) => {
        const def = definicionEvento(f.tipo, f.evento)
        return (
          <div className="flex min-w-0 items-center gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_TONO_EVENTO[def.tono]}`} />
            <span className="truncate">{def.etiqueta}</span>
          </div>
        )
      },
    },
    {
      clave: "detalle",
      titulo: "Detalle",
      ancho: 380,
      flexible: true,
      ordenable: false,
      texto: (f) => [...detalleEvento(f, f.tipo), f.motivo ? `Motivo: ${f.motivo}` : ""].filter(Boolean).join(" · "),
      celda: (f) => {
        const lineas = [...detalleEvento(f, f.tipo), ...(f.motivo ? [`Motivo: ${f.motivo}`] : [])]
        if (f.datos?.reconstruido) lineas.push("Reconstruido de datos anteriores")
        return lineas.length === 0 ? (
          <span className="text-muted-foreground/60">—</span>
        ) : (
          <div className="min-w-0 space-y-0.5 py-1 text-xs">
            {lineas.map((l, i) => (
              <div key={i} className="truncate" title={l}>
                {l}
              </div>
            ))}
          </div>
        )
      },
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio. Los terceros también salen aquí (su ficha tiene el detalle)."
        >
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo((v ?? "todos") as TipoHistorial | "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {TIPOS.map(([clave, nombre]) => (
                  <SelectItem key={clave} value={clave}>
                    {nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Persona</Label>
            <Select value={usuarioId} onValueChange={(v) => setUsuarioId(v ?? "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas</SelectItem>
                {usuarios.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Fechas</Label>
            <CampoFecha value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" />
            <CampoFecha value={hasta} onChange={(e) => setHasta(e.target.value)} aria-label="Hasta" />
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {filas === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Presiona Consultar para ver la auditoría.
            </div>
          ) : filas === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando auditoría...
            </div>
          ) : filas.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún movimiento coincide con los filtros.
            </div>
          ) : (
            <TablaExcel
              filas={filas}
              columnas={columnas}
              claveFila={(f) => f.id}
              onDobleClickFila={setViendo}
              tituloFila={AYUDA_DOBLE_CLIC}
              tarjeta={{
                titulo: (f) => definicionEvento(f.tipo, f.evento).etiqueta,
                subtitulo: (f) => `${NOMBRE_TIPO_HISTORIAL[f.tipo] ?? f.tipo}${f.referencia ? ` · ${f.referencia}` : ""}`,
                esquina: (f) => <span className="text-xs text-muted-foreground tabular-nums">{formatoFechaHora(f.createdAt)}</span>,
                campos: ["quien", "detalle"],
              }}
            />
          )}

          {filas !== null && filas.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(aplicados, n)} />
          )}
        <VentanaDetalle
          abierta={viendo !== null}
          onCerrar={() => setViendo(null)}
          titulo={viendo ? definicionEvento(viendo.tipo, viendo.evento).etiqueta : ""}
          subtitulo={viendo ? `${NOMBRE_TIPO_HISTORIAL[viendo.tipo] ?? viendo.tipo}${viendo.referencia ? ` · ${viendo.referencia}` : ""}` : undefined}
          campos={viendo ? camposDesdeColumnas(columnas, viendo) : []}
        />
        </div>
      </div>
    </div>
  )
}
