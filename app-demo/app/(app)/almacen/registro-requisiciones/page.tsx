"use client"
// app/(app)/almacen/registro-requisiciones/page.tsx
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, Filter } from "lucide-react"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { BadgeCompraRequisicion, BadgeEstadoRequisicion } from "@/components/badge-requisicion"
import { formatearFechaSinHora } from "@/lib/fechas"

import { buscarUsuarios, buscarInsumosCompras } from "../comprar-pedidos/actions"
import {
  verProyectos,
  listarRequisiciones,
  type FiltrosRequisiciones,
} from "../actions"
import type { EstadoRequisicion, RequisicionResumen } from "@/lib/requisiciones-lineas"

const headClasses =
  "border-r bg-primary px-3 py-2.5 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celda = "border-r px-3 py-2 text-xs last:border-r-0"

const ESTADOS: { valor: EstadoRequisicion | "todos"; etiqueta: string }[] = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "aprobada", etiqueta: "Aprobada" },
  { valor: "rechazada", etiqueta: "Rechazada" },
  { valor: "cancelada", etiqueta: "Cancelada" },
]

// Adaptadores: las server actions devuelven su propia forma de fila; el
// buscador genérico espera { id, etiqueta, subetiqueta }.
async function buscarUsuariosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const usuarios = await buscarUsuarios(termino)
  return usuarios.map((u) => ({ id: u.id, etiqueta: u.nombre }))
}

async function buscarInsumosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const insumos = await buscarInsumosCompras(termino)
  return insumos.map((i) => ({
    id: i.id,
    etiqueta: i.descripcion,
    subetiqueta: `${i.codigo} · ${i.u_m ?? ""}`,
  }))
}

