"use client"

import { useEffect, useRef, useState } from "react"
import { Trash2 } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import type { ItemPresupuesto, EstadoApuItem, MotivoRechazoPorItem } from "@/app/(app)/presupuestos/actions"

const inputClasses =
  "h-7 w-full rounded-none border-none bg-transparent px-2 shadow-none " +
  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"

// Igual que inputClasses pero para el textarea de descripción: sin
// altura fija (crece con el contenido) y con wrap normal en vez de
// desbordarse en una sola línea como hacía el <Input>.
const textareaClasses =
  "block w-full resize-none overflow-hidden rounded-none border-none bg-transparent " +
  "px-2 py-1 text-xs leading-snug shadow-none " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"

// Encabezado en azul de marca (bg-primary/text-primary-foreground) --
// mismo tratamiento que ya usan admin-tecnico y admin-insumos.
const headClasses = "h-8 border-r border-b bg-primary px-2 text-xs font-medium text-primary-foreground last:border-r-0"
const cellClasses = "border-r p-0 align-middle last:border-r-0"

// Textarea que ajusta su alto solo, según el texto -- así la caja de
// descripción hace wrap en vez de desbordarse horizontalmente, y no le
// queda una barra de scroll interna incómoda.
function DescripcionTextarea({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (valor: string) => void
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  )
}

// Celda de cantidad editable con doble click, para ítems YA GUARDADOS en
// la base de datos -- mismo patrón que CantidadEditable en
// apu-editor-dialog.tsx (doble click, Enter confirma, Escape cancela),
// pero acá sí se permite 0 (una cantidad presupuestada en 0 es válida --
// significa "no se usó en esta variante del proyecto", a diferencia de
// un insumo de APU en 0 que no tiene sentido).
function CantidadItemGuardadoEditable({
  valor,
  onGuardar,
}: {
  valor: number | null | undefined
  onGuardar: (nuevoValor: number) => void | Promise<void>
}) {
  const [editando, setEditando] = useState(false)
  const [valorLocal, setValorLocal] = useState(String(valor ?? ""))
  // Igual que en apu-editor-dialog.tsx: esto va directo a la base de
  // datos, sin pasar por el botón "Guardar en base de datos" de la
  // página -- sin este flash, el guardado quedaba silencioso.
  const [guardadoReciente, setGuardadoReciente] = useState(false)

  useEffect(() => {
    setValorLocal(String(valor ?? ""))
  }, [valor])

  async function confirmar() {
    setEditando(false)
    const num = Number(valorLocal)
    if (!Number.isNaN(num) && num >= 0 && num !== valor) {
      await onGuardar(num)
      setGuardadoReciente(true)
      setTimeout(() => setGuardadoReciente(false), 1800)
    } else {
      setValorLocal(String(valor ?? ""))
    }
  }

  if (editando) {
    return (
      <input
        type="number"
        autoFocus
        value={valorLocal}
        onChange={(e) => setValorLocal(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirmar()
          if (e.key === "Escape") {
            setValorLocal(String(valor ?? ""))
            setEditando(false)
          }
        }}
        className="w-full rounded border px-1.5 py-0.5 text-right text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation() // si no, el doble click también abre el diálogo de APU
        setEditando(true)
      }}
      title="Doble click para editar la cantidad"
      className={`block cursor-pointer rounded px-2 py-1 text-right text-xs transition-colors ${
        guardadoReciente
          ? "bg-emerald-50 text-emerald-700"
          : "text-muted-foreground hover:bg-muted"
      }`}
    >
      {guardadoReciente && <span className="mr-1">✓</span>}
      {valor ?? "—"}
    </span>
  )
}

