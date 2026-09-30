"use client"

import { useState } from "react"
import { ChevronLeft, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { BuscadorAsync, type OpcionBuscador } from "./buscador-async"
import {
  listarProyectosCompras,
  buscarUsuarios,
  buscarInsumosCompras,
  type FiltrosPedidosCompra,
} from "@/app/(app)/almacen/comprar-pedidos/actions"

type FiltrosPedidosCompraPanelProps = {
  onConsultar: (filtros: FiltrosPedidosCompra) => void
  cargando: boolean
}

// Adaptadores: las server actions devuelven su propia forma de fila; el
// buscador genérico espera { id, etiqueta, subetiqueta }.
async function buscarProyectosAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const proyectos = await listarProyectosCompras()
  const t = termino.trim().toLowerCase()
  return proyectos
    .filter((p) => (p.codigo ?? "").toLowerCase().includes(t) || p.nombre.toLowerCase().includes(t))
    .slice(0, 20)
    .map((p) => ({ id: p.id, etiqueta: p.codigo ?? p.nombre, subetiqueta: p.codigo ? p.nombre : null }))
}

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
  const [proyecto, setProyecto] = useState<OpcionBuscador | null>(null)
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

  const puedeConsultar = proyecto !== null && !cargando

  function handleConsultar() {
    if (!proyecto) return
    onConsultar({
      proyectoId: proyecto.id,
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
    })
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
          <Label>
            Proyecto <span className="text-destructive">*</span>
          </Label>
          <BuscadorAsync
            placeholder="Buscar proyecto"
            valorSeleccionado={proyecto}
            onSeleccionar={setProyecto}
            buscar={buscarProyectosAdaptado}
            minCaracteres={0}
          />
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
          <Label htmlFor="observacion-pedido">Observación pedido</Label>
          <Input
            id="observacion-pedido"
            placeholder="observación pedido"
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Pedidos</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <Input
              type="date"
              value={fechaPedidoInicio}
              onChange={(e) => setFechaPedidoInicio(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <Input type="date" value={fechaPedidoFin} onChange={(e) => setFechaPedidoFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Requerimientos</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <Input type="date" value={fechaReqInicio} onChange={(e) => setFechaReqInicio(e.target.value)} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <Input type="date" value={fechaReqFin} onChange={(e) => setFechaReqFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Rango de fechas Aprobación</Label>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Inicial</span>
            <Input
              type="date"
              value={fechaAprobInicio}
              onChange={(e) => setFechaAprobInicio(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 text-xs text-muted-foreground">Final</span>
            <Input type="date" value={fechaAprobFin} onChange={(e) => setFechaAprobFin(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Opcionales</Label>
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
          <p className="text-xs text-muted-foreground">Selecciona un proyecto para consultar.</p>
        )}
      </div>
    </div>
  )
}