export default function RegistroRequisiciones() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [requisiciones, setRequisiciones] = useState<RequisicionResumen[] | null>(null)
  const [truncado, setTruncado] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(true)

  // Filtros (todos opcionales)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [numero, setNumero] = useState("")
  const [proyectoId, setProyectoId] = useState<string>("todos")
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [estado, setEstado] = useState<EstadoRequisicion | "todos">("todos")
  const [solicitante, setSolicitante] = useState<OpcionBuscador | null>(null)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos.")
      )
  }, [])

  function consultar(filtros: FiltrosRequisiciones) {
    setCargando(true)
    setError(null)
    listarRequisiciones(filtros)
      .then((r) => {
        setRequisiciones(r.filas)
        setTruncado(r.truncado)
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudo cargar el registro de requisiciones.")
      )
      .finally(() => setCargando(false))
  }

  function handleConsultar() {
    const n = numero.trim() === "" ? undefined : Number(numero)
    if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
      setError("El número de requisición debe ser un número entero mayor que cero.")
      return
    }
    consultar({
      numero: n,
      proyectoId: proyectoId === "todos" ? undefined : proyectoId,
      insumoId: insumo?.id,
      estado: estado === "todos" ? undefined : estado,
      solicitadoPorId: solicitante?.id,
      desde: desde || undefined,
      hasta: hasta || undefined,
    })
  }

  function limpiarFiltros() {
    setNumero("")
    setProyectoId("todos")
    setInsumo(null)
    setEstado("todos")
    setSolicitante(null)
    setDesde("")
    setHasta("")
  }

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Registro de requisiciones</h1>
          <p className="text-sm text-muted-foreground">
            Requisiciones de todos los proyectos a los que tienes acceso.
          </p>
        </div>
      </header>

      <main className="flex w-full flex-1 gap-4 p-6">
        {filtrosAbiertos ? (
          <div className="h-fit w-full max-w-xs shrink-0 rounded-lg border bg-card">
            <div className="flex items-center justify-between rounded-t-lg bg-primary px-4 py-3 text-primary-foreground">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <span className="font-medium">Filtros</span>
              </div>
              <button
                type="button"
                onClick={() => setFiltrosAbiertos(false)}
                className="rounded p-1 hover:bg-primary-foreground/10"
                title="Ocultar filtros"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="numero-requisicion">Número de requisición</Label>
                <Input
                  id="numero-requisicion"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  placeholder="Ej. 12"
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Proyecto</Label>
                <Select value={proyectoId} onValueChange={(v) => setProyectoId(v ?? "todos")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos mis proyectos</SelectItem>
                    {proyectos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.codigo ? `${p.codigo} · ${p.nombre}` : p.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Insumo</Label>
                <BuscadorAsync
                  placeholder="Buscar insumo"
                  valorSeleccionado={insumo}
                  onSeleccionar={setInsumo}
                  buscar={buscarInsumosAdaptado}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Select
                  value={estado}
                  onValueChange={(v) => setEstado((v ?? "todos") as EstadoRequisicion | "todos")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (
                      <SelectItem key={e.valor} value={e.valor}>
                        {e.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Solicitado por</Label>
                <BuscadorAsync
                  placeholder="Buscar usuario"
                  valorSeleccionado={solicitante}
                  onSeleccionar={setSolicitante}
                  buscar={buscarUsuariosAdaptado}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Rango de fechas</Label>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-muted-foreground">Inicial</span>
                  <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-muted-foreground">Final</span>
                  <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Button className="w-full" disabled={cargando} onClick={handleConsultar}>
                  {cargando ? "Consultando..." : "Consultar"}
                </Button>
                <Button className="w-full" variant="ghost" onClick={limpiarFiltros}>
                  Limpiar filtros
                </Button>
                <p className="text-xs text-muted-foreground">
                  Ningún filtro es obligatorio: sin filtros se consultan todas.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-fit w-12 shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFiltrosAbiertos(true)}
              title="Mostrar filtros"
            >
              <Filter className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {requisiciones === null ? (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver las requisiciones.
            </div>
          ) : requisiciones.length === 0 ? (
            <p className="rounded-lg border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              Ninguna requisición coincide con los filtros.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {requisiciones.length} {requisiciones.length === 1 ? "requisición" : "requisiciones"}
                {truncado && " — se muestran las más recientes; afina los filtros para ver otras."}
                {" "}Haz clic en una para ver su detalle.
              </p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={`${headClasses} w-28`}>Requisición</th>
                      <th className={`${headClasses} w-48`}>Proyecto</th>
                      <th className={`${headClasses} w-40`}>Solicitado por</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requisición</th>
                      <th className={`${headClasses} w-28 text-center`}>Fecha requerida</th>
                      <th className={`${headClasses} w-20 text-center`}>Insumos</th>
                      <th className={`${headClasses} w-28 text-center`}>Estado</th>
                      <th className={`${headClasses} w-32 text-center`}>Compra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requisiciones.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => router.push(`/almacen/registro-requisiciones/${r.id}`)}
                        className={`cursor-pointer border-b hover:bg-accent/40 ${
                          r.urgente && r.estado === "pendiente" ? "bg-amber-50/60" : ""
                        }`}
                      >
                        <td className={`${celda} font-medium text-primary`}>
                          Requisición {r.numero}
                          {r.urgente && (
                            <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-800">
                              Urgente
                            </span>
                          )}
                        </td>
                        <td className={celda}>
                          <p className="font-medium">{r.proyectoCodigo ?? "—"}</p>
                          <p className="text-muted-foreground">{r.proyectoNombre}</p>
                        </td>
                        <td className={celda}>{r.solicitanteNombre ?? "—"}</td>
                        <td className={`${celda} text-center`}>
                          {new Date(r.createdAt).toLocaleDateString("es-CO")}
                        </td>
                        <td className={`${celda} text-center`}>
                          {r.fechaRequerida ? formatearFechaSinHora(r.fechaRequerida) : "—"}
                        </td>
                        <td className={`${celda} text-center`}>{r.nLineas}</td>
                        <td className={`${celda} text-center`}>
                          <BadgeEstadoRequisicion estado={r.estado} />
                        </td>
                        <td className={`${celda} text-center`}>
                          <BadgeCompraRequisicion estadoCompra={r.estadoCompra} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  )
}
