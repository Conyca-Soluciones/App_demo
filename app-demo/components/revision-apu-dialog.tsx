"use client"

/**
 * Diálogo de revisión de insumos del import de APU -- reemplaza al
 * enfoque de "pestaña nueva" (no funcionó como se esperaba, ver
 * HANDOFF_import_apu.md). Vuelve a ser un diálogo, pero con 2 reglas
 * nuevas:
 *
 *  1. No se puede cerrar por accidente (click afuera / Esc) -- pide
 *     confirmación explícita.
 *  2. SÍ se puede cerrar sin terminar (los datos ya están guardados de
 *     todos modos -- ver decisión de arquitectura en el handoff), pero
 *     queda MUY claro que no quedó completo: la fila del ítem sigue en
 *     amarillo/rojo en la tabla del presupuesto, y este mismo diálogo se
 *     puede REABRIR después sobre lo que falte (ver `itemIds` -- ya no
 *     depende de un loteImportId de una sesión anterior).
 *
 * Muestra 3 grupos: pendientes (elegir candidato o pedir solicitud),
 * rechazados (un admin rechazó la solicitud -- se ve el motivo, y se
 * puede volver a intentar igual que un pendiente), y automáticos (para
 * CONFIRMAR que el match esté bien, con opción de cambiarlo).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  listarRevisionPorItems,
  resolverLineaRevision,
  resolverLineasRevisionEnLote,
  editarLineaAutoMatch,
  type LoteRevisionInfo,
} from "@/app/(app)/presupuestos/actions"
import type { FilaRevisionImport, CandidatoInsumo, CategoriaManoObra } from "@/lib/apu-import-types"

// Estilo "tipo Excel" -- mismo tratamiento que ya usa el resto de la app
// (presupuesto-table.tsx, admin-insumos/page.tsx): encabezado azul de
// marca, celdas con borde.
const headClasesCandidatos =
  "border-r border-b bg-primary px-2 py-1.5 text-left text-[11px] font-medium text-primary-foreground last:border-r-0"
const celdaCandidato = "border-r px-2 py-1.5 text-xs last:border-r-0"

/**
 * Tabla de candidatos de insumo (nombre/unidad/valor/% similitud) --
 * reemplaza los botones tipo "pill" que había antes. Se usa en los 3
 * lugares donde se elige un candidato: pendientes, rechazados, y la
 * corrección de un automático.
 */
