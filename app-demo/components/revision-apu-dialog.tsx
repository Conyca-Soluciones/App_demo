// "use client"

// /**
//  * Diálogo de revisión de insumos del import de APU -- reemplaza al
//  * enfoque de "pestaña nueva" (no funcionó como se esperaba, ver
//  * HANDOFF_import_apu.md). Vuelve a ser un diálogo, pero con 2 reglas
//  * nuevas:
//  *
//  *  1. No se puede cerrar por accidente (click afuera / Esc) -- pide
//  *     confirmación explícita.
//  *  2. SÍ se puede cerrar sin terminar (los datos ya están guardados de
//  *     todos modos -- ver decisión de arquitectura en el handoff), pero
//  *     queda MUY claro que no quedó completo: la fila del ítem sigue en
//  *     amarillo/rojo en la tabla del presupuesto, y este mismo diálogo se
//  *     puede REABRIR después sobre lo que falte (ver `itemIds` -- ya no
//  *     depende de un loteImportId de una sesión anterior).
//  *
//  * Muestra 3 grupos: pendientes (elegir candidato o pedir solicitud),
//  * rechazados (un admin rechazó la solicitud -- se ve el motivo, y se
//  * puede volver a intentar igual que un pendiente), y automáticos (para
//  * CONFIRMAR que el match esté bien, con opción de cambiarlo).
//  */

// import { useEffect, useMemo, useRef, useState } from "react"
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
// import { Button } from "@/components/ui/button"
// import {
//   listarRevisionPorItems,
//   resolverLineaRevision,
//   resolverLineasRevisionEnLote,
//   editarLineaAutoMatch,
//   type LoteRevisionInfo,
// } from "@/app/(app)/presupuestos/actions"
// import type { FilaRevisionImport, CandidatoInsumo, CategoriaManoObra } from "@/lib/apu-import-types"

// // Estilo "tipo Excel" -- mismo tratamiento que ya usa el resto de la app
// // (presupuesto-table.tsx, admin-insumos/page.tsx): encabezado azul de
// // marca, celdas con borde.
// const headClasesCandidatos =
//   "border-r border-b bg-primary px-3 py-2 text-left text-xs font-medium text-primary-foreground last:border-r-0"
// const celdaCandidato = "border-r px-3 py-2 text-sm last:border-r-0"

// /**
//  * Tabla de candidatos de insumo (nombre/unidad/valor/% similitud) --
//  * reemplaza los botones tipo "pill" que había antes. Se usa en los 3
//  * lugares donde se elige un candidato: pendientes, rechazados, y la
//  * corrección de un automático.
//  */
// function TablaCandidatos({
//   candidatos,
//   seleccionado,
//   onSeleccionar,
// }: {
//   candidatos: CandidatoInsumo[]
//   seleccionado?: string | null
//   onSeleccionar: (insumoId: string) => void
// }) {
//   if (candidatos.length === 0) return null

//   return (
//     <div className="space-y-1">
//       <p className="text-xs text-muted-foreground">Las recomendaciones de insumo son:</p>
//       <div className="overflow-x-auto rounded-md border">
//         <table className="w-full border-separate border-spacing-0">
//           <thead>
//             <tr>
//               <th className={headClasesCandidatos}>Nombre</th>
//               <th className={`${headClasesCandidatos} w-20`}>Unidad</th>
//               <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
//               <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
//             </tr>
//           </thead>
//           <tbody>
//             {candidatos.map((c) => {
//               const sel = seleccionado === c.id
//               return (
//                 <tr
//                   key={c.id}
//                   onClick={() => onSeleccionar(c.id)}
//                   className={`cursor-pointer border-t ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`}
//                 >
//                   <td className={celdaCandidato}>
//                     {sel && <span className="mr-1 text-primary">✓</span>}
//                     {c.descripcion}
//                   </td>
//                   <td className={`${celdaCandidato} text-muted-foreground`}>{c.u_m ?? "—"}</td>
//                   <td className={`${celdaCandidato} text-right`}>
//                     ${(c.vr_unitario ?? 0).toLocaleString()}
//                   </td>
//                   <td className={`${celdaCandidato} text-right text-muted-foreground`}>
//                     {Math.round(c.similitud * 100)}%
//                   </td>
//                 </tr>
//               )
//             })}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   )
// }

// /**
//  * Tabla de CATEGORÍAS de mano de obra (categoría/grupo/$-hora/%
//  * similitud) -- distinta de TablaCandidatos porque son columnas
//  * distintas (grupo en vez de unidad, valor es $/hora no $/unidad).
//  * Categorías sin precio todavía (valor_unitario null) se ven pero no se
//  * pueden elegir -- mismo criterio que un insumo con precio placeholder.
//  */
// function TablaCategoriasManoObra({
//   categorias,
//   seleccionado,
//   onSeleccionar,
// }: {
//   categorias: CategoriaManoObra[]
//   seleccionado?: string | null
//   onSeleccionar: (categoriaId: string) => void
// }) {
//   if (categorias.length === 0) return null

//   return (
//     <div className="space-y-1">
//       <p className="text-xs text-muted-foreground">Las categorías de mano de obra recomendadas son:</p>
//       <div className="overflow-x-auto rounded-md border">
//         <table className="w-full border-separate border-spacing-0">
//           <thead>
//             <tr>
//               <th className={headClasesCandidatos}>Categoría</th>
//               <th className={`${headClasesCandidatos} w-28`}>Grupo</th>
//               <th className={`${headClasesCandidatos} w-20 text-center`}>Unidad</th>
//               <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
//               <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
//             </tr>
//           </thead>
//           <tbody>
//             {categorias.map((c) => {
//               const sel = seleccionado === c.id
//               const sinPrecio = c.valorUnitario == null
//               return (
//                 <tr
//                   key={c.id}
//                   onClick={() => !sinPrecio && onSeleccionar(c.id)}
//                   title={sinPrecio ? "Esta categoría todavía no tiene precio definido en el catálogo" : undefined}
//                   className={`border-t ${
//                     sinPrecio
//                       ? "cursor-not-allowed opacity-50"
//                       : `cursor-pointer ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`
//                   }`}
//                 >
//                   <td className={celdaCandidato}>
//                     {sel && <span className="mr-1 text-primary">✓</span>}
//                     {c.categoria}
//                   </td>
//                   <td className={`${celdaCandidato} text-muted-foreground`}>{c.grupo ?? "—"}</td>
//                   <td className={`${celdaCandidato} text-center font-medium`}>{c.unidad}</td>
//                   <td className={`${celdaCandidato} text-right`}>
//                     {sinPrecio ? (
//                       <span className="text-amber-600">sin precio</span>
//                     ) : (
//                       `$${c.valorUnitario!.toLocaleString()}`
//                     )}
//                   </td>
//                   <td className={`${celdaCandidato} text-right text-muted-foreground`}>
//                     {Math.round(c.similitud * 100)}%
//                   </td>
//                 </tr>
//               )
//             })}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   )
// }

// interface Props {
//   open: boolean
//   itemIds: string[]
//   onCerrar: () => void
//   // se llama cada vez que algo se resuelve (para que page.tsx pueda
//   // refrescar los colores de la tabla sin esperar a que se cierre todo
//   // el diálogo)
//   onCambio?: () => void
// }

// type Eleccion =
//   | { tipo: "maestro"; insumoId: string }
//   | { tipo: "solicitud" }
//   | { tipo: "mano_obra"; categoriaId: string }
//   | { tipo: "solicitud_mano_obra" }
//   | null

// export function RevisionApuDialog({ open, itemIds, onCerrar, onCambio }: Props) {
//   const [datos, setDatos] = useState<LoteRevisionInfo | null>(null)
//   const [cargando, setCargando] = useState(false)
//   const [error, setError] = useState<string | null>(null)
//   const [pidiendoConfirmacionCierre, setPidiendoConfirmacionCierre] = useState(false)
//   const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({})
//   const [correcciones, setCorrecciones] = useState<Record<string, string>>({}) // revisionId -> nuevoInsumoId
//   const [guardandoIds, setGuardandoIds] = useState<Set<string>>(new Set())

//   async function cargar() {
//     // Solo se muestra el "Cargando revisión…" de pantalla completa la
//     // PRIMERA vez (cuando todavía no hay nada que mostrar) -- las
//     // recargas posteriores (después de guardar algo) pasan calladas,
//     // sin tapar lo que ya está en pantalla. Antes esto no se distinguía,
//     // y guardarSeleccionados() -- que llamaba cargar() una vez POR CADA
//     // línea del lote -- hacía que el diálogo completo parpadeara entre
//     // "Cargando…" y el contenido, una vez por línea.
//     const esPrimeraCarga = datos === null
//     if (esPrimeraCarga) setCargando(true)
//     setError(null)
//     try {
//       const resultado = await listarRevisionPorItems(itemIds)
//       setDatos(resultado)

//       // Limpia elecciones/correcciones de líneas que YA NO EXISTEN en la
//       // recarga (porque se resolvieron) -- sin esto, después de guardar
//       // el diálogo seguía pensando "hay trabajo sin guardar" con ids
//       // viejos, y el aviso de "¿cerrar sin terminar?" decía "quedan 0
//       // insumos" (bug real: preguntaba igual aunque ya no quedara nada).
//       const idsVigentes = new Set(resultado.filas.map((f) => f.id))
//       setElecciones((prev) => {
//         const nuevo: typeof prev = {}
//         for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
//         return nuevo
//       })
//       setCorrecciones((prev) => {
//         const nuevo: typeof prev = {}
//         for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
//         return nuevo
//       })
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo cargar la revisión.")
//     } finally {
//       if (esPrimeraCarga) setCargando(false)
//     }
//   }

//   // Recuerda si el diálogo YA estaba abierto en el render anterior --
//   // así se puede distinguir "se acaba de abrir" (resetear todo) de
//   // "sigue abierto pero itemIds creció" (recargar SIN perder las
//   // elecciones que ya hizo el usuario -- ver el useEffect de abajo).
//   const yaEstabaAbierto = useRef(false)

//   useEffect(() => {
//     if (!open) {
//       yaEstabaAbierto.current = false
//       return
//     }
//     if (!yaEstabaAbierto.current) {
//       // Apertura nueva -- reset completo.
//       setElecciones({})
//       setCorrecciones({})
//       setDatos(null) // fuerza que la próxima cargar() cuente como "primera carga" otra vez
//       yaEstabaAbierto.current = true
//     }
//     // Si ya estaba abierto y esto corrió de nuevo, es porque `itemIds`
//     // cambió (llegaron ítems nuevos con pendientes de una tanda que
//     // terminó en el fondo) -- se recarga, pero SIN tocar elecciones ni
//     // correcciones, para no perder lo que el usuario ya había elegido.
//     cargar()
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [open, itemIds.join(",")])

//   const filas = datos?.filas ?? []
//   const pendientesTodo = useMemo(() => filas.filter((f) => f.estado === "pendiente"), [filas])
//   // Mano de obra se separa del resto -- no se agrupa por descripción
//   // (dos líneas "Cuadrilla AA-4" de ítems distintos tienen candidatos
//   // DISTINTOS, agruparlas por texto sería incorrecto -- ver
//   // matchearManoDeObraApuImport en actions.ts, es 1 búsqueda por ítem).
//   const pendientes = useMemo(() => pendientesTodo.filter((f) => f.tipo !== "MO"), [pendientesTodo])
//   const pendientesManoObra = useMemo(() => pendientesTodo.filter((f) => f.tipo === "MO"), [pendientesTodo])
//   const rechazadosTodo = useMemo(() => filas.filter((f) => f.estado === "rechazado"), [filas])
//   const rechazados = useMemo(() => rechazadosTodo.filter((f) => f.tipo !== "MO"), [rechazadosTodo])
//   const rechazadosManoObra = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "MO"), [rechazadosTodo])
//   const autoMatch = useMemo(() => filas.filter((f) => f.estado === "auto_match"), [filas])

//   // ---------- tabs: Insumos / Mano de obra ----------
//   // Separados en dos pestañas porque son flujos de revisión distintos
//   // (candidatos del maestro vs. categorías de mano de obra) -- antes
//   // vivían todos apilados en un solo scroll larguísimo. El auto-match
//   // nunca aplica a mano de obra (ver actions.ts / handoff), así que esa
//   // sección se queda en la pestaña de Insumos.
//   const [tabActiva, setTabActiva] = useState<"insumos" | "mano_obra">("insumos")
//   const totalPendientesInsumos = pendientes.length + rechazados.length + autoMatch.length
//   const totalPendientesManoObra = pendientesManoObra.length + rechazadosManoObra.length
//   const sinNadaEnTabInsumos = totalPendientesInsumos === 0
//   const sinNadaEnTabManoObra = totalPendientesManoObra === 0

//   function agruparPorItem(lista: FilaRevisionImport[]) {
//     const grupos = new Map<string, FilaRevisionImport[]>()
//     for (const fila of lista) {
//       const l = grupos.get(fila.presupuestoItemId) ?? []
//       l.push(fila)
//       grupos.set(fila.presupuestoItemId, l)
//     }
//     return grupos
//   }

//   // El MISMO insumo (misma descripción) suele aparecer en muchos ítems
//   // distintos (ej. "Herramienta menor" en 20 ítems) -- agrupar
//   // "Pendientes" por ítem obligaba a elegir el mismo candidato 20 veces.
//   // Se agrupa por descripción en su lugar: una tarjeta por insumo único,
//   // la elección se aplica a TODAS las apariciones de una. El servidor ya
//   // deduplica esto también del lado de "crear solicitud" (ver
//   // resolverLineasRevisionEnLote en actions.ts) -- no se crean N
//   // solicitudes idénticas.
//   function agruparPorDescripcion(lista: FilaRevisionImport[]) {
//     const grupos = new Map<string, FilaRevisionImport[]>()
//     for (const fila of lista) {
//       const clave = fila.descripcionOriginal.trim().toLowerCase()
//       const l = grupos.get(clave) ?? []
//       l.push(fila)
//       grupos.set(clave, l)
//     }
//     return grupos
//   }

//   const gruposPendientes = useMemo(() => agruparPorDescripcion(pendientes), [pendientes])
//   const rechazadosPorItem = useMemo(() => agruparPorItem(rechazados), [rechazados])
//   const autoMatchPorItem = useMemo(() => agruparPorItem(autoMatch), [autoMatch])

//   function elegirCandidatoGrupo(filasGrupo: FilaRevisionImport[], insumoId: string) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "maestro", insumoId }
//       return nuevo
//     })
//   }
//   function marcarSolicitudGrupo(filasGrupo: FilaRevisionImport[]) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "solicitud" }
//       return nuevo
//     })
//   }
//   // Rechazados NO se agrupan por descripción -- cada uno puede tener un
//   // motivo distinto, y ya no deberían duplicarse hacia adelante (la
//   // deduplicación de solicitudes evita que se repita el mismo rechazo
//   // muchas veces).
//   function elegirCandidato(revisionId: string, insumoId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "maestro", insumoId } }))
//   }
//   function marcarSolicitud(revisionId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud" } }))
//   }
//   function elegirCategoriaManoObra(revisionId: string, categoriaId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "mano_obra", categoriaId } }))
//   }
//   function marcarSolicitudManoObra(revisionId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud_mano_obra" } }))
//   }
//   function corregirAutoMatch(revisionId: string, nuevoInsumoId: string) {
//     setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoInsumoId }))
//   }

//   // ---------- "seleccionados" (rechazados) -- YA NO es un checkbox manual:
//   // una línea queda "seleccionada" automáticamente en cuanto el usuario le
//   // elige un candidato o la marca como solicitud (ver elegirCandidato /
//   // marcarSolicitud arriba). "Guardar seleccionados" guarda todas las que
//   // ya tengan una elección hecha, de una sola vez.
//   const idsRechazadosConEleccion = useMemo(
//     () => rechazados.filter((f) => elecciones[f.id]).map((f) => f.id),
//     [rechazados, elecciones]
//   )

//   // ---------- "seleccionados" (grupos de pendientes, por descripción) --
//   // mismo criterio: un grupo cuenta como "seleccionado" en cuanto tiene
//   // una elección hecha (se comparte entre todas las filas del grupo).
//   const clavesGruposConEleccion = useMemo(
//     () => Array.from(gruposPendientes.entries())
//       .filter(([, filasGrupo]) => elecciones[filasGrupo[0].id])
//       .map(([clave]) => clave),
//     [gruposPendientes, elecciones]
//   )

