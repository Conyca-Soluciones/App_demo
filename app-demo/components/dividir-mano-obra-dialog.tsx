"use client"

// Dividir la mano de obra de un ítem en varios trabajos (20270101004400 y
// 004500): la línea del Excel ("Cuadrilla AA" o el nombre del ítem) se
// reemplaza por los trabajos que se escriban (fabricación, instalación...), y
// cada uno se contrata por separado. Mientras se escribe salen sugerencias del
// catálogo para elegir, y antes de enviar se muestran las más parecidas de lo
// que no se eligió; lo que se confirme sin categoría va a Aprobación de mano
// de obra.
// "Juntar otra vez" lo deshace mientras el ítem no tenga contratos.

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  dividirManoObraItem,
  infoDivisionManoObra,
  juntarManoObraItem,
  listarManoObraCategoriasCompleto,
  type InfoDivisionManoObra,
} from "@/app/(app)/presupuestos/actions"
import type { CategoriaManoObra } from "@/lib/apu-import-types"
import { claveActividad, claveUnidad } from "@/lib/solicitudes-recurso"
import { DropdownFlotante } from "@/components/dropdown-flotante"

const pesos = (n: number) => n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()

type Trabajo = { nombre: string; categoriaId: string | null }
const VACIO: Trabajo = { nombre: "", categoriaId: null }

// Sugerencias del catálogo para lo que se escribe: categorías que traen todas
// las palabras escritas; primero las de la unidad del ítem.
function sugerencias(catalogo: CategoriaManoObra[], texto: string, unidad: string | null): CategoriaManoObra[] {
  const palabras = normalizar(texto).split(/\s+/).filter((p) => p.length >= 2)
  if (palabras.length === 0) return []
  const u = claveUnidad(unidad)
  return catalogo
    .filter((c) => c.valorUnitario != null)
    .filter((c) => {
      const n = normalizar(c.categoria)
      return palabras.every((p) => n.includes(p))
    })
    .sort((a, b) => Number(claveUnidad(b.unidad) === u) - Number(claveUnidad(a.unidad) === u) || a.categoria.length - b.categoria.length)
    .slice(0, 8)
}

// Las más parecidas aunque no traigan todas las palabras: las que comparten
// más palabras (de 3 letras o más) con lo escrito.
function parecidas(catalogo: CategoriaManoObra[], texto: string, unidad: string | null, limite = 3): CategoriaManoObra[] {
  const palabras = normalizar(texto).split(/\s+/).filter((p) => p.length >= 3)
  if (palabras.length === 0) return []
  const u = claveUnidad(unidad)
  return catalogo
    .filter((c) => c.valorUnitario != null)
    .map((c) => {
      const n = normalizar(c.categoria)
      return { c, puntos: palabras.filter((p) => n.includes(p)).length }
    })
    .filter((x) => x.puntos > 0)
    .sort(
      (a, b) =>
        b.puntos - a.puntos ||
        Number(claveUnidad(b.c.unidad) === u) - Number(claveUnidad(a.c.unidad) === u) ||
        a.c.categoria.length - b.c.categoria.length
    )
    .slice(0, limite)
    .map((x) => x.c)
}

