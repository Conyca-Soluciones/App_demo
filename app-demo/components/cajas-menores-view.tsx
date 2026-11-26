"use client"

import { useEffect, useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { DialogoLegalizacion, EtiquetaEstadoLegalizacion } from "@/components/detalle-legalizacion-caja-menor"
import { formatoMoneda } from "@/lib/pagos"
import { formatearFechaHora } from "@/lib/fechas"
import {
  validarCajaMenor,
  valorDe,
  type CajaMenor,
  type CajaMenorForm,
  type EstadoLegalizacion,
  type LegalizacionDetalle,
  type LegalizacionFila,
  type OpcionesCajaMenor,
} from "@/lib/caja-menor"
import { textoCuenta, type CuentaReqAdmin } from "@/lib/requisiciones-admin"
import {
  buscarTercerosRequisicionAdmin,
  cuentasTerceroRequisicionAdmin,
} from "@/app/(app)/ayf/pagos-administrativos/actions"
import {
  aprobarLegalizacionLider,
  cerrarCajaMenor,
  devolverLegalizacionLider,
  guardarCajaMenor,
  listarCajasMenores,
  listarLegalizaciones,
  opcionesCajaMenor,
  revisarLegalizacion,
} from "@/app/(app)/ayf/cajas-menores/actions"

type Vista = "por_revisar" | "por_aprobar" | "todas" | "cajas"

// Cajas menores para A&F (20270101007400): Financiera revisa los soportes de
// cada legalización y la pasa a Líder Financiera, que la aprueba (la app crea
// el cuadro de pago del reembolso para Gerencia). Cualquiera de las dos la
// devuelve al responsable. En "Cajas", Financiera crea, edita y cierra cajas.
export function CajasMenoresView({
  verInicial,
  puedeGestionar,
  puedeAprobar,
}: {
  verInicial: string | null
  puedeGestionar: boolean
  puedeAprobar: boolean
}) {
  const [vista, setVista] = useState<Vista>(puedeAprobar && !puedeGestionar ? "por_aprobar" : verInicial ? "todas" : "por_revisar")
  const [verId, setVerId] = useState<string | null>(verInicial)
  const [recarga, setRecarga] = useState(0)

  const vistas: { valor: Vista; etiqueta: string }[] = [
    { valor: "por_revisar", etiqueta: "Por revisar (Financiera)" },
    { valor: "por_aprobar", etiqueta: "Por aprobar (Líder Financiera)" },
    { valor: "todas", etiqueta: "Todas" },
    { valor: "cajas", etiqueta: "Cajas" },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex gap-1.5 overflow-x-auto border-b">
        {vistas.map((v) => (
          <button
            key={v.valor}
            type="button"
            onClick={() => setVista(v.valor)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              vista === v.valor ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {v.etiqueta}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {vista === "cajas" ? (
          <Cajas puedeGestionar={puedeGestionar} />
        ) : (
          <Legalizaciones
            key={`${vista}-${recarga}`}
            estado={vista === "todas" ? null : vista}
            onVer={setVerId}
          />
        )}
      </div>
      <AccionesLegalizacion
        id={verId}
        onCerrar={() => setVerId(null)}
        puedeGestionar={puedeGestionar}
        puedeAprobar={puedeAprobar}
        onResuelta={() => {
          setVerId(null)
          setRecarga((r) => r + 1)
        }}
      />
    </div>
  )
}

function Legalizaciones({ estado, onVer }: { estado: EstadoLegalizacion | null; onVer: (id: string) => void }) {
  const [filas, setFilas] = useState<LegalizacionFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    listarLegalizaciones(estado)
      .then((f: LegalizacionFila[]) => vigente && setFilas(f))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las legalizaciones."))
    return () => {
      vigente = false
    }
  }, [estado])

  const columnas: ColumnaExcel<LegalizacionFila>[] = [
    { clave: "codigo", titulo: "Código", ancho: 130, fija: true, texto: (f) => f.codigo },
    { clave: "estado", titulo: "Estado", ancho: 170, texto: (f) => f.estado, celda: (f) => <EtiquetaEstadoLegalizacion estado={f.estado} /> },
    { clave: "responsable", titulo: "Responsable", ancho: 180, texto: (f) => f.responsableNombre },
    { clave: "proyecto", titulo: "Proyecto de la caja", ancho: 170, texto: (f) => f.proyectoCodigo || f.proyectoNombre },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 180, texto: (f) => f.empresaNombre },
    { clave: "enviada", titulo: "Enviada", ancho: 150, texto: (f) => formatearFechaHora(f.enviadaEn), valorOrden: (f) => f.enviadaEn },
    { clave: "gastos", titulo: "Gastos", ancho: 80, alinear: "right", texto: (f) => String(f.nGastos), valorOrden: (f) => f.nGastos },
    { clave: "total", titulo: "Total", ancho: 140, alinear: "right", texto: (f) => formatoMoneda(f.valorTotal), valorOrden: (f) => f.valorTotal },
    { clave: "cuadro", titulo: "Cuadro de pago", ancho: 130, texto: (f) => f.cuadroCodigo ?? "" },
  ]
  const { ordenadas: filasOrdenadas, orden, ordenar } = useOrdenExcel(filas ?? [], columnas)

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!filas)
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </p>
    )
  if (filas.length === 0) return <p className="py-6 text-sm text-muted-foreground">No hay legalizaciones aquí.</p>
  return (
    <TablaExcel
      filas={filasOrdenadas}
      columnas={columnas}
      claveFila={(f) => f.id}
      orden={orden}
      onOrdenar={ordenar}
      onDobleClickFila={(f) => onVer(f.id)}
      tituloFila={AYUDA_DOBLE_CLIC}
      tarjeta={{
        titulo: (f) => `${f.codigo} · ${f.responsableNombre}`,
        subtitulo: (f) => formatearFechaHora(f.enviadaEn),
        esquina: (f) => <EtiquetaEstadoLegalizacion estado={f.estado} />,
        campos: ["proyecto", "gastos", "total", "cuadro"],
      }}
    />
  )
}