//   // Guardar UNA línea de una vez (en vez de esperar a un botón "guardar
//   // todo" al final) -- así el ingeniero ve el progreso inmediato, y
//   // puede cerrar en cualquier momento sin perder lo que ya resolvió acá.
//   async function guardarLinea(revisionId: string) {
//     const eleccion = elecciones[revisionId]
//     if (!eleccion) return
//     setGuardandoIds((prev) => new Set(prev).add(revisionId))
//     setError(null)
//     try {
//       if (eleccion.tipo === "maestro") {
//         await resolverLineaRevision({ revisionId, accion: "maestro", insumoId: eleccion.insumoId })
//       } else if (eleccion.tipo === "mano_obra") {
//         await resolverLineaRevision({ revisionId, accion: "mano_obra", manoObraCategoriaId: eleccion.categoriaId })
//       } else if (eleccion.tipo === "solicitud_mano_obra") {
//         await resolverLineaRevision({ revisionId, accion: "solicitud_mano_obra" })
//       } else {
//         await resolverLineaRevision({ revisionId, accion: "solicitud" })
//       }
//       await cargar()
//       onCambio?.()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo guardar esa línea.")
//     } finally {
//       setGuardandoIds((prev) => {
//         const copia = new Set(prev)
//         copia.delete(revisionId)
//         return copia
//       })
//     }
//   }

//   // Guarda un conjunto explícito de revisionIds de una sola vez -- usada
//   // tanto por "guardar seleccionados" (rechazados) como por "guardar
//   // grupos seleccionados" (pendientes), y también al guardar UN grupo
//   // entero de un insumo repetido con un solo click.
//   async function guardarIds(ids: string[]) {
//     if (ids.length === 0) return
//     setError(null)
//     setGuardandoIds((prev) => {
//       const copia = new Set(prev)
//       ids.forEach((id) => copia.add(id))
//       return copia
//     })

//     try {
//       const resoluciones = ids
//         .map((id) => {
//           const eleccion = elecciones[id]
//           if (!eleccion) return null
//           if (eleccion.tipo === "maestro") {
//             return { revisionId: id, accion: "maestro" as const, insumoId: eleccion.insumoId }
//           }
//           if (eleccion.tipo === "mano_obra") {
//             return { revisionId: id, accion: "mano_obra" as const, manoObraCategoriaId: eleccion.categoriaId }
//           }
//           if (eleccion.tipo === "solicitud_mano_obra") {
//             return { revisionId: id, accion: "solicitud_mano_obra" as const }
//           }
//           return { revisionId: id, accion: "solicitud" as const }
//         })
//         .filter((r): r is NonNullable<typeof r> => r !== null)

//       const { errores } = await resolverLineasRevisionEnLote(resoluciones)
//       if (errores.length > 0) setError(errores.map((e) => e.mensaje).join(" · "))
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudieron guardar los seleccionados.")
//     }

//     setGuardandoIds((prev) => {
//       const copia = new Set(prev)
//       ids.forEach((id) => copia.delete(id))
//       return copia
//     })

//     await cargar()
//     onCambio?.()
//   }

//   async function guardarSeleccionados() {
//     await guardarIds(idsRechazadosConEleccion)
//   }

//   async function guardarGruposSeleccionados() {
//     const ids = clavesGruposConEleccion.flatMap((clave) => gruposPendientes.get(clave) ?? []).map((f) => f.id)
//     await guardarIds(ids)
//   }

//   async function guardarGrupo(filasGrupo: FilaRevisionImport[]) {
//     const ids = filasGrupo.filter((f) => elecciones[f.id]).map((f) => f.id)
//     await guardarIds(ids)
//   }

//   async function guardarCorreccion(revisionId: string) {
//     const nuevoInsumoId = correcciones[revisionId]
//     if (!nuevoInsumoId) return
//     setGuardandoIds((prev) => new Set(prev).add(revisionId))
//     setError(null)
//     try {
//       await editarLineaAutoMatch({ revisionId, nuevoInsumoId })
//       await cargar()
//       onCambio?.()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
//     } finally {
//       setGuardandoIds((prev) => {
//         const copia = new Set(prev)
//         copia.delete(revisionId)
//         return copia
//       })
//     }
//   }

//   const hayTrabajoSinGuardar = Object.keys(elecciones).length > 0 || Object.keys(correcciones).length > 0
//   const faltanPorResolver =
//     pendientes.length + pendientesManoObra.length + rechazados.length + rechazadosManoObra.length

//   function handleIntentoCerrar(siguienteEstado: boolean) {
//     if (siguienteEstado) return
//     if (faltanPorResolver === 0 && !hayTrabajoSinGuardar) {
//       onCerrar()
//       return
//     }
//     setPidiendoConfirmacionCierre(true)
//   }

//   return (
//     <Dialog open={open} onOpenChange={handleIntentoCerrar}>
//       <DialogContent
//         className="max-w-7xl w-[95vw] max-h-[92vh] overflow-y-auto"
//         style={{ maxWidth: "1500px", width: "95vw" }}
//       >
//         {pidiendoConfirmacionCierre ? (
//           <div className="space-y-4 p-2">
//             <DialogHeader>
//               <DialogTitle>¿Cerrar sin terminar?</DialogTitle>
//             </DialogHeader>
//             <p className="text-sm text-muted-foreground">
//               Todavía quedan {faltanPorResolver} línea(s) sin resolver
//               {hayTrabajoSinGuardar ? " (algunos ya elegidos pero sin guardar)" : ""}. Puedes cerrar y
//               terminar después -- esos ítems se van a seguir viendo en amarillo o rojo en la tabla del
//               presupuesto hasta que los resuelvas, y puedes volver a abrir esta revisión cuando quieras
//               desde ahí.
//             </p>
//             <DialogFooter>
//               <Button variant="outline" onClick={() => setPidiendoConfirmacionCierre(false)}>
//                 Seguir revisando
//               </Button>
//               <Button
//                 variant="destructive"
//                 onClick={() => {
//                   setPidiendoConfirmacionCierre(false)
//                   onCerrar()
//                 }}
//               >
//                 Cerrar y terminar después
//               </Button>
//             </DialogFooter>
//           </div>
//         ) : (
//           <>
//             <DialogHeader>
//               <DialogTitle>Revisión de APU</DialogTitle>
//             </DialogHeader>

//             {cargando && (
//               <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4">
//                 <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
//                 Cargando revisión…
//               </div>
//             )}
//             {error && <p className="text-sm text-destructive">{error}</p>}

//             {!cargando && datos && (
//               <div className="space-y-6">
//                 <div className="flex gap-1 border-b">
//                   <button
//                     type="button"
//                     onClick={() => setTabActiva("insumos")}
//                     className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
//                       tabActiva === "insumos"
//                         ? "border-primary text-primary"
//                         : "border-transparent text-muted-foreground hover:text-foreground"
//                     }`}
//                   >
//                     Insumos
//                     {totalPendientesInsumos > 0 && (
//                       <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
//                         {totalPendientesInsumos}
//                       </span>
//                     )}
//                   </button>
//                   <button
//                     type="button"
//                     onClick={() => setTabActiva("mano_obra")}
//                     className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
//                       tabActiva === "mano_obra"
//                         ? "border-primary text-primary"
//                         : "border-transparent text-muted-foreground hover:text-foreground"
//                     }`}
//                   >
//                     Mano de obra
//                     {totalPendientesManoObra > 0 && (
//                       <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
//                         {totalPendientesManoObra}
//                       </span>
//                     )}
//                   </button>
//                 </div>

//                 {tabActiva === "insumos" && sinNadaEnTabInsumos && (
//                   <p className="text-sm text-muted-foreground">No hay nada que revisar en Insumos.</p>
//                 )}
//                 {tabActiva === "mano_obra" && sinNadaEnTabManoObra && (
//                   <p className="text-sm text-muted-foreground">No hay nada que revisar en Mano de obra.</p>
//                 )}

//                 {tabActiva === "insumos" && pendientes.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

//                     {gruposPendientes.size > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {clavesGruposConEleccion.length} de {gruposPendientes.size} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={clavesGruposConEleccion.length === 0}
//                           onClick={guardarGruposSeleccionados}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(gruposPendientes.entries()).map(([clave, filasGrupo]) => (
//                       <GrupoInsumoPendiente
//                         key={clave}
//                         clave={clave}
//                         filasGrupo={filasGrupo}
//                         itemsPorId={datos.itemsPorId}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirCandidato={(insumoId) => elegirCandidatoGrupo(filasGrupo, insumoId)}
//                         onMarcarSolicitud={() => marcarSolicitudGrupo(filasGrupo)}
//                         onGuardarGrupo={() => guardarGrupo(filasGrupo)}
//                       />
//                     ))}
//                   </section>
//                 )}

//                 {tabActiva === "mano_obra" && pendientesManoObra.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Mano de obra -- confirma la categoría</h3>
//                     <p className="text-xs text-muted-foreground">
//                       Nunca se asigna sola -- elige la categoría de actividad más parecida para cada
//                       ítem.
//                     </p>
//                     {pendientesManoObra.map((fila) => {
//                       const item = datos.itemsPorId[fila.presupuestoItemId]
//                       const eleccion = elecciones[fila.id]
//                       const guardando = guardandoIds.has(fila.id)
//                       return (
//                         <div key={fila.id} className="border rounded-lg p-4 space-y-2">
//                           <div>
//                             <p className="text-sm font-medium text-muted-foreground">
//                               {item?.codigo} — {item?.descripcion}
//                             </p>
//                             <p className="text-xs italic text-muted-foreground/70">
//                               Está en el presupuesto como: {fila.descripcionOriginal}
//                             </p>
//                           </div>
//                           <TablaCategoriasManoObra
//                             categorias={fila.candidatos as CategoriaManoObra[]}
//                             seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
//                             onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
//                           />
//                           <div className="flex items-center gap-2">
//                             <button
//                               type="button"
//                               onClick={() => marcarSolicitudManoObra(fila.id)}
//                               className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
//                             >
//                               Ninguna calza — solicitar categoría nueva
//                             </button>
//                             {eleccion && (
//                               <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
//                                 {guardando ? "Guardando…" : "Guardar"}
//                               </Button>
//                             )}
//                           </div>
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//                 {tabActiva === "insumos" && rechazados.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold text-red-700">
//                       Rechazados por admin -- necesitan otra opción
//                     </h3>

//                     {rechazados.length > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {idsRechazadosConEleccion.length} de {rechazados.length} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={idsRechazadosConEleccion.length === 0}
//                           onClick={guardarSeleccionados}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(rechazadosPorItem.entries()).map(([itemId, filasItem]) => (
//                       <FilaGrupoItem
//                         key={itemId}
//                         item={datos.itemsPorId[itemId]}
//                         filas={filasItem}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirCandidato={elegirCandidato}
//                         onMarcarSolicitud={marcarSolicitud}
//                         onGuardarLinea={guardarLinea}
//                         mostrarMotivoRechazo
//                       />
//                     ))}
//                   </section>
//                 )}


//                 {tabActiva === "mano_obra" && rechazadosManoObra.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold text-red-700">
//                       Mano de obra rechazada por admin -- elige otra categoría
//                     </h3>
//                     {rechazadosManoObra.map((fila) => {
//                       const item = datos.itemsPorId[fila.presupuestoItemId]
//                       const eleccion = elecciones[fila.id]
//                       const guardando = guardandoIds.has(fila.id)
//                       return (
//                         <div key={fila.id} className="border rounded-lg p-4 space-y-2 bg-red-50/40 border-red-200">
//                           <div>
//                             <p className="text-sm font-medium text-muted-foreground">
//                               {item?.codigo} — {item?.descripcion}
//                             </p>
//                             <p className="text-xs italic text-muted-foreground/70">
//                               Está en el presupuesto como: {fila.descripcionOriginal}
//                             </p>
//                           </div>
//                           {fila.motivoRechazo && (
//                             <p className="text-xs text-red-700">
//                               <span className="font-medium">Motivo del rechazo:</span> {fila.motivoRechazo}
//                             </p>
//                           )}
//                           <TablaCategoriasManoObra
//                             categorias={fila.candidatos as CategoriaManoObra[]}
//                             seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
//                             onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
//                           />
//                           <div className="flex items-center gap-2">
//                             <button
//                               type="button"
//                               onClick={() => marcarSolicitudManoObra(fila.id)}
//                               className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
//                             >
//                               Ninguna calza — solicitar categoría nueva otra vez
//                             </button>
//                             {eleccion && (
//                               <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
//                                 {guardando ? "Guardando…" : "Guardar"}
//                               </Button>
//                             )}
//                           </div>
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//                 {tabActiva === "insumos" && autoMatch.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Automáticos -- confirma que estén bien</h3>
//                     {Array.from(autoMatchPorItem.entries()).map(([itemId, filasItem]) => {
//                       const item = datos.itemsPorId[itemId]
//                       return (
//                         <div key={itemId} className="space-y-2">
//                           <p className="text-sm font-medium text-muted-foreground">
//                             {item?.codigo} — {item?.descripcion}
//                           </p>
//                           {filasItem.map((fila) => {
//                             const tieneCorreccionSinGuardar = !!correcciones[fila.id]
//                             return (
//                               <div key={fila.id} className="border rounded-lg p-4 space-y-2 ml-2 bg-emerald-50/40">
//                                 <div className="flex items-center justify-between">
//                                   <span className="font-medium">{fila.descripcionOriginal}</span>
//                                   <span className="text-xs text-emerald-700">✓ auto-match</span>
//                                 </div>
//                                 <TablaCandidatos
//                                   candidatos={fila.candidatos as CandidatoInsumo[]}
//                                   seleccionado={correcciones[fila.id] ?? fila.insumoIdAsignado}
//                                   onSeleccionar={(insumoId) => corregirAutoMatch(fila.id, insumoId)}
//                                 />
//                                 {tieneCorreccionSinGuardar && (
//                                   <Button
//                                     size="sm"
//                                     onClick={() => guardarCorreccion(fila.id)}
//                                     disabled={guardandoIds.has(fila.id)}
//                                   >
//                                     {guardandoIds.has(fila.id) ? "Guardando…" : "Guardar cambio"}
//                                   </Button>
//                                 )}
//                               </div>
//                             )
//                           })}
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//               </div>
//             )}

//             <DialogFooter>
//               <Button variant="outline" onClick={() => handleIntentoCerrar(false)}>
//                 Cerrar
//               </Button>
//               {!cargando && datos && faltanPorResolver === 0 && (
//                 <span className="text-sm text-emerald-700 self-center">✓ Todo resuelto</span>
//               )}
//             </DialogFooter>
//           </>
//         )}
//       </DialogContent>
//     </Dialog>
//   )
// }

// // ---------------------------------------------------------------------------
// // Un insumo PENDIENTE agrupado por descripción -- puede aparecer en
// // varios ítems a la vez (ej. "Herramienta menor" en 20 ítems). Se elige
// // el candidato UNA vez y se aplica a todas las apariciones -- ver
// // elegirCandidatoGrupo/marcarSolicitudGrupo en el padre.
// // ---------------------------------------------------------------------------

// function GrupoInsumoPendiente({
//   clave,
//   filasGrupo,
//   itemsPorId,
//   elecciones,
//   guardandoIds,
//   onElegirCandidato,
//   onMarcarSolicitud,
//   onGuardarGrupo,
// }: {
//   clave: string
//   filasGrupo: FilaRevisionImport[]
//   itemsPorId: Record<string, { codigo: string; descripcion: string }>
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirCandidato: (insumoId: string) => void
//   onMarcarSolicitud: () => void
//   onGuardarGrupo: () => void
// }) {
//   const primera = filasGrupo[0]
//   const eleccion = elecciones[primera.id] // todas las filas del grupo comparten la misma elección
//   const guardandoAlgo = filasGrupo.some((f) => guardandoIds.has(f.id))
//   const codigosItems = filasGrupo
//     .map((f) => itemsPorId[f.presupuestoItemId]?.codigo)
//     .filter(Boolean)
//     .join(", ")

//   return (
//     <div className={`border rounded-lg p-4 space-y-2 ${eleccion ? "border-primary/40 bg-primary/5" : ""}`}>
//       <div className="flex items-center gap-2">
//         {eleccion && <span className="text-primary">✓</span>}
//         <span className="font-medium">{primera.descripcionOriginal}</span>
//         <span className="text-xs text-muted-foreground">
//           {primera.cantidad} {primera.unidad}
//         </span>
//       </div>

//       <p className="text-xs text-muted-foreground">
//         {filasGrupo.length > 1
//           ? `Aparece en ${filasGrupo.length} ítems: ${codigosItems}`
//           : `Ítem: ${codigosItems}`}
//         {filasGrupo.length > 1 && " -- la elección de abajo se aplica a todos."}
//       </p>

//       {(primera.candidatos as CandidatoInsumo[])[0] &&
//         [0, 1].includes((primera.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
//           <p className="text-xs text-amber-600">
//             ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
//           </p>
//         )}

