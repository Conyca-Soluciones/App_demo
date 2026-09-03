"use client"

import { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  buscarInsumos,
  buscarInsumosSimilares,
  crearSolicitudInsumo,
  obtenerApuDeItem,
  crearApuParaItem,
  crearApuStandalone,
  previsualizarApu,
  agregarInsumoApu,
  // actualizarPrecioInsumo,
  actualizarCantidadItemApu,
  actualizarRendimientoItemApu,
  eliminarInsumoApu,
  recalcularValorItemDesdeApu,
  type InsumoSugerido,
  type InsumoSimilar,
  type ApuDeItem,
  type ItemApu,
} from "@/app/(app)/presupuestos/actions"
import { CATEGORIAS_APU } from "@/app/(app)/presupuestos/categorias-apu"
import { DropdownFlotante } from "@/components/dropdown-flotante"

const PRECIOS_PLACEHOLDER = [0, 1]

function esPrecioPlaceholder(precio: number | null) {
  return precio == null || PRECIOS_PLACEHOLDER.includes(precio)
}

function formatoCOP(valor: number) {
  return valor.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
}

// pequeños avisos junto a cada sugerencia de INSUMO, para que el
// ingeniero vea POR QUÉ algo no es un match exacto en vez de que quede
// escondido -- puede ser justo la opción correcta con otro tamaño/unidad.
// (Esto es matching de insumo individual -- se mantiene. Lo que se quitó
// es la sugerencia de APU *completo*, ver nota de decisión de negocio
// más abajo.)
function BadgesDiferencia({
  medidaDistinta,
  unidadDistinta,
}: {
  medidaDistinta?: boolean
  unidadDistinta?: boolean
}) {
  if (!medidaDistinta && !unidadDistinta) return null
  return (
    <span className="inline-flex gap-1">
      {medidaDistinta && (
        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
          medida distinta
        </span>
      )}
      {unidadDistinta && (
        <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-800">
          unidad distinta
        </span>
      )}
    </span>
  )
}

// A qué categoría (de CATEGORIAS_APU) pertenece un tipo real de
// maestro_insumos -- para mostrar cada línea del APU bajo su sección.
function categoriaDeTipo(tipo: string | null): string {
  if (!tipo) return "Otros"
  const cat = CATEGORIAS_APU.find((c) => (c.tipos as readonly string[]).includes(tipo))
  return cat?.nombre ?? "Otros"
}

// Celda de cantidad editable con doble click -- en toda la tabla del
// APU, SOLO la cantidad se puede tocar así (descripción, unidad y
// precio siguen siendo de solo lectura acá; el precio se cambia desde
// maestro_insumos, no por línea).
function CantidadEditable({
  valor,
  onGuardar,
}: {
  valor: number
  onGuardar: (nuevoValor: number) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valorLocal, setValorLocal] = useState(String(valor))

  useEffect(() => {
    setValorLocal(String(valor))
  }, [valor])

  function confirmar() {
    setEditando(false)
    const num = Number(valorLocal)
    if (!Number.isNaN(num) && num > 0 && num !== valor) {
      onGuardar(num)
    } else {
      setValorLocal(String(valor)) // valor inválido o sin cambio -> revertir
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
            setValorLocal(String(valor))
            setEditando(false)
          }
        }}
        className="w-20 rounded border px-1.5 py-0.5 text-right text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  return (
    <span
      onDoubleClick={() => setEditando(true)}
      title="Doble click para editar la cantidad"
      className="cursor-pointer rounded px-1.5 py-0.5 hover:bg-muted"
    >
      {valor}
    </span>
  )
}

// clase para que el scroll interno del diálogo se vea siempre (no
// depende de que el sistema operativo muestre la barra por defecto) --
// el "slider" para bajar que se pidió.
const scrollClasses =
  "overflow-y-scroll [scrollbar-gutter:stable] " +
  "[&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 " +
  "[&::-webkit-scrollbar-thumb:hover]:bg-muted-foreground/50"

