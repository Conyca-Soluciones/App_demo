"use client"

import { useState } from "react"
import { ChevronLeft, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BuscadorAsync, type OpcionBuscador } from "./buscador-async"
import { useProyectoActual } from "@/components/proyecto-provider"
import { etiquetaProyecto } from "@/lib/proyecto-actual"
import {
  buscarUsuarios,
  buscarInsumosCompras,
  type FiltrosPedidosCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"

const TODOS = "todos"

type FiltrosPedidosCompraPanelProps = {
  onConsultar: (filtros: FiltrosPedidosCompra) => void
  cargando: boolean
}

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

export function FiltrosPedidosCompraPanel({ onConsultar, cargando }: FiltrosPedidosCompraPanelProps) {
  const [abierto, setAbierto] = useState(true)
  // Por omisión el proyecto actual; se puede elegir otro de los suyos o todos
  // (decisión del usuario 2026-11-06). Una orden sigue siendo de UN proyecto.
  const { proyecto: proyectoActual, proyectos } = useProyectoActual()
  const [proyectoId, setProyectoId] = useState<string>(proyectoActual?.id ?? TODOS)
  const elegido = proyectos.find((p) => p.id === proyectoId) ?? null
  const proyecto = { etiqueta: elegido ? (elegido.codigo ?? elegido.nombre) : "Todos los proyectos" }
  const [usuario, setUsuario] = useState<OpcionBuscador | null>(null)
  const [insumo, setInsumo] = useState<OpcionBuscador | null>(null)
  const [observacion, setObservacion] = useState("")
  const [fechaPedidoInicio, setFechaPedidoInicio] = useState("")
  const [fechaPedidoFin, setFechaPedidoFin] = useState("")
  const [fechaReqInicio, setFechaReqInicio] = useState("")
  const [fechaReqFin, setFechaReqFin] = useState("")
  const [fechaAprobInicio, setFechaAprobInicio] = useState("")
  const [fechaAprobFin, setFechaAprobFin] = useState("")
  const [soloUrgentes, setSoloUrgentes] = useState(false)
  // Marcado de entrada: solo lo que todavía falta comprar.
  const [soloPendientes, setSoloPendientes] = useState(true)

  const puedeConsultar = !cargando

  function handleConsultar() {
    onConsultar({
      proyectoId: proyectoId === TODOS ? null : proyectoId,
      usuarioId: usuario?.id ?? null,
      insumoId: insumo?.id ?? null,
      observacion: observacion.trim() || null,
      fechaPedidoInicio: fechaPedidoInicio || null,
      fechaPedidoFin: fechaPedidoFin || null,
      fechaRequerimientoInicio: fechaReqInicio || null,
      fechaRequerimientoFin: fechaReqFin || null,
      fechaAprobacionInicio: fechaAprobInicio || null,
      fechaAprobacionFin: fechaAprobFin || null,
      soloUrgentes,
      soloPendientes,
    })
    // Al consultar, el panel se minimiza para dejar el ancho a los resultados.
    setAbierto(false)
  }

  // Colapsado: franja angosta con un botón para reabrir. Se mantiene el
  // mismo componente montado (no un componente aparte) para no perder la
  // selección de proyecto/usuario/insumo ni los rangos de fecha al cerrar.
  if (!abierto) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 rounded-lg border bg-card py-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAbierto(true)}
          title={proyecto ? `Mostrar filtros — Proyecto: ${proyecto.etiqueta}` : "Mostrar filtros"}
        >
          <Filter className="h-4 w-4" />
        </Button>
        {proyecto && (
          <span
            className="max-h-40 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-muted-foreground [writing-mode:vertical-rl]"
          >
            {proyecto.etiqueta}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="w-full max-w-xs shrink-0 rounded-lg border bg-card">
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
          <Label>Proyecto</Label>
          <Select value={proyectoId} onValueChange={(v) => setProyectoId(v ?? TODOS)}>
            <SelectTrigger className="w-full">
              <SelectValue>{elegido ? etiquetaProyecto(elegido) : "Todos los proyectos"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos los proyectos</SelectItem>
              {proyectos.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {etiquetaProyecto(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Usuario</Label>
          <BuscadorAsync
            placeholder="Buscar usuario"
            valorSeleccionado={usuario}
            onSeleccionar={setUsuario}
            buscar={buscarUsuariosAdaptado}
          />
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
          <Label htmlFor="observacion-pedido">Observación requisición</Label>
          <Input
            id="observacion-pedido"
            placeholder="observación requisición"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Requisiciones</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <CampoFecha
              value={fechaPedidoInicio}
              onChange={(e) => setFechaPedidoInicio(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <CampoFecha value={fechaPedidoFin} onChange={(e) => setFechaPedidoFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Requerimientos</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <CampoFecha value={fechaReqInicio} onChange={(e) => setFechaReqInicio(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <CampoFecha value={fechaReqFin} onChange={(e) => setFechaReqFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Aprobación</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <CampoFecha
              value={fechaAprobInicio}
              onChange={(e) => setFechaAprobInicio(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <CampoFecha value={fechaAprobFin} onChange={(e) => setFechaAprobFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Opcionales</Label>
          <div className="flex items-center gap-2">
            <Checkbox
              id="solo-pendientes"
              checked={soloPendientes}
              onCheckedChange={(v) => setSoloPendientes(v === true)}
            />
            <Label htmlFor="solo-pendientes" className="cursor-pointer font-normal">
              Solo pendientes por comprar
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="solo-urgentes"
              checked={soloUrgentes}
              onCheckedChange={(v) => setSoloUrgentes(v === true)}
            />
            <Label htmlFor="solo-urgentes" className="cursor-pointer font-normal">
              Mostrar solo urgentes
            </Label>
          </div>
        </div>

        <Button className="w-full" disabled={!puedeConsultar} onClick={handleConsultar}>
          {cargando ? "Consultando..." : "Consultar"}
        </Button>
        {!proyecto && (
          <p className="text-xs text-muted-foreground">
            Elige un proyecto en <a href="/inicio" className="underline">el inicio</a> para consultar.
          </p>
        )}
      </div>
    </div>
  )
}