//       <TablaCandidatos
//         candidatos={primera.candidatos as CandidatoInsumo[]}
//         seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
//         onSeleccionar={onElegirCandidato}
//       />

//       <div className="flex items-center gap-2">
//         <button
//           type="button"
//           onClick={onMarcarSolicitud}
//           className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
//         >
//           No existe — crear solicitud de aprobación
//         </button>
//         {eleccion && (
//           <Button size="sm" onClick={onGuardarGrupo} disabled={guardandoAlgo}>
//             {guardandoAlgo ? "Guardando…" : filasGrupo.length > 1 ? `Guardar (${filasGrupo.length} ítems)` : "Guardar"}
//           </Button>
//         )}
//       </div>
//     </div>
//   )
// }

// // ---------------------------------------------------------------------------
// // Un grupo de líneas (pendientes o rechazadas) de UN ítem -- candidatos y
// // opción de solicitud. Compartido entre las secciones "Pendientes" y
// // "Rechazados" (mismo diseño, la única diferencia es si se muestra el
// // motivo del rechazo). Una fila cuenta como "seleccionada" (para el botón
// // "Guardar seleccionados" de arriba) en cuanto tiene una elección hecha --
// // no hay checkbox manual.
// // ---------------------------------------------------------------------------

// function FilaGrupoItem({
//   item,
//   filas,
//   elecciones,
//   guardandoIds,
//   onElegirCandidato,
//   onMarcarSolicitud,
//   onGuardarLinea,
//   mostrarMotivoRechazo,
// }: {
//   item: { codigo: string; descripcion: string } | undefined
//   filas: FilaRevisionImport[]
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirCandidato: (revisionId: string, insumoId: string) => void
//   onMarcarSolicitud: (revisionId: string) => void
//   onGuardarLinea: (revisionId: string) => void
//   mostrarMotivoRechazo?: boolean
// }) {
//   return (
//     <div className="space-y-2">
//       <p className="text-sm font-medium text-muted-foreground">
//         {item?.codigo} — {item?.descripcion}
//       </p>
//       {filas.map((fila) => {
//         const eleccion = elecciones[fila.id]
//         const guardando = guardandoIds.has(fila.id)
//         return (
//           <div
//             key={fila.id}
//             className={`border rounded-lg p-4 space-y-2 ml-2 ${
//               eleccion
//                 ? "border-primary/40 bg-primary/5"
//                 : mostrarMotivoRechazo
//                   ? "bg-red-50/40 border-red-200"
//                   : ""
//             }`}
//           >
//             <div className="flex items-center gap-2">
//               {eleccion && <span className="text-primary">✓</span>}
//               <span className="font-medium">{fila.descripcionOriginal}</span>
//               <span className="text-xs text-muted-foreground">
//                 {fila.cantidad} {fila.unidad}
//               </span>
//             </div>

//             {mostrarMotivoRechazo && (
//               <p className="text-xs text-red-700">
//                 <span className="font-medium">Motivo del rechazo:</span>{" "}
//                 {fila.motivoRechazo ?? "El admin no escribió un motivo."}
//               </p>
//             )}

//             {(fila.candidatos as CandidatoInsumo[])[0] &&
//               [0, 1].includes((fila.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
//                 <p className="text-xs text-amber-600">
//                   ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
//                 </p>
//               )}

//             <TablaCandidatos
//               candidatos={fila.candidatos as CandidatoInsumo[]}
//               seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
//               onSeleccionar={(insumoId) => onElegirCandidato(fila.id, insumoId)}
//             />

//             <div className="flex items-center gap-2">
//               <button
//                 type="button"
//                 onClick={() => onMarcarSolicitud(fila.id)}
//                 className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
//               >
//                 No existe — crear solicitud de aprobación
//               </button>
//               {eleccion && (
//                 <Button size="sm" onClick={() => onGuardarLinea(fila.id)} disabled={guardando}>
//                   {guardando ? "Guardando…" : "Guardar"}
//                 </Button>
//               )}
//             </div>
//           </div>
//         )
//       })}
//     </div>
//   )
// }

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

// import { useEffect, useMemo, useRef, useState } from "react"
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
// import { Button } from "@/components/ui/button"
// import {
//   listarRevisionPorItems,
//   resolverLineaRevision,
//   resolverLineasRevisionEnLote,
//   editarLineaAutoMatch,
//   editarLineaAutoMatchEquipo,
//   type LoteRevisionInfo,
// } from "@/app/(app)/presupuestos/actions"
// import type { FilaRevisionImport, CandidatoInsumo, CategoriaManoObra, CategoriaEquipo } from "@/lib/apu-import-types"

// // Estilo "tipo Excel" -- mismo tratamiento que ya usa el resto de la app
// // (presupuesto-table.tsx, admin-insumos/page.tsx): encabezado azul de
// // marca, celdas con borde.
// const headClasesCandidatos =
//   "border-r border-b bg-primary px-3 py-2 text-left text-xs font-medium text-primary-foreground last:border-r-0"
// const celdaCandidato = "border-r px-3 py-2 text-sm last:border-r-0"

// /**
//  * Tabla de candidatos de insumo (nombre/unidad/valor/% similitud) --
//  * reemplaza los botones tipo "pill" que había antes. Se usa en los 3
//  * lugares donde se elige un candidato: pendientes, rechazados, y la
//  * corrección de un automático.
//  */
// function TablaCandidatos({
//   candidatos,
//   seleccionado,
//   onSeleccionar,
// }: {
//   candidatos: CandidatoInsumo[]
//   seleccionado?: string | null
//   onSeleccionar: (insumoId: string) => void
// }) {
//   if (candidatos.length === 0) return null

//   return (
//     <div className="space-y-1">
//       <p className="text-xs text-muted-foreground">Las recomendaciones de insumo son:</p>
//       <div className="overflow-x-auto rounded-md border">
//         <table className="w-full border-separate border-spacing-0">
//           <thead>
//             <tr>
//               <th className={headClasesCandidatos}>Nombre</th>
//               <th className={`${headClasesCandidatos} w-20`}>Unidad</th>
//               <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
//               <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
//             </tr>
//           </thead>
//           <tbody>
//             {candidatos.map((c) => {
//               const sel = seleccionado === c.id
//               return (
//                 <tr
//                   key={c.id}
//                   onClick={() => onSeleccionar(c.id)}
//                   className={`cursor-pointer border-t ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`}
//                 >
//                   <td className={celdaCandidato}>
//                     {sel && <span className="mr-1 text-primary">✓</span>}
//                     {c.descripcion}
//                   </td>
//                   <td className={`${celdaCandidato} text-muted-foreground`}>{c.u_m ?? "—"}</td>
//                   <td className={`${celdaCandidato} text-right`}>
//                     ${(c.vr_unitario ?? 0).toLocaleString()}
//                   </td>
//                   <td className={`${celdaCandidato} text-right text-muted-foreground`}>
//                     {Math.round(c.similitud * 100)}%
//                   </td>
//                 </tr>
//               )
//             })}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   )
// }

// /**
//  * Tabla de CATEGORÍAS de mano de obra (categoría/grupo/$-hora/%
//  * similitud) -- distinta de TablaCandidatos porque son columnas
//  * distintas (grupo en vez de unidad, valor es $/hora no $/unidad).
//  * Categorías sin precio todavía (valor_unitario null) se ven pero no se
//  * pueden elegir -- mismo criterio que un insumo con precio placeholder.
//  */
// function TablaCategoriasManoObra({
//   categorias,
//   seleccionado,
//   onSeleccionar,
// }: {
//   categorias: CategoriaManoObra[]
//   seleccionado?: string | null
//   onSeleccionar: (categoriaId: string) => void
// }) {
//   if (categorias.length === 0) return null

//   return (
//     <div className="space-y-1">
//       <p className="text-xs text-muted-foreground">Las categorías de mano de obra recomendadas son:</p>
//       <div className="overflow-x-auto rounded-md border">
//         <table className="w-full border-separate border-spacing-0">
//           <thead>
//             <tr>
//               <th className={headClasesCandidatos}>Categoría</th>
//               <th className={`${headClasesCandidatos} w-28`}>Grupo</th>
//               <th className={`${headClasesCandidatos} w-20 text-center`}>Unidad</th>
//               <th className={`${headClasesCandidatos} w-28 text-right`}>Valor</th>
//               <th className={`${headClasesCandidatos} w-24 text-right`}>% Similitud</th>
//             </tr>
//           </thead>
//           <tbody>
//             {categorias.map((c) => {
//               const sel = seleccionado === c.id
//               const sinPrecio = c.valorUnitario == null
//               return (
//                 <tr
//                   key={c.id}
//                   onClick={() => !sinPrecio && onSeleccionar(c.id)}
//                   title={sinPrecio ? "Esta categoría todavía no tiene precio definido en el catálogo" : undefined}
//                   className={`border-t ${
//                     sinPrecio
//                       ? "cursor-not-allowed opacity-50"
//                       : `cursor-pointer ${sel ? "bg-primary/10" : "hover:bg-muted/40"}`
//                   }`}
//                 >
//                   <td className={celdaCandidato}>
//                     {sel && <span className="mr-1 text-primary">✓</span>}
//                     {c.categoria}
//                   </td>
//                   <td className={`${celdaCandidato} text-muted-foreground`}>{c.grupo ?? "—"}</td>
//                   <td className={`${celdaCandidato} text-center font-medium`}>{c.unidad}</td>
//                   <td className={`${celdaCandidato} text-right`}>
//                     {sinPrecio ? (
//                       <span className="text-amber-600">sin precio</span>
//                     ) : (
//                       `$${c.valorUnitario!.toLocaleString()}`
//                     )}
//                   </td>
//                   <td className={`${celdaCandidato} text-right text-muted-foreground`}>
//                     {Math.round(c.similitud * 100)}%
//                   </td>
//                 </tr>
//               )
//             })}
//           </tbody>
//         </table>
//       </div>
//     </div>
//   )
// }

// interface Props {
//   open: boolean
//   itemIds: string[]
//   onCerrar: () => void
//   // se llama cada vez que algo se resuelve (para que page.tsx pueda
//   // refrescar los colores de la tabla sin esperar a que se cierre todo
//   // el diálogo)
//   onCambio?: () => void
// }

// type Eleccion =
//   | { tipo: "maestro"; insumoId: string }
//   | { tipo: "solicitud" }
//   | { tipo: "mano_obra"; categoriaId: string }
//   | { tipo: "solicitud_mano_obra" }
//   | { tipo: "equipo"; equipoId: string }
//   | { tipo: "solicitud_equipo" }
//   | null

// export function RevisionApuDialog({ open, itemIds, onCerrar, onCambio }: Props) {
//   const [datos, setDatos] = useState<LoteRevisionInfo | null>(null)
//   const [cargando, setCargando] = useState(false)
//   const [error, setError] = useState<string | null>(null)
//   const [pidiendoConfirmacionCierre, setPidiendoConfirmacionCierre] = useState(false)
//   const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({})
//   const [correcciones, setCorrecciones] = useState<Record<string, string>>({}) // revisionId -> nuevoInsumoId
//   const [guardandoIds, setGuardandoIds] = useState<Set<string>>(new Set())

//   async function cargar() {
//     // Solo se muestra el "Cargando revisión…" de pantalla completa la
//     // PRIMERA vez (cuando todavía no hay nada que mostrar) -- las
//     // recargas posteriores (después de guardar algo) pasan calladas,
//     // sin tapar lo que ya está en pantalla. Antes esto no se distinguía,
//     // y guardarSeleccionados() -- que llamaba cargar() una vez POR CADA
//     // línea del lote -- hacía que el diálogo completo parpadeara entre
//     // "Cargando…" y el contenido, una vez por línea.
//     const esPrimeraCarga = datos === null
//     if (esPrimeraCarga) setCargando(true)
//     setError(null)
//     try {
//       const resultado = await listarRevisionPorItems(itemIds)
//       setDatos(resultado)

//       // Limpia elecciones/correcciones de líneas que YA NO EXISTEN en la
//       // recarga (porque se resolvieron) -- sin esto, después de guardar
//       // el diálogo seguía pensando "hay trabajo sin guardar" con ids
//       // viejos, y el aviso de "¿cerrar sin terminar?" decía "quedan 0
//       // insumos" (bug real: preguntaba igual aunque ya no quedara nada).
//       const idsVigentes = new Set(resultado.filas.map((f) => f.id))
//       setElecciones((prev) => {
//         const nuevo: typeof prev = {}
//         for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
//         return nuevo
//       })
//       setCorrecciones((prev) => {
//         const nuevo: typeof prev = {}
//         for (const [id, val] of Object.entries(prev)) if (idsVigentes.has(id)) nuevo[id] = val
//         return nuevo
//       })
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo cargar la revisión.")
//     } finally {
//       if (esPrimeraCarga) setCargando(false)
//     }
//   }

//   // Recuerda si el diálogo YA estaba abierto en el render anterior --
//   // así se puede distinguir "se acaba de abrir" (resetear todo) de
//   // "sigue abierto pero itemIds creció" (recargar SIN perder las
//   // elecciones que ya hizo el usuario -- ver el useEffect de abajo).
//   const yaEstabaAbierto = useRef(false)

//   useEffect(() => {
//     if (!open) {
//       yaEstabaAbierto.current = false
//       return
//     }
//     if (!yaEstabaAbierto.current) {
//       // Apertura nueva -- reset completo.
//       setElecciones({})
//       setCorrecciones({})
//       setDatos(null) // fuerza que la próxima cargar() cuente como "primera carga" otra vez
//       yaEstabaAbierto.current = true
//     }
//     // Si ya estaba abierto y esto corrió de nuevo, es porque `itemIds`
//     // cambió (llegaron ítems nuevos con pendientes de una tanda que
//     // terminó en el fondo) -- se recarga, pero SIN tocar elecciones ni
//     // correcciones, para no perder lo que el usuario ya había elegido.
//     cargar()
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [open, itemIds.join(",")])

//   const filas = datos?.filas ?? []
//   const pendientesTodo = useMemo(() => filas.filter((f) => f.estado === "pendiente"), [filas])
//   // Mano de obra se separa del resto -- no se agrupa por descripción
//   // (dos líneas "Cuadrilla AA-4" de ítems distintos tienen candidatos
//   // DISTINTOS, agruparlas por texto sería incorrecto -- ver
//   // matchearManoDeObraApuImport en actions.ts, es 1 búsqueda por ítem).
//   // Equipo SÍ se agrupa por descripción, igual que insumos -- ver
//   // matchearEquipoApuImport en actions.ts (matching por texto de línea).
//   const pendientes = useMemo(
//     () => pendientesTodo.filter((f) => f.tipo !== "MO" && f.tipo !== "EQUIPO"),
//     [pendientesTodo]
//   )
//   const pendientesManoObra = useMemo(() => pendientesTodo.filter((f) => f.tipo === "MO"), [pendientesTodo])
//   const pendientesEquipo = useMemo(() => pendientesTodo.filter((f) => f.tipo === "EQUIPO"), [pendientesTodo])
//   const rechazadosTodo = useMemo(() => filas.filter((f) => f.estado === "rechazado"), [filas])
//   const rechazados = useMemo(
//     () => rechazadosTodo.filter((f) => f.tipo !== "MO" && f.tipo !== "EQUIPO"),
//     [rechazadosTodo]
//   )
//   const rechazadosManoObra = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "MO"), [rechazadosTodo])
//   const rechazadosEquipo = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "EQUIPO"), [rechazadosTodo])
//   const autoMatchTodo = useMemo(() => filas.filter((f) => f.estado === "auto_match"), [filas])
//   // El auto-match SÍ aplica a equipo (a diferencia de mano de obra) --
//   // se separa para que la pestaña de Equipo tenga su propia sección de
//   // "Automáticos", en vez de que aparezcan mezclados en la de Insumos.
//   const autoMatch = useMemo(() => autoMatchTodo.filter((f) => f.tipo !== "EQUIPO"), [autoMatchTodo])
//   const autoMatchEquipo = useMemo(() => autoMatchTodo.filter((f) => f.tipo === "EQUIPO"), [autoMatchTodo])