function AccionesLegalizacion({
  id,
  onCerrar,
  puedeGestionar,
  puedeAprobar,
  onResuelta,
}: {
  id: string | null
  onCerrar: () => void
  puedeGestionar: boolean
  puedeAprobar: boolean
  onResuelta: () => void
}) {
  const [devolviendo, setDevolviendo] = useState<LegalizacionDetalle | null>(null)
  const [motivo, setMotivo] = useState("")
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ejecutar(f: () => Promise<unknown>) {
    setOcupado(true)
    setError(null)
    try {
      await f()
      setDevolviendo(null)
      setMotivo("")
      onResuelta()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar.")
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <DialogoLegalizacion
        id={id}
        onCerrar={() => {
          setError(null)
          onCerrar()
        }}
        acciones={(d) => {
          const revisar = d.estado === "por_revisar" && puedeGestionar
          const aprobar = d.estado === "por_aprobar" && puedeAprobar
          if (!revisar && !aprobar) return null
          return (
            <>
              {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
              <Button type="button" variant="outline" disabled={ocupado} onClick={() => setDevolviendo(d)}>
                Devolver al responsable
              </Button>
              {revisar ? (
                <Button type="button" disabled={ocupado} onClick={() => ejecutar(async () => valorDe(await revisarLegalizacion(d.id, "aprobar", null)))}>
                  {ocupado && <Loader2 className="mr-1 size-4 animate-spin" />} Soportes revisados: pasar a Líder Financiera
                </Button>
              ) : (
                <Button type="button" disabled={ocupado} onClick={() => ejecutar(async () => valorDe(await aprobarLegalizacionLider(d.id)))}>
                  {ocupado && <Loader2 className="mr-1 size-4 animate-spin" />} Aprobar y enviar el reembolso a Gerencia
                </Button>
              )}
            </>
          )
        }}
      />

      <Dialog open={devolviendo != null} onOpenChange={(o) => !o && !ocupado && setDevolviendo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Devolver {devolviendo?.codigo}</DialogTitle>
            <DialogDescription>Le llega al responsable para que la corrija y la envíe otra vez a Financiera.</DialogDescription>
          </DialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} placeholder="Qué falta o qué hay que corregir" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => setDevolviendo(null)}>
              Volver
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={ocupado || !motivo.trim()}
              onClick={() =>
                devolviendo &&
                ejecutar(async () =>
                  valorDe(
                    devolviendo.estado === "por_revisar"
                      ? await revisarLegalizacion(devolviendo.id, "devolver", motivo)
                      : await devolverLegalizacionLider(devolviendo.id, motivo)
                  )
                )
              }
            >
              {ocupado && <Loader2 className="mr-1 size-4 animate-spin" />} Devolver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------- cajas
function Cajas({ puedeGestionar }: { puedeGestionar: boolean }) {
  const [cajas, setCajas] = useState<CajaMenor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cerradas, setCerradas] = useState(false)
  const [recarga, setRecarga] = useState(0)
  const [editando, setEditando] = useState<CajaMenor | "nueva" | null>(null)
  const [cerrando, setCerrando] = useState<CajaMenor | null>(null)
  const [motivo, setMotivo] = useState("")
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    let vigente = true
    listarCajasMenores(cerradas)
      .then((c: CajaMenor[]) => vigente && setCajas(c))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las cajas."))
    return () => {
      vigente = false
    }
  }, [cerradas, recarga])

  async function cerrar() {
    if (!cerrando) return
    setOcupado(true)
    try {
      valorDe(await cerrarCajaMenor(cerrando.id, motivo))
      setCerrando(null)
      setMotivo("")
      setRecarga((r) => r + 1)
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "No se pudo cerrar la caja.")
    } finally {
      setOcupado(false)
    }
  }

  const columnas: ColumnaExcel<CajaMenor>[] = [
    { clave: "numero", titulo: "N°", ancho: 60, alinear: "right", texto: (c) => String(c.numero), valorOrden: (c) => c.numero },
    { clave: "responsable", titulo: "Responsable", ancho: 180, texto: (c) => c.responsableNombre },
    { clave: "monto", titulo: "Monto", ancho: 130, alinear: "right", texto: (c) => formatoMoneda(c.monto), valorOrden: (c) => c.monto },
    { clave: "proyecto", titulo: "Proyecto o área", ancho: 170, texto: (c) => c.proyectoCodigo || c.proyectoNombre },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 180, texto: (c) => c.empresaNombre },
    { clave: "tercero", titulo: "Se reembolsa a", ancho: 200, texto: (c) => `${c.terceroNombre} · ${c.cuentaTexto}` },
    {
      clave: "ultima",
      titulo: "Última legalización",
      ancho: 170,
      texto: (c) => (c.ultimaLegalizacion ? `${c.ultimaLegalizacion.codigo} · ${formatoMoneda(c.ultimaLegalizacion.valorTotal)}` : ""),
    },
    { clave: "estado", titulo: "Estado", ancho: 100, texto: (c) => (c.estado === "abierta" ? "Abierta" : "Cerrada") },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 110,
      ordenable: false,
      texto: () => "",
      celda: (c) =>
        puedeGestionar && c.estado === "abierta" ? (
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setCerrando(c)}>
            Cerrar
          </Button>
        ) : null,
    },
  ]
  const { ordenadas: filasOrdenadas, orden, ordenar } = useOrdenExcel(cajas ?? [], columnas)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {puedeGestionar && (
          <Button type="button" size="sm" onClick={() => setEditando("nueva")}>
            <Plus className="mr-1 size-4" /> Nueva caja menor
          </Button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cerradas} onChange={(e) => setCerradas(e.target.checked)} /> Ver también las cerradas
        </label>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : !cajas ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Cargando…
        </p>
      ) : cajas.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">No hay cajas menores.</p>
      ) : (
        <TablaExcel
          filas={filasOrdenadas}
          columnas={columnas}
          claveFila={(c) => c.id}
          orden={orden}
          onOrdenar={ordenar}
          onDobleClickFila={puedeGestionar ? (c) => c.estado === "abierta" && setEditando(c) : undefined}
          tituloFila={puedeGestionar ? "Doble clic para editar" : undefined}
          tarjeta={{
            titulo: (c) => `N° ${c.numero} · ${c.responsableNombre}`,
            subtitulo: (c) => c.proyectoCodigo || c.proyectoNombre,
            esquina: (c) => <span className="text-sm font-medium tabular-nums">{formatoMoneda(c.monto)}</span>,
            campos: ["empresa", "tercero", "ultima", "estado", "acciones"],
          }}
        />
      )}

      {editando && (
        <DialogoCaja
          caja={editando === "nueva" ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null)
            setRecarga((r) => r + 1)
          }}
        />
      )}

      <Dialog open={cerrando != null} onOpenChange={(o) => !o && !ocupado && setCerrando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cerrar la caja N° {cerrando?.numero}</DialogTitle>
            <DialogDescription>
              El responsable debe haber legalizado lo pendiente y reintegrado el saldo no usado (acta GF-F-004). Escribe el motivo.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => setCerrando(null)}>
              Volver
            </Button>
            <Button type="button" variant="destructive" disabled={ocupado || !motivo.trim()} onClick={cerrar}>
              {ocupado && <Loader2 className="mr-1 size-4 animate-spin" />} Cerrar caja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const claseSelect = "h-9 w-full rounded-md border bg-background px-2 text-sm"

