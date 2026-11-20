"use client"

// Cambiar la modalidad de UN ítem desde Revisar pendientes (2026-11-19), sin
// pasar por el Excel de modalidades: se busca el ítem, se elige la modalidad
// (y la mano de obra oficial si hace falta), se revisa lo que cambia y se
// aplica. Usa la misma fijar_modalidades_presupuesto: lo resuelto del APU se
// conserva y vuelve si la modalidad cambia otra vez.

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fijarModalidadesPresupuesto,
  infoModalidadesDeItem,
  infoModalidadesPresupuesto,
} from "@/app/(app)/presupuestos/actions"
import type { ItemInfoModalidad } from "@/lib/excel-modalidades"
import { leerNumero } from "@/lib/contratos"
import { MODALIDADES, NOMBRE_MODALIDAD, type Modalidad, type ResultadoModalidades } from "@/lib/modalidades"

const pesos = (n: number) => n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()

// La modalidad pide la mano de obra oficial: administración con mano de obra,
// o subcontrato de mano de obra sin insumos (igual que _aplicar_modalidad_item).
export function pideManoObraOficial(item: Pick<ItemInfoModalidad, "tieneManoObra" | "conInsumos">, modalidad: Modalidad | "") {
  if (modalidad === "administracion") return item.tieneManoObra
  if (modalidad === "mano_obra") return !item.conInsumos
  return false
}