//   // ---------- tabs: Insumos / Mano de obra / Equipo ----------
//   // Separados en pestañas porque son flujos de revisión distintos
//   // (candidatos del maestro vs. categorías de mano de obra vs. catálogo
//   // de equipo) -- antes vivían todos apilados en un solo scroll
//   // larguísimo. El auto-match nunca aplica a mano de obra (ver
//   // actions.ts / handoff), así que esa pestaña no tiene sección de
//   // "Automáticos" -- equipo sí, igual que insumos.
//   const [tabActiva, setTabActiva] = useState<"insumos" | "mano_obra" | "equipo">("insumos")
//   const totalPendientesInsumos = pendientes.length + rechazados.length + autoMatch.length
//   const totalPendientesManoObra = pendientesManoObra.length + rechazadosManoObra.length
//   const totalPendientesEquipo = pendientesEquipo.length + rechazadosEquipo.length + autoMatchEquipo.length
//   const sinNadaEnTabInsumos = totalPendientesInsumos === 0
//   const sinNadaEnTabManoObra = totalPendientesManoObra === 0
//   const sinNadaEnTabEquipo = totalPendientesEquipo === 0

//   function agruparPorItem(lista: FilaRevisionImport[]) {
//     const grupos = new Map<string, FilaRevisionImport[]>()
//     for (const fila of lista) {
//       const l = grupos.get(fila.presupuestoItemId) ?? []
//       l.push(fila)
//       grupos.set(fila.presupuestoItemId, l)
//     }
//     return grupos
//   }

//   // El MISMO insumo (misma descripción) suele aparecer en muchos ítems
//   // distintos (ej. "Herramienta menor" en 20 ítems) -- agrupar
//   // "Pendientes" por ítem obligaba a elegir el mismo candidato 20 veces.
//   // Se agrupa por descripción en su lugar: una tarjeta por insumo único,
//   // la elección se aplica a TODAS las apariciones de una. El servidor ya
//   // deduplica esto también del lado de "crear solicitud" (ver
//   // resolverLineasRevisionEnLote en actions.ts) -- no se crean N
//   // solicitudes idénticas.
//   function agruparPorDescripcion(lista: FilaRevisionImport[]) {
//     const grupos = new Map<string, FilaRevisionImport[]>()
//     for (const fila of lista) {
//       const clave = fila.descripcionOriginal.trim().toLowerCase()
//       const l = grupos.get(clave) ?? []
//       l.push(fila)
//       grupos.set(clave, l)
//     }
//     return grupos
//   }

//   const gruposPendientes = useMemo(() => agruparPorDescripcion(pendientes), [pendientes])
//   const rechazadosPorItem = useMemo(() => agruparPorItem(rechazados), [rechazados])
//   const autoMatchPorItem = useMemo(() => agruparPorItem(autoMatch), [autoMatch])
//   const gruposPendientesEquipo = useMemo(() => agruparPorDescripcion(pendientesEquipo), [pendientesEquipo])
//   const rechazadosEquipoPorItem = useMemo(() => agruparPorItem(rechazadosEquipo), [rechazadosEquipo])
//   const autoMatchEquipoPorItem = useMemo(() => agruparPorItem(autoMatchEquipo), [autoMatchEquipo])

//   function elegirCandidatoGrupo(filasGrupo: FilaRevisionImport[], insumoId: string) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "maestro", insumoId }
//       return nuevo
//     })
//   }
//   function marcarSolicitudGrupo(filasGrupo: FilaRevisionImport[]) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "solicitud" }
//       return nuevo
//     })
//   }
//   function elegirEquipoGrupo(filasGrupo: FilaRevisionImport[], equipoId: string) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "equipo", equipoId }
//       return nuevo
//     })
//   }
//   function marcarSolicitudEquipoGrupo(filasGrupo: FilaRevisionImport[]) {
//     setElecciones((prev) => {
//       const nuevo = { ...prev }
//       for (const f of filasGrupo) nuevo[f.id] = { tipo: "solicitud_equipo" }
//       return nuevo
//     })
//   }
//   // Rechazados NO se agrupan por descripción -- cada uno puede tener un
//   // motivo distinto, y ya no deberían duplicarse hacia adelante (la
//   // deduplicación de solicitudes evita que se repita el mismo rechazo
//   // muchas veces).
//   function elegirCandidato(revisionId: string, insumoId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "maestro", insumoId } }))
//   }
//   function marcarSolicitud(revisionId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud" } }))
//   }
//   function elegirCategoriaManoObra(revisionId: string, categoriaId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "mano_obra", categoriaId } }))
//   }
//   function marcarSolicitudManoObra(revisionId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud_mano_obra" } }))
//   }
//   function elegirEquipo(revisionId: string, equipoId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "equipo", equipoId } }))
//   }
//   function marcarSolicitudEquipo(revisionId: string) {
//     setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud_equipo" } }))
//   }
//   function corregirAutoMatch(revisionId: string, nuevoInsumoId: string) {
//     setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoInsumoId }))
//   }
//   // Reusa el mismo mapa `correcciones` (revisionId -> nuevo id) que
//   // insumos -- revisionId ya es único entre TODAS las filas, sin
//   // importar el tipo, así que no hace falta un estado aparte. Lo que
//   // cambia es guardarCorreccion (abajo), que decide a cuál server action
//   // llamar según fila.tipo.
//   function corregirAutoMatchEquipo(revisionId: string, nuevoEquipoId: string) {
//     setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoEquipoId }))
//   }

//   // ---------- "seleccionados" (rechazados) -- YA NO es un checkbox manual:
//   // una línea queda "seleccionada" automáticamente en cuanto el usuario le
//   // elige un candidato o la marca como solicitud (ver elegirCandidato /
//   // marcarSolicitud arriba). "Guardar seleccionados" guarda todas las que
//   // ya tengan una elección hecha, de una sola vez.
//   const idsRechazadosConEleccion = useMemo(
//     () => rechazados.filter((f) => elecciones[f.id]).map((f) => f.id),
//     [rechazados, elecciones]
//   )

//   // ---------- "seleccionados" (grupos de pendientes, por descripción) --
//   // mismo criterio: un grupo cuenta como "seleccionado" en cuanto tiene
//   // una elección hecha (se comparte entre todas las filas del grupo).
//   const clavesGruposConEleccion = useMemo(
//     () => Array.from(gruposPendientes.entries())
//       .filter(([, filasGrupo]) => elecciones[filasGrupo[0].id])
//       .map(([clave]) => clave),
//     [gruposPendientes, elecciones]
//   )

//   // ---------- mismo criterio, para Equipo ----------
//   const idsRechazadosEquipoConEleccion = useMemo(
//     () => rechazadosEquipo.filter((f) => elecciones[f.id]).map((f) => f.id),
//     [rechazadosEquipo, elecciones]
//   )
//   const clavesGruposEquipoConEleccion = useMemo(
//     () => Array.from(gruposPendientesEquipo.entries())
//       .filter(([, filasGrupo]) => elecciones[filasGrupo[0].id])
//       .map(([clave]) => clave),
//     [gruposPendientesEquipo, elecciones]
//   )

//   // Guardar UNA línea de una vez (en vez de esperar a un botón "guardar
//   // todo" al final) -- así el ingeniero ve el progreso inmediato, y
//   // puede cerrar en cualquier momento sin perder lo que ya resolvió acá.
//   async function guardarLinea(revisionId: string) {
//     const eleccion = elecciones[revisionId]
//     if (!eleccion) return
//     setGuardandoIds((prev) => new Set(prev).add(revisionId))
//     setError(null)
//     try {
//       if (eleccion.tipo === "maestro") {
//         await resolverLineaRevision({ revisionId, accion: "maestro", insumoId: eleccion.insumoId })
//       } else if (eleccion.tipo === "mano_obra") {
//         await resolverLineaRevision({ revisionId, accion: "mano_obra", manoObraCategoriaId: eleccion.categoriaId })
//       } else if (eleccion.tipo === "solicitud_mano_obra") {
//         await resolverLineaRevision({ revisionId, accion: "solicitud_mano_obra" })
//       } else if (eleccion.tipo === "equipo") {
//         await resolverLineaRevision({ revisionId, accion: "equipo", equipoCategoriaId: eleccion.equipoId })
//       } else if (eleccion.tipo === "solicitud_equipo") {
//         await resolverLineaRevision({ revisionId, accion: "solicitud_equipo" })
//       } else {
//         await resolverLineaRevision({ revisionId, accion: "solicitud" })
//       }
//       await cargar()
//       onCambio?.()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo guardar esa línea.")
//     } finally {
//       setGuardandoIds((prev) => {
//         const copia = new Set(prev)
//         copia.delete(revisionId)
//         return copia
//       })
//     }
//   }

//   // Guarda un conjunto explícito de revisionIds de una sola vez -- usada
//   // tanto por "guardar seleccionados" (rechazados) como por "guardar
//   // grupos seleccionados" (pendientes), y también al guardar UN grupo
//   // entero de un insumo repetido con un solo click.
//   async function guardarIds(ids: string[]) {
//     if (ids.length === 0) return
//     setError(null)
//     setGuardandoIds((prev) => {
//       const copia = new Set(prev)
//       ids.forEach((id) => copia.add(id))
//       return copia
//     })

//     try {
//       const resoluciones = ids
//         .map((id) => {
//           const eleccion = elecciones[id]
//           if (!eleccion) return null
//           if (eleccion.tipo === "maestro") {
//             return { revisionId: id, accion: "maestro" as const, insumoId: eleccion.insumoId }
//           }
//           if (eleccion.tipo === "mano_obra") {
//             return { revisionId: id, accion: "mano_obra" as const, manoObraCategoriaId: eleccion.categoriaId }
//           }
//           if (eleccion.tipo === "solicitud_mano_obra") {
//             return { revisionId: id, accion: "solicitud_mano_obra" as const }
//           }
//           if (eleccion.tipo === "equipo") {
//             return { revisionId: id, accion: "equipo" as const, equipoCategoriaId: eleccion.equipoId }
//           }
//           if (eleccion.tipo === "solicitud_equipo") {
//             return { revisionId: id, accion: "solicitud_equipo" as const }
//           }
//           return { revisionId: id, accion: "solicitud" as const }
//         })
//         .filter((r): r is NonNullable<typeof r> => r !== null)

//       const { errores } = await resolverLineasRevisionEnLote(resoluciones)
//       if (errores.length > 0) setError(errores.map((e) => e.mensaje).join(" · "))
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudieron guardar los seleccionados.")
//     }

//     setGuardandoIds((prev) => {
//       const copia = new Set(prev)
//       ids.forEach((id) => copia.delete(id))
//       return copia
//     })

//     await cargar()
//     onCambio?.()
//   }

//   async function guardarSeleccionados() {
//     await guardarIds(idsRechazadosConEleccion)
//   }

//   async function guardarGruposSeleccionados() {
//     const ids = clavesGruposConEleccion.flatMap((clave) => gruposPendientes.get(clave) ?? []).map((f) => f.id)
//     await guardarIds(ids)
//   }

//   async function guardarSeleccionadosEquipo() {
//     await guardarIds(idsRechazadosEquipoConEleccion)
//   }

//   async function guardarGruposSeleccionadosEquipo() {
//     const ids = clavesGruposEquipoConEleccion
//       .flatMap((clave) => gruposPendientesEquipo.get(clave) ?? [])
//       .map((f) => f.id)
//     await guardarIds(ids)
//   }

//   // guardarGrupo (abajo) ya sirve para grupos de equipo también -- es
//   // puramente mecánico (junta los ids con elección y llama guardarIds,
//   // que ya sabe rutear "equipo"/"solicitud_equipo" según el tipo de la
//   // elección), no hace falta duplicarlo.
//   async function guardarGrupo(filasGrupo: FilaRevisionImport[]) {
//     const ids = filasGrupo.filter((f) => elecciones[f.id]).map((f) => f.id)
//     await guardarIds(ids)
//   }

//   async function guardarCorreccion(revisionId: string) {
//     const nuevoInsumoId = correcciones[revisionId]
//     if (!nuevoInsumoId) return
//     setGuardandoIds((prev) => new Set(prev).add(revisionId))
//     setError(null)
//     try {
//       await editarLineaAutoMatch({ revisionId, nuevoInsumoId })
//       await cargar()
//       onCambio?.()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
//     } finally {
//       setGuardandoIds((prev) => {
//         const copia = new Set(prev)
//         copia.delete(revisionId)
//         return copia
//       })
//     }
//   }

//   async function guardarCorreccionEquipo(revisionId: string) {
//     const nuevoEquipoId = correcciones[revisionId]
//     if (!nuevoEquipoId) return
//     setGuardandoIds((prev) => new Set(prev).add(revisionId))
//     setError(null)
//     try {
//       await editarLineaAutoMatchEquipo({ revisionId, nuevoEquipoId })
//       await cargar()
//       onCambio?.()
//     } catch (e) {
//       setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
//     } finally {
//       setGuardandoIds((prev) => {
//         const copia = new Set(prev)
//         copia.delete(revisionId)
//         return copia
//       })
//     }
//   }

//   const hayTrabajoSinGuardar = Object.keys(elecciones).length > 0 || Object.keys(correcciones).length > 0
//   const faltanPorResolver =
//     pendientes.length +
//     pendientesManoObra.length +
//     pendientesEquipo.length +
//     rechazados.length +
//     rechazadosManoObra.length +
//     rechazadosEquipo.length

//   function handleIntentoCerrar(siguienteEstado: boolean) {
//     if (siguienteEstado) return
//     if (faltanPorResolver === 0 && !hayTrabajoSinGuardar) {
//       onCerrar()
//       return
//     }
//     setPidiendoConfirmacionCierre(true)
//   }

//   return (
//     <Dialog open={open} onOpenChange={handleIntentoCerrar}>
//       <DialogContent
//         className="max-w-7xl w-[95vw] max-h-[92vh] overflow-y-auto"
//         style={{ maxWidth: "1500px", width: "95vw" }}
//       >
//         {pidiendoConfirmacionCierre ? (
//           <div className="space-y-4 p-2">
//             <DialogHeader>
//               <DialogTitle>¿Cerrar sin terminar?</DialogTitle>
//             </DialogHeader>
//             <p className="text-sm text-muted-foreground">
//               Todavía quedan {faltanPorResolver} línea(s) sin resolver
//               {hayTrabajoSinGuardar ? " (algunos ya elegidos pero sin guardar)" : ""}. Puedes cerrar y
//               terminar después -- esos ítems se van a seguir viendo en amarillo o rojo en la tabla del
//               presupuesto hasta que los resuelvas, y puedes volver a abrir esta revisión cuando quieras
//               desde ahí.
//             </p>
//             <DialogFooter>
//               <Button variant="outline" onClick={() => setPidiendoConfirmacionCierre(false)}>
//                 Seguir revisando
//               </Button>
//               <Button
//                 variant="destructive"
//                 onClick={() => {
//                   setPidiendoConfirmacionCierre(false)
//                   onCerrar()
//                 }}
//               >
//                 Cerrar y terminar después
//               </Button>
//             </DialogFooter>
//           </div>
//         ) : (
//           <>
//             <DialogHeader>
//               <DialogTitle>Revisión de APU</DialogTitle>
//             </DialogHeader>

//             {cargando && (
//               <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4">
//                 <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
//                 Cargando revisión…
//               </div>
//             )}
//             {error && <p className="text-sm text-destructive">{error}</p>}

//             {!cargando && datos && (
//               <div className="space-y-6">
//                 <div className="flex gap-1 border-b">
//                   <button
//                     type="button"
//                     onClick={() => setTabActiva("insumos")}
//                     className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
//                       tabActiva === "insumos"
//                         ? "border-primary text-primary"
//                         : "border-transparent text-muted-foreground hover:text-foreground"
//                     }`}
//                   >
//                     Insumos
//                     {totalPendientesInsumos > 0 && (
//                       <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
//                         {totalPendientesInsumos}
//                       </span>
//                     )}
//                   </button>
//                   <button
//                     type="button"
//                     onClick={() => setTabActiva("mano_obra")}
//                     className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
//                       tabActiva === "mano_obra"
//                         ? "border-primary text-primary"
//                         : "border-transparent text-muted-foreground hover:text-foreground"
//                     }`}
//                   >
//                     Mano de obra
//                     {totalPendientesManoObra > 0 && (
//                       <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
//                         {totalPendientesManoObra}
//                       </span>
//                     )}
//                   </button>
//                   <button
//                     type="button"
//                     onClick={() => setTabActiva("equipo")}
//                     className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
//                       tabActiva === "equipo"
//                         ? "border-primary text-primary"
//                         : "border-transparent text-muted-foreground hover:text-foreground"
//                     }`}
//                   >
//                     Equipo
//                     {totalPendientesEquipo > 0 && (
//                       <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
//                         {totalPendientesEquipo}
//                       </span>
//                     )}
//                   </button>
//                 </div>