function TablaCandidatos({
  candidatos,
  seleccionado,
  onSeleccionar,
}: {
  candidatos: CandidatoInsumo[]
  seleccionado?: string | null
  onSeleccionar: (insumoId: string) => void
}) {
  if (candidatos.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Las recomendaciones de insumo son:</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={headClasesCandidatos}>Nombre</th>
              <th className={`${headClasesCandidatos} w-20`}>Unidad</th>
              <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
              <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
            </tr>
          </thead>
          <tbody>
            {candidatos.map((c) => {
              const sel = seleccionado === c.id
              return (
                <tr
                  key={c.id}
                  onClick={() => onSeleccionar(c.id)}
                  className={`cursor-pointer border-t ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`}
                >
                  <td className={celdaCandidato}>
                    {sel && <span className="mr-1 text-primary">✓</span>}
                    {c.descripcion}
                  </td>
                  <td className={`${celdaCandidato} text-muted-foreground`}>{c.u_m ?? "—"}</td>
                  <td className={`${celdaCandidato} text-right`}>
                    ${(c.vr_unitario ?? 0).toLocaleString()}
                  </td>
                  <td className={`${celdaCandidato} text-right text-muted-foreground`}>
                    {Math.round(c.similitud * 100)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Tabla de CATEGORÍAS de mano de obra (categoría/grupo/$-hora/%
 * similitud) -- distinta de TablaCandidatos porque son columnas
 * distintas (grupo en vez de unidad, valor es $/hora no $/unidad).
 * Categorías sin precio todavía (valor_unitario null) se ven pero no se
 * pueden elegir -- mismo criterio que un insumo con precio placeholder.
 */
function TablaCategoriasManoObra({
  categorias,
  seleccionado,
  onSeleccionar,
}: {
  categorias: CategoriaManoObra[]
  seleccionado?: string | null
  onSeleccionar: (categoriaId: string) => void
}) {
  if (categorias.length === 0) return null

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Las categorías de mano de obra recomendadas son:</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className={headClasesCandidatos}>Categoría</th>
              <th className={`${headClasesCandidatos} w-28`}>Grupo</th>
              <th className={`${headClasesCandidatos} w-20 text-center`}>Unidad</th>
              <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
              <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((c) => {
              const sel = seleccionado === c.id
              const sinPrecio = c.valorUnitario == null
              return (
                <tr
                  key={c.id}
                  onClick={() => !sinPrecio && onSeleccionar(c.id)}
                  title={sinPrecio ? "Esta categoría todavía no tiene precio definido en el catálogo" : undefined}
                  className={`border-t ${
                    sinPrecio
                      ? "cursor-not-allowed opacity-50"
                      : `cursor-pointer ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`
                  }`}
                >
                  <td className={celdaCandidato}>
                    {sel && <span className="mr-1 text-primary">✓</span>}
                    {c.categoria}
                  </td>
                  <td className={`${celdaCandidato} text-muted-foreground`}>{c.grupo ?? "—"}</td>
                  <td className={`${celdaCandidato} text-center font-medium`}>{c.unidad}</td>
                  <td className={`${celdaCandidato} text-right`}>
                    {sinPrecio ? (
                      <span className="text-amber-600">sin precio</span>
                    ) : (
                      `$${c.valorUnitario!.toLocaleString()}`
                    )}
                  </td>
                  <td className={`${celdaCandidato} text-right text-muted-foreground`}>
                    {Math.round(c.similitud * 100)}%
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface Props {
  open: boolean
  itemIds: string[]
  onCerrar: () => void
  // se llama cada vez que algo se resuelve (para que page.tsx pueda
  // refrescar los colores de la tabla sin esperar a que se cierre todo
  // el diálogo)
  onCambio?: () => void
}

type Eleccion =
  | { tipo: "maestro"; insumoId: string }
  | { tipo: "solicitud" }
  | { tipo: "mano_obra"; categoriaId: string }
  | { tipo: "solicitud_mano_obra" }
  | null

export function RevisionApuDialog({ open, itemIds, onCerrar, onCambio }: Props) {
  const [datos, setDatos] = useState<LoteRevisionInfo | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pidiendoConfirmacionCierre, setPidiendoConfirmacionCierre] = useState(false)
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({})
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({}) // revisionId -> nuevoInsumoId
  const [guardandoIds, setGuardandoIds] = useState<Set<string>>(new Set())

  async function cargar() {
    // Solo se muestra el "Cargando revisión…" de pantalla completa la
    // PRIMERA vez (cuando todavía no hay nada que mostrar) -- las
    // recargas posteriores (después de guardar algo) pasan calladas,
    // sin tapar lo que ya está en pantalla. Antes esto no se distinguía,
    // y guardarSeleccionados() -- que llamaba cargar() una vez POR CADA
    // línea del lote -- hacía que el diálogo completo parpadeara entre
    // "Cargando…" y el contenido, una vez por línea.
    const esPrimeraCarga = datos === null
    if (esPrimeraCarga) setCargando(true)
    setError(null)
    try {
      const resultado = await listarRevisionPorItems(itemIds)
      setDatos(resultado)

      // Limpia elecciones/correcciones de líneas que YA NO EXISTEN en la
      // recarga (porque se resolvieron) -- sin esto, después de guardar
      // el diálogo seguía pensando "hay trabajo sin guardar" con ids
      // viejos, y el aviso de "¿cerrar sin terminar?" decía "quedan 0
      // insumos" (bug real: preguntaba igual aunque ya no quedara nada).
      const idsVigentes = new Set(resultado.filas.map((f) => f.id))
      setElecciones((prev) => {
        const nuevo: typeof prev = {}
        for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
        return nuevo
      })
      setCorrecciones((prev) => {
        const nuevo: typeof prev = {}
        for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
        return nuevo
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la revisión.")
    } finally {
      if (esPrimeraCarga) setCargando(false)
    }
  }

  // Recuerda si el diálogo YA estaba abierto en el render anterior --
  // así se puede distinguir "se acaba de abrir" (resetear todo) de
  // "sigue abierto pero itemIds creció" (recargar SIN perder las
  // elecciones que ya hizo el usuario -- ver el useEffect de abajo).
  const yaEstabaAbierto = useRef(false)

  useEffect(() => {
    if (!open) {
      yaEstabaAbierto.current = false
      return
    }
    if (!yaEstabaAbierto.current) {
      // Apertura nueva -- reset completo.
      setElecciones({})
      setCorrecciones({})
      setDatos(null) // fuerza que la próxima cargar() cuente como "primera carga" otra vez
      yaEstabaAbierto.current = true
    }
    // Si ya estaba abierto y esto corrió de nuevo, es porque `itemIds`
    // cambió (llegaron ítems nuevos con pendientes de una tanda que
    // terminó en el fondo) -- se recarga, pero SIN tocar elecciones ni
    // correcciones, para no perder lo que el usuario ya había elegido.
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemIds.join(",")])

  const filas = datos?.filas ?? []
  const pendientesTodo = useMemo(() => filas.filter((f) => f.estado === "pendiente"), [filas])
  // Mano de obra se separa del resto -- no se agrupa por descripción
  // (dos líneas "Cuadrilla AA-4" de ítems distintos tienen candidatos
  // DISTINTOS, agruparlas por texto sería incorrecto -- ver
  // matchearManoDeObraApuImport en actions.ts, es 1 búsqueda por ítem).
  const pendientes = useMemo(() => pendientesTodo.filter((f) => f.tipo !== "MO"), [pendientesTodo])
  const pendientesManoObra = useMemo(() => pendientesTodo.filter((f) => f.tipo === "MO"), [pendientesTodo])
  const rechazadosTodo = useMemo(() => filas.filter((f) => f.estado === "rechazado"), [filas])
  const rechazados = useMemo(() => rechazadosTodo.filter((f) => f.tipo !== "MO"), [rechazadosTodo])
  const rechazadosManoObra = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "MO"), [rechazadosTodo])
  const autoMatch = useMemo(() => filas.filter((f) => f.estado === "auto_match"), [filas])

  function agruparPorItem(lista: FilaRevisionImport[]) {
    const grupos = new Map<string, FilaRevisionImport[]>()
    for (const fila of lista) {
      const l = grupos.get(fila.presupuestoItemId) ?? []
      l.push(fila)
      grupos.set(fila.presupuestoItemId, l)
    }
    return grupos
  }

  // El MISMO insumo (misma descripción) suele aparecer en muchos ítems
  // distintos (ej. "Herramienta menor" en 20 ítems) -- agrupar
  // "Pendientes" por ítem obligaba a elegir el mismo candidato 20 veces.
  // Se agrupa por descripción en su lugar: una tarjeta por insumo único,
  // la elección se aplica a TODAS las apariciones de una. El servidor ya
  // deduplica esto también del lado de "crear solicitud" (ver
  // resolverLineasRevisionEnLote en actions.ts) -- no se crean N
  // solicitudes idénticas.
  function agruparPorDescripcion(lista: FilaRevisionImport[]) {
    const grupos = new Map<string, FilaRevisionImport[]>()
    for (const fila of lista) {
      const clave = fila.descripcionOriginal.trim().toLowerCase()
      const l = grupos.get(clave) ?? []
      l.push(fila)
      grupos.set(clave, l)
    }
    return grupos
  }

  const gruposPendientes = useMemo(() => agruparPorDescripcion(pendientes), [pendientes])
  const rechazadosPorItem = useMemo(() => agruparPorItem(rechazados), [rechazados])
  const autoMatchPorItem = useMemo(() => agruparPorItem(autoMatch), [autoMatch])

  function elegirCandidatoGrupo(filasGrupo: FilaRevisionImport[], insumoId: string) {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const f of filasGrupo) nuevo[f.id] = { tipo: "maestro", insumoId }
      return nuevo
    })
  }
  function marcarSolicitudGrupo(filasGrupo: FilaRevisionImport[]) {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const f of filasGrupo) nuevo[f.id] = { tipo: "solicitud" }
      return nuevo
    })
  }
  // Rechazados NO se agrupan por descripción -- cada uno puede tener un
  // motivo distinto, y ya no deberían duplicarse hacia adelante (la
  // deduplicación de solicitudes evita que se repita el mismo rechazo
  // muchas veces).
  function elegirCandidato(revisionId: string, insumoId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "maestro", insumoId } }))
  }
  function marcarSolicitud(revisionId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud" } }))
  }
  function elegirCategoriaManoObra(revisionId: string, categoriaId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "mano_obra", categoriaId } }))
  }
  function marcarSolicitudManoObra(revisionId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud_mano_obra" } }))
  }
  function corregirAutoMatch(revisionId: string, nuevoInsumoId: string) {
    setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoInsumoId }))
  }

  // ---------- selección múltiple: rechazados (por línea) ----------
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const toggleSeleccionado = (id: string) => {
    setSeleccionados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }
  const todosSeleccionados = rechazados.length > 0 && seleccionados.size === rechazados.length
  const toggleSeleccionarTodos = () => {
    setSeleccionados(todosSeleccionados ? new Set() : new Set(rechazados.map((f) => f.id)))
  }
  const aplicarEnLote = (accion: "mejor_candidato" | "solicitud") => {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const id of seleccionados) {
        if (accion === "mejor_candidato") {
          const fila = rechazados.find((f) => f.id === id)
          if (fila && fila.candidatos.length > 0) {
            nuevo[id] = { tipo: "maestro", insumoId: fila.candidatos[0].id }
          }
          continue
        }
        nuevo[id] = { tipo: "solicitud" }
      }
      return nuevo
    })
  }

  // ---------- selección múltiple: grupos de pendientes (por descripción) ----------
  const [gruposSeleccionados, setGruposSeleccionados] = useState<Set<string>>(new Set())
  const toggleGrupoSeleccionado = (clave: string) => {
    setGruposSeleccionados((prev) => {
      const copia = new Set(prev)
      if (copia.has(clave)) copia.delete(clave)
      else copia.add(clave)
      return copia
    })
  }
  const clavesGruposPendientes = Array.from(gruposPendientes.keys())
  const todosGruposSeleccionados =
    clavesGruposPendientes.length > 0 && gruposSeleccionados.size === clavesGruposPendientes.length
  const toggleTodosGruposSeleccionados = () => {
    setGruposSeleccionados(todosGruposSeleccionados ? new Set() : new Set(clavesGruposPendientes))
  }
  const aplicarEnLoteGrupos = (accion: "mejor_candidato" | "solicitud") => {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const clave of gruposSeleccionados) {
        const filasGrupo = gruposPendientes.get(clave) ?? []
        for (const f of filasGrupo) {
          if (accion === "mejor_candidato") {
            if (f.candidatos.length > 0) nuevo[f.id] = { tipo: "maestro", insumoId: f.candidatos[0].id }
            continue
          }
          nuevo[f.id] = { tipo: "solicitud" }
        }
      }
      return nuevo
    })
  }

  // Guardar UNA línea de una vez (en vez de esperar a un botón "guardar
  // todo" al final) -- así el ingeniero ve el progreso inmediato, y
  // puede cerrar en cualquier momento sin perder lo que ya resolvió acá.
  async function guardarLinea(revisionId: string) {
    const eleccion = elecciones[revisionId]
    if (!eleccion) return
    setGuardandoIds((prev) => new Set(prev).add(revisionId))
    setError(null)
    try {
      if (eleccion.tipo === "maestro") {
        await resolverLineaRevision({ revisionId, accion: "maestro", insumoId: eleccion.insumoId })
      } else if (eleccion.tipo === "mano_obra") {
        await resolverLineaRevision({ revisionId, accion: "mano_obra", manoObraCategoriaId: eleccion.categoriaId })
      } else if (eleccion.tipo === "solicitud_mano_obra") {
        await resolverLineaRevision({ revisionId, accion: "solicitud_mano_obra" })
      } else {
        await resolverLineaRevision({ revisionId, accion: "solicitud" })
      }
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar esa línea.")
    } finally {
      setGuardandoIds((prev) => {
        const copia = new Set(prev)
        copia.delete(revisionId)
        return copia
      })
    }
  }

  // Guarda un conjunto explícito de revisionIds de una sola vez -- usada
  // tanto por "guardar seleccionados" (rechazados) como por "guardar
  // grupos seleccionados" (pendientes), y también al guardar UN grupo
  // entero de un insumo repetido con un solo click.
  async function guardarIds(ids: string[]) {
    if (ids.length === 0) return
    setError(null)
    setGuardandoIds((prev) => {
      const copia = new Set(prev)
      ids.forEach((id) => copia.add(id))
      return copia
    })

    try {
      const resoluciones = ids
        .map((id) => {
          const eleccion = elecciones[id]
          if (!eleccion) return null
          if (eleccion.tipo === "maestro") {
            return { revisionId: id, accion: "maestro" as const, insumoId: eleccion.insumoId }
          }
          if (eleccion.tipo === "mano_obra") {
            return { revisionId: id, accion: "mano_obra" as const, manoObraCategoriaId: eleccion.categoriaId }
          }
          if (eleccion.tipo === "solicitud_mano_obra") {
            return { revisionId: id, accion: "solicitud_mano_obra" as const }
          }
          return { revisionId: id, accion: "solicitud" as const }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const { errores } = await resolverLineasRevisionEnLote(resoluciones)
      if (errores.length > 0) setError(errores.map((e) => e.mensaje).join(" · "))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los seleccionados.")
    }

    setGuardandoIds((prev) => {
      const copia = new Set(prev)
      ids.forEach((id) => copia.delete(id))
      return copia
    })

    await cargar()
    onCambio?.()
  }

  async function guardarSeleccionados() {
    const ids = Array.from(seleccionados).filter((id) => elecciones[id])
    await guardarIds(ids)
    setSeleccionados(new Set())
  }

  async function guardarGruposSeleccionados() {
    const ids = Array.from(gruposSeleccionados)
      .flatMap((clave) => gruposPendientes.get(clave) ?? [])
      .filter((f) => elecciones[f.id])
      .map((f) => f.id)
    await guardarIds(ids)
    setGruposSeleccionados(new Set())
  }

  async function guardarGrupo(filasGrupo: FilaRevisionImport[]) {
    const ids = filasGrupo.filter((f) => elecciones[f.id]).map((f) => f.id)
    await guardarIds(ids)
  }

  async function guardarCorreccion(revisionId: string) {
    const nuevoInsumoId = correcciones[revisionId]
    if (!nuevoInsumoId) return
    setGuardandoIds((prev) => new Set(prev).add(revisionId))
    setError(null)
    try {
      await editarLineaAutoMatch({ revisionId, nuevoInsumoId })
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
    } finally {
      setGuardandoIds((prev) => {
        const copia = new Set(prev)
        copia.delete(revisionId)
        return copia
      })
    }
  }

  const hayTrabajoSinGuardar = Object.keys(elecciones).length > 0 || Object.keys(correcciones).length > 0
  const faltanPorResolver =
    pendientes.length + pendientesManoObra.length + rechazados.length + rechazadosManoObra.length

  function handleIntentoCerrar(siguienteEstado: boolean) {
    if (siguienteEstado) return
    if (faltanPorResolver === 0 && !hayTrabajoSinGuardar) {
      onCerrar()
      return
    }
    setPidiendoConfirmacionCierre(true)
  }

  return (
    <Dialog open={open} onOpenChange={handleIntentoCerrar}>
      <DialogContent
        className="max-w-6xl w-[95vw] max-h-[92vh] overflow-y-auto"
        style={{ maxWidth: "1200px", width: "95vw" }}
      >
        {pidiendoConfirmacionCierre ? (
          <div className="space-y-4 p-2">
            <DialogHeader>
              <DialogTitle>¿Cerrar sin terminar?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Todavía quedan {faltanPorResolver} línea(s) sin resolver
              {hayTrabajoSinGuardar ? " (algunos ya elegidos pero sin guardar)" : ""}. Puedes cerrar y
              terminar después -- esos ítems se van a seguir viendo en amarillo o rojo en la tabla del
              presupuesto hasta que los resuelvas, y puedes volver a abrir esta revisión cuando quieras
              desde ahí.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPidiendoConfirmacionCierre(false)}>
                Seguir revisando
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setPidiendoConfirmacionCierre(false)
                  onCerrar()
                }}
              >
                Cerrar y terminar después
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Revisión de APU</DialogTitle>
            </DialogHeader>

            {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {!cargando && datos && (
              <div className="space-y-6">
                {pendientes.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

                    {gruposPendientes.size > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <label className="flex items-center gap-1.5 text-sm mr-2">
                          <input
                            type="checkbox"
                            checked={todosGruposSeleccionados}
                            onChange={toggleTodosGruposSeleccionados}
                          />
                          Seleccionar todos ({gruposSeleccionados.size}/{gruposPendientes.size})
                        </label>
                        <span className="text-xs text-muted-foreground">Aplicar a los seleccionados:</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={gruposSeleccionados.size === 0}
                          onClick={() => aplicarEnLoteGrupos("mejor_candidato")}
                        >
                          Elegir mejor candidato
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={gruposSeleccionados.size === 0}
                          onClick={() => aplicarEnLoteGrupos("solicitud")}
                        >
                          Marcar como solicitud
                        </Button>
                        <Button size="sm" disabled={gruposSeleccionados.size === 0} onClick={guardarGruposSeleccionados}>
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {Array.from(gruposPendientes.entries()).map(([clave, filasGrupo]) => (
                      <GrupoInsumoPendiente
                        key={clave}
                        clave={clave}
                        filasGrupo={filasGrupo}
                        itemsPorId={datos.itemsPorId}
                        elecciones={elecciones}
                        seleccionado={gruposSeleccionados.has(clave)}
                        guardandoIds={guardandoIds}
                        onToggleSeleccionado={() => toggleGrupoSeleccionado(clave)}
                        onElegirCandidato={(insumoId) => elegirCandidatoGrupo(filasGrupo, insumoId)}
                        onMarcarSolicitud={() => marcarSolicitudGrupo(filasGrupo)}
                        onGuardarGrupo={() => guardarGrupo(filasGrupo)}
                      />
                    ))}
                  </section>
                )}

                {pendientesManoObra.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Mano de obra -- confirma la categoría</h3>
                    <p className="text-xs text-muted-foreground">
                      Nunca se asigna sola -- elige la categoría de actividad más parecida para cada
                      ítem.
                    </p>
                    {pendientesManoObra.map((fila) => {
                      const item = datos.itemsPorId[fila.presupuestoItemId]
                      const eleccion = elecciones[fila.id]
                      const guardando = guardandoIds.has(fila.id)
                      return (
                        <div key={fila.id} className="border rounded-lg p-3 space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">
                            {item?.codigo} — {item?.descripcion}
                          </p>
                          <TablaCategoriasManoObra
                            categorias={fila.candidatos as CategoriaManoObra[]}
                            seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
                            onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => marcarSolicitudManoObra(fila.id)}
                              className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
                            >
                              Ninguna calza — solicitar categoría nueva
                            </button>
                            {eleccion && (
                              <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
                                {guardando ? "Guardando…" : "Guardar"}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </section>
                )}

                {rechazados.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700">
                      Rechazados por admin -- necesitan otra opción
                    </h3>

                    {rechazados.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <label className="flex items-center gap-1.5 text-sm mr-2">
                          <input type="checkbox" checked={todosSeleccionados} onChange={toggleSeleccionarTodos} />
                          Seleccionar todos ({seleccionados.size}/{rechazados.length})
                        </label>
                        <span className="text-xs text-muted-foreground">Aplicar a los seleccionados:</span>
                        <Button size="sm" variant="outline" disabled={seleccionados.size === 0} onClick={() => aplicarEnLote("mejor_candidato")}>
                          Elegir mejor candidato
                        </Button>
                        <Button size="sm" variant="outline" disabled={seleccionados.size === 0} onClick={() => aplicarEnLote("solicitud")}>
                          Marcar como solicitud
                        </Button>
                        <Button size="sm" disabled={seleccionados.size === 0} onClick={guardarSeleccionados}>
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {Array.from(rechazadosPorItem.entries()).map(([itemId, filasItem]) => (
                      <FilaGrupoItem
                        key={itemId}
                        item={datos.itemsPorId[itemId]}
                        filas={filasItem}
                        elecciones={elecciones}
                        seleccionados={seleccionados}
                        guardandoIds={guardandoIds}
                        onToggleSeleccionado={toggleSeleccionado}
                        onElegirCandidato={elegirCandidato}
                        onMarcarSolicitud={marcarSolicitud}
                        onGuardarLinea={guardarLinea}
                        mostrarMotivoRechazo
                      />
                    ))}
                  </section>
                )}

                {rechazadosManoObra.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700">
                      Mano de obra rechazada por admin -- elige otra categoría
                    </h3>
                    {rechazadosManoObra.map((fila) => {
                      const item = datos.itemsPorId[fila.presupuestoItemId]
                      const eleccion = elecciones[fila.id]
                      const guardando = guardandoIds.has(fila.id)
                      return (
                        <div key={fila.id} className="border rounded-lg p-3 space-y-2 bg-red-50/40 border-red-200">
                          <p className="text-sm font-medium text-muted-foreground">
                            {item?.codigo} — {item?.descripcion}
                          </p>
                          {fila.motivoRechazo && (
                            <p className="text-xs text-red-700">
                              <span className="font-medium">Motivo del rechazo:</span> {fila.motivoRechazo}
                            </p>
                          )}
                          <TablaCategoriasManoObra
                            categorias={fila.candidatos as CategoriaManoObra[]}
                            seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
                            onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => marcarSolicitudManoObra(fila.id)}
                              className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
                            >
                              Ninguna calza — solicitar categoría nueva otra vez
                            </button>
                            {eleccion && (
                              <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
                                {guardando ? "Guardando…" : "Guardar"}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </section>
                )}

                {autoMatch.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Automáticos -- confirma que estén bien</h3>
                    {Array.from(autoMatchPorItem.entries()).map(([itemId, filasItem]) => {
                      const item = datos.itemsPorId[itemId]
                      return (
                        <div key={itemId} className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">
                            {item?.codigo} — {item?.descripcion}
                          </p>
                          {filasItem.map((fila) => {
                            const tieneCorreccionSinGuardar = !!correcciones[fila.id]
                            return (
                              <div key={fila.id} className="border rounded-lg p-3 space-y-2 ml-2 bg-emerald-50/40">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{fila.descripcionOriginal}</span>
                                  <span className="text-xs text-emerald-700">✓ auto-match</span>
                                </div>
                                <TablaCandidatos
                                  candidatos={fila.candidatos as CandidatoInsumo[]}
                                  seleccionado={correcciones[fila.id] ?? fila.insumoIdAsignado}
                                  onSeleccionar={(insumoId) => corregirAutoMatch(fila.id, insumoId)}
                                />
                                {tieneCorreccionSinGuardar && (
                                  <Button
                                    size="sm"
                                    onClick={() => guardarCorreccion(fila.id)}
                                    disabled={guardandoIds.has(fila.id)}
                                  >
                                    {guardandoIds.has(fila.id) ? "Guardando…" : "Guardar cambio"}
                                  </Button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </section>
                )}

                {filas.length === 0 && (
                  <p className="text-sm text-muted-foreground">No hay nada que revisar aquí.</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleIntentoCerrar(false)}>
                Cerrar
              </Button>
              {faltanPorResolver === 0 && (
                <span className="text-sm text-emerald-700 self-center">✓ Todo resuelto</span>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Un insumo PENDIENTE agrupado por descripción -- puede aparecer en
// varios ítems a la vez (ej. "Herramienta menor" en 20 ítems). Se elige
// el candidato UNA vez y se aplica a todas las apariciones -- ver
// elegirCandidatoGrupo/marcarSolicitudGrupo en el padre.
// ---------------------------------------------------------------------------

function GrupoInsumoPendiente({
  clave,
  filasGrupo,
  itemsPorId,
  elecciones,
  seleccionado,
  guardandoIds,
  onToggleSeleccionado,
  onElegirCandidato,
  onMarcarSolicitud,
  onGuardarGrupo,
}: {
  clave: string
  filasGrupo: FilaRevisionImport[]
  itemsPorId: Record<string, { codigo: string; descripcion: string }>
  elecciones: Record<string, Eleccion>
  seleccionado: boolean
  guardandoIds: Set<string>
  onToggleSeleccionado: () => void
  onElegirCandidato: (insumoId: string) => void
  onMarcarSolicitud: () => void
  onGuardarGrupo: () => void
}) {
  const primera = filasGrupo[0]
  const eleccion = elecciones[primera.id] // todas las filas del grupo comparten la misma elección
  const guardandoAlgo = filasGrupo.some((f) => guardandoIds.has(f.id))
  const codigosItems = filasGrupo
    .map((f) => itemsPorId[f.presupuestoItemId]?.codigo)
    .filter(Boolean)
    .join(", ")

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={seleccionado} onChange={onToggleSeleccionado} />
        <span className="font-medium">{primera.descripcionOriginal}</span>
        <span className="text-xs text-muted-foreground">
          {primera.cantidad} {primera.unidad}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {filasGrupo.length > 1
          ? `Aparece en ${filasGrupo.length} ítems: ${codigosItems}`
          : `Ítem: ${codigosItems}`}
        {filasGrupo.length > 1 && " -- la elección de abajo se aplica a todos."}
      </p>

      {(primera.candidatos as CandidatoInsumo[])[0] &&
        [0, 1].includes((primera.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
          <p className="text-xs text-amber-600">
            ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
          </p>
        )}

      <TablaCandidatos
        candidatos={primera.candidatos as CandidatoInsumo[]}
        seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
        onSeleccionar={onElegirCandidato}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMarcarSolicitud}
          className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
        >
          No existe — crear solicitud de aprobación
        </button>
        {eleccion && (
          <Button size="sm" onClick={onGuardarGrupo} disabled={guardandoAlgo}>
            {guardandoAlgo ? "Guardando…" : filasGrupo.length > 1 ? `Guardar (${filasGrupo.length} ítems)` : "Guardar"}
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Un grupo de líneas (pendientes o rechazadas) de UN ítem -- con checkbox
// individual, candidatos, y opción de solicitud. Compartido entre las
// secciones "Pendientes" y "Rechazados" (mismo diseño, la única
// diferencia es si se muestra el motivo del rechazo).
// ---------------------------------------------------------------------------

function FilaGrupoItem({
  item,
  filas,
  elecciones,
  seleccionados,
  guardandoIds,
  onToggleSeleccionado,
  onElegirCandidato,
  onMarcarSolicitud,
  onGuardarLinea,
  mostrarMotivoRechazo,
}: {
  item: { codigo: string; descripcion: string } | undefined
  filas: FilaRevisionImport[]
  elecciones: Record<string, Eleccion>
  seleccionados: Set<string>
  guardandoIds: Set<string>
  onToggleSeleccionado: (id: string) => void
  onElegirCandidato: (revisionId: string, insumoId: string) => void
  onMarcarSolicitud: (revisionId: string) => void
  onGuardarLinea: (revisionId: string) => void
  mostrarMotivoRechazo?: boolean
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">
        {item?.codigo} — {item?.descripcion}
      </p>
      {filas.map((fila) => {
        const eleccion = elecciones[fila.id]
        const guardando = guardandoIds.has(fila.id)
        return (
          <div
            key={fila.id}
            className={`border rounded-lg p-3 space-y-2 ml-2 ${mostrarMotivoRechazo ? "bg-red-50/40 border-red-200" : ""}`}
          >
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={seleccionados.has(fila.id)}
                onChange={() => onToggleSeleccionado(fila.id)}
              />
              <span className="font-medium">{fila.descripcionOriginal}</span>
              <span className="text-xs text-muted-foreground">
                {fila.cantidad} {fila.unidad}
              </span>
            </div>

            {mostrarMotivoRechazo && (
              <p className="text-xs text-red-700">
                <span className="font-medium">Motivo del rechazo:</span>{" "}
                {fila.motivoRechazo ?? "El admin no escribió un motivo."}
              </p>
            )}

            {(fila.candidatos as CandidatoInsumo[])[0] &&
              [0, 1].includes((fila.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
                <p className="text-xs text-amber-600">
                  ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
                </p>
              )}

            <TablaCandidatos
              candidatos={fila.candidatos as CandidatoInsumo[]}
              seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
              onSeleccionar={(insumoId) => onElegirCandidato(fila.id, insumoId)}
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onMarcarSolicitud(fila.id)}
                className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
              >
                No existe — crear solicitud de aprobación
              </button>
              {eleccion && (
                <Button size="sm" onClick={() => onGuardarLinea(fila.id)} disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar"}
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}