export function ApuEditorDialog({
  open,
  onOpenChange,
  presupuestoItemId,
  codigo,
  descripcion,
  guardado,
  apuIdPendiente,
  onValorActualizado,
  onApuIdPendienteCreado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presupuestoItemId: string
  codigo: string
  descripcion: string
  // false si el ítem todavía no se ha guardado en presupuesto_items --
  // en ese caso el APU se arma "suelto" (standalone) y solo se enlaza
  // al ítem cuando se guarde el presupuesto completo.
  guardado: boolean
  // id del apu ya creado en una sesión anterior de este mismo ítem sin
  // guardar todavía (para poder seguir editándolo si se cierra y se
  // vuelve a abrir el diálogo antes de guardar).
  apuIdPendiente?: string | null
  onValorActualizado?: (valorUnitario: number, valorTotal: number | null) => void
  // avisa al padre que se creó un apu para un ítem SIN guardar, para que
  // lo recuerde en el estado local (item.apuIdPendiente) y lo mande a
  // enlazar cuando se guarde todo.
  onApuIdPendienteCreado?: (apuId: string) => void
}) {
  const [apu, setApu] = useState<ApuDeItem | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null)
  // Feedback visual de que un cambio SÍ se guardó -- para ítems ya
  // guardados, cada edición de APU (agregar/quitar insumo, cambiar
  // cantidad) escribe directo a la base de datos apenas pasa, sin pasar
  // por el botón "Guardar en base de datos" de la página (ese botón es
  // solo para ítems nuevos). Sin este aviso, el guardado quedaba
  // silencioso y parecía que "no dejaba guardar".
  const [guardadoReciente, setGuardadoReciente] = useState(false)
  function avisarGuardado() {
    if (!guardado) return // ítems sin guardar sí dependen del botón de la página
    setGuardadoReciente(true)
    setTimeout(() => setGuardadoReciente(false), 1800)
  }

  // Creando el APU nuevo (botón "Crear APU nuevo" cuando el ítem
  // todavía no tiene ninguno) -- antes este mismo estado también
  // cubría "copiando un APU sugerido", ya no aplica (ver decisión de
  // negocio abajo).
  const [creandoApu, setCreandoApu] = useState(false)

  useEffect(() => {
    if (!open) return
    cargarTodo()
  }, [open, presupuestoItemId, guardado, apuIdPendiente])

  // ---------------------------------------------------------------------
  // DECISIÓN DE NEGOCIO (no técnica): este editor YA NO sugiere copiar un
  // APU completo de otro ítem/proyecto -- dos ítems con descripción casi
  // idéntica pueden necesitar insumos de marca/especificación distinta
  // según la entidad (ej. un "bombillo" puede exigir una marca puntual en
  // un contrato y otra en otro). Cada APU se arma desde cero, insumo por
  // insumo -- el matching por INSUMO individual (buscarInsumosSimilares,
  // más abajo en BuscadorInsumoCategoria) sigue exactamente igual, solo
  // se quitó el atajo de "copiar un APU entero".
  // ---------------------------------------------------------------------

  async function cargarTodo() {
    setCargando(true)
    setError(null)
    try {
      // ítem ya guardado -> el apu (si existe) vive en presupuesto_items.apu_id
      // ítem SIN guardar -> el apu (si existe) es el que se armó suelto antes
      // (apuIdPendiente); si tampoco hay eso, no tiene apu todavía.
      const actual = guardado
        ? await obtenerApuDeItem(presupuestoItemId)
        : apuIdPendiente
          ? await previsualizarApu(apuIdPendiente)
          : null

      setApu(actual)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el APU")
    } finally {
      setCargando(false)
    }
  }

  async function recargarApu(apuId: string) {
    const actualizado = await previsualizarApu(apuId)
    setApu(actualizado)

    if (guardado) {
      // ítem ya real en la base -> recalcular y guardar el valor de
      // verdad, propagándolo a la tabla del presupuesto.
      try {
        const { valorUnitario, valorTotal } = await recalcularValorItemDesdeApu(presupuestoItemId)
        onValorActualizado?.(valorUnitario, valorTotal)
      } catch (e) {
        console.error("No se pudo recalcular el valor del ítem:", e)
      }
    } else {
      // ítem todavía sin guardar -> el total es solo una vista previa
      // calculada en el navegador (no hay fila real que actualizar
      // todavía). Se recalcula de verdad cuando se guarde el presupuesto.
      const totalLocal = actualizado.items.reduce(
        (acc, it) => acc + (it.vrUnitario ?? 0) * it.cantidad * it.rendimiento,
        0
      )
      onValorActualizado?.(totalLocal, null)
    }
  }

  async function handleCrearApuNuevo() {
    setCreandoApu(true)
    setError(null)
    try {
      if (guardado) {
        const nuevo = await crearApuParaItem(presupuestoItemId, codigo, descripcion)
        setApu(nuevo)
        avisarGuardado()
      } else {
        const nuevo = await crearApuStandalone(codigo, descripcion)
        setApu(nuevo)
        onApuIdPendienteCreado?.(nuevo.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el APU.")
    } finally {
      setCreandoApu(false)
    }
  }

  async function handleEliminarLinea(itemApuId: string) {
    if (!apu) return
    try {
      await eliminarInsumoApu(itemApuId)
      await recargarApu(apu.id)
      avisarGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar la línea.")
    }
  }

  async function handleEditarCantidad(itemApuId: string, nuevaCantidad: number) {
    if (!apu) return
    try {
      await actualizarCantidadItemApu(itemApuId, nuevaCantidad)
      await recargarApu(apu.id)
      avisarGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la cantidad.")
    }
  }

  async function handleEditarRendimiento(itemApuId: string, nuevoRendimiento: number) {
    if (!apu) return
    try {
      await actualizarRendimientoItemApu(itemApuId, nuevoRendimiento)
      await recargarApu(apu.id)
      avisarGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el rendimiento.")
    }
  }

  const total = apu?.items.reduce((acc, it) => acc + (it.vrUnitario ?? 0) * it.cantidad * it.rendimiento, 0) ?? 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] w-[95vw] max-w-[1600px] sm:max-w-[1600px] flex-col overflow-hidden p-0"
      >
        <DialogHeader className="border-b px-8 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl">
            APU — {codigo} · {descripcion}
            {guardadoReciente && (
              <span className="animate-in fade-in text-sm font-normal text-emerald-600">
                ✓ Guardado
              </span>
            )}
          </DialogTitle>
          {guardado && (
            <p className="text-xs text-muted-foreground">
              Los cambios en este APU se guardan solos, apenas los haces -- no
              necesitas el botón "Guardar en base de datos" de la página.
            </p>
          )}
        </DialogHeader>

        <div className={`flex-1 space-y-5 px-8 py-6 ${scrollClasses}`}>
          {cargando && <p className="text-sm text-muted-foreground">Cargando...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* ítem sin APU todavía -- se arma desde cero, insumo por
              insumo (ya no se ofrece copiar uno parecido) */}
          {!cargando && !apu && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-5 py-4">
              <p className="text-sm text-muted-foreground">
                Este ítem todavía no tiene APU. Se arma agregando los insumos uno por uno.
              </p>
              <Button variant="outline" onClick={handleCrearApuNuevo} disabled={creandoApu}>
                {creandoApu ? "Creando..." : "Crear APU nuevo"}
              </Button>
            </div>
          )}

          {apu && (
            <div className="space-y-5">
              {apu.usos > 1 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Este APU se usa en <strong>{apu.usos} ítems</strong> (de este y otros
                  proyectos). Cualquier cambio que hagas aquí se refleja en todos ellos.
                </div>
              )}

              {CATEGORIAS_APU.map((cat) => {
                const itemsCategoria = apu.items.filter(
                  (it) => categoriaDeTipo(it.tipo) === cat.nombre
                )

                return (
                  <SeccionCategoria
                    key={cat.nombre}
                    nombre={cat.nombre}
                    tipos={cat.tipos as unknown as string[]}
                    items={itemsCategoria}
                    abierta={categoriaAbierta === cat.nombre}
                    onAbrir={() =>
                      setCategoriaAbierta(categoriaAbierta === cat.nombre ? null : cat.nombre)
                    }
                    onEliminarLinea={handleEliminarLinea}
                    onEditarCantidad={handleEditarCantidad}
                    onEditarRendimiento={handleEditarRendimiento}
                    onAgregado={async () => {
                      await recargarApu(apu.id)
                      setCategoriaAbierta(null)
                      avisarGuardado()
                    }}
                    apuId={apu.id}
                    presupuestoItemId={presupuestoItemId}
                  />
                )
              })}

              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-5 py-4 font-medium">
                <span>Precio unitario del APU</span>
                <span className="text-lg">{formatoCOP(total)}</span>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Una sección de categoría (Materiales, Mano de Obra, etc.): muestra sus
// líneas actuales y, si está abierta, el buscador para agregar una nueva
// -- filtrado SIEMPRE a los `tipos` reales de esa categoría.
// ---------------------------------------------------------------------------

function SeccionCategoria({
  nombre,
  tipos,
  items,
  abierta,
  onAbrir,
  onEliminarLinea,
  onEditarCantidad,
  onEditarRendimiento,
  onAgregado,
  apuId,
  presupuestoItemId,
}: {
  nombre: string
  tipos: string[]
  items: ItemApu[]
  abierta: boolean
  onAbrir: () => void
  onEliminarLinea: (id: string) => void
  onEditarCantidad: (id: string, nuevaCantidad: number) => void
  onEditarRendimiento: (id: string, nuevoRendimiento: number) => void
  onAgregado: () => void
  apuId: string
  presupuestoItemId: string
}) {
  const subtotal = items.reduce((acc, it) => acc + (it.vrUnitario ?? 0) * it.cantidad * it.rendimiento, 0)

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between bg-muted/50 px-4 py-3">
        <p className="text-sm font-medium">{nombre}</p>
        <div className="flex items-center gap-4">
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">{formatoCOP(subtotal)}</span>
          )}
          <Button size="sm" variant="outline" onClick={onAbrir}>
            {abierta ? "Cerrar" : "+ Agregar"}
          </Button>
        </div>
      </div>

      {items.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t bg-muted/30 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Descripción</th>
              <th className="px-4 py-2 font-medium">Unidad</th>
              <th className="px-4 py-2 font-medium text-right">Cantidad</th>
              <th className="px-4 py-2 font-medium text-right">Rendimiento</th>
              <th className="px-4 py-2 font-medium text-right">Precio unitario</th>
              <th className="px-4 py-2 font-medium text-right">Total</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t">
                <td className="px-4 py-2.5">{it.descripcion}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{it.uM ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <CantidadEditable
                    valor={it.cantidad}
                    onGuardar={(nuevaCantidad) => onEditarCantidad(it.id, nuevaCantidad)}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <CantidadEditable
                    valor={it.rendimiento}
                    onGuardar={(nuevoRendimiento) => onEditarRendimiento(it.id, nuevoRendimiento)}
                  />
                </td>
                <td className="px-4 py-2.5 text-right">
                  {it.vrUnitario != null ? formatoCOP(it.vrUnitario) : "—"}
                </td>
                <td className="px-4 py-2.5 text-right font-medium">
                  {formatoCOP((it.vrUnitario ?? 0) * it.cantidad * it.rendimiento)}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <button
                    type="button"
                    onClick={() => onEliminarLinea(it.id)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {abierta && (
        <div className="border-t bg-muted/10 p-4">
          <BuscadorInsumoCategoria
            tipos={tipos}
            categoriaNombre={nombre}
            apuId={apuId}
            presupuestoItemId={presupuestoItemId}
            onAgregado={onAgregado}
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Buscador + pattern matching de INSUMO individual, acotado a los
// `tipos` de una sola categoría -- "solo se pueden añadir elementos que
// estén ahí". Este flujo NO cambió -- la decisión de negocio fue quitar
// la sugerencia de APU completo (arriba), no el matching de insumo.
// ---------------------------------------------------------------------------

function BuscadorInsumoCategoria({
  tipos,
  categoriaNombre,
  apuId,
  presupuestoItemId,
  onAgregado,
}: {
  tipos: string[]
  categoriaNombre: string
  apuId: string
  presupuestoItemId: string
  onAgregado: () => void
}) {
  const [busqueda, setBusqueda] = useState("")
  const [sugerencias, setSugerencias] = useState<InsumoSugerido[]>([])
  const [seleccionado, setSeleccionado] = useState<InsumoSugerido | null>(null)
  const [similares, setSimilares] = useState<InsumoSimilar[] | null>(null)
  const [cantidad, setCantidad] = useState("")
  const [rendimiento, setRendimiento] = useState("1")
  const [precioNuevo, setPrecioNuevo] = useState("")
  const [verificando, setVerificando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)

  // Flujo de "solicitar insumo nuevo": primero corre buscarInsumosSimilares
  // (motor de similitud de INSUMO, se mantiene igual) para evitar
  // duplicados; si de verdad no hay nada parecido, se muestra este
  // formulario corto (unidad + tipo, SIN precio -- eso lo pone quien
  // aprueba) y la solicitud queda pendiente en /admin-insumos.
  const [mostrandoFormNuevo, setMostrandoFormNuevo] = useState(false)
  const [uMInsumoNuevo, setUMInsumoNuevo] = useState("")
  const [tipoInsumoNuevo, setTipoInsumoNuevo] = useState(tipos[0] ?? "")
  const [enviandoSolicitud, setEnviandoSolicitud] = useState(false)
  const [solicitudEnviada, setSolicitudEnviada] = useState(false)

  const inputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (seleccionado) return
    if (busqueda.trim().length < 2) {
      setSugerencias([])
      return
    }
    const timeout = setTimeout(() => {
      buscarInsumos(busqueda, tipos).then(setSugerencias).catch(console.error)
    }, 300)
    return () => clearTimeout(timeout)
  }, [busqueda, seleccionado, tipos])

  function elegirSugerencia(insumo: InsumoSugerido) {
    setSeleccionado(insumo)
    setBusqueda(insumo.descripcion)
    setSugerencias([])
    setSimilares(null)
    setMensaje(null)
  }

  async function handleAgregar() {
    if (!seleccionado) return
    setMensaje(null)

    if (!cantidad || Number(cantidad) <= 0) {
      setMensaje("Ingresa una cantidad válida.")
      return
    }

    try {
      // if (esPrecioPlaceholder(seleccionado.vr_unitario)) {
      //   if (!precioNuevo || Number(precioNuevo) <= 0) {
      //     setMensaje(
      //       `"${seleccionado.descripcion}" todavía no tiene precio real -- ingresa el precio unitario para poder agregarlo.`
      //     )
      //     return
      //   }
      //   await actualizarPrecioInsumo(seleccionado.codigo, Number(precioNuevo))
      // }

      await agregarInsumoApu({
        apuId,
        insumoId: seleccionado.id,
        cantidad: Number(cantidad),
        rendimiento: rendimiento ? Number(rendimiento) : 1,
      })

      onAgregado()
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo agregar el insumo.")
    }
  }

  async function handleVerificarNuevo() {
    const texto = busqueda.trim()
    if (texto.length < 2) return

    setVerificando(true)
    setMensaje(null)
    try {
      const parecidos = await buscarInsumosSimilares(texto, 0.4, tipos)
      if (parecidos.length > 0) {
        setSimilares(parecidos)
        return
      }

      // nada parecido -> mostrar el formulario corto para SOLICITARLO
      // (no crearlo directo -- queda pendiente de aprobación)
      setMostrandoFormNuevo(true)
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo verificar el insumo.")
    } finally {
      setVerificando(false)
    }
  }

  async function handleEnviarSolicitud() {
    const texto = busqueda.trim()
    if (texto.length < 2) return

    if (!tipoInsumoNuevo) {
      setMensaje("Elige un tipo para la solicitud.")
      return
    }

    setEnviandoSolicitud(true)
    setMensaje(null)
    try {
      await crearSolicitudInsumo({
        descripcion: texto,
        tipo: tipoInsumoNuevo,
        uM: uMInsumoNuevo || null,
        presupuestoItemId,
      })
      setMostrandoFormNuevo(false)
      setUMInsumoNuevo("")
      setSimilares(null)
      setSolicitudEnviada(true)
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : "No se pudo enviar la solicitud.")
    } finally {
      setEnviandoSolicitud(false)
    }
  }

  return (
    <div className="space-y-3">
      <div ref={inputRef} className="relative">
        <Input
          value={busqueda}
          onChange={(e) => {
            setBusqueda(e.target.value)
            setSeleccionado(null)
            setSimilares(null)
            setMensaje(null)
            setSolicitudEnviada(false)
          }}
          placeholder={`Busca un insumo de ${categoriaNombre.toLowerCase()}...`}
          className="h-10"
        />
      </div>
      <DropdownFlotante anchorRef={inputRef} abierto={sugerencias.length > 0 && !seleccionado}>
        <div className="max-h-72 w-full overflow-auto rounded-lg border bg-background shadow-lg">
          {sugerencias.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => elegirSugerencia(s)}
              className="flex w-full flex-col items-start gap-0.5 border-b px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-muted"
            >
              <span>{s.descripcion}</span>
              <span className="text-xs text-muted-foreground">
                {s.codigo} · {s.u_m ?? "sin unidad"} ·{" "}
                {esPrecioPlaceholder(s.vr_unitario) ? (
                  <span className="text-amber-700">sin precio real</span>
                ) : (
                  formatoCOP(s.vr_unitario as number)
                )}
              </span>
            </button>
          ))}
        </div>
      </DropdownFlotante>

      {seleccionado && (
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-32 space-y-1.5">
            <label className="text-xs text-muted-foreground">Cantidad</label>
            <Input
              type="number"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="w-32 space-y-1.5">
            <label className="text-xs text-muted-foreground" title="Multiplicador libre, default 1 -- ej. factor de productividad de mano de obra">
              Rendimiento
            </label>
            <Input
              type="number"
              value={rendimiento}
              onChange={(e) => setRendimiento(e.target.value)}
              className="h-10"
            />
          </div>

          {esPrecioPlaceholder(seleccionado.vr_unitario) && (
            <div className="w-44 space-y-1.5">
              <label className="text-xs text-amber-700">Sin precio real -- ingrésalo</label>
              <Input
                type="number"
                value={precioNuevo}
                onChange={(e) => setPrecioNuevo(e.target.value)}
                className="h-10 border-amber-300"
              />
            </div>
          )}

          <Button onClick={handleAgregar}>Agregar</Button>
        </div>
      )}

      {!seleccionado && busqueda.trim().length >= 2 && sugerencias.length === 0 && !solicitudEnviada && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            No hay ningún insumo de {categoriaNombre.toLowerCase()} con ese nombre.
          </p>
          <Button variant="outline" size="sm" onClick={handleVerificarNuevo} disabled={verificando}>
            {verificando ? "Verificando..." : `Solicitar "${busqueda}" como insumo nuevo`}
          </Button>
        </div>
      )}

      {similares && similares.length > 0 && !mostrandoFormNuevo && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">
            Ya existe algo parecido -- ¿es el mismo insumo?
          </p>
          {similares.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3">
              <span>
                {s.descripcion}{" "}
                <span className="text-xs text-muted-foreground">
                  ({s.codigo} · {Math.round(s.similitud * 100)}% similar)
                </span>{" "}
                <BadgesDiferencia
                  medidaDistinta={s.medidaDistinta}
                  unidadDistinta={s.unidadDistinta}
                />
              </span>
              <Button size="sm" variant="outline" onClick={() => elegirSugerencia(s)}>
                Usar este
              </Button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setMostrandoFormNuevo(true)}
            className="text-xs text-amber-800 underline underline-offset-2 hover:text-amber-950"
          >
            No, es un insumo distinto -- solicitarlo de todas formas
          </button>
        </div>
      )}

      {mostrandoFormNuevo && (
        <div className="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-4">
          <p className="text-sm font-medium text-sky-900">
            Solicitar &quot;{busqueda.trim()}&quot; como insumo nuevo -- queda pendiente
            de aprobación (le asignan precio en el panel de admin).
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1.5">
              <label className="text-xs text-sky-800">Tipo</label>
              {tipos.length > 1 ? (
                <select
                  value={tipoInsumoNuevo}
                  onChange={(e) => setTipoInsumoNuevo(e.target.value)}
                  className="h-10 w-full rounded-md border bg-white px-2 text-sm"
                >
                  {tipos.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex h-10 items-center rounded-md border bg-white px-2 text-sm text-muted-foreground">
                  {tipoInsumoNuevo}
                </div>
              )}
            </div>

            <div className="w-32 space-y-1.5">
              <label className="text-xs text-sky-800">Unidad</label>
              <Input
                value={uMInsumoNuevo}
                onChange={(e) => setUMInsumoNuevo(e.target.value)}
                className="h-10 bg-white"
                placeholder="ej. m2, un"
              />
            </div>

            <Button onClick={handleEnviarSolicitud} disabled={enviandoSolicitud}>
              {enviandoSolicitud ? "Enviando..." : "Enviar solicitud"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMostrandoFormNuevo(false)
                setUMInsumoNuevo("")
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {solicitudEnviada && (
        <p className="text-sm text-emerald-700">
          ✓ Solicitud enviada -- un admin la revisa en el panel de aprobación y le
          asigna precio. Cuando se apruebe, si este APU ya está armado, el
          insumo se agrega solo con cantidad 1 (puedes ajustarla después).
        </p>
      )}

      {mensaje && <p className="text-sm text-muted-foreground">{mensaje}</p>}
    </div>
  )
}