//                 {tabActiva === "insumos" && sinNadaEnTabInsumos && (
//                   <p className="text-sm text-muted-foreground">No hay nada que revisar en Insumos.</p>
//                 )}
//                 {tabActiva === "mano_obra" && sinNadaEnTabManoObra && (
//                   <p className="text-sm text-muted-foreground">No hay nada que revisar en Mano de obra.</p>
//                 )}
//                 {tabActiva === "equipo" && sinNadaEnTabEquipo && (
//                   <p className="text-sm text-muted-foreground">No hay nada que revisar en Equipo.</p>
//                 )}


//                 {tabActiva === "insumos" && pendientes.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

//                     {gruposPendientes.size > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {clavesGruposConEleccion.length} de {gruposPendientes.size} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={clavesGruposConEleccion.length === 0}
//                           onClick={guardarGruposSeleccionados}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(gruposPendientes.entries()).map(([clave, filasGrupo]) => (
//                       <GrupoInsumoPendiente
//                         key={clave}
//                         clave={clave}
//                         filasGrupo={filasGrupo}
//                         itemsPorId={datos.itemsPorId}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirCandidato={(insumoId) => elegirCandidatoGrupo(filasGrupo, insumoId)}
//                         onMarcarSolicitud={() => marcarSolicitudGrupo(filasGrupo)}
//                         onGuardarGrupo={() => guardarGrupo(filasGrupo)}
//                       />
//                     ))}
//                   </section>
//                 )}

//                 {tabActiva === "mano_obra" && pendientesManoObra.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Mano de obra -- confirma la categoría</h3>
//                     <p className="text-xs text-muted-foreground">
//                       Nunca se asigna sola -- elige la categoría de actividad más parecida para cada
//                       ítem.
//                     </p>
//                     {pendientesManoObra.map((fila) => {
//                       const item = datos.itemsPorId[fila.presupuestoItemId]
//                       const eleccion = elecciones[fila.id]
//                       const guardando = guardandoIds.has(fila.id)
//                       return (
//                         <div key={fila.id} className="border rounded-lg p-4 space-y-2">
//                           <div>
//                             <p className="text-sm font-medium text-muted-foreground">
//                               {item?.codigo} — {item?.descripcion}
//                             </p>
//                             <p className="text-xs italic text-muted-foreground/70">
//                               Está en el presupuesto como: {fila.descripcionOriginal}
//                             </p>
//                           </div>
//                           <TablaCategoriasManoObra
//                             categorias={fila.candidatos as CategoriaManoObra[]}
//                             seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
//                             onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
//                           />
//                           <div className="flex items-center gap-2">
//                             <button
//                               type="button"
//                               onClick={() => marcarSolicitudManoObra(fila.id)}
//                               className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
//                             >
//                               Ninguna calza — solicitar categoría nueva
//                             </button>
//                             {eleccion && (
//                               <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
//                                 {guardando ? "Guardando…" : "Guardar"}
//                               </Button>
//                             )}
//                           </div>
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//                 {tabActiva === "insumos" && rechazados.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold text-red-700">
//                       Rechazados por admin -- necesitan otra opción
//                     </h3>

//                     {rechazados.length > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {idsRechazadosConEleccion.length} de {rechazados.length} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={idsRechazadosConEleccion.length === 0}
//                           onClick={guardarSeleccionados}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(rechazadosPorItem.entries()).map(([itemId, filasItem]) => (
//                       <FilaGrupoItem
//                         key={itemId}
//                         item={datos.itemsPorId[itemId]}
//                         filas={filasItem}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirCandidato={elegirCandidato}
//                         onMarcarSolicitud={marcarSolicitud}
//                         onGuardarLinea={guardarLinea}
//                         mostrarMotivoRechazo
//                       />
//                     ))}
//                   </section>
//                 )}


//                 {tabActiva === "mano_obra" && rechazadosManoObra.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold text-red-700">
//                       Mano de obra rechazada por admin -- elige otra categoría
//                     </h3>
//                     {rechazadosManoObra.map((fila) => {
//                       const item = datos.itemsPorId[fila.presupuestoItemId]
//                       const eleccion = elecciones[fila.id]
//                       const guardando = guardandoIds.has(fila.id)
//                       return (
//                         <div key={fila.id} className="border rounded-lg p-4 space-y-2 bg-red-50/40 border-red-200">
//                           <div>
//                             <p className="text-sm font-medium text-muted-foreground">
//                               {item?.codigo} — {item?.descripcion}
//                             </p>
//                             <p className="text-xs italic text-muted-foreground/70">
//                               Está en el presupuesto como: {fila.descripcionOriginal}
//                             </p>
//                           </div>
//                           {fila.motivoRechazo && (
//                             <p className="text-xs text-red-700">
//                               <span className="font-medium">Motivo del rechazo:</span> {fila.motivoRechazo}
//                             </p>
//                           )}
//                           <TablaCategoriasManoObra
//                             categorias={fila.candidatos as CategoriaManoObra[]}
//                             seleccionado={eleccion?.tipo === "mano_obra" ? eleccion.categoriaId : undefined}
//                             onSeleccionar={(categoriaId) => elegirCategoriaManoObra(fila.id, categoriaId)}
//                           />
//                           <div className="flex items-center gap-2">
//                             <button
//                               type="button"
//                               onClick={() => marcarSolicitudManoObra(fila.id)}
//                               className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_mano_obra" ? "border-primary bg-primary/10" : "border-muted"}`}
//                             >
//                               Ninguna calza — solicitar categoría nueva otra vez
//                             </button>
//                             {eleccion && (
//                               <Button size="sm" onClick={() => guardarLinea(fila.id)} disabled={guardando}>
//                                 {guardando ? "Guardando…" : "Guardar"}
//                               </Button>
//                             )}
//                           </div>
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//                 {tabActiva === "insumos" && autoMatch.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Automáticos -- confirma que estén bien</h3>
//                     {Array.from(autoMatchPorItem.entries()).map(([itemId, filasItem]) => {
//                       const item = datos.itemsPorId[itemId]
//                       return (
//                         <div key={itemId} className="space-y-2">
//                           <p className="text-sm font-medium text-muted-foreground">
//                             {item?.codigo} — {item?.descripcion}
//                           </p>
//                           {filasItem.map((fila) => {
//                             const tieneCorreccionSinGuardar = !!correcciones[fila.id]
//                             return (
//                               <div key={fila.id} className="border rounded-lg p-4 space-y-2 ml-2 bg-emerald-50/40">
//                                 <div className="flex items-center justify-between">
//                                   <span className="font-medium">{fila.descripcionOriginal}</span>
//                                   <span className="text-xs text-emerald-700">✓ auto-match</span>
//                                 </div>
//                                 <TablaCandidatos
//                                   candidatos={fila.candidatos as CandidatoInsumo[]}
//                                   seleccionado={correcciones[fila.id] ?? fila.insumoIdAsignado}
//                                   onSeleccionar={(insumoId) => corregirAutoMatch(fila.id, insumoId)}
//                                 />
//                                 {tieneCorreccionSinGuardar && (
//                                   <Button
//                                     size="sm"
//                                     onClick={() => guardarCorreccion(fila.id)}
//                                     disabled={guardandoIds.has(fila.id)}
//                                   >
//                                     {guardandoIds.has(fila.id) ? "Guardando…" : "Guardar cambio"}
//                                   </Button>
//                                 )}
//                               </div>
//                             )
//                           })}
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//                 {tabActiva === "equipo" && pendientesEquipo.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

//                     {gruposPendientesEquipo.size > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {clavesGruposEquipoConEleccion.length} de {gruposPendientesEquipo.size} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={clavesGruposEquipoConEleccion.length === 0}
//                           onClick={guardarGruposSeleccionadosEquipo}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(gruposPendientesEquipo.entries()).map(([clave, filasGrupo]) => (
//                       <GrupoEquipoPendiente
//                         key={clave}
//                         clave={clave}
//                         filasGrupo={filasGrupo}
//                         itemsPorId={datos.itemsPorId}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirEquipo={(equipoId) => elegirEquipoGrupo(filasGrupo, equipoId)}
//                         onMarcarSolicitud={() => marcarSolicitudEquipoGrupo(filasGrupo)}
//                         onGuardarGrupo={() => guardarGrupo(filasGrupo)}
//                       />
//                     ))}
//                   </section>
//                 )}

//                 {tabActiva === "equipo" && rechazadosEquipo.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold text-red-700">
//                       Rechazados por admin -- necesitan otra opción
//                     </h3>

//                     {rechazadosEquipo.length > 1 && (
//                       <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
//                         <span className="text-sm text-muted-foreground mr-auto">
//                           {idsRechazadosEquipoConEleccion.length} de {rechazadosEquipo.length} con una elección hecha
//                         </span>
//                         <Button
//                           size="sm"
//                           disabled={idsRechazadosEquipoConEleccion.length === 0}
//                           onClick={guardarSeleccionadosEquipo}
//                         >
//                           Guardar seleccionados
//                         </Button>
//                       </div>
//                     )}

//                     {Array.from(rechazadosEquipoPorItem.entries()).map(([itemId, filasItem]) => (
//                       <FilaGrupoItemEquipo
//                         key={itemId}
//                         item={datos.itemsPorId[itemId]}
//                         filas={filasItem}
//                         elecciones={elecciones}
//                         guardandoIds={guardandoIds}
//                         onElegirEquipo={elegirEquipo}
//                         onMarcarSolicitud={marcarSolicitudEquipo}
//                         onGuardarLinea={guardarLinea}
//                         mostrarMotivoRechazo
//                       />
//                     ))}
//                   </section>
//                 )}

//                 {tabActiva === "equipo" && autoMatchEquipo.length > 0 && (
//                   <section className="space-y-3">
//                     <h3 className="text-sm font-semibold">Automáticos -- confirma que estén bien</h3>
//                     {Array.from(autoMatchEquipoPorItem.entries()).map(([itemId, filasItem]) => {
//                       const item = datos.itemsPorId[itemId]
//                       return (
//                         <div key={itemId} className="space-y-2">
//                           <p className="text-sm font-medium text-muted-foreground">
//                             {item?.codigo} — {item?.descripcion}
//                           </p>
//                           {filasItem.map((fila) => {
//                             const tieneCorreccionSinGuardar = !!correcciones[fila.id]
//                             return (
//                               <div key={fila.id} className="border rounded-lg p-4 space-y-2 ml-2 bg-emerald-50/40">
//                                 <div className="flex items-center justify-between">
//                                   <span className="font-medium">{fila.descripcionOriginal}</span>
//                                   <span className="text-xs text-emerald-700">✓ auto-match</span>
//                                 </div>
//                                 <TablaCategoriasManoObra
//                                   categorias={fila.candidatos as CategoriaEquipo[]}
//                                   seleccionado={correcciones[fila.id] ?? fila.equipoCategoriaIdAsignado}
//                                   onSeleccionar={(equipoId) => corregirAutoMatchEquipo(fila.id, equipoId)}
//                                 />
//                                 {tieneCorreccionSinGuardar && (
//                                   <Button
//                                     size="sm"
//                                     onClick={() => guardarCorreccionEquipo(fila.id)}
//                                     disabled={guardandoIds.has(fila.id)}
//                                   >
//                                     {guardandoIds.has(fila.id) ? "Guardando…" : "Guardar cambio"}
//                                   </Button>
//                                 )}
//                               </div>
//                             )
//                           })}
//                         </div>
//                       )
//                     })}
//                   </section>
//                 )}

//               </div>
//             )}

//             <DialogFooter>
//               <Button variant="outline" onClick={() => handleIntentoCerrar(false)}>
//                 Cerrar
//               </Button>
//               {!cargando && datos && faltanPorResolver === 0 && (
//                 <span className="text-sm text-emerald-700 self-center">✓ Todo resuelto</span>
//               )}
//             </DialogFooter>
//           </>
//         )}
//       </DialogContent>
//     </Dialog>
//   )
// }

// // ---------------------------------------------------------------------------
// // Un insumo PENDIENTE agrupado por descripción -- puede aparecer en
// // varios ítems a la vez (ej. "Herramienta menor" en 20 ítems). Se elige
// // el candidato UNA vez y se aplica a todas las apariciones -- ver
// // elegirCandidatoGrupo/marcarSolicitudGrupo en el padre.
// // ---------------------------------------------------------------------------

// function GrupoInsumoPendiente({
//   clave,
//   filasGrupo,
//   itemsPorId,
//   elecciones,
//   guardandoIds,
//   onElegirCandidato,
//   onMarcarSolicitud,
//   onGuardarGrupo,
// }: {
//   clave: string
//   filasGrupo: FilaRevisionImport[]
//   itemsPorId: Record<string, { codigo: string; descripcion: string }>
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirCandidato: (insumoId: string) => void
//   onMarcarSolicitud: () => void
//   onGuardarGrupo: () => void
// }) {
//   const primera = filasGrupo[0]
//   const eleccion = elecciones[primera.id] // todas las filas del grupo comparten la misma elección
//   const guardandoAlgo = filasGrupo.some((f) => guardandoIds.has(f.id))
//   const codigosItems = filasGrupo
//     .map((f) => itemsPorId[f.presupuestoItemId]?.codigo)
//     .filter(Boolean)
//     .join(", ")

//   return (
//     <div className={`border rounded-lg p-4 space-y-2 ${eleccion ? "border-primary/40 bg-primary/5" : ""}`}>
//       <div className="flex items-center gap-2">
//         {eleccion && <span className="text-primary">✓</span>}
//         <span className="font-medium">{primera.descripcionOriginal}</span>
//         <span className="text-xs text-muted-foreground">
//           {primera.cantidad} {primera.unidad}
//         </span>
//       </div>

//       <p className="text-xs text-muted-foreground">
//         {filasGrupo.length > 1
//           ? `Aparece en ${filasGrupo.length} ítems: ${codigosItems}`
//           : `Ítem: ${codigosItems}`}
//         {filasGrupo.length > 1 && " -- la elección de abajo se aplica a todos."}
//       </p>

//       {(primera.candidatos as CandidatoInsumo[])[0] &&
//         [0, 1].includes((primera.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
//           <p className="text-xs text-amber-600">
//             ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
//           </p>
//         )}

//       <TablaCandidatos
//         candidatos={primera.candidatos as CandidatoInsumo[]}
//         seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
//         onSeleccionar={onElegirCandidato}
//       />

//       <div className="flex items-center gap-2">
//         <button
//           type="button"
//           onClick={onMarcarSolicitud}
//           className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
//         >
//           No existe — crear solicitud de aprobación
//         </button>
//         {eleccion && (
//           <Button size="sm" onClick={onGuardarGrupo} disabled={guardandoAlgo}>
//             {guardandoAlgo ? "Guardando…" : filasGrupo.length > 1 ? `Guardar (${filasGrupo.length} ítems)` : "Guardar"}
//           </Button>
//         )}
//       </div>
//     </div>
//   )
// }

// // ---------------------------------------------------------------------------
// // Un grupo de líneas (pendientes o rechazadas) de UN ítem -- candidatos y
// // opción de solicitud. Compartido entre las secciones "Pendientes" y
// // "Rechazados" (mismo diseño, la única diferencia es si se muestra el
// // motivo del rechazo). Una fila cuenta como "seleccionada" (para el botón
// // "Guardar seleccionados" de arriba) en cuanto tiene una elección hecha --
// // no hay checkbox manual.
// // ---------------------------------------------------------------------------

// function FilaGrupoItem({
//   item,
//   filas,
//   elecciones,
//   guardandoIds,
//   onElegirCandidato,
//   onMarcarSolicitud,
//   onGuardarLinea,
//   mostrarMotivoRechazo,
// }: {
//   item: { codigo: string; descripcion: string } | undefined
//   filas: FilaRevisionImport[]
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirCandidato: (revisionId: string, insumoId: string) => void
//   onMarcarSolicitud: (revisionId: string) => void
//   onGuardarLinea: (revisionId: string) => void
//   mostrarMotivoRechazo?: boolean
// }) {
//   return (
//     <div className="space-y-2">
//       <p className="text-sm font-medium text-muted-foreground">
//         {item?.codigo} — {item?.descripcion}
//       </p>
//       {filas.map((fila) => {
//         const eleccion = elecciones[fila.id]
//         const guardando = guardandoIds.has(fila.id)
//         return (
//           <div
//             key={fila.id}
//             className={`border rounded-lg p-4 space-y-2 ml-2 ${
//               eleccion
//                 ? "border-primary/40 bg-primary/5"
//                 : mostrarMotivoRechazo
//                   ? "bg-red-50/40 border-red-200"
//                   : ""
//             }`}
//           >
//             <div className="flex items-center gap-2">
//               {eleccion && <span className="text-primary">✓</span>}
//               <span className="font-medium">{fila.descripcionOriginal}</span>
//               <span className="text-xs text-muted-foreground">
//                 {fila.cantidad} {fila.unidad}
//               </span>
//             </div>

