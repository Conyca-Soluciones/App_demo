"use client"

import { useMemo, useState } from "react"
import type { ItemPresupuesto } from "@/app/(app)/presupuestos/actions"

// ---------------------------------------------------------------------------
// Árbol de navegación del presupuesto (sidebar), con buscador -- se
// construye 100% desde `data` (el mismo estado que ya usa PresupuestoTable),
// que ya trae `nivel`/`padreId` -- no hace ninguna llamada nueva a la base
// de datos ni al servidor. Clickear un nodo avisa al padre (page.tsx),
// que hace scroll hasta esa fila en la tabla principal.
// ---------------------------------------------------------------------------

type NodoArbol = ItemPresupuesto & { hijos: NodoArbol[] }

function construirArbol(items: ItemPresupuesto[]): NodoArbol[] {
  const porId = new Map<string, NodoArbol>()
  for (const item of items) {
    porId.set(item.id, { ...item, hijos: [] })
  }

  const raices: NodoArbol[] = []
  for (const item of items) {
    const nodo = porId.get(item.id)!
    if (item.padreId && porId.has(item.padreId)) {
      porId.get(item.padreId)!.hijos.push(nodo)
    } else {
      // sin padre, o padre no encontrado en el set (dato huérfano) --
      // igual que en ordenarJerarquicamente (actions.ts), no se pierde,
      // se muestra como raíz.
      raices.push(nodo)
    }
  }
  return raices
}

function coincide(item: ItemPresupuesto, terminoLower: string): boolean {
  return (
    item.descripcion.toLowerCase().includes(terminoLower) ||
    item.codigo.toLowerCase().includes(terminoLower)
  )
}

// Recorre el árbol una vez y devuelve dos sets: los nodos que hacen match
// directo, y todos sus ancestros (para poder mostrar el camino completo
// hasta cada match sin perder el contexto de en qué capítulo está).
function calcularVisiblesPorBusqueda(raices: NodoArbol[], termino: string) {
  const terminoLower = termino.toLowerCase()
  const coincidencias = new Set<string>()
  const ancestros = new Set<string>()

  function visitar(nodo: NodoArbol, camino: string[]): boolean {
    let algoAbajo = coincide(nodo, terminoLower)
    if (algoAbajo) coincidencias.add(nodo.id)

    for (const hijo of nodo.hijos) {
      const hijoTuvoMatch = visitar(hijo, [...camino, nodo.id])
      algoAbajo = algoAbajo || hijoTuvoMatch
    }

    if (algoAbajo) {
      camino.forEach((id) => ancestros.add(id))
    }
    return algoAbajo
  }

  raices.forEach((r) => visitar(r, []))
  return { coincidencias, ancestros }
}

function Nodo({
  nodo,
  colapsados,
  onAlternarColapso,
  onSeleccionar,
  idSeleccionado,
  buscando,
  coincidencias,
  ancestros,
}: {
  nodo: NodoArbol
  colapsados: Set<string>
  onAlternarColapso: (id: string) => void
  onSeleccionar: (id: string) => void
  idSeleccionado?: string | null
  buscando: boolean
  coincidencias: Set<string>
  ancestros: Set<string>
}) {
  // durante una búsqueda activa, un nodo que no es ni coincidencia ni
  // ancestro de una coincidencia se esconde del todo (con su subárbol)
  if (buscando && !coincidencias.has(nodo.id) && !ancestros.has(nodo.id)) {
    return null
  }

  const tieneHijos = nodo.hijos.length > 0
  // buscando -> forzamos expandido, para que el camino hasta el match
  // quede siempre visible sin importar el estado de colapsados
  const expandido = buscando ? true : !colapsados.has(nodo.id)
  const esMatch = buscando && coincidencias.has(nodo.id)

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-muted ${
          idSeleccionado === nodo.id ? "bg-primary/10 font-medium" : ""
        } ${esMatch ? "bg-amber-50" : ""}`}
        style={{ paddingLeft: `${(nodo.nivel - 1) * 14 + 4}px` }}
        onClick={() => onSeleccionar(nodo.id)}
        title={nodo.descripcion}
      >
        {tieneHijos ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation() // si no, también seleccionaría el nodo
              onAlternarColapso(nodo.id)
            }}
            className="w-3 shrink-0 text-center text-muted-foreground"
          >
            {expandido ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="truncate">
          {nodo.nivel <= 2 && (
            <span className="font-mono font-semibold">{nodo.codigo} </span>
          )}
          {nodo.descripcion || "(sin descripción)"}
        </span>
      </div>

      {tieneHijos && expandido && (
        <div>
          {nodo.hijos.map((hijo) => (
            <Nodo
              key={hijo.id}
              nodo={hijo}
              colapsados={colapsados}
              onAlternarColapso={onAlternarColapso}
              onSeleccionar={onSeleccionar}
              idSeleccionado={idSeleccionado}
              buscando={buscando}
              coincidencias={coincidencias}
              ancestros={ancestros}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function PresupuestoTree({
  data,
  onSeleccionar,
  idSeleccionado,
}: {
  data: ItemPresupuesto[]
  onSeleccionar: (id: string) => void
  idSeleccionado?: string | null
}) {
  const [busqueda, setBusqueda] = useState("")
  const [colapsados, setColapsados] = useState<Set<string>>(new Set())
  // panel plegado (distinto de `colapsados`, que es qué NODOS del árbol
  // están cerrados) -- para poder ganar ancho en la tabla cuando el
  // árbol no se está usando en ese momento.
  const [panelPlegado, setPanelPlegado] = useState(false)

  const raices = useMemo(() => construirArbol(data), [data])

  const buscando = busqueda.trim().length > 0
  const { coincidencias, ancestros } = useMemo(() => {
    if (!buscando) return { coincidencias: new Set<string>(), ancestros: new Set<string>() }
    return calcularVisiblesPorBusqueda(raices, busqueda.trim())
  }, [raices, busqueda, buscando])

  function alternarColapso(id: string) {
    setColapsados((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (panelPlegado) {
    return (
      <button
        type="button"
        onClick={() => setPanelPlegado(false)}
        title="Mostrar árbol de navegación"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
      >
        »
      </button>
    )
  }

  return (
    <div className="flex max-h-[calc(100vh-16rem)] w-64 shrink-0 flex-col rounded-md border">
      <div className="flex items-center gap-1.5 border-b p-2">
        <input
          type="text"
          placeholder="Buscar en el presupuesto..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="w-full rounded border px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => setPanelPlegado(true)}
          title="Ocultar árbol de navegación"
          className="shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        >
          «
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {raices.map((r) => (
          <Nodo
            key={r.id}
            nodo={r}
            colapsados={colapsados}
            onAlternarColapso={alternarColapso}
            onSeleccionar={onSeleccionar}
            idSeleccionado={idSeleccionado}
            buscando={buscando}
            coincidencias={coincidencias}
            ancestros={ancestros}
          />
        ))}
        {buscando && coincidencias.size === 0 && (
          <p className="p-2 text-xs text-muted-foreground">Sin resultados.</p>
        )}
      </div>
    </div>
  )
}