// ---------------------------------------------------------------------
// Estado visual del APU de una fila, a partir de:
//   - item.apuId: si no tiene, ni siquiera se empezó a armar.
//   - item.cantidad: si está vacía/0, falta ponerla (aunque el APU esté
//     completo, sin cantidad no hay valor_total real).
//   - estadosApu (viene de obtenerEstadoApuPorItem en actions.ts, vía
//     page.tsx): "listo" / "pendiente" / "rechazado" por ítem, ya
//     calculado contra apu_import_revision + solicitudes_insumos.
//
// 🟢 LISTO PARA SUBIR = todos los insumos del APU ya están en la base
//   (auto-match o resueltos a mano).
// 🟡 PENDIENTE DE APROBACIÓN = falta que se apruebe/resuelva algo.
// 🔴 RECHAZADO = un admin rechazó un insumo -- necesita que el
//   ingeniero elija otra opción (se ve el motivo).
// Un ítem sin ninguna fila en apu_import_revision no tiene entrada en
// estadosApu -- se queda neutro (sin color), como antes de que existiera
// este sistema.
// ---------------------------------------------------------------------
type EstadoApuFila = "sin_apu" | "rechazado" | "pendiente" | "listo"

function estadoApuDeFila(item: ItemPresupuesto, estadoDesdeRevision: EstadoApuItem | undefined): EstadoApuFila {
  if (estadoDesdeRevision) return estadoDesdeRevision
  if (!item.apuId) return "sin_apu"
  return "sin_apu" // ítem con APU pero sin ningún import de por medio -- neutro, no se opina
}

const FILA_ESTILO_POR_ESTADO: Record<EstadoApuFila, string> = {
  sin_apu: "",
  rechazado: "bg-red-50 hover:bg-red-100/70",
  pendiente: "bg-amber-50 hover:bg-amber-100/70",
  listo: "bg-emerald-50/60 hover:bg-emerald-100/60",
}

// ---------------------------------------------------------------------
// Alerta de sobrecosto vs. presupuesto original (columna "Valor total"
// del Excel importado, guardada tal cual en item.precioOriginal -- ver
// CLAUDE.md). Umbral de $1.000: diferencias menores son redondeo, no un
// sobrecosto real que valga la pena alertar.
//
// Rollup por capítulo: si ALGÚN descendiente con costo no trae
// precioOriginal (ej. un ítem agregado a mano, nunca importado), el
// capítulo completo NO se marca en alerta -- un total original
// incompleto subestima el original y daría una alerta falsa. Se prefiere
// silencio a un falso positivo acá.
// ---------------------------------------------------------------------
const UMBRAL_ALERTA_PRESUPUESTO = 1000

function excedePresupuestoOriginal(
  valorTotal: number | null | undefined,
  precioOriginal: number | null | undefined
): boolean {
  if (valorTotal == null || precioOriginal == null) return false
  return valorTotal - precioOriginal > UMBRAL_ALERTA_PRESUPUESTO
}

type RollupCapitulo = {
  totalCalculado: number
  totalOriginal: number | null
  excede: boolean
}

function calcularRollupsPorCapitulo(data: ItemPresupuesto[]): Map<string, RollupCapitulo> {
  const hijosDirectos = new Map<string, string[]>()
  for (const item of data) {
    if (!item.padreId) continue
    const lista = hijosDirectos.get(item.padreId) ?? []
    lista.push(item.id)
    hijosDirectos.set(item.padreId, lista)
  }

  const porId = new Map(data.map((i) => [i.id, i]))

  function recolectarDescendientes(id: string): ItemPresupuesto[] {
    const resultado: ItemPresupuesto[] = []
    for (const hijoId of hijosDirectos.get(id) ?? []) {
      const hijo = porId.get(hijoId)
      if (!hijo) continue
      resultado.push(hijo)
      resultado.push(...recolectarDescendientes(hijoId))
    }
    return resultado
  }

  const rollups = new Map<string, RollupCapitulo>()

  for (const item of data) {
    if (!hijosDirectos.has(item.id)) continue // no es capítulo (no tiene hijos) -- no se calcula rollup

    // Solo cuentan los descendientes que son ítems REALES de presupuesto
    // (con valorTotal propio) -- los subcapítulos intermedios ya
    // contribuyen 0 y no hay que filtrarlos aparte.
    const itemsConCosto = recolectarDescendientes(item.id).filter((d) => d.valorTotal != null)

    const totalCalculado = itemsConCosto.reduce((s, d) => s + (d.valorTotal ?? 0), 0)
    const todosConOriginal =
      itemsConCosto.length > 0 && itemsConCosto.every((d) => d.precioOriginal != null)
    const totalOriginal = todosConOriginal
      ? itemsConCosto.reduce((s, d) => s + (d.precioOriginal ?? 0), 0)
      : null

    rollups.set(item.id, {
      totalCalculado,
      totalOriginal,
      excede: totalOriginal != null && totalCalculado - totalOriginal > UMBRAL_ALERTA_PRESUPUESTO,
    })
  }

  return rollups
}