//             {mostrarMotivoRechazo && (
//               <p className="text-xs text-red-700">
//                 <span className="font-medium">Motivo del rechazo:</span>{" "}
//                 {fila.motivoRechazo ?? "El admin no escribió un motivo."}
//               </p>
//             )}

//             {(fila.candidatos as CandidatoInsumo[])[0] &&
//               [0, 1].includes((fila.candidatos as CandidatoInsumo[])[0].vr_unitario ?? -1) && (
//                 <p className="text-xs text-amber-600">
//                   ⚠ El candidato mejor puntuado tiene un precio placeholder -- verifica el precio real.
//                 </p>
//               )}

//             <TablaCandidatos
//               candidatos={fila.candidatos as CandidatoInsumo[]}
//               seleccionado={eleccion?.tipo === "maestro" ? eleccion.insumoId : undefined}
//               onSeleccionar={(insumoId) => onElegirCandidato(fila.id, insumoId)}
//             />

//             <div className="flex items-center gap-2">
//               <button
//                 type="button"
//                 onClick={() => onMarcarSolicitud(fila.id)}
//                 className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud" ? "border-primary bg-primary/10" : "border-muted"}`}
//               >
//                 No existe — crear solicitud de aprobación
//               </button>
//               {eleccion && (
//                 <Button size="sm" onClick={() => onGuardarLinea(fila.id)} disabled={guardando}>
//                   {guardando ? "Guardando…" : "Guardar"}
//                 </Button>
//               )}
//             </div>
//           </div>
//         )
//       })}
//     </div>
//   )
// }

// // ---------------------------------------------------------------------------
// // Equivalentes de GrupoInsumoPendiente / FilaGrupoItem, para Equipo --
// // misma agrupación por descripción (el mismo equipo puede aparecer en
// // muchos ítems, igual que insumos), pero usan TablaCategoriasManoObra en
// // vez de TablaCandidatos porque CategoriaEquipo trae grupo/unidad propia
// // (mismo shape que CategoriaManoObra, no el de un insumo del maestro).
// // ---------------------------------------------------------------------------

// function GrupoEquipoPendiente({
//   clave,
//   filasGrupo,
//   itemsPorId,
//   elecciones,
//   guardandoIds,
//   onElegirEquipo,
//   onMarcarSolicitud,
//   onGuardarGrupo,
// }: {
//   clave: string
//   filasGrupo: FilaRevisionImport[]
//   itemsPorId: Record<string, { codigo: string; descripcion: string }>
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirEquipo: (equipoId: string) => void
//   onMarcarSolicitud: () => void
//   onGuardarGrupo: () => void
// }) {
//   const primera = filasGrupo[0]
//   const eleccion = elecciones[primera.id]
//   const guardandoAlgo = filasGrupo.some((f) => guardandoIds.has(f.id))
//   const codigosItems = filasGrupo
//     .map((f) => itemsPorId[f.presupuestoItemId]?.codigo)
//     .filter(Boolean)
//     .join(", ")

//   return (
//     <div className={`border rounded-lg p-4 space-y-2 ${eleccion ? "border-primary/40 bg-primary/5" : ""}`}>
//       <div className="flex items-center gap-2">
//         {eleccion && <span className="text-primary">✓</span>}
//         <span className="font-medium">{primera.descripcionOriginal}</span>
//         <span className="text-xs text-muted-foreground">
//           {primera.cantidad} {primera.unidad}
//         </span>
//       </div>

//       <p className="text-xs text-muted-foreground">
//         {filasGrupo.length > 1
//           ? `Aparece en ${filasGrupo.length} ítems: ${codigosItems}`
//           : `Ítem: ${codigosItems}`}
//         {filasGrupo.length > 1 && " -- la elección de abajo se aplica a todos."}
//       </p>

//       <TablaCategoriasManoObra
//         categorias={primera.candidatos as CategoriaEquipo[]}
//         seleccionado={eleccion?.tipo === "equipo" ? eleccion.equipoId : undefined}
//         onSeleccionar={onElegirEquipo}
//       />

//       <div className="flex items-center gap-2">
//         <button
//           type="button"
//           onClick={onMarcarSolicitud}
//           className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_equipo" ? "border-primary bg-primary/10" : "border-muted"}`}
//         >
//           No existe — crear solicitud de aprobación
//         </button>
//         {eleccion && (
//           <Button size="sm" onClick={onGuardarGrupo} disabled={guardandoAlgo}>
//             {guardandoAlgo ? "Guardando…" : filasGrupo.length > 1 ? `Guardar (${filasGrupo.length} ítems)` : "Guardar"}
//           </Button>
//         )}
//       </div>
//     </div>
//   )
// }

// function FilaGrupoItemEquipo({
//   item,
//   filas,
//   elecciones,
//   guardandoIds,
//   onElegirEquipo,
//   onMarcarSolicitud,
//   onGuardarLinea,
//   mostrarMotivoRechazo,
// }: {
//   item: { codigo: string; descripcion: string } | undefined
//   filas: FilaRevisionImport[]
//   elecciones: Record<string, Eleccion>
//   guardandoIds: Set<string>
//   onElegirEquipo: (revisionId: string, equipoId: string) => void
//   onMarcarSolicitud: (revisionId: string) => void
//   onGuardarLinea: (revisionId: string) => void
//   mostrarMotivoRechazo?: boolean
// }) {
//   return (
//     <div className="space-y-2">
//       <p className="text-sm font-medium text-muted-foreground">
//         {item?.codigo} — {item?.descripcion}
//       </p>
//       {filas.map((fila) => {
//         const eleccion = elecciones[fila.id]
//         const guardando = guardandoIds.has(fila.id)
//         return (
//           <div
//             key={fila.id}
//             className={`border rounded-lg p-4 space-y-2 ml-2 ${
//               eleccion
//                 ? "border-primary/40 bg-primary/5"
//                 : mostrarMotivoRechazo
//                   ? "bg-red-50/40 border-red-200"
//                   : ""
//             }`}
//           >
//             <div className="flex items-center gap-2">
//               {eleccion && <span className="text-primary">✓</span>}
//               <span className="font-medium">{fila.descripcionOriginal}</span>
//               <span className="text-xs text-muted-foreground">
//                 {fila.cantidad} {fila.unidad}
//               </span>
//             </div>

//             {mostrarMotivoRechazo && (
//               <p className="text-xs text-red-700">
//                 <span className="font-medium">Motivo del rechazo:</span>{" "}
//                 {fila.motivoRechazo ?? "El admin no escribió un motivo."}
//               </p>
//             )}

//             <TablaCategoriasManoObra
//               categorias={fila.candidatos as CategoriaEquipo[]}
//               seleccionado={eleccion?.tipo === "equipo" ? eleccion.equipoId : undefined}
//               onSeleccionar={(equipoId) => onElegirEquipo(fila.id, equipoId)}
//             />

//             <div className="flex items-center gap-2">
//               <button
//                 type="button"
//                 onClick={() => onMarcarSolicitud(fila.id)}
//                 className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_equipo" ? "border-primary bg-primary/10" : "border-muted"}`}
//               >
//                 No existe — crear solicitud de aprobación
//               </button>
//               {eleccion && (
//                 <Button size="sm" onClick={() => onGuardarLinea(fila.id)} disabled={guardando}>
//                   {guardando ? "Guardando…" : "Guardar"}
//                 </Button>
//               )}
//             </div>
//           </div>
//         )
//       })}
//     </div>
//   )
// }


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
import ExcelJS from "exceljs"
import * as XLSX from "xlsx"
import {
  listarRevisionPorItems,
  resolverLineaRevision,
  resolverLineasRevisionEnLote,
  editarLineaAutoMatch,
  editarLineaAutoMatchEquipo,
  obtenerPendientesTransporte,
  importarPreciosTransporte,
  type LoteRevisionInfo,
} from "@/app/(app)/presupuestos/actions"
import type {
  FilaRevisionImport,
  CandidatoInsumo,
  CategoriaManoObra,
  CategoriaEquipo,
  FilaImportTransporte,
} from "@/lib/apu-import-types"

// Estilo "tipo Excel" -- mismo tratamiento que ya usa el resto de la app
// (presupuesto-table.tsx, admin-insumos/page.tsx): encabezado azul de
// marca, celdas con borde.
const headClasesCandidatos =
  "border-r border-b bg-primary px-3 py-2 text-left text-xs font-medium text-primary-foreground last:border-r-0"
const celdaCandidato = "border-r px-3 py-2 text-sm last:border-r-0"

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
  // Qué pestaña mostrar al abrir -- por defecto "insumos" (comportamiento
  // de siempre). El banner de transporte en page.tsx pasa "transporte"
  // para que el usuario no tenga que buscar la pestaña a mano.
  tabInicial?: "insumos" | "mano_obra" | "equipo" | "transporte"
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
  | { tipo: "equipo"; equipoId: string }
  | { tipo: "solicitud_equipo" }
  | null

// Cuando la revisión es de UN solo ítem (ver handleAbrirRevisionDeItem
// en page.tsx), el título muestra código y descripción -- mismo formato
// que ApuEditorDialog ("APU — 4.1.24.10 · Acero de refuerzo Grado 60")
// para que quede claro sobre qué ítem se está trabajando. Cuando son
// varios ítems (revisión general o banner de transporte), no hay un
// solo ítem que nombrar -- se deja el título genérico.
function tituloRevision(
  itemIds: string[],
  itemsPorId: Record<string, { codigo: string; descripcion: string }> | undefined
): string {
  if (itemIds.length !== 1) return "Revisión de APU"
  const item = itemsPorId?.[itemIds[0]]
  if (!item) return "Revisión de APU"
  return `APU — ${item.codigo} · ${item.descripcion}`
}