// Con presupuestoId se busca cualquier ítem (Revisar pendientes); con
// presupuestoItemId es ese ítem fijo (editor de APU).
export function CambiarModalidadItem({
  presupuestoId: presupuestoIdProp,
  presupuestoItemId,
  onAplicado,
}: {
  presupuestoId?: string
  presupuestoItemId?: string
  onAplicado: (codigo: string, modalidad: Modalidad) => void | Promise<void>
}) {
  const [items, setItems] = useState<ItemInfoModalidad[] | null>(null)
  const [presupuestoId, setPresupuestoId] = useState<string | null>(presupuestoIdProp ?? null)
  const [codigoFijo, setCodigoFijo] = useState<string | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [busqueda, setBusqueda] = useState("")
  const [codigo, setCodigo] = useState<string | null>(null)
  const [modalidad, setModalidad] = useState<Modalidad | "">("")
  const [manoObra, setManoObra] = useState("")
  const [resumen, setResumen] = useState<ResultadoModalidades | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    const carga = presupuestoItemId
      ? infoModalidadesDeItem(presupuestoItemId).then(
          (r: { presupuestoId: string; codigo: string; items: ItemInfoModalidad[] } | null) => {
            if (!vigente) return
            if (!r) {
              setErrorCarga("Este ítem es de una versión anterior: la modalidad se cambia en la versión vigente.")
              return
            }
            setPresupuestoId(r.presupuestoId)
            setCodigoFijo(r.codigo)
            setItems(r.items)
          }
        )
      : presupuestoIdProp
        ? infoModalidadesPresupuesto(presupuestoIdProp).then((lista: ItemInfoModalidad[]) => vigente && setItems(lista))
        : Promise.resolve()
    carga.catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar los ítems."))
    return () => {
      vigente = false
    }
  }, [presupuestoIdProp, presupuestoItemId, recarga])

  const porCodigo = useMemo(() => new Map((items ?? []).map((i) => [i.codigo, i])), [items])
  const codigoElegido = codigoFijo ?? codigo
  const item = codigoElegido ? porCodigo.get(codigoElegido) ?? null : null
  // En el editor de APU el ítem está fijo: se arranca con su modalidad actual.
  const [iniciado, setIniciado] = useState(false)
  if (codigoFijo && item && !iniciado) {
    setIniciado(true)
    setModalidad(item.modalidad ?? "")
    setManoObra(item.manoObraOficial != null ? String(item.manoObraOficial).replace(".", ",") : "")
  }
  const coincidencias = useMemo(() => {
    const q = normalizar(busqueda.trim())
    if (!items || q.length < 1) return []
    return items.filter((i) => normalizar(`${i.codigo} ${i.descripcion}`).includes(q)).slice(0, 8)
  }, [items, busqueda])

  function elegir(i: ItemInfoModalidad) {
    setCodigo(i.codigo)
    setModalidad(i.modalidad ?? "")
    setManoObra(i.manoObraOficial != null ? String(i.manoObraOficial).replace(".", ",") : "")
    setBusqueda("")
    setResumen(null)
    setError(null)
    setHecho(null)
  }

  function fila() {
    if (!item || !modalidad) return null
    const pide = pideManoObraOficial(item, modalidad)
    const valor = manoObra.trim() ? leerNumero(manoObra) : null
    if (pide && (valor === null || valor <= 0)) {
      setError("Escribe la mano de obra oficial (valor unitario, sin herramienta menor).")
      return null
    }
    return { codigo: item.codigo, modalidad, mano_obra_oficial: pide ? valor : undefined }
  }

  async function revisar() {
    const f = fila()
    if (!f || !presupuestoId) return
    setTrabajando(true)
    setError(null)
    try {
      const r = await fijarModalidadesPresupuesto(presupuestoId, [f], false)
      if (r.errores.length > 0) setError(r.errores.map((e) => e.error).join(" "))
      else setResumen(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo revisar el cambio.")
    } finally {
      setTrabajando(false)
    }
  }

  async function aplicar() {
    const f = fila()
    if (!f || !item || !presupuestoId) return
    setTrabajando(true)
    setError(null)
    try {
      const r = await fijarModalidadesPresupuesto(presupuestoId, [f], true)
      if (r.errores.length > 0) {
        setError(r.errores.map((e) => e.error).join(" "))
        setResumen(null)
        return
      }
      setHecho(`Listo: ${item.codigo} quedó en ${NOMBRE_MODALIDAD[f.modalidad]}.`)
      setResumen(null)
      setCodigo(null)
      setIniciado(false)
      await onAplicado(item.codigo, f.modalidad)
      setRecarga((n) => n + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la modalidad.")
    } finally {
      setTrabajando(false)
    }
  }

  if (errorCarga) return <p className="text-sm text-destructive">{errorCarga}</p>
  if (!items) return <p className="text-sm text-muted-foreground">Cargando ítems…</p>

  return (
    <div className="space-y-3">
      {hecho && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          {hecho}
        </p>
      )}
      {!codigoFijo && (
      <div className="relative">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={item ? `${item.codigo} · ${item.descripcion}` : "Buscar ítem por código o descripción"}
          aria-label="Buscar ítem"
          disabled={trabajando}
        />
        {coincidencias.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover shadow-lg">
            {coincidencias.map((i) => (
              <li key={i.codigo}>
                <button
                  type="button"
                  onClick={() => elegir(i)}
                  className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>
                    <span className="font-medium tabular-nums">{i.codigo}</span> {i.descripcion}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {i.modalidad ? NOMBRE_MODALIDAD[i.modalidad] : "Sin modalidad"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      )}

      {item && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm">
            <span className="font-medium tabular-nums">{item.codigo}</span> {item.descripcion}
          </p>
          <p className="text-xs text-muted-foreground">
            Ahora: {item.modalidad ? NOMBRE_MODALIDAD[item.modalidad] : "sin modalidad"} ·{" "}
            {item.conInsumos ? "con insumos" : "sin insumos"} · {item.tieneManoObra ? "con mano de obra" : "sin mano de obra"}
            {item.precioOficial != null && <> · precio oficial {pesos(item.precioOficial)}</>}
          </p>
          {item.conMovimientos ? (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Este ítem ya tiene requisiciones o contratos: su modalidad no se puede cambiar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {MODALIDADES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setModalidad(m)
                      setResumen(null)
                      setError(null)
                    }}
                    // Sin mano de obra ni insumos no hay subcontrato de mano de obra; con
                    // insumos se le agrega una línea para elegir del catálogo (20270101004600).
                    disabled={trabajando || (m === "mano_obra" && !item.tieneManoObra && !item.conInsumos)}
                    title={
                      m === "mano_obra" && !item.tieneManoObra
                        ? item.conInsumos
                          ? "El APU no trae mano de obra: se agrega una línea para elegirla del catálogo"
                          : "El ítem no tiene mano de obra ni insumos en su APU"
                        : undefined
                    }
                    className={`rounded-md border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${modalidad === m ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}
                  >
                    {NOMBRE_MODALIDAD[m]}
                  </button>
                ))}
              </div>
              {modalidad && pideManoObraOficial(item, modalidad) && (
                <label className="block space-y-1 text-sm">
                  <span>Mano de obra oficial (valor unitario, sin herramienta menor)</span>
                  <Input
                    value={manoObra}
                    onChange={(e) => {
                      setManoObra(e.target.value)
                      setResumen(null)
                    }}
                    inputMode="decimal"
                    className="max-w-48"
                    disabled={trabajando}
                  />
                </label>
              )}
              {resumen && (
                <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                  {resumen.cambian === 0 ? (
                    <p>No cambia nada: el ítem ya está así.</p>
                  ) : (
                    <>
                      <p>
                        Total del presupuesto: {pesos(resumen.valorAntes)} → <strong>{pesos(resumen.valorDespues)}</strong>
                        {" "}({resumen.valorDespues >= resumen.valorAntes ? "+" : "−"}
                        {pesos(Math.abs(resumen.valorDespues - resumen.valorAntes))})
                      </p>
                      {(resumen.lineasGuardadas > 0 || resumen.lineasNoRequeridas > 0) && (
                        <p className="text-xs text-muted-foreground">
                          Se guardan aparte {resumen.lineasGuardadas} línea(s) del APU y {resumen.lineasNoRequeridas} pendiente(s) dejan de
                          revisarse; vuelven si cambias la modalidad otra vez.
                        </p>
                      )}
                      {resumen.solicitudesCerradas > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Se cierran {resumen.solicitudesCerradas} solicitud(es) pendiente(s) que solo servían a este ítem.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={revisar} disabled={trabajando || !modalidad}>
                  {trabajando && !resumen ? "Revisando…" : "Revisar cambio"}
                </Button>
                <Button size="sm" onClick={aplicar} disabled={trabajando || !resumen || resumen.cambian === 0}>
                  {trabajando && resumen ? "Aplicando…" : "Aplicar"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
