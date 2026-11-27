"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UNIDADES_MAESTRO } from "@/lib/unidades"
import { leerNumeroOFormula } from "@/lib/formula-numero"
import {
  IVAS_INSUMO,
  TIPOS_INSUMO,
  cambiosInsumo,
  formularioDesdeInsumo,
  validarEdicionInsumo,
  vrNetoInsumo,
  type FormularioInsumo,
} from "@/lib/editar-insumo"
import { editarInsumoMaestra, type InsumoMaestra } from "@/app/(app)/presupuestos/insumos/actions"

// Ventana para editar un insumo de la Maestra (lib/editar-insumo.ts). El código
// no se edita. El precio es el valor unitario SIN IVA del maestro; cambiarlo no
// toca los APU ya armados.

const CLASE_SELECT =
  "h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"

const pesos = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 2 })

export function EditarInsumoDialog({
  insumo,
  agrupaciones,
  onCerrar,
  onGuardado,
}: {
  insumo: InsumoMaestra | null
  agrupaciones: string[]
  onCerrar: () => void
  onGuardado: (i: InsumoMaestra) => void
}) {
  return (
    <Dialog open={insumo !== null} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-2xl">
        {/* key: al abrir otro insumo el formulario arranca con sus datos. */}
        {insumo && (
          <Formulario key={insumo.id} insumo={insumo} agrupaciones={agrupaciones} onCerrar={onCerrar} onGuardado={onGuardado} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Formulario({
  insumo,
  agrupaciones,
  onCerrar,
  onGuardado,
}: {
  insumo: InsumoMaestra
  agrupaciones: string[]
  onCerrar: () => void
  onGuardado: (i: InsumoMaestra) => void
}) {
  const [f, setF] = useState<FormularioInsumo>(() => formularioDesdeInsumo(insumo))
  const [intento, setIntento] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listaAgrupaciones = useMemo(() => {
    const s = new Set(agrupaciones)
    if (insumo.agrupacion) s.add(insumo.agrupacion)
    return Array.from(s).sort()
  }, [agrupaciones, insumo.agrupacion])
  const conjuntoAgrupaciones = useMemo(() => new Set(listaAgrupaciones), [listaAgrupaciones])

  const validacion = validarEdicionInsumo(f, conjuntoAgrupaciones)
  const errores = !validacion.ok && intento ? validacion.errores : {}
  const cambios = validacion.ok ? cambiosInsumo(insumo, validacion.valores) : null
  const sinCambios = cambios !== null && Object.keys(cambios).length === 0

  const precio = leerNumeroOFormula(f.vrUnitario)
  const conIva = vrNetoInsumo(precio, Number(f.ivaPorcentaje), f.excluyeIva)
  const cambiaUnidad = validacion.ok && cambios?.u_m !== undefined

  const poner = <K extends keyof FormularioInsumo>(campo: K, valor: FormularioInsumo[K]) =>
    setF((prev) => ({ ...prev, [campo]: valor }))

  async function guardar() {
    setIntento(true)
    setError(null)
    if (!validacion.ok || sinCambios) return
    setGuardando(true)
    const r = await editarInsumoMaestra(insumo.id, f)
    setGuardando(false)
    if (!r.ok) {
      setError(r.error)
      return
    }
    onGuardado(r.valor)
  }

  const mensaje = (campo: keyof FormularioInsumo) =>
    errores[campo] ? <p className="text-xs text-destructive">{errores[campo]}</p> : null

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar insumo</DialogTitle>
        <p className="text-sm text-muted-foreground">
          Código <span className="font-mono">{insumo.codigo}</span> (no se cambia)
        </p>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ins-nombre">Nombre</Label>
          <Input
            id="ins-nombre"
            value={f.descripcion}
            onChange={(e) => poner("descripcion", e.target.value)}
            onBlur={() => poner("descripcion", f.descripcion.trim().replace(/\s+/g, " ").toUpperCase())}
            disabled={guardando}
          />
          <p className="text-xs text-muted-foreground">
            Debe decir la presentación si aplica (&quot;TELA VERDE ROLLO X 100 M&quot;). Se guarda en mayúsculas.
          </p>
          {mensaje("descripcion")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ins-tipo">Tipo</Label>
          <select id="ins-tipo" className={CLASE_SELECT} value={f.tipo} onChange={(e) => poner("tipo", e.target.value)} disabled={guardando}>
            <option value="">Elige…</option>
            {TIPOS_INSUMO.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {mensaje("tipo")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ins-um">Unidad de compra</Label>
          <select id="ins-um" className={CLASE_SELECT} value={f.uM} onChange={(e) => poner("uM", e.target.value)} disabled={guardando}>
            <option value="">Elige…</option>
            {UNIDADES_MAESTRO.map((u) => (
              <option key={u.codigo} value={u.texto}>
                {u.texto}
              </option>
            ))}
          </select>
          {mensaje("uM")}
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="ins-agrup">Agrupación</Label>
          <select
            id="ins-agrup"
            className={CLASE_SELECT}
            value={f.agrupacion}
            onChange={(e) => poner("agrupacion", e.target.value)}
            disabled={guardando}
          >
            <option value="">Elige…</option>
            {listaAgrupaciones.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {mensaje("agrupacion")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ins-precio">Valor unitario (sin IVA)</Label>
          <Input
            id="ins-precio"
            inputMode="decimal"
            value={f.vrUnitario}
            onChange={(e) => poner("vrUnitario", e.target.value)}
            disabled={guardando}
            placeholder="Ej. 25.000 o =29.750/1,19"
          />
          {mensaje("vrUnitario")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ins-iva">IVA</Label>
          <select
            id="ins-iva"
            className={CLASE_SELECT}
            value={f.ivaPorcentaje}
            onChange={(e) => poner("ivaPorcentaje", e.target.value)}
            disabled={guardando}
          >
            {IVAS_INSUMO.map((v) => (
              <option key={v} value={String(v)}>
                {v} %
              </option>
            ))}
          </select>
          {mensaje("ivaPorcentaje")}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.excluyeIva}
            onChange={(e) => poner("excluyeIva", e.target.checked)}
            disabled={guardando}
            className="size-4"
          />
          Excluye IVA
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.ivaDescontable}
            onChange={(e) => poner("ivaDescontable", e.target.checked)}
            disabled={guardando}
            className="size-4"
          />
          IVA descontable
        </label>

        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm sm:col-span-2">
          Valor con IVA: <span className="font-medium tabular-nums">{pesos(conIva)}</span>
          <p className="mt-1 text-xs text-muted-foreground">
            Es el precio de respaldo del maestro: la tabla muestra el promedio de compras cuando el insumo tiene compras. Cambiarlo no
            toca los APU ya armados (las líneas con precio congelado siguen igual).
          </p>
        </div>

        {cambiaUnidad && (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:col-span-2 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Cambias la unidad: las líneas de APU, requisiciones y compras que ya usan este insumo conservan su unidad y su
            conversión. Revisa que el precio sea por la unidad nueva.
          </div>
        )}
      </div>

      {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {intento && sinCambios && <p className="text-sm text-muted-foreground">No cambiaste nada.</p>}

      <DialogFooter>
        <Button variant="outline" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={guardando}>
          {guardando && <Loader2 className="size-4 animate-spin" />}
          Guardar
        </Button>
      </DialogFooter>
    </>
  )
}