export function RevisionApuDialog({ open, itemIds, tabInicial = "insumos", onCerrar, onCambio }: Props) {
  const [datos, setDatos] = useState<LoteRevisionInfo | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pidiendoConfirmacionCierre, setPidiendoConfirmacionCierre] = useState(false)
  const [elecciones, setElecciones] = useState<Record<string, Eleccion>>({})
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({}) // revisionId -> nuevoInsumoId
  const [guardandoIds, setGuardandoIds] = useState<Set<string>>(new Set())
  // Guard síncrono contra doble-submit -- guardandoIds (arriba) es
  // estado de React, así que el botón solo queda "disabled" DESPUÉS de
  // que React re-renderice. Un doble-click rápido puede disparar el
  // segundo onClick ANTES de ese re-render (la ventana entre el primer
  // setGuardandoIds y el commit del DOM), y ahí sí se manda la misma
  // línea dos veces al backend. Este ref se lee/escribe de forma
  // síncrona en el mismo tick del evento, sin esperar a React -- así
  // el segundo click se corta ahí mismo, pase lo que pase con el
  // render. guardandoIds sigue existiendo para el "disabled"/texto del
  // botón (UX); este ref es la garantía real de que no se duplica.
  const enVueloRef = useRef<Set<string>>(new Set())

  // ---------- Transporte: estado del roundtrip por Excel ----------
  const [descargandoExcelTransporte, setDescargandoExcelTransporte] = useState(false)
  const [subiendoExcelTransporte, setSubiendoExcelTransporte] = useState(false)
  const [errorTransporte, setErrorTransporte] = useState<string | null>(null)
  const [resultadoImportTransporte, setResultadoImportTransporte] = useState<{
    actualizados: number
    sinCambios: number
    errores: { revisionId: string; mensaje: string }[]
  } | null>(null)

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
      setTabActiva(tabInicial)
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
  // Equipo SÍ se agrupa por descripción, igual que insumos -- ver
  // matchearEquipoApuImport en actions.ts (matching por texto de línea).
  // Transporte NO tiene candidatos de ningún tipo -- se excluye acá
  // también (si no, sus filas aparecerían como tarjetas vacías en el
  // tab de Insumos, sin ninguna tabla de candidatos que mostrar).
  const pendientes = useMemo(
    () => pendientesTodo.filter((f) => f.tipo !== "MO" && f.tipo !== "EQUIPO" && f.tipo !== "TRANSPORTE"),
    [pendientesTodo]
  )
  const pendientesManoObra = useMemo(() => pendientesTodo.filter((f) => f.tipo === "MO"), [pendientesTodo])
  const pendientesEquipo = useMemo(() => pendientesTodo.filter((f) => f.tipo === "EQUIPO"), [pendientesTodo])
  const pendientesTransporte = useMemo(() => pendientesTodo.filter((f) => f.tipo === "TRANSPORTE"), [pendientesTodo])
  const rechazadosTodo = useMemo(() => filas.filter((f) => f.estado === "rechazado"), [filas])
  const rechazados = useMemo(
    () => rechazadosTodo.filter((f) => f.tipo !== "MO" && f.tipo !== "EQUIPO" && f.tipo !== "TRANSPORTE"),
    [rechazadosTodo]
  )
  const rechazadosManoObra = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "MO"), [rechazadosTodo])
  const rechazadosEquipo = useMemo(() => rechazadosTodo.filter((f) => f.tipo === "EQUIPO"), [rechazadosTodo])
  const autoMatchTodo = useMemo(() => filas.filter((f) => f.estado === "auto_match"), [filas])
  // El auto-match SÍ aplica a equipo (a diferencia de mano de obra) --
  // se separa para que la pestaña de Equipo tenga su propia sección de
  // "Automáticos", en vez de que aparezcan mezclados en la de Insumos.
  // Transporte nunca auto-matchea (no tiene candidatos) -- no necesita
  // su propio filtro acá.
  const autoMatch = useMemo(() => autoMatchTodo.filter((f) => f.tipo !== "EQUIPO"), [autoMatchTodo])
  const autoMatchEquipo = useMemo(() => autoMatchTodo.filter((f) => f.tipo === "EQUIPO"), [autoMatchTodo])
  // Transporte también trae las YA resueltas -- a diferencia de las
  // demás pestañas, acá interesa ver el historial completo (para poder
  // re-descargar y corregir un valor ya cargado), no solo lo pendiente.
  const resueltasTransporte = useMemo(
    () => filas.filter((f) => f.tipo === "TRANSPORTE" && f.estado === "resuelto"),
    [filas]
  )

  // ---------- tabs: Insumos / Mano de obra / Equipo / Transporte ----------
  // Separados en pestañas porque son flujos de revisión distintos
  // (candidatos del maestro vs. categorías de mano de obra vs. catálogo
  // de equipo vs. Excel de transporte) -- antes vivían todos apilados en
  // un solo scroll larguísimo. El auto-match nunca aplica a mano de obra
  // ni a transporte (ver actions.ts / handoff), así que esas pestañas no
  // tienen sección de "Automáticos" -- equipo sí, igual que insumos.
  const [tabActiva, setTabActiva] = useState<"insumos" | "mano_obra" | "equipo" | "transporte">("insumos")
  const totalPendientesInsumos = pendientes.length + rechazados.length + autoMatch.length
  const totalPendientesManoObra = pendientesManoObra.length + rechazadosManoObra.length
  const totalPendientesEquipo = pendientesEquipo.length + rechazadosEquipo.length + autoMatchEquipo.length
  const totalPendientesTransporte = pendientesTransporte.length
  const sinNadaEnTabInsumos = totalPendientesInsumos === 0
  const sinNadaEnTabManoObra = totalPendientesManoObra === 0
  const sinNadaEnTabEquipo = totalPendientesEquipo === 0
  const sinNadaEnTabTransporte = totalPendientesTransporte === 0 && resueltasTransporte.length === 0

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
  const gruposPendientesEquipo = useMemo(() => agruparPorDescripcion(pendientesEquipo), [pendientesEquipo])
  const rechazadosEquipoPorItem = useMemo(() => agruparPorItem(rechazadosEquipo), [rechazadosEquipo])
  const autoMatchEquipoPorItem = useMemo(() => agruparPorItem(autoMatchEquipo), [autoMatchEquipo])

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
  function elegirEquipoGrupo(filasGrupo: FilaRevisionImport[], equipoId: string) {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const f of filasGrupo) nuevo[f.id] = { tipo: "equipo", equipoId }
      return nuevo
    })
  }
  function marcarSolicitudEquipoGrupo(filasGrupo: FilaRevisionImport[]) {
    setElecciones((prev) => {
      const nuevo = { ...prev }
      for (const f of filasGrupo) nuevo[f.id] = { tipo: "solicitud_equipo" }
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
  function elegirEquipo(revisionId: string, equipoId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "equipo", equipoId } }))
  }
  function marcarSolicitudEquipo(revisionId: string) {
    setElecciones((prev) => ({ ...prev, [revisionId]: { tipo: "solicitud_equipo" } }))
  }
  function corregirAutoMatch(revisionId: string, nuevoInsumoId: string) {
    setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoInsumoId }))
  }
  // Reusa el mismo mapa `correcciones` (revisionId -> nuevo id) que
  // insumos -- revisionId ya es único entre TODAS las filas, sin
  // importar el tipo, así que no hace falta un estado aparte. Lo que
  // cambia es guardarCorreccion (abajo), que decide a cuál server action
  // llamar según fila.tipo.
  function corregirAutoMatchEquipo(revisionId: string, nuevoEquipoId: string) {
    setCorrecciones((prev) => ({ ...prev, [revisionId]: nuevoEquipoId }))
  }

  // ---------- "seleccionados" (rechazados) -- YA NO es un checkbox manual:
  // una línea queda "seleccionada" automáticamente en cuanto el usuario le
  // elige un candidato o la marca como solicitud (ver elegirCandidato /
  // marcarSolicitud arriba). "Guardar seleccionados" guarda todas las que
  // ya tengan una elección hecha, de una sola vez.
  const idsRechazadosConEleccion = useMemo(
    () => rechazados.filter((f) => elecciones[f.id]).map((f) => f.id),
    [rechazados, elecciones]
  )

  // ---------- "seleccionados" (grupos de pendientes, por descripción) --
  // mismo criterio: un grupo cuenta como "seleccionado" en cuanto tiene
  // una elección hecha (se comparte entre todas las filas del grupo).
  const clavesGruposConEleccion = useMemo(
    () => Array.from(gruposPendientes.entries())
      .filter(([, filasGrupo]) => elecciones[filasGrupo[0].id])
      .map(([clave]) => clave),
    [gruposPendientes, elecciones]
  )

  // ---------- mismo criterio, para Equipo ----------
  const idsRechazadosEquipoConEleccion = useMemo(
    () => rechazadosEquipo.filter((f) => elecciones[f.id]).map((f) => f.id),
    [rechazadosEquipo, elecciones]
  )
  const clavesGruposEquipoConEleccion = useMemo(
    () => Array.from(gruposPendientesEquipo.entries())
      .filter(([, filasGrupo]) => elecciones[filasGrupo[0].id])
      .map(([clave]) => clave),
    [gruposPendientesEquipo, elecciones]
  )

  // ---------- mismo criterio, para Mano de obra -- pero SIN agrupar
  // por descripción (pendientesManoObra/rechazadosManoObra ya son listas
  // planas, cada fila se confirma individualmente), así que el criterio
  // es directo sobre la fila en vez de sobre un grupo.
  const idsManoObraConEleccion = useMemo(
    () => pendientesManoObra.filter((f) => elecciones[f.id]).map((f) => f.id),
    [pendientesManoObra, elecciones]
  )
  const idsRechazadosManoObraConEleccion = useMemo(
    () => rechazadosManoObra.filter((f) => elecciones[f.id]).map((f) => f.id),
    [rechazadosManoObra, elecciones]
  )

  // Guardar UNA línea de una vez (en vez de esperar a un botón "guardar
  // todo" al final) -- así el ingeniero ve el progreso inmediato, y
  // puede cerrar en cualquier momento sin perder lo que ya resolvió acá.
  async function guardarLinea(revisionId: string) {
    const eleccion = elecciones[revisionId]
    if (!eleccion) return
    if (enVueloRef.current.has(revisionId)) return
    enVueloRef.current.add(revisionId)
    setGuardandoIds((prev) => new Set(prev).add(revisionId))
    setError(null)
    try {
      if (eleccion.tipo === "maestro") {
        await resolverLineaRevision({ revisionId, accion: "maestro", insumoId: eleccion.insumoId })
      } else if (eleccion.tipo === "mano_obra") {
        await resolverLineaRevision({ revisionId, accion: "mano_obra", manoObraCategoriaId: eleccion.categoriaId })
      } else if (eleccion.tipo === "solicitud_mano_obra") {
        await resolverLineaRevision({ revisionId, accion: "solicitud_mano_obra" })
      } else if (eleccion.tipo === "equipo") {
        await resolverLineaRevision({ revisionId, accion: "equipo", equipoCategoriaId: eleccion.equipoId })
      } else if (eleccion.tipo === "solicitud_equipo") {
        await resolverLineaRevision({ revisionId, accion: "solicitud_equipo" })
      } else {
        await resolverLineaRevision({ revisionId, accion: "solicitud" })
      }
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar esa línea.")
    } finally {
      enVueloRef.current.delete(revisionId)
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
    // Filtra los que ya están en vuelo -- un doble-click en "guardar
    // seleccionados" no debe volver a mandar los que ya se están
    // procesando (mismo guard síncrono que guardarLinea/guardarCorrección).
    const idsNuevos = ids.filter((id) => !enVueloRef.current.has(id))
    if (idsNuevos.length === 0) return
    idsNuevos.forEach((id) => enVueloRef.current.add(id))
    setError(null)
    setGuardandoIds((prev) => {
      const copia = new Set(prev)
      idsNuevos.forEach((id) => copia.add(id))
      return copia
    })

    try {
      const resoluciones = idsNuevos
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
          if (eleccion.tipo === "equipo") {
            return { revisionId: id, accion: "equipo" as const, equipoCategoriaId: eleccion.equipoId }
          }
          if (eleccion.tipo === "solicitud_equipo") {
            return { revisionId: id, accion: "solicitud_equipo" as const }
          }
          return { revisionId: id, accion: "solicitud" as const }
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      const { errores } = await resolverLineasRevisionEnLote(resoluciones)
      if (errores.length > 0) setError(errores.map((e) => e.mensaje).join(" · "))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los seleccionados.")
    }

    idsNuevos.forEach((id) => enVueloRef.current.delete(id))
    setGuardandoIds((prev) => {
      const copia = new Set(prev)
      idsNuevos.forEach((id) => copia.delete(id))
      return copia
    })

    await cargar()
    onCambio?.()
  }

  async function guardarSeleccionados() {
    await guardarIds(idsRechazadosConEleccion)
  }

  async function guardarGruposSeleccionados() {
    const ids = clavesGruposConEleccion.flatMap((clave) => gruposPendientes.get(clave) ?? []).map((f) => f.id)
    await guardarIds(ids)
  }

  async function guardarSeleccionadosEquipo() {
    await guardarIds(idsRechazadosEquipoConEleccion)
  }

  async function guardarGruposSeleccionadosEquipo() {
    const ids = clavesGruposEquipoConEleccion
      .flatMap((clave) => gruposPendientesEquipo.get(clave) ?? [])
      .map((f) => f.id)
    await guardarIds(ids)
  }

  async function guardarSeleccionadosManoObra() {
    await guardarIds(idsManoObraConEleccion)
  }

  async function guardarRechazadosSeleccionadosManoObra() {
    await guardarIds(idsRechazadosManoObraConEleccion)
  }

  // guardarGrupo (abajo) ya sirve para grupos de equipo también -- es
  // puramente mecánico (junta los ids con elección y llama guardarIds,
  // que ya sabe rutear "equipo"/"solicitud_equipo" según el tipo de la
  // elección), no hace falta duplicarlo.
  async function guardarGrupo(filasGrupo: FilaRevisionImport[]) {
    const ids = filasGrupo.filter((f) => elecciones[f.id]).map((f) => f.id)
    await guardarIds(ids)
  }

  async function guardarCorreccion(revisionId: string) {
    const nuevoInsumoId = correcciones[revisionId]
    if (!nuevoInsumoId) return
    if (enVueloRef.current.has(revisionId)) return
    enVueloRef.current.add(revisionId)
    setGuardandoIds((prev) => new Set(prev).add(revisionId))
    setError(null)
    try {
      await editarLineaAutoMatch({ revisionId, nuevoInsumoId })
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
    } finally {
      enVueloRef.current.delete(revisionId)
      setGuardandoIds((prev) => {
        const copia = new Set(prev)
        copia.delete(revisionId)
        return copia
      })
    }
  }

  async function guardarCorreccionEquipo(revisionId: string) {
    const nuevoEquipoId = correcciones[revisionId]
    if (!nuevoEquipoId) return
    if (enVueloRef.current.has(revisionId)) return
    enVueloRef.current.add(revisionId)
    setGuardandoIds((prev) => new Set(prev).add(revisionId))
    setError(null)
    try {
      await editarLineaAutoMatchEquipo({ revisionId, nuevoEquipoId })
      await cargar()
      onCambio?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo corregir esa línea.")
    } finally {
      enVueloRef.current.delete(revisionId)
      setGuardandoIds((prev) => {
        const copia = new Set(prev)
        copia.delete(revisionId)
        return copia
      })
    }
  }

  // ---------- Transporte: descargar Excel de pendientes/corrección ----------
  // Se exportan TODAS las líneas de los itemIds actuales (no solo las
  // pendientes) -- así el mismo archivo sirve para cargar por primera
  // vez y para corregir (el ingeniero ve "Valor actual" al lado).
  async function handleDescargarExcelTransporte() {
    setDescargandoExcelTransporte(true)
    setErrorTransporte(null)
    try {
      const filasExport = await obtenerPendientesTransporte(itemIds)
      if (filasExport.length === 0) {
        setErrorTransporte("No hay líneas de transporte para exportar en estos ítems.")
        return
      }

      const workbook = new ExcelJS.Workbook()
      const hoja = workbook.addWorksheet("Transporte")
      hoja.columns = [
        { header: "Proyecto", key: "proyecto", width: 24 },
        { header: "Código ítem", key: "codigoItem", width: 14 },
        { header: "Descripción ítem", key: "descripcionItem", width: 40 },
        { header: "Unidad ítem", key: "unidadItem", width: 12 },
        { header: "Cantidad ítem", key: "cantidadItem", width: 14 },
        { header: "Descripción transporte", key: "descripcionTransporte", width: 40 },
        { header: "Unidad transporte", key: "unidadTransporte", width: 16 },
        { header: "Cantidad transporte", key: "cantidadTransporte", width: 18 },
        { header: "Valor actual", key: "valorActual", width: 16 },
        { header: "Valor transporte", key: "valorTransporte", width: 18 },
        // Columna oculta -- ES la clave real del roundtrip (ver
        // importarPreciosTransporte en actions.ts). No se borra ni se
        // edita -- por eso además de ocultarla, el encabezado lo dice
        // explícito (por si alguien la desoculta sin querer).
        { header: "ID interno -- NO BORRAR NI EDITAR", key: "revisionId", width: 38 },
      ]
      hoja.getRow(1).font = { bold: true }
      hoja.getColumn("revisionId").hidden = true

      for (const f of filasExport) {
        hoja.addRow({
          proyecto: f.proyectoNombre ?? "",
          codigoItem: f.itemCodigo,
          descripcionItem: f.itemDescripcion,
          unidadItem: f.itemUnidad ?? "",
          cantidadItem: f.itemCantidad ?? "",
          descripcionTransporte: f.descripcionTransporte,
          unidadTransporte: f.unidadTransporte ?? "",
          cantidadTransporte: f.cantidadTransporte,
          valorActual: f.valorActual ?? "",
          // Prellenado con el valor actual (si lo hay) -- facilita
          // corregir sin tener que escribir todo de nuevo.
          valorTransporte: f.valorActual ?? "",
          revisionId: f.revisionId,
        })
      }

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `transporte-${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setErrorTransporte(e instanceof Error ? e.message : "No se pudo generar el Excel.")
    } finally {
      setDescargandoExcelTransporte(false)
    }
  }

  // ---------- Transporte: subir Excel diligenciado ----------
  async function handleSubirExcelTransporte(archivo: File) {
    setSubiendoExcelTransporte(true)
    setErrorTransporte(null)
    setResultadoImportTransporte(null)
    try {
      const buffer = await archivo.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const hoja = workbook.Sheets[workbook.SheetNames[0]]
      const filas: Record<string, unknown>[] = XLSX.utils.sheet_to_json(hoja)

      if (filas.length === 0) {
        setErrorTransporte("El archivo no tiene filas de datos.")
        return
      }

      // Columnas por NOMBRE, no por posición -- si el ingeniero reordena
      // columnas al editar, esto sigue encontrándolas.
      const headers = Object.keys(filas[0])
      const colId = headers.find((h) => h.toLowerCase().includes("id interno"))
      const colValor = headers.find((h) => h.toLowerCase().includes("valor transporte"))

      if (!colId || !colValor) {
        setErrorTransporte(
          'No se encontraron las columnas "ID interno" y/o "Valor transporte" -- usa el Excel descargado desde acá, sin cambiar los encabezados.'
        )
        return
      }

      const filasImport: FilaImportTransporte[] = []
      for (const fila of filas) {
        const revisionId = String(fila[colId] ?? "").trim()
        const valorRaw = fila[colValor]
        // Fila sin ID -- probablemente una fila vacía al final del
        // Excel, se ignora en silencio (no es una línea real).
        if (!revisionId) continue
        // Todavía sin diligenciar -- se ignora, NO es un error (el
        // ingeniero puede estar llenando el archivo de a poco).
        if (valorRaw === undefined || valorRaw === null || String(valorRaw).trim() === "") continue

        const valorUnitario =
          typeof valorRaw === "number"
            ? valorRaw
            : Number(String(valorRaw).replace(/\./g, "").replace(",", "."))

        filasImport.push({ revisionId, valorUnitario })
      }

      if (filasImport.length === 0) {
        setErrorTransporte("No hay ninguna fila con un valor de transporte diligenciado.")
        return
      }

      const resultado = await importarPreciosTransporte(filasImport)
      setResultadoImportTransporte(resultado)
      await cargar()
      onCambio?.()
    } catch (e) {
      setErrorTransporte(e instanceof Error ? e.message : "No se pudo procesar el Excel.")
    } finally {
      setSubiendoExcelTransporte(false)
    }
  }

  const hayTrabajoSinGuardar = Object.keys(elecciones).length > 0 || Object.keys(correcciones).length > 0
  const faltanPorResolver =
    pendientes.length +
    pendientesManoObra.length +
    pendientesEquipo.length +
    rechazados.length +
    rechazadosManoObra.length +
    rechazadosEquipo.length

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
        className="max-w-7xl w-[95vw] max-h-[92vh] overflow-y-auto"
        style={{ maxWidth: "1500px", width: "95vw" }}
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
              <DialogTitle>{tituloRevision(itemIds, datos?.itemsPorId)}</DialogTitle>
            </DialogHeader>

            {cargando && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded-lg p-4">
                <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                Cargando revisión…
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {!cargando && datos && (
              <div className="space-y-6">
                <div className="flex gap-1 border-b">
                  <button
                    type="button"
                    onClick={() => setTabActiva("insumos")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tabActiva === "insumos"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Insumos
                    {totalPendientesInsumos > 0 && (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {totalPendientesInsumos}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabActiva("mano_obra")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tabActiva === "mano_obra"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Mano de obra
                    {totalPendientesManoObra > 0 && (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {totalPendientesManoObra}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabActiva("equipo")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tabActiva === "equipo"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Equipo
                    {totalPendientesEquipo > 0 && (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {totalPendientesEquipo}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTabActiva("transporte")}
                    className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                      tabActiva === "transporte"
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Transporte
                    {totalPendientesTransporte > 0 && (
                      <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                        {totalPendientesTransporte}
                      </span>
                    )}
                  </button>
                </div>

                {tabActiva === "insumos" && sinNadaEnTabInsumos && (
                  <p className="text-sm text-muted-foreground">No hay nada que revisar en Insumos.</p>
                )}
                {tabActiva === "mano_obra" && sinNadaEnTabManoObra && (
                  <p className="text-sm text-muted-foreground">No hay nada que revisar en Mano de obra.</p>
                )}
                {tabActiva === "equipo" && sinNadaEnTabEquipo && (
                  <p className="text-sm text-muted-foreground">No hay nada que revisar en Equipo.</p>
                )}
                {tabActiva === "transporte" && sinNadaEnTabTransporte && (
                  <p className="text-sm text-muted-foreground">No hay nada que revisar en Transporte.</p>
                )}


                {tabActiva === "insumos" && pendientes.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

                    {gruposPendientes.size > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {clavesGruposConEleccion.length} de {gruposPendientes.size} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={clavesGruposConEleccion.length === 0}
                          onClick={guardarGruposSeleccionados}
                        >
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
                        guardandoIds={guardandoIds}
                        onElegirCandidato={(insumoId) => elegirCandidatoGrupo(filasGrupo, insumoId)}
                        onMarcarSolicitud={() => marcarSolicitudGrupo(filasGrupo)}
                        onGuardarGrupo={() => guardarGrupo(filasGrupo)}
                      />
                    ))}
                  </section>
                )}

                {tabActiva === "mano_obra" && pendientesManoObra.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Mano de obra -- confirma la categoría</h3>
                    <p className="text-xs text-muted-foreground">
                      Nunca se asigna sola -- elige la categoría de actividad más parecida para cada
                      ítem.
                    </p>

                    {pendientesManoObra.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {idsManoObraConEleccion.length} de {pendientesManoObra.length} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={idsManoObraConEleccion.length === 0}
                          onClick={guardarSeleccionadosManoObra}
                        >
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {pendientesManoObra.map((fila) => {
                      const item = datos.itemsPorId[fila.presupuestoItemId]
                      const eleccion = elecciones[fila.id]
                      const guardando = guardandoIds.has(fila.id)
                      return (
                        <div key={fila.id} className="border rounded-lg p-4 space-y-2">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              {item?.codigo} — {item?.descripcion}
                            </p>
                            <p className="text-xs italic text-muted-foreground/70">
                              Está en el presupuesto como: {fila.descripcionOriginal}
                            </p>
                          </div>
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

                {tabActiva === "insumos" && rechazados.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700">
                      Rechazados por admin -- necesitan otra opción
                    </h3>

                    {rechazados.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {idsRechazadosConEleccion.length} de {rechazados.length} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={idsRechazadosConEleccion.length === 0}
                          onClick={guardarSeleccionados}
                        >
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
                        guardandoIds={guardandoIds}
                        onElegirCandidato={elegirCandidato}
                        onMarcarSolicitud={marcarSolicitud}
                        onGuardarLinea={guardarLinea}
                        mostrarMotivoRechazo
                      />
                    ))}
                  </section>
                )}


                {tabActiva === "mano_obra" && rechazadosManoObra.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700">
                      Mano de obra rechazada por admin -- elige otra categoría
                    </h3>

                    {rechazadosManoObra.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {idsRechazadosManoObraConEleccion.length} de {rechazadosManoObra.length} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={idsRechazadosManoObraConEleccion.length === 0}
                          onClick={guardarRechazadosSeleccionadosManoObra}
                        >
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {rechazadosManoObra.map((fila) => {
                      const item = datos.itemsPorId[fila.presupuestoItemId]
                      const eleccion = elecciones[fila.id]
                      const guardando = guardandoIds.has(fila.id)
                      return (
                        <div key={fila.id} className="border rounded-lg p-4 space-y-2 bg-red-50/40 border-red-200">
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              {item?.codigo} — {item?.descripcion}
                            </p>
                            <p className="text-xs italic text-muted-foreground/70">
                              Está en el presupuesto como: {fila.descripcionOriginal}
                            </p>
                          </div>
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

                {tabActiva === "insumos" && autoMatch.length > 0 && (
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
                              <div key={fila.id} className="border rounded-lg p-4 space-y-2 ml-2 bg-emerald-50/40">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{fila.descripcionOriginal}</span>
                                  <span className="text-xs text-emerald-700">✓ auto-match</span>
                                </div>
                                <TablaCandidatos
                                  candidatos={fila.candidatos as CandidatoInsumo[]}
                                  seleccionado={correcciones[fila.id] ?? fila.insumoIdAsignado}
                                  onSeleccionar={(insumoId) => {
                                    // Click de nuevo sobre la fila ya seleccionada no es una
                                    // corrección real -- si se deja pasar, "Guardar cambio"
                                    // aparece igual y termina agregando el mismo insumo 2 veces.
                                    if (insumoId === fila.insumoIdAsignado) return
                                    corregirAutoMatch(fila.id, insumoId)
                                  }}
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

                {tabActiva === "equipo" && pendientesEquipo.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Pendientes de resolver</h3>

                    {gruposPendientesEquipo.size > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {clavesGruposEquipoConEleccion.length} de {gruposPendientesEquipo.size} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={clavesGruposEquipoConEleccion.length === 0}
                          onClick={guardarGruposSeleccionadosEquipo}
                        >
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {Array.from(gruposPendientesEquipo.entries()).map(([clave, filasGrupo]) => (
                      <GrupoEquipoPendiente
                        key={clave}
                        clave={clave}
                        filasGrupo={filasGrupo}
                        itemsPorId={datos.itemsPorId}
                        elecciones={elecciones}
                        guardandoIds={guardandoIds}
                        onElegirEquipo={(equipoId) => elegirEquipoGrupo(filasGrupo, equipoId)}
                        onMarcarSolicitud={() => marcarSolicitudEquipoGrupo(filasGrupo)}
                        onGuardarGrupo={() => guardarGrupo(filasGrupo)}
                      />
                    ))}
                  </section>
                )}

                {tabActiva === "equipo" && rechazadosEquipo.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-red-700">
                      Rechazados por admin -- necesitan otra opción
                    </h3>

                    {rechazadosEquipo.length > 1 && (
                      <div className="flex flex-wrap items-center gap-2 border rounded-lg p-2 bg-muted/30">
                        <span className="text-sm text-muted-foreground mr-auto">
                          {idsRechazadosEquipoConEleccion.length} de {rechazadosEquipo.length} con una elección hecha
                        </span>
                        <Button
                          size="sm"
                          disabled={idsRechazadosEquipoConEleccion.length === 0}
                          onClick={guardarSeleccionadosEquipo}
                        >
                          Guardar seleccionados
                        </Button>
                      </div>
                    )}

                    {Array.from(rechazadosEquipoPorItem.entries()).map(([itemId, filasItem]) => (
                      <FilaGrupoItemEquipo
                        key={itemId}
                        item={datos.itemsPorId[itemId]}
                        filas={filasItem}
                        elecciones={elecciones}
                        guardandoIds={guardandoIds}
                        onElegirEquipo={elegirEquipo}
                        onMarcarSolicitud={marcarSolicitudEquipo}
                        onGuardarLinea={guardarLinea}
                        mostrarMotivoRechazo
                      />
                    ))}
                  </section>
                )}

                {tabActiva === "equipo" && autoMatchEquipo.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">Automáticos -- confirma que estén bien</h3>
                    {Array.from(autoMatchEquipoPorItem.entries()).map(([itemId, filasItem]) => {
                      const item = datos.itemsPorId[itemId]
                      return (
                        <div key={itemId} className="space-y-2">
                          <p className="text-sm font-medium text-muted-foreground">
                            {item?.codigo} — {item?.descripcion}
                          </p>
                          {filasItem.map((fila) => {
                            const tieneCorreccionSinGuardar = !!correcciones[fila.id]
                            return (
                              <div key={fila.id} className="border rounded-lg p-4 space-y-2 ml-2 bg-emerald-50/40">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">{fila.descripcionOriginal}</span>
                                  <span className="text-xs text-emerald-700">✓ auto-match</span>
                                </div>
                                <TablaCategoriasManoObra
                                  categorias={fila.candidatos as CategoriaEquipo[]}
                                  seleccionado={correcciones[fila.id] ?? fila.equipoCategoriaIdAsignado}
                                  onSeleccionar={(equipoId) => {
                                    // Mismo guard que el de insumos arriba -- ver comentario ahí.
                                    if (equipoId === fila.equipoCategoriaIdAsignado) return
                                    corregirAutoMatchEquipo(fila.id, equipoId)
                                  }}
                                />
                                {tieneCorreccionSinGuardar && (
                                  <Button
                                    size="sm"
                                    onClick={() => guardarCorreccionEquipo(fila.id)}
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

                {tabActiva === "transporte" && (
                  <section className="space-y-4">
                    <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                      <p className="text-sm">
                        El transporte se cotiza por Excel, no dentro de este diálogo -- cada ítem
                        puede necesitar un precio distinto según el lugar. Descarga el Excel,
                        complétalo (columna <span className="font-medium">"Valor transporte"</span>,
                        valor unitario, sin multiplicar por cantidad) y súbelo de vuelta.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        El Excel trae una columna oculta con el identificador interno de cada
                        línea -- no la borres ni la edites, es lo que permite que el valor vuelva a
                        la línea correcta al subir el archivo. Si necesitas corregir un valor ya
                        cargado, descarga el Excel de nuevo (va a traer el valor actual) y
                        sobrescríbelo.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleDescargarExcelTransporte}
                          disabled={descargandoExcelTransporte}
                        >
                          {descargandoExcelTransporte ? "Generando…" : "Descargar Excel"}
                        </Button>
                        <label className="inline-flex">
                          <input
                            type="file"
                            accept=".xlsx,.xls"
                            className="hidden"
                            disabled={subiendoExcelTransporte}
                            onChange={(e) => {
                              const archivo = e.target.files?.[0]
                              e.target.value = "" // permite volver a subir el MISMO archivo dos veces seguidas
                              if (archivo) handleSubirExcelTransporte(archivo)
                            }}
                          />
                          <span
                            className={`inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-muted/40 ${
                              subiendoExcelTransporte ? "opacity-50 pointer-events-none" : ""
                            }`}
                          >
                            {subiendoExcelTransporte ? "Subiendo…" : "Subir Excel con precios"}
                          </span>
                        </label>
                      </div>
                      {errorTransporte && <p className="text-sm text-destructive">{errorTransporte}</p>}
                      {resultadoImportTransporte && (
                        <div className="text-sm space-y-1 pt-1 border-t mt-2">
                          <p className="text-emerald-700">
                            ✓ {resultadoImportTransporte.actualizados} precio(s) guardado(s)
                            {resultadoImportTransporte.sinCambios > 0 &&
                              ` -- ${resultadoImportTransporte.sinCambios} sin cambios (mismo valor de antes)`}
                            .
                          </p>
                          {resultadoImportTransporte.errores.length > 0 && (
                            <div className="text-destructive">
                              <p className="font-medium">
                                {resultadoImportTransporte.errores.length} fila(s) con error:
                              </p>
                              <ul className="list-disc list-inside">
                                {resultadoImportTransporte.errores.map((e, i) => (
                                  <li key={i}>{e.mensaje}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {pendientesTransporte.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold">Pendientes ({pendientesTransporte.length})</h3>
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full border-separate border-spacing-0">
                            <thead>
                              <tr>
                                <th className={headClasesCandidatos}>Ítem</th>
                                <th className={headClasesCandidatos}>Transporte</th>
                                <th className={`${headClasesCandidatos} w-28 text-right`}>Cantidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pendientesTransporte.map((fila) => {
                                const item = datos.itemsPorId[fila.presupuestoItemId]
                                return (
                                  <tr key={fila.id} className="border-t">
                                    <td className={celdaCandidato}>
                                      {item?.codigo} — {item?.descripcion}
                                    </td>
                                    <td className={celdaCandidato}>{fila.descripcionOriginal}</td>
                                    <td className={`${celdaCandidato} text-right`}>
                                      {fila.cantidad} {fila.unidad}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {resueltasTransporte.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-emerald-700">
                          Ya tienen precio ({resueltasTransporte.length})
                        </h3>
                        <div className="overflow-x-auto rounded-md border">
                          <table className="w-full border-separate border-spacing-0">
                            <thead>
                              <tr>
                                <th className={headClasesCandidatos}>Ítem</th>
                                <th className={headClasesCandidatos}>Transporte</th>
                                <th className={`${headClasesCandidatos} w-32 text-right`}>Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {resueltasTransporte.map((fila) => {
                                const item = datos.itemsPorId[fila.presupuestoItemId]
                                return (
                                  <tr key={fila.id} className="border-t bg-emerald-50/40">
                                    <td className={celdaCandidato}>
                                      {item?.codigo} — {item?.descripcion}
                                    </td>
                                    <td className={celdaCandidato}>{fila.descripcionOriginal}</td>
                                    <td className={`${celdaCandidato} text-right`}>
                                      {fila.valorTransporte != null ? `$${fila.valorTransporte.toLocaleString()}` : "—"}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>
                )}

              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => handleIntentoCerrar(false)}>
                Cerrar
              </Button>
              {!cargando && datos && faltanPorResolver === 0 && (
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
  guardandoIds,
  onElegirCandidato,
  onMarcarSolicitud,
  onGuardarGrupo,
}: {
  clave: string
  filasGrupo: FilaRevisionImport[]
  itemsPorId: Record<string, { codigo: string; descripcion: string }>
  elecciones: Record<string, Eleccion>
  guardandoIds: Set<string>
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
    <div className={`border rounded-lg p-4 space-y-2 ${eleccion ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        {eleccion && <span className="text-primary">✓</span>}
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
// Un grupo de líneas (pendientes o rechazadas) de UN ítem -- candidatos y
// opción de solicitud. Compartido entre las secciones "Pendientes" y
// "Rechazados" (mismo diseño, la única diferencia es si se muestra el
// motivo del rechazo). Una fila cuenta como "seleccionada" (para el botón
// "Guardar seleccionados" de arriba) en cuanto tiene una elección hecha --
// no hay checkbox manual.
// ---------------------------------------------------------------------------

function FilaGrupoItem({
  item,
  filas,
  elecciones,
  guardandoIds,
  onElegirCandidato,
  onMarcarSolicitud,
  onGuardarLinea,
  mostrarMotivoRechazo,
}: {
  item: { codigo: string; descripcion: string } | undefined
  filas: FilaRevisionImport[]
  elecciones: Record<string, Eleccion>
  guardandoIds: Set<string>
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
            className={`border rounded-lg p-4 space-y-2 ml-2 ${
              eleccion
                ? "border-primary/40 bg-primary/5"
                : mostrarMotivoRechazo
                  ? "bg-red-50/40 border-red-200"
                  : ""
            }`}
          >
            <div className="flex items-center gap-2">
              {eleccion && <span className="text-primary">✓</span>}
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

// ---------------------------------------------------------------------------
// Equivalentes de GrupoInsumoPendiente / FilaGrupoItem, para Equipo --
// misma agrupación por descripción (el mismo equipo puede aparecer en
// muchos ítems, igual que insumos), pero usan TablaCategoriasManoObra en
// vez de TablaCandidatos porque CategoriaEquipo trae grupo/unidad propia
// (mismo shape que CategoriaManoObra, no el de un insumo del maestro).
// ---------------------------------------------------------------------------

function GrupoEquipoPendiente({
  clave,
  filasGrupo,
  itemsPorId,
  elecciones,
  guardandoIds,
  onElegirEquipo,
  onMarcarSolicitud,
  onGuardarGrupo,
}: {
  clave: string
  filasGrupo: FilaRevisionImport[]
  itemsPorId: Record<string, { codigo: string; descripcion: string }>
  elecciones: Record<string, Eleccion>
  guardandoIds: Set<string>
  onElegirEquipo: (equipoId: string) => void
  onMarcarSolicitud: () => void
  onGuardarGrupo: () => void
}) {
  const primera = filasGrupo[0]
  const eleccion = elecciones[primera.id]
  const guardandoAlgo = filasGrupo.some((f) => guardandoIds.has(f.id))
  const codigosItems = filasGrupo
    .map((f) => itemsPorId[f.presupuestoItemId]?.codigo)
    .filter(Boolean)
    .join(", ")

  return (
    <div className={`border rounded-lg p-4 space-y-2 ${eleccion ? "border-primary/40 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2">
        {eleccion && <span className="text-primary">✓</span>}
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

      <TablaCategoriasManoObra
        categorias={primera.candidatos as CategoriaEquipo[]}
        seleccionado={eleccion?.tipo === "equipo" ? eleccion.equipoId : undefined}
        onSeleccionar={onElegirEquipo}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMarcarSolicitud}
          className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_equipo" ? "border-primary bg-primary/10" : "border-muted"}`}
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

function FilaGrupoItemEquipo({
  item,
  filas,
  elecciones,
  guardandoIds,
  onElegirEquipo,
  onMarcarSolicitud,
  onGuardarLinea,
  mostrarMotivoRechazo,
}: {
  item: { codigo: string; descripcion: string } | undefined
  filas: FilaRevisionImport[]
  elecciones: Record<string, Eleccion>
  guardandoIds: Set<string>
  onElegirEquipo: (revisionId: string, equipoId: string) => void
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
            className={`border rounded-lg p-4 space-y-2 ml-2 ${
              eleccion
                ? "border-primary/40 bg-primary/5"
                : mostrarMotivoRechazo
                  ? "bg-red-50/40 border-red-200"
                  : ""
            }`}
          >
            <div className="flex items-center gap-2">
              {eleccion && <span className="text-primary">✓</span>}
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

            <TablaCategoriasManoObra
              categorias={fila.candidatos as CategoriaEquipo[]}
              seleccionado={eleccion?.tipo === "equipo" ? eleccion.equipoId : undefined}
              onSeleccionar={(equipoId) => onElegirEquipo(fila.id, equipoId)}
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onMarcarSolicitud(fila.id)}
                className={`text-sm px-2 py-1 rounded border ${eleccion?.tipo === "solicitud_equipo" ? "border-primary bg-primary/10" : "border-muted"}`}
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