function EtiquetaEstadoApu({
  estado,
  motivos,
  onRevisar,
}: {
  estado: EstadoApuFila
  motivos?: MotivoRechazoPorItem[]
  onRevisar?: () => void
}) {
  if (estado === "sin_apu") return null

  if (estado === "rechazado") {
    const motivoTexto = motivos
      ?.map((m) => `${m.descripcion}: ${m.motivo ?? "sin motivo escrito"}`)
      .join(" · ")
    return (
      <div className="flex flex-col items-center gap-0.5 max-w-[180px]">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRevisar?.()
          }}
          className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-200"
        >
          RECHAZADO
        </button>
        {motivoTexto && (
          <span className="text-[10px] text-red-700 text-center leading-tight break-words">
            {motivoTexto}
          </span>
        )}
      </div>
    )
  }

  if (estado === "pendiente") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onRevisar?.()
        }}
        title="Hay insumos de este ítem esperando aprobación -- click para revisar"
        className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-200"
      >
        PENDIENTE DE APROBACIÓN
      </button>
    )
  }

  return (
    <span
      title="Todos los insumos de este APU ya están en la base"
      className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
    >
      LISTO PARA SUBIR
    </span>
  )
}

export function PresupuestoTable({
  data,
  onChange,
  onEditarApu,
  onActualizarCantidadGuardada,
  onEliminarItem,
  idResaltado,
  soloLectura,
  estadosApu,
  motivosRechazo,
  onRevisarItem,
}: {
  data: ItemPresupuesto[]
  onChange: (data: ItemPresupuesto[]) => void
  onEditarApu?: (item: ItemPresupuesto) => void
  // Ítems ya guardados en la base de datos no se pueden editar tocando el
  // estado local (se perdería en el próximo guardado, que solo manda los
  // ítems con guardado:false) -- necesitan su propio round-trip al
  // servidor. Ver actualizarCantidadPresupuestoItem en actions.ts.
  onActualizarCantidadGuardada?: (id: string, nuevaCantidad: number) => void | Promise<void>
  // Elimina la fila del presupuesto. Si el ítem tiene sub-ítems (otras
  // filas cuyo padreId apunta a este), page.tsx los elimina también en
  // cascada -- no se pasa cuando soloLectura es true.
  onEliminarItem?: (id: string) => void
  // id del ítem al que se acaba de hacer scroll desde el árbol de
  // navegación (PresupuestoTree) -- se resalta un momento para que sea
  // fácil ubicarlo entre cientos de filas. El padre (page.tsx) es quien
  // controla cuándo se apaga (con un timeout).
  idResaltado?: string | null
  // true cuando `data` es una versión VIEJA (de solo lectura) del
  // presupuesto -- fuerza el modo "ya guardado" en todas las filas sin
  // importar item.guardado, para que no se pueda editar cantidad ni abrir
  // el editor de APU sobre una foto congelada.
  soloLectura?: boolean
  // estado de APU por ítem ("listo"/"pendiente"/"rechazado"), calculado
  // en page.tsx vía obtenerEstadoApuPorItem -- determina el color de
  // cada fila. Opcional: si no se pasa, ninguna fila se pinta.
  estadosApu?: Record<string, EstadoApuItem>
  motivosRechazo?: Record<string, MotivoRechazoPorItem[]>
  // abre el diálogo de revisión ACOTADO a este ítem puntual -- se llama
  // al hacer click en la etiqueta de estado (pendiente/rechazado).
  onRevisarItem?: (itemId: string) => void
}) {
  function actualizarCampo(
    id: string,
    campo: keyof ItemPresupuesto,
    valor: string
  ) {
    onChange(
      data.map((item) => {
        if (item.id !== id) return item
        // defensa extra: una fila ya guardada en la base de datos no se
        // vuelve a mandar en el próximo guardado, así que editarla aquí
        // se perdería en silencio -- por eso también está deshabilitado
        // el input, pero por si acaso.
        if (item.guardado) return item

        if (campo === "cantidad") {
          const cantidad = valor === "" ? null : Number(valor)
          // BUG que arreglamos acá: antes esto dejaba cantidad actualizada
          // pero valorTotal intacto (nunca se recalculaba), así que la
          // tarjeta de "Valor presupuesto" no reflejaba lo que se acababa
          // de escribir aunque el ítem ya tuviera valorUnitario (de un
          // APU ya armado antes de guardar).
          const valorTotal =
            cantidad != null && item.valorUnitario != null
              ? cantidad * item.valorUnitario
              : null
          return { ...item, cantidad, valorTotal }
        }

        return { ...item, [campo]: valor }
      })
    )
  }

  const rollupsPorCapitulo = calcularRollupsPorCapitulo(data)

  return (
    // overflow-hidden -> overflow-x-auto: antes el scroll horizontal de
    // una tabla ancha se lo comía el layout completo (había que cerrar
    // el sidebar para que cupiera) -- ahora el scroll queda contenido
    // acá, dentro de la tabla misma. Ver también layout-inside.tsx
    // (min-w-0 en SidebarInset) para el arreglo complementario.
    <div className="overflow-x-auto rounded-md border">
      <Table className="table-fixed border-separate border-spacing-0">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`w-32 ${headClasses}`}>Código</TableHead>
            <TableHead className={`w-[420px] ${headClasses}`}>Descripción</TableHead>
            <TableHead className={`w-24 ${headClasses}`}>Unidad</TableHead>
            <TableHead className={`w-28 text-right ${headClasses}`}>Cantidad</TableHead>
            <TableHead className={`w-32 text-right ${headClasses}`}>Valor unitario</TableHead>
            <TableHead className={`w-32 text-right ${headClasses}`}>Valor total</TableHead>
            <TableHead className={`w-32 text-right ${headClasses}`}>Presupuesto original</TableHead>
            <TableHead className={`w-40 ${headClasses}`}>APU</TableHead>
            <TableHead className={`w-10 ${headClasses}`} />
          </TableRow>
        </TableHeader>

        <TableBody>
          {data.map((item) => {
            const estadoApu = estadoApuDeFila(item, estadosApu?.[item.id])
            const estiloEstado = FILA_ESTILO_POR_ESTADO[estadoApu]

            const rollup = rollupsPorCapitulo.get(item.id)
            // Fila hoja: compara su propio valorTotal/precioOriginal.
            // Fila capítulo (tiene rollup): compara los totales sumados
            // de sus descendientes -- ver calcularRollupsPorCapitulo.
            const excedePresupuesto = rollup
              ? rollup.excede
              : excedePresupuestoOriginal(item.valorTotal, item.precioOriginal)

            const valorOriginalMostrado = rollup ? rollup.totalOriginal : item.precioOriginal

            return (
            <TableRow
              key={item.id}
              id={`item-${item.id}`}
              onDoubleClick={() => onEditarApu?.(item)}
              title={soloLectura ? "Versión anterior -- solo lectura" : "Doble click para ver/editar el APU"}
              className={
                item.id === idResaltado
                  ? "bg-accent hover:bg-accent cursor-pointer transition-colors"
                  : excedePresupuesto
                    ? "bg-red-600/25 hover:bg-red-600/35 cursor-pointer transition-colors"
                    : soloLectura
                      ? "bg-muted/20 hover:bg-muted/20"
                      : `cursor-pointer ${estiloEstado || (item.guardado ? "bg-muted/20 hover:bg-muted/20" : "hover:bg-accent/60")}`
              }
            >
              <TableCell
                className={`${cellClasses} border-b px-2 font-mono text-xs text-muted-foreground`}
              >
                {item.codigo}
              </TableCell>

              <TableCell
                className={`${cellClasses} border-b`}
                style={{ paddingLeft: `${(item.nivel - 1) * 20}px` }}
              >
                {item.guardado ? (
                  <span
                    className={`block whitespace-normal break-words px-2 py-1 text-xs ${item.nivel === 1 ? "font-semibold" : ""}`}
                  >
                    {item.descripcion}
                  </span>
                ) : (
                  <DescripcionTextarea
                    value={item.descripcion ?? ""}
                    onChange={(valor) => actualizarCampo(item.id, "descripcion", valor)}
                    className={
                      item.nivel === 1 ? `${textareaClasses} font-semibold` : textareaClasses
                    }
                  />
                )}
              </TableCell>

              <TableCell className={`${cellClasses} border-b`}>
                {item.guardado ? (
                  <span className="block px-2 py-1 text-xs text-muted-foreground">
                    {item.unidad ?? "—"}
                  </span>
                ) : (
                  <Input
                    value={item.unidad ?? ""}
                    onChange={(e) => actualizarCampo(item.id, "unidad", e.target.value)}
                    className={inputClasses}
                  />
                )}
              </TableCell>

              <TableCell className={`${cellClasses} border-b`}>
                {item.guardado && !soloLectura ? (
                  <CantidadItemGuardadoEditable
                    valor={item.cantidad}
                    onGuardar={(nuevaCantidad) =>
                      onActualizarCantidadGuardada?.(item.id, nuevaCantidad)
                    }
                  />
                ) : item.guardado ? (
                  <span className="block px-2 py-1 text-right text-xs text-muted-foreground">
                    {item.cantidad ?? "—"}
                  </span>
                ) : (
                  <Input
                    type="number"
                    value={item.cantidad ?? ""}
                    onChange={(e) => actualizarCampo(item.id, "cantidad", e.target.value)}
                    className={`${inputClasses} text-right`}
                  />
                )}
              </TableCell>

              <TableCell className={`${cellClasses} border-b px-2 py-1 text-right text-xs`}>
                {item.valorUnitario != null
                  ? item.valorUnitario.toLocaleString("es-CO", {
                      style: "currency",
                      currency: "COP",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </TableCell>

              <TableCell
                className={`${cellClasses} border-b px-2 py-1 text-right text-xs font-medium ${
                  excedePresupuesto ? "text-red-950" : ""
                }`}
              >
                {(rollup ? rollup.totalCalculado : item.valorTotal) != null
                  ? (rollup ? rollup.totalCalculado : item.valorTotal!).toLocaleString("es-CO", {
                      style: "currency",
                      currency: "COP",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </TableCell>

              <TableCell
                className={`${cellClasses} border-b px-2 py-1 text-right text-xs ${
                  excedePresupuesto ? "font-semibold text-red-950" : "text-muted-foreground"
                }`}
              >
                {valorOriginalMostrado != null
                  ? valorOriginalMostrado.toLocaleString("es-CO", {
                      style: "currency",
                      currency: "COP",
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </TableCell>

              <TableCell className={`${cellClasses} border-b px-2 text-center`}>
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEditarApu?.(item)}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {item.apuId ? "Editar APU" : "Agregar APU"}
                  </button>
                  <EtiquetaEstadoApu
                    estado={estadoApu}
                    motivos={motivosRechazo?.[item.id]}
                    onRevisar={() => onRevisarItem?.(item.id)}
                  />
                  {excedePresupuesto && (
                    <span
                      title="El valor calculado supera el presupuesto original del Excel en más de $1.000"
                      className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    >
                      ⚠ SUPERA PRESUPUESTO
                    </span>
                  )}
                </div>
              </TableCell>

              <TableCell className={`${cellClasses} border-b px-1 text-center`}>
                <div className="flex items-center justify-center gap-1">
                  {item.guardado && (
                    <span title="Guardado en la base de datos" className="text-xs text-emerald-600">
                      ✓
                    </span>
                  )}
                  {item.pendienteAprobacion && (
                    <span
                      title="Insumo nuevo pendiente de aprobación"
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                    >
                      Pend.
                    </span>
                  )}
                  {onEliminarItem && !soloLectura && (
                    <button
                      type="button"
                      onClick={(e) => {
                        // si no, el click también dispara el onDoubleClick
                        // de la fila (abre el editor de APU) al segundo click
                        e.stopPropagation()
                        const tieneHijos = data.some((i) => i.padreId === item.id)
                        if (
                          confirm(
                            `¿Eliminar "${item.descripcion}"?` +
                              (tieneHijos ? " Sus sub-ítems también se eliminan." : "")
                          )
                        ) {
                          onEliminarItem(item.id)
                        }
                      }}
                      title="Eliminar fila"
                      className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </TableCell>
            </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}