function DialogoCaja({ caja, onCerrar, onGuardada }: { caja: CajaMenor | null; onCerrar: () => void; onGuardada: () => void }) {
  const [opciones, setOpciones] = useState<OpcionesCajaMenor | null>(null)
  const [form, setForm] = useState<CajaMenorForm>(() => ({
    responsableId: caja?.responsableId ?? "",
    terceroId: caja?.terceroId ?? null,
    terceroNombre: caja?.terceroNombre ?? "",
    cuentaId: caja?.cuentaId ?? null,
    empresaId: caja?.empresaId ?? "",
    proyectoId: caja?.proyectoId ?? "",
    monto: caja ? String(caja.monto).replace(".", ",") : "",
    descripcion: caja?.descripcion ?? "",
  }))
  const [cuentas, setCuentas] = useState<{ tercero: string; lista: CuentaReqAdmin[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vigente = true
    opcionesCajaMenor()
      .then((o: OpcionesCajaMenor) => vigente && setOpciones(o))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las opciones."))
    return () => {
      vigente = false
    }
  }, [])

  useEffect(() => {
    if (!form.terceroId) return
    let vigente = true
    const tercero = form.terceroId
    cuentasTerceroRequisicionAdmin(tercero)
      .then((l: CuentaReqAdmin[]) => vigente && setCuentas({ tercero, lista: l }))
      .catch(() => vigente && setCuentas({ tercero, lista: [] }))
    return () => {
      vigente = false
    }
  }, [form.terceroId])

  const cuentasTercero = cuentas && cuentas.tercero === form.terceroId ? cuentas.lista : null
  const cambiar = (c: Partial<CajaMenorForm>) => setForm((f) => ({ ...f, ...c }))

  async function guardar() {
    const e = validarCajaMenor(form)
    if (e) {
      setError(e)
      return
    }
    setGuardando(true)
    setError(null)
    try {
      valorDe(await guardarCajaMenor(caja?.id ?? null, form))
      onGuardada()
    } catch (x) {
      setError(x instanceof Error ? x.message : "No se pudo guardar la caja.")
    } finally {
      setGuardando(false)
    }
  }

  const tercero: OpcionBuscador | null = form.terceroId ? { id: form.terceroId, etiqueta: form.terceroNombre } : null

  return (
    <Dialog open onOpenChange={(o) => !o && !guardando && onCerrar()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{caja ? `Editar la caja N° ${caja.numero}` : "Nueva caja menor"}</DialogTitle>
          <DialogDescription>
            Monto y responsable aprobados por la Subgerencia (acta GF-F-003). El reembolso se consigna a la cuenta que elijas.
          </DialogDescription>
        </DialogHeader>
        {!opciones ? (
          error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Cargando…
            </p>
          )
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label>Responsable</Label>
              <select
                className={claseSelect}
                value={form.responsableId}
                disabled={Boolean(caja)}
                onChange={(e) => cambiar({ responsableId: e.target.value })}
              >
                <option value="">Elige…</option>
                {opciones.personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
              {caja && <p className="text-xs text-muted-foreground">Para cambiar el responsable, cierra esta caja y abre otra.</p>}
            </div>
            <div className="grid gap-1">
              <Label>Se reembolsa a (tercero)</Label>
              <BuscadorAsync
                placeholder="Nombre o documento"
                valorSeleccionado={tercero}
                onSeleccionar={(o) => cambiar({ terceroId: o?.id ?? null, terceroNombre: o?.etiqueta ?? "", cuentaId: null })}
                buscar={buscarTercerosRequisicionAdmin}
              />
            </div>
            <div className="grid gap-1">
              <Label>Cuenta</Label>
              <select
                className={claseSelect}
                value={form.cuentaId ?? ""}
                disabled={!form.terceroId || !cuentasTercero}
                onChange={(e) => cambiar({ cuentaId: e.target.value || null })}
              >
                <option value="">{!form.terceroId ? "Elige primero el tercero" : !cuentasTercero ? "Cargando…" : "Elige…"}</option>
                {(cuentasTercero ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {textoCuenta(c)}
                    {c.verificada ? "" : " (por verificar)"}
                  </option>
                ))}
              </select>
              {cuentasTercero && cuentasTercero.length === 0 && (
                <p className="text-xs text-amber-700">Ese tercero no tiene cuentas en Terceros: agrégala antes.</p>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Proyecto o área</Label>
                <select
                  className={claseSelect}
                  value={form.proyectoId}
                  onChange={(e) => {
                    const p = opciones.proyectos.find((x) => x.id === e.target.value)
                    cambiar({ proyectoId: e.target.value, empresaId: form.empresaId || p?.empresaId || "" })
                  }}
                >
                  <option value="">Elige…</option>
                  {opciones.proyectos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo || p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1">
                <Label>Grupo empresarial</Label>
                <select className={claseSelect} value={form.empresaId} onChange={(e) => cambiar({ empresaId: e.target.value })}>
                  <option value="">Elige…</option>
                  {opciones.empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.razonSocial}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>Monto de la caja</Label>
                <Input value={form.monto} inputMode="decimal" onChange={(e) => cambiar({ monto: e.target.value })} placeholder="3.000.000" />
              </div>
              <div className="grid gap-1">
                <Label>Sede o finalidad (opcional)</Label>
                <Input value={form.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={guardando} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="button" disabled={guardando || !opciones} onClick={guardar}>
            {guardando && <Loader2 className="mr-1 size-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