// Una fila de la ventana: el nombre del trabajo con sus sugerencias.
function FilaTrabajo({
  indice,
  trabajo,
  catalogo,
  catalogoPorId,
  catalogoPorNombre,
  unidad,
  placeholder,
  disabled,
  puedeQuitar,
  onCambiar,
  onQuitar,
}: {
  indice: number
  trabajo: Trabajo
  catalogo: CategoriaManoObra[]
  catalogoPorId: Map<string, CategoriaManoObra>
  catalogoPorNombre: Map<string, CategoriaManoObra>
  unidad: string | null
  placeholder: string
  disabled: boolean
  puedeQuitar: boolean
  onCambiar: (t: Trabajo) => void
  onQuitar: () => void
}) {
  const ancla = useRef<HTMLInputElement>(null)
  const [abierto, setAbierto] = useState(false)
  const elegida = trabajo.categoriaId ? catalogoPorId.get(trabajo.categoriaId) : undefined
  const igual = !elegida && trabajo.nombre.trim() ? catalogoPorNombre.get(claveActividad(trabajo.nombre)) : undefined
  const lista = useMemo(
    () => {
      if (elegida) return []
      const exactas = sugerencias(catalogo, trabajo.nombre, unidad)
      return exactas.length > 0 ? exactas : parecidas(catalogo, trabajo.nombre, unidad, 8)
    },
    [catalogo, trabajo.nombre, unidad, elegida]
  )
  const otraUnidad = elegida && claveUnidad(elegida.unidad) !== claveUnidad(unidad)

  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto_2rem] items-center gap-2">
      <span className="text-sm text-muted-foreground">{indice + 1}</span>
      <div>
        <Input
          ref={ancla}
          value={trabajo.nombre}
          onChange={(e) => {
            onCambiar({ nombre: e.target.value, categoriaId: null })
            setAbierto(true)
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          onKeyDown={(e) => {
            // Escape cierra primero la lista, no toda la ventana.
            if (e.key === "Escape" && abierto && lista.length > 0) {
              e.preventDefault()
              e.stopPropagation()
              setAbierto(false)
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={`Trabajo ${indice + 1}`}
        />
        <DropdownFlotante anchorRef={ancla} abierto={abierto && lista.length > 0} anchoMinimo={420}>
          <ul className="max-h-72 overflow-auto rounded-md border bg-popover shadow-lg">
            <li className="border-b px-3 py-1.5 text-xs text-muted-foreground">Del catálogo de mano de obra</li>
            {lista.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onCambiar({ nombre: c.categoria, categoriaId: c.id })
                    setAbierto(false)
                  }}
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>{c.categoria}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {pesos(c.valorUnitario ?? 0)} / {c.unidad}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DropdownFlotante>
      </div>
      {trabajo.nombre.trim() === "" ? (
        <span />
      ) : elegida || igual ? (
        <span
          className="whitespace-nowrap rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          title={otraUnidad ? `La categoría está en ${elegida?.unidad}; el ítem en ${unidad ?? "—"}` : undefined}
        >
          Del catálogo · {pesos((elegida ?? igual)?.valorUnitario ?? 0)}
          {otraUnidad ? ` / ${elegida?.unidad}` : ""}
        </span>
      ) : (
        <span className="whitespace-nowrap rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Nuevo · va a aprobación
        </span>
      )}
      {puedeQuitar ? (
        <button
          type="button"
          aria-label={`Quitar trabajo ${indice + 1}`}
          onClick={onQuitar}
          disabled={disabled}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      ) : (
        <span />
      )}
    </div>
  )
}

export function DividirManoObraDialog({
  open,
  onOpenChange,
  presupuestoItemId,
  codigo,
  descripcion,
  onCambio,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  presupuestoItemId: string
  codigo: string
  descripcion: string
  // Después de dividir o juntar (para recargar el APU o la revisión).
  onCambio: () => void | Promise<void>
}) {
  // Lo cargado y para qué ítem (mientras no sea el actual, se está cargando).
  const [cargado, setCargado] = useState<{
    item: string
    info: InfoDivisionManoObra
    catalogo: CategoriaManoObra[]
  } | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [trabajos, setTrabajos] = useState<Trabajo[]>([VACIO, VACIO])
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  // Antes de enviar a aprobación lo que no se eligió del catálogo, se muestran
  // sus opciones más parecidas (decisión del usuario).
  const [confirmando, setConfirmando] = useState(false)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    if (!open) return
    let vigente = true
    Promise.all([infoDivisionManoObra(presupuestoItemId), listarManoObraCategoriasCompleto()])
      .then(([info, catalogo]: [InfoDivisionManoObra, CategoriaManoObra[]]) => {
        if (vigente) setCargado({ item: presupuestoItemId, info, catalogo })
      })
      .catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : "No se pudo cargar la mano de obra del ítem."))
    return () => {
      vigente = false
    }
  }, [open, presupuestoItemId, recarga])

  const info = cargado?.item === presupuestoItemId ? cargado.info : null
  const cargando = open && !info && !errorCarga

  // Categorías del catálogo en la unidad del ítem, por nombre (una pasada).
  const catalogoPorNombre = useMemo(() => {
    const mapa = new Map<string, CategoriaManoObra>()
    if (!cargado) return mapa
    const unidad = claveUnidad(cargado.info.unidad)
    for (const c of cargado.catalogo) {
      if (c.valorUnitario == null || claveUnidad(c.unidad) !== unidad) continue
      const clave = claveActividad(c.categoria)
      if (!mapa.has(clave)) mapa.set(clave, c)
    }
    return mapa
  }, [cargado])
  const catalogoPorId = useMemo(() => new Map((cargado?.catalogo ?? []).map((c) => [c.id, c])), [cargado])

  const aprobadas = (info?.lineas ?? []).filter((l) => l.estado === "resuelto" && l.valor != null)
  const valorAprobado = aprobadas.reduce((acc, l) => acc + (l.valor ?? 0), 0)

  function cerrar(abierto: boolean) {
    if (!abierto) {
      setTrabajos([VACIO, VACIO])
      setError(null)
      setHecho(null)
      setErrorCarga(null)
    }
    onOpenChange(abierto)
  }

  function validar(): Trabajo[] | null {
    const limpios = trabajos.map((t) => ({ ...t, nombre: t.nombre.trim().replace(/\s+/g, " ") }))
    if (limpios.some((t) => t.nombre === "")) {
      setError("Escribe el nombre de cada trabajo o quita la fila vacía.")
      return null
    }
    if (limpios.length < 2) {
      setError("Escribe al menos dos trabajos.")
      return null
    }
    const claves = limpios.map((t) => claveActividad(t.nombre))
    if (new Set(claves).size !== claves.length) {
      setError("Hay dos trabajos con el mismo nombre.")
      return null
    }
    const elegidas = limpios.map((t) => t.categoriaId).filter(Boolean)
    if (new Set(elegidas).size !== elegidas.length) {
      setError("Dos trabajos tienen la misma categoría del catálogo.")
      return null
    }
    return limpios
  }

  // Trabajos sin categoría elegida ni nombre igual a uno del catálogo.
  const nuevos = trabajos
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.nombre.trim() && !t.categoriaId && !catalogoPorNombre.has(claveActividad(t.nombre)))

  async function dividir(confirmado = false) {
    const limpios = validar()
    if (!limpios) return
    if (nuevos.length > 0 && !confirmado) {
      setConfirmando(true)
      return
    }
    setConfirmando(false)
    setGuardando(true)
    setError(null)
    try {
      const r = await dividirManoObraItem(presupuestoItemId, limpios)
      setHecho(
        r.porAprobar > 0
          ? `Listo: ${r.trabajos} trabajos. ${r.porAprobar} van a Aprobación de mano de obra; mientras tanto el ítem no se puede contratar.`
          : `Listo: ${r.trabajos} trabajos, todos con su valor del catálogo.`
      )
      setTrabajos([VACIO, VACIO])
      await onCambio()
      setRecarga((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo dividir la mano de obra.")
    } finally {
      setGuardando(false)
    }
  }

  async function juntar() {
    setGuardando(true)
    setError(null)
    try {
      await juntarManoObraItem(presupuestoItemId)
      setHecho("Listo: la mano de obra volvió a ser una sola, como venía del Excel.")
      await onCambio()
      setRecarga((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo juntar la mano de obra.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Dividir la mano de obra en varios trabajos</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {codigo} · {descripcion}
          {info?.excel && <> · del Excel: {info.excel}</>}
        </p>

        {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}
        {hecho && (
          <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            {hecho}
          </p>
        )}

        {info && info.dividida && (
          <div className="space-y-3">
            <p className="text-sm">
              La mano de obra de este ítem está dividida en estos trabajos. Cada uno se contrata por separado; también se puede
              contratar completa en un solo contrato.
            </p>
            <ul className="divide-y rounded-md border text-sm">
              {info.lineas.map((l) => (
                <li key={l.nombre} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{l.nombre}</span>
                  {l.estado === "resuelto" ? (
                    <span className="tabular-nums">{l.valor != null ? pesos(l.valor) : "—"}</span>
                  ) : (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      {l.estado === "rechazado" ? "Rechazado: elige otro en Revisar pendientes" : "En aprobación"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {info.puedeJuntar ? (
              <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  ¿Se dividió por error? Al juntarla vuelve la mano de obra del Excel como estaba.
                </p>
                <Button variant="outline" size="sm" onClick={juntar} disabled={guardando}>
                  {guardando ? "Juntando…" : "Juntar otra vez"}
                </Button>
              </div>
            ) : (
              info.motivo && <p className="text-xs text-muted-foreground">{info.motivo}</p>
            )}
          </div>
        )}

        {info && !info.dividida && !info.puedeDividir && (
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">{info.motivo ?? "Este ítem no se puede dividir."}</p>
        )}

        {info && info.puedeDividir && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Escribe cada trabajo y elígelo del catálogo de mano de obra. Si no está, déjalo escrito: se envía a Aprobación de mano de
              obra. Cada trabajo cuenta una vez por cada unidad del ítem y se contrata por separado.
            </p>
            {valorAprobado > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                Esta mano de obra ya está aprobada en {pesos(valorAprobado)}. Al dividirla, el ítem pasa a valer la suma de los
                trabajos nuevos. Lo que ya está en el catálogo no se toca.
              </p>
            )}
            <div className="space-y-2">
              {trabajos.map((t, i) => (
                <FilaTrabajo
                  key={i}
                  indice={i}
                  trabajo={t}
                  catalogo={cargado?.catalogo ?? []}
                  catalogoPorId={catalogoPorId}
                  catalogoPorNombre={catalogoPorNombre}
                  unidad={info.unidad}
                  placeholder={i === 0 && info.excel ? `Del Excel: ${info.excel}` : "Escribe y elige del catálogo"}
                  disabled={guardando}
                  puedeQuitar={trabajos.length > 2}
                  onCambiar={(nuevo) => {
                    setTrabajos((v) => v.map((x, j) => (j === i ? nuevo : x)))
                    setError(null)
                    setConfirmando(false)
                  }}
                  onQuitar={() => setTrabajos((v) => v.filter((_, j) => j !== i))}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTrabajos((v) => [...v, VACIO])}
              disabled={guardando || trabajos.length >= 15}
            >
              <Plus className="size-4" /> Agregar trabajo
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {confirmando && nuevos.length > 0 ? (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:bg-amber-950/30">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  {nuevos.length === 1 ? "Este trabajo no está" : "Estos trabajos no están"} en el catálogo. ¿Es alguno de estos?
                </p>
                {nuevos.map(({ t, i }) => {
                  const opciones = parecidas(cargado?.catalogo ?? [], t.nombre, info.unidad)
                  return (
                    <div key={i} className="space-y-1">
                      <p className="text-sm">
                        <span className="text-muted-foreground">{i + 1}.</span> {t.nombre}
                      </p>
                      {opciones.length === 0 ? (
                        <p className="pl-4 text-xs text-muted-foreground">No hay nada parecido en el catálogo.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2 pl-4">
                          {opciones.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setTrabajos((v) => v.map((x, j) => (j === i ? { nombre: c.categoria, categoriaId: c.id } : x)))}
                              disabled={guardando}
                              className="rounded-md border bg-background px-2 py-1 text-left text-xs hover:bg-muted"
                            >
                              {c.categoria} · {pesos(c.valorUnitario ?? 0)} / {c.unidad}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfirmando(false)} disabled={guardando}>
                    Volver
                  </Button>
                  <Button size="sm" onClick={() => dividir(true)} disabled={guardando}>
                    {guardando
                      ? "Dividiendo…"
                      : nuevos.length === 1
                        ? "Ninguno: enviarlo a aprobación"
                        : "Ninguno: enviarlos a aprobación"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => cerrar(false)} disabled={guardando}>
                  Cancelar
                </Button>
                <Button onClick={() => dividir()} disabled={guardando}>
                  {guardando ? "Dividiendo…" : "Dividir"}
                </Button>
              </div>
            )}
          </div>
        )}
        {info && !info.puedeDividir && error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  )
}
