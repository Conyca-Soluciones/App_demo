"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { buscarUsuarios, buscarInsumosCompras } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { verProyectos, type FiltrosRequisiciones } from "@/app/(app)/almacen/actions"
import type { EstadoRequisicion } from "@/lib/requisiciones-lineas"

// Panel de filtros de requisiciones, el mismo en el Registro y en la
// Aprobación. Ningún filtro es obligatorio. En Aprobación el estado ya lo
// eligen las pestañas (Pendientes / Aprobadas / Rechazadas), por eso allá se
// oculta con conEstado={false}.

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

type Props = {
  onConsultar: (filtros: FiltrosRequisiciones) => void
  cargando: boolean
  conEstado?: boolean
  // Casilla "Solo por Aprobar": solo en Aprobación de requisiciones.
  conSoloPorAprobar?: boolean
  // Al limpiar, además de vaciar los campos vuelve a consultar sin filtros
  // (Aprobación, que siempre muestra su cola). El Registro solo vacía los campos.
  consultarAlLimpiar?: boolean
  // Mensaje de validación (p. ej. número inválido) para mostrarlo arriba.
  onError?: (mensaje: string) => void
}

export function FiltrosRequisicionesPanel({
  onConsultar,
  cargando,
  conEstado = true,
  conSoloPorAprobar = false,
  consultarAlLimpiar = false,
  onError,
}: Props) {
  const [abierto, setAbierto] = useState(true)
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [numero, setNumero] = useState("")
  const [proyectoId, setProyectoId] = useState<string>("todos")
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [estado, setEstado] = useState<EstadoRequisicion | "todos">("todos")
  // "Solo por Aprobar" = estado pendiente de aprobación (pisa el filtro Estado).
  const [soloPorAprobar, setSoloPorAprobar] = useState(false)
  const [solicitante, setSolicitante] = useState<OpcionBuscador | null>(null)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) => onError?.(e instanceof Error ? e.message : "No se pudieron cargar los proyectos."))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function construirFiltros(): FiltrosRequisiciones | null {
    const n = numero.trim() === "" ? undefined : Number(numero)
    if (n !== undefined && (!Number.isInteger(n) || n <= 0)) {
      onError?.("El número de requisición debe ser un número entero mayor que cero.")
      return null
    }
    return {
      numero: n,
      proyectoId: proyectoId === "todos" ? undefined : proyectoId,
      insumoId: insumo?.id,
      estado: conSoloPorAprobar && soloPorAprobar ? "pendiente" : conEstado && estado !== "todos" ? estado : undefined,
      solicitadoPorId: solicitante?.id,
      desde: desde || undefined,
      hasta: hasta || undefined,
    }
  }

  function consultar() {
    const f = construirFiltros()
    if (!f) return
    onConsultar(f)
    // Al consultar, el panel se minimiza para dejar todo el ancho a los resultados.
    setAbierto(false)
  }

  function limpiar() {
    setNumero("")
    setProyectoId("todos")
    setInsumo(null)
    setEstado("todos")
    setSoloPorAprobar(false)
    setSolicitante(null)
    setDesde("")
    setHasta("")
  }

  if (!abierto) {
    return (
      <div className="flex h-fit w-12 shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-3">
        <Button variant="ghost" size="icon" onClick={() => setAbierto(true)} title="Mostrar filtros">
          <Filter className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  return (
    <div className="h-fit w-full max-w-xs shrink-0 rounded-lg border bg-card">
      <div className="flex items-center justify-between rounded-t-lg bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="font-medium">Filtros</span>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
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
            onKeyDown={(e) => e.key === "Enter" && consultar()}
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

        {conEstado && (
          <div className="space-y-1.5">
            <Label>Estado</Label>
            <Select
              disabled={soloPorAprobar}
              value={soloPorAprobar ? "pendiente" : estado}
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
        )}

        {conSoloPorAprobar && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={soloPorAprobar}
              onCheckedChange={(v) => setSoloPorAprobar(v === true)}
            />
            Solo por Aprobar
          </label>
        )}

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
          <Button className="w-full" disabled={cargando} onClick={consultar}>
            {cargando ? "Consultando..." : "Consultar"}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            onClick={() => {
              limpiar()
              if (consultarAlLimpiar) onConsultar({})
            }}
          >
            Limpiar filtros
          </Button>
          <p className="text-xs text-muted-foreground">
            Ningún filtro es obligatorio: sin filtros se consultan todas.
          </p>
        </div>
      </div>
    </div>
  )
}
