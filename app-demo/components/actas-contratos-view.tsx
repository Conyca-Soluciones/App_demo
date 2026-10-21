"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, FileCheck2, Flag, Loader2, Paperclip, Pencil, Plus, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { DetalleActa } from "@/components/detalle-acta"
import { tituloTipoContrato } from "@/components/detalle-solicitud-contrato"
import { OtrosisDelContrato } from "@/components/otrosis-del-contrato"
import { createClient } from "@/lib/supabase/client"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos, numero } from "@/lib/contratos"
import {
  CLASE_ESTADO_ACTA,
  ETIQUETA_ESTADO_ACTA,
  ETIQUETA_SOPORTE,
  ETIQUETA_TIPO_ACTA,
  MIME_SOPORTES,
  actaEditable,
  calcularActa,
  consumidoActas,
  formActaVacio,
  formDesdeActa,
  saldoContrato,
  tiposPermitidos,
  validarActa,
  validarSoporte,
  type ActaDetalle,
  type ActaResumen,
  type ContratoParaActa,
  type FormActa,
  type InfoContratoActa,
  type TipoActa,
  type TipoSoporte,
} from "@/lib/actas"
import {
  buscarContratistasParaActa,
  buscarContratosParaActa,
  contratosDeContratista,
  editarActa,
  guardarActa,
  listarActasDeContrato,
  obtenerActa,
  obtenerContratoParaActa,
  type SoporteSubido,
} from "@/app/(app)/contratos/actas/actions"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC } from "@/components/ventana-detalle"

// Actas por grupos: se busca el contrato o el contratista (con un solo
// contrato se escoge solo; con varios, se elige en la lista). Del contrato se
// ven su información, sus actas y los botones de acta parcial, final o de
// liquidación (según lo que permita: vencido, con acta final, liquidado). El
// formulario muestra TODAS las actividades del contrato y se llenan las que
// se ejecutaron (o el % de avance si es a valor global). Las que no están
// aprobadas las puede editar quien las creó (una rechazada vuelve a aprobación).
// ?ver=<id> (aviso de la campanita) abre el contrato del acta con el acta abierta.

const mensaje = (e: unknown, otro: string) => (e instanceof Error ? e.message : otro)

export function ActasContratosView({ puedeElaborar, verInicial }: { puedeElaborar: boolean; verInicial: string | null }) {
  const router = useRouter()
  const [contratista, setContratista] = useState<OpcionBuscador | null>(null)
  // Contratos aprobados del contratista elegido (null = no se ha elegido o se buscó por contrato y aún carga).
  const [contratosContratista, setContratosContratista] = useState<ContratoParaActa[] | null>(null)
  const [contrato, setContrato] = useState<ContratoParaActa | null>(null)
  const [cargandoContratos, setCargandoContratos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Los resultados de la última búsqueda de contratos, para pasar de la opción al contrato.
  const ultimosContratos = useRef(new Map<string, ContratoParaActa>())
  // Acta que se abre al entrar desde un aviso (?ver=<id>).
  const [actaInicial, setActaInicial] = useState<{ id: string; contratoId: string } | null>(null)

  const buscarContratistas = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratistasParaActa(t)
    return lista.map((k) => ({
      id: k.id,
      etiqueta: k.nombre,
      subetiqueta: `${k.documento} · ${k.contratos} ${k.contratos === 1 ? "contrato" : "contratos"}`,
    }))
  }, [])

  const buscarContratos = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratosParaActa(t)
    ultimosContratos.current = new Map(lista.map((c) => [c.id, c]))
    return lista.map((c) => ({
      id: c.id,
      etiqueta: `${c.numeroContrato} · ${c.contratistaNombre}`,
      subetiqueta: `${c.proyectoCodigo} · ${c.objeto}`,
    }))
  }, [])

  // elegirId: el contrato a escoger cuando se llega desde un aviso.
  function cargarContratosDe(contratistaId: string, elegido: ContratoParaActa | null, elegirId?: string) {
    setCargandoContratos(true)
    setError(null)
    contratosDeContratista(contratistaId)
      .then((lista) => {
        setContratosContratista(lista)
        if (elegirId) {
          const c = lista.find((x) => x.id === elegirId) ?? null
          setContrato(c)
          if (!c) setError("El contrato de esta acta ya no está aprobado o no tienes acceso.")
        } else if (!elegido) setContrato(lista.length === 1 ? lista[0] : null)
      })
      .catch((e) => setError(mensaje(e, "No se pudieron cargar los contratos.")))
      .finally(() => setCargandoContratos(false))
  }

  function elegirContratista(op: OpcionBuscador | null) {
    setContratista(op)
    setContrato(null)
    setContratosContratista(null)
    if (op) cargarContratosDe(op.id, null)
  }

  function elegirContrato(c: ContratoParaActa | null) {
    setContrato(c)
    if (c && c.contratistaId !== contratista?.id) {
      setContratista({ id: c.contratistaId, etiqueta: c.contratistaNombre, subetiqueta: c.contratistaDocumento })
      setContratosContratista(null)
      cargarContratosDe(c.contratistaId, c)
    }
  }

  // Desde un aviso: busca el acta, escoge su contratista y su contrato y la abre.
  useEffect(() => {
    if (!verInicial) return
    obtenerActa(verInicial)
      .then((a) => {
        setContratista({ id: a.contratistaId, etiqueta: a.contratistaNombre, subetiqueta: a.contratistaDocumento })
        setActaInicial({ id: a.id, contratoId: a.contratoId })
        cargarContratosDe(a.contratistaId, null, a.contratoId)
      })
      .catch((e) => setError(mensaje(e, "No se pudo abrir el acta.")))
    // Solo al entrar a la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const variosContratos = contratosContratista != null && contratosContratista.length > 1

  return (
    <MarcoPagina titulo="Actas por grupos" subtitulo="Busca el contrato o el contratista y crea sus actas." scroll>
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <section className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contratista</label>
            <BuscadorAsync
              placeholder="Buscar por nombre o documento..."
              valorSeleccionado={contratista}
              onSeleccionar={elegirContratista}
              buscar={buscarContratistas}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contrato</label>
            {cargandoContratos ? (
              <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando contratos...
              </div>
            ) : variosContratos ? (
              <Select
                value={contrato?.id ?? ""}
                onValueChange={(v) => elegirContrato(contratosContratista.find((c) => c.id === v) ?? null)}
              >
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={`Escoge uno de sus ${contratosContratista.length} contratos`} />
                </SelectTrigger>
                <SelectContent>
                  {contratosContratista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.numeroContrato} · {c.objeto.length > 70 ? `${c.objeto.slice(0, 70)}…` : c.objeto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : contratista && contratosContratista?.length === 0 ? (
              <p className="flex h-10 items-center text-sm text-muted-foreground">Este contratista no tiene contratos aprobados.</p>
            ) : (
              <BuscadorAsync
                placeholder="Buscar por número de contrato u objeto..."
                valorSeleccionado={
                  contrato ? { id: contrato.id, etiqueta: contrato.numeroContrato, subetiqueta: `· ${contrato.objeto}` } : null
                }
                onSeleccionar={(op) => {
                  if (!op) {
                    // Quitar el contrato también suelta al contratista (se llenó con el contrato).
                    elegirContratista(null)
                    return
                  }
                  elegirContrato(ultimosContratos.current.get(op.id) ?? null)
                }}
                buscar={buscarContratos}
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
        </section>

        {contrato && (
          <ContratoActas
            key={contrato.id}
            contrato={contrato}
            puedeElaborar={puedeElaborar}
            verActaInicial={actaInicial?.contratoId === contrato.id ? actaInicial.id : null}
            onCerrarActaInicial={() => {
              setActaInicial(null)
              if (verInicial) router.replace("/contratos/actas")
            }}
          />
        )}
      </div>
    </MarcoPagina>
  )
}

function ContratoActas({
  contrato,
  puedeElaborar,
  verActaInicial,
  onCerrarActaInicial,
}: {
  contrato: ContratoParaActa
  puedeElaborar: boolean
  verActaInicial: string | null
  onCerrarActaInicial: () => void
}) {
  // Sube cada vez que se guarda un acta: vuelve a traer la lista y los acumulados.
  const [version, setVersion] = useState(0)
  const [carga, setCarga] = useState<{ version: number; actas: ActaResumen[]; info: InfoContratoActa } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<{ tipo: TipoActa; edicion: ActaDetalle | null } | null>(null)
  const [abriendoEdicion, setAbriendoEdicion] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [verActa, setVerActa] = useState<string | null>(verActaInicial)

  useEffect(() => {
    let activo = true
    Promise.all([listarActasDeContrato(contrato.id), obtenerContratoParaActa(contrato.id)])
      .then(([actas, info]) => activo && setCarga({ version, actas, info }))
      .catch((e) => activo && setError(mensaje(e, "No se pudieron cargar las actas.")))
    return () => {
      activo = false
    }
  }, [contrato.id, version])

  const actas = carga?.actas ?? null
  const info = carga?.info ?? null
  const consumido = actas ? consumidoActas(actas) : null
  const saldo = consumido == null ? null : saldoContrato(contrato.valor, consumido)
  const permitidos = info ? tiposPermitidos(info) : null
  const siguiente = (actas?.reduce((max, a) => Math.max(max, a.numero), 0) ?? 0) + 1

  const columnasActas: ColumnaExcel<ActaResumen>[] = [
    { clave: "numero", titulo: "Acta", ancho: 90, fija: true, texto: (a) => `Acta ${a.numero}`, valorOrden: (a) => a.numero, claseCelda: "font-medium" },
    { clave: "tipo", titulo: "Tipo", ancho: 150, texto: (a) => ETIQUETA_TIPO_ACTA[a.tipo] },
    { clave: "periodo", titulo: "Período", ancho: 190, flexible: true, texto: (a) => textoPeriodo(a.periodoDesde, a.periodoHasta), claseCelda: "tabular-nums" },
    {
      clave: "elaborada",
      titulo: "Elaborada",
      ancho: 200,
      texto: (a) => `${formatearFechaSinHora(a.createdAt)}${a.creadoPorNombre ? ` · ${a.creadoPorNombre}` : ""}`,
      valorOrden: (a) => a.createdAt,
    },
    { clave: "bruto", titulo: "Valor bruto", ancho: 140, alinear: "right", texto: (a) => pesos(a.valorBruto), valorOrden: (a) => a.valorBruto, claseCelda: "tabular-nums" },
    { clave: "neto", titulo: "Neto a pagar", ancho: 140, alinear: "right", texto: (a) => pesos(a.neto), valorOrden: (a) => a.neto, claseCelda: "font-medium tabular-nums" },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 150,
      alinear: "center",
      texto: (a) => ETIQUETA_ESTADO_ACTA[a.estado],
      celda: (a) => <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[a.estado]}`}>{ETIQUETA_ESTADO_ACTA[a.estado]}</Badge>,
    },
    ...(puedeElaborar
      ? [
          {
            clave: "acciones",
            titulo: "Acciones",
            ancho: 120,
            alinear: "center" as const,
            ordenable: false,
            texto: () => "",
            celda: (a: ActaResumen) =>
              actaEditable(a) ? (
                <Button size="sm" variant="outline" className="h-7" onClick={() => editarDesdeLista(a.id)} disabled={abriendoEdicion != null}>
                  {abriendoEdicion === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pencil className="h-3.5 w-3.5" />}
                  Editar
                </Button>
              ) : null,
          },
        ]
      : []),
  ]
  const { ordenadas: ordenadasActas, orden: ordenActas, ordenar: ordenarActas } = useOrdenExcel(actas ?? [], columnasActas)

  function cerrarActa() {
    if (verActa != null && verActa === verActaInicial) onCerrarActaInicial()
    setVerActa(null)
  }

  function editar(acta: ActaDetalle) {
    cerrarActa()
    setAviso(null)
    setFormulario({ tipo: acta.tipo, edicion: acta })
  }

  function editarDesdeLista(id: string) {
    setAbriendoEdicion(id)
    setError(null)
    obtenerActa(id)
      .then(editar)
      .catch((e) => setError(mensaje(e, "No se pudo abrir el acta.")))
      .finally(() => setAbriendoEdicion(null))
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border">
        <table className="w-full text-sm">
          <tbody className="[&_th]:w-56 [&_th]:bg-muted/50 [&_th]:px-4 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_td]:px-4 [&_td]:py-2 [&_tr]:border-b last:[&_tr]:border-0">
            <tr>
              <th>Contratista</th>
              <td>
                {contrato.contratistaNombre} <span className="text-muted-foreground">({contrato.contratistaDocumento})</span>
              </td>
            </tr>
            <tr>
              <th>Número de contrato</th>
              <td className="font-medium">
                {contrato.numeroContrato}
                {info?.liquidado && <Badge className="ml-2 h-6 bg-slate-200 px-3 text-xs text-slate-700 hover:bg-slate-200">Liquidado</Badge>}
                {info?.vencido && !info.liquidado && (
                  <Badge className="ml-2 h-6 bg-red-100 px-3 text-xs text-red-800 hover:bg-red-100">Vencido</Badge>
                )}
              </td>
            </tr>
            <tr>
              <th>Valor del contrato</th>
              <td className="font-medium tabular-nums">
                {pesos(contrato.valor)}
                {/* Con otrosí: el contrato firmado no cambia; el valor vigente lo incluye. */}
                {info && info.valorInicial !== info.valor && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    contrato {pesos(info.valorInicial)} + otrosí {pesos(info.valor - info.valorInicial)}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <th>Valor en actas</th>
              <td className="tabular-nums">
                {consumido == null ? "…" : pesos(consumido)} <span className="text-muted-foreground">(valor bruto de las actas por aprobar y aprobadas)</span>
              </td>
            </tr>
            <tr>
              <th>Saldo del contrato</th>
              <td className={`font-medium tabular-nums ${saldo != null && saldo <= 0 ? "text-destructive" : ""}`}>
                {saldo == null ? "…" : pesos(saldo)}
              </td>
            </tr>
            <tr>
              <th>Fecha de terminación</th>
              <td>{info ? (info.fechaFin ? formatearFechaSinHora(info.fechaFin) : "Sin fecha (duración sin inicio)") : "…"}</td>
            </tr>
            <tr>
              <th>Anticipo / retención</th>
              <td>
                {info
                  ? `${info.anticipoPorcentaje ? `Anticipo ${numero(info.anticipoPorcentaje)} % (${pesos((contrato.valor * info.anticipoPorcentaje) / 100)})` : "Sin anticipo"} · ${
                      info.retencionPorcentaje ? `Retención en garantía ${numero(info.retencionPorcentaje)} %` : "Sin retención en garantía"
                    }`
                  : "…"}
              </td>
            </tr>
            <tr>
              <th>Tipo y forma de pago</th>
              <td>
                {tituloTipoContrato(contrato.tipo)} ·{" "}
                {info ? (info.anexoTipo === "valores_unitarios" ? "Valores unitarios (por actividad)" : "Valor global (por % de avance)") : "…"}
              </td>
            </tr>
            <tr>
              <th>Proyecto</th>
              <td>
                {contrato.proyectoCodigo} · {contrato.proyectoNombre}
              </td>
            </tr>
            <tr>
              <th>Objeto</th>
              <td>{contrato.objeto}</td>
            </tr>
            <tr>
              <th className="align-top">Otrosí</th>
              <td>
                <OtrosisDelContrato contratoId={contrato.id} />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {aviso && !formulario && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> {aviso}
        </p>
      )}

      {formulario ? (
        <FormularioActa
          key={formulario.edicion?.id ?? `nueva-${formulario.tipo}`}
          contrato={contrato}
          numero={formulario.edicion?.numero ?? siguiente}
          tipo={formulario.tipo}
          edicion={formulario.edicion}
          onCancelar={() => setFormulario(null)}
          onGuardada={(texto) => {
            setAviso(texto)
            setFormulario(null)
            setVersion((v) => v + 1)
          }}
        />
      ) : (
        <section className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <h2 className="font-semibold">Actas del contrato</h2>
            {puedeElaborar && permitidos && (
              <div className="flex flex-wrap gap-2">
                {permitidos.tipos.includes("parcial") && (
                  <Button onClick={() => setFormulario({ tipo: "parcial", edicion: null })} disabled={saldo != null && saldo <= 0}>
                    <Plus className="mr-1 h-4 w-4" /> Acta parcial
                  </Button>
                )}
                {permitidos.tipos.includes("final") && (
                  <Button variant="outline" onClick={() => setFormulario({ tipo: "final", edicion: null })}>
                    <Flag className="mr-1 h-4 w-4" /> Acta final
                  </Button>
                )}
                {permitidos.tipos.includes("liquidacion") && (
                  <Button variant="outline" onClick={() => setFormulario({ tipo: "liquidacion", edicion: null })}>
                    <FileCheck2 className="mr-1 h-4 w-4" /> Acta de liquidación
                  </Button>
                )}
              </div>
            )}
          </div>
          {puedeElaborar && permitidos?.motivo && (
            <p className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-800">{permitidos.motivo}</p>
          )}
          {error ? (
            <p className="p-4 text-sm text-destructive">{error}</p>
          ) : actas == null ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando actas...
            </p>
          ) : actas.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Este contrato todavía no tiene actas.</p>
          ) : (
            <div className="p-3">
              <TablaExcel
                filas={ordenadasActas}
                columnas={columnasActas}
                claveFila={(a) => a.id}
                orden={ordenActas}
                onOrdenar={ordenarActas}
                onDobleClickFila={(a) => setVerActa(a.id)}
                tituloFila={AYUDA_DOBLE_CLIC}
                claseAltoMax="max-h-[60svh]"
                tarjeta={{
                  titulo: (a) => `Acta ${a.numero} · ${ETIQUETA_TIPO_ACTA[a.tipo]}`,
                  subtitulo: (a) => textoPeriodo(a.periodoDesde, a.periodoHasta),
                  esquina: (a) => columnasActas.find((c) => c.clave === "estado")!.celda!(a),
                  campos: ["elaborada", "bruto", "neto", "acciones"],
                }}
              />
            </div>
          )}
        </section>
      )}

      <DetalleActa
        id={verActa}
        onCerrar={cerrarActa}
        acciones={(a) =>
          puedeElaborar && actaEditable(a) ? (
            <Button onClick={() => editar(a)}>
              <Pencil className="size-4" /> {a.estado === "rechazada" ? "Corregir y enviar otra vez" : "Editar acta"}
            </Button>
          ) : null
        }
      />
    </>
  )
}

const textoPeriodo = (desde: string | null, hasta: string | null) =>
  desde || hasta ? `${desde ? formatearFechaSinHora(desde) : "…"} a ${hasta ? formatearFechaSinHora(hasta) : "…"}` : "—"

type SoporteNuevo = { clave: number; tipo: TipoSoporte; archivo: File }

function FormularioActa({
  contrato,
  numero: numeroActa,
  tipo,
  edicion,
  onCancelar,
  onGuardada,
}: {
  contrato: ContratoParaActa
  numero: number
  tipo: TipoActa
  edicion: ActaDetalle | null
  onCancelar: () => void
  onGuardada: (aviso: string) => void
}) {
  // Los acumulados del contrato SIN esta acta (al editar no cuenta contra sí misma).
  const [info, setInfo] = useState<InfoContratoActa | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  useEffect(() => {
    let activo = true
    obtenerContratoParaActa(contrato.id, edicion?.id)
      .then((i) => activo && setInfo(i))
      .catch((e) => activo && setErrorCarga(mensaje(e, "No se pudo cargar el contrato.")))
    return () => {
      activo = false
    }
  }, [contrato.id, edicion?.id])

  const [form, setForm] = useState<FormActa>(() => (edicion ? formDesdeActa(edicion) : formActaVacio(tipo)))
  const [quitarSoportes, setQuitarSoportes] = useState<Set<string>>(new Set())
  const [nuevos, setNuevos] = useState<SoporteNuevo[]>([])
  const claveNuevo = useRef(0)
  const [tipoNuevo, setTipoNuevo] = useState<TipoSoporte>("factura")
  const [guardando, setGuardando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cambiar = (c: Partial<FormActa>) => setForm((f) => ({ ...f, ...c }))
  const r = info ? calcularActa(info, form) : null
  const lineaPorId = new Map((r?.lineas ?? []).map((l) => [l.id, l]))
  // Neto (redondeado) <= 0: la base no crea pago y aprueba el acta sola.
  const sinPago = r != null && Math.round(r.neto) <= 0
  const despues = sinPago ? "Quedó aprobada (neto $ 0: no hay pago)." : "Su pago quedó por aprobar en A&F."

  function agregarArchivos(archivos: FileList | null) {
    if (!archivos) return
    const lista: SoporteNuevo[] = []
    for (const archivo of Array.from(archivos)) {
      const problema = validarSoporte(archivo)
      if (problema) {
        setError(`${archivo.name}: ${problema}`)
        return
      }
      lista.push({ clave: claveNuevo.current++, tipo: tipoNuevo, archivo })
    }
    setError(null)
    setNuevos((n) => [...n, ...lista])
  }

  async function guardar() {
    if (!info) return
    const v = validarActa(info, form)
    if (!v.ok) {
      setError(v.error)
      return
    }
    // Un acta con pago (neto > 0) exige al menos la factura del contratista
    // (decisión del usuario; la base lo revisa otra vez en _pago_de_acta).
    const hayFactura =
      nuevos.some((n) => n.tipo === "factura") ||
      (edicion?.soportes ?? []).some((s) => s.tipo === "factura" && !quitarSoportes.has(s.id))
    if (!sinPago && !hayFactura) {
      setError("Adjunta la factura del contratista: el acta con pago la exige.")
      return
    }
    const actaId = edicion?.id ?? crypto.randomUUID()
    const supabase = createClient()
    const subidos: SoporteSubido[] = []
    setError(null)
    try {
      setGuardando("Subiendo soportes…")
      const marca = Date.now()
      await Promise.all(
        nuevos.map(async (n, i) => {
          const ext = n.archivo.name.includes(".") ? n.archivo.name.split(".").pop()!.toLowerCase() : "bin"
          const ruta = `${actaId}/${n.tipo}-${marca}-${i}.${ext}`
          const { error: e } = await supabase.storage.from("actas").upload(ruta, n.archivo, { contentType: n.archivo.type, upsert: false })
          if (e) throw new Error(`No se pudo subir "${n.archivo.name}": ${e.message}`)
          subidos.push({ tipo: n.tipo, ruta, nombreArchivo: n.archivo.name, tamano: n.archivo.size, mime: n.archivo.type })
        })
      )
      setGuardando("Guardando acta…")
      if (edicion) {
        const res = await editarActa(edicion.id, v.datos, subidos, [...quitarSoportes])
        if (res.rutasQuitadas.length > 0) await supabase.storage.from("actas").remove(res.rutasQuitadas)
        onGuardada(`${ETIQUETA_TIPO_ACTA[form.tipo]} ${res.numero} corregida. ${despues}`)
      } else {
        const res = await guardarActa(actaId, contrato.id, v.datos, subidos)
        onGuardada(`${ETIQUETA_TIPO_ACTA[form.tipo]} ${res.numero} guardada. ${despues}`)
      }
    } catch (e) {
      // Nada queda a medias: crear y editar son una transacción en la base.
      if (subidos.length > 0) await supabase.storage.from("actas").remove(subidos.map((s) => s.ruta))
      setError(mensaje(e, "No se pudo guardar el acta."))
    } finally {
      setGuardando(null)
    }
  }

  const titulo = edicion
    ? `Editar ${ETIQUETA_TIPO_ACTA[form.tipo].toLowerCase()} N° ${numeroActa}`
    : `${ETIQUETA_TIPO_ACTA[form.tipo]} N° ${numeroActa}`

  return (
    <section className="rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="font-semibold">{titulo}</h2>
        <p className="text-sm text-muted-foreground">
          {form.tipo === "liquidacion"
            ? "Cierra el contrato: devuelve la retención en garantía y descuenta el anticipo que falte por amortizar. Al aprobarla, el contrato queda liquidado."
            : info?.anexoTipo === "valor_global"
              ? "Contrato a valor global: escribe el porcentaje de avance que se cobra en esta acta."
              : "Escribe la cantidad ejecutada en esta acta de cada actividad del contrato. Las que no se ejecutaron se dejan vacías."}
          {form.tipo === "final" && " Es la última acta de avance: amortiza todo el anticipo que falte."}
          {form.tipo === "liquidacion" && sinPago
            ? " Con neto $ 0 no hay pago: al guardar, el acta queda aprobada."
            : " Al guardar, su pago queda por aprobar en A&F (Aprobación de pagos); el acta se aprueba cuando se aprueba el pago."}
          {edicion && " Conserva el mismo número."}
        </p>
        {edicion?.estado === "rechazada" && (
          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Rechazada{edicion.resueltoPorNombre ? ` por ${edicion.resueltoPorNombre}` : ""}. Motivo: {edicion.motivoResolucion}
          </p>
        )}
      </div>

      {errorCarga ? (
        <p className="p-4 text-sm text-destructive">{errorCarga}</p>
      ) : !info || !r ? (
        <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando el contrato…
        </p>
      ) : (
        <div className="space-y-5 p-4">
          {/* Período */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="acta-desde">
                Período: desde
              </label>
              <CampoFecha id="acta-desde" contenedorClassName="w-44" className="h-9" value={form.periodoDesde} onChange={(e) => cambiar({ periodoDesde: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="acta-hasta">
                Hasta (fecha de corte)
              </label>
              <CampoFecha id="acta-hasta" contenedorClassName="w-44" className="h-9" value={form.periodoHasta} onChange={(e) => cambiar({ periodoHasta: e.target.value })} />
            </div>
          </div>

          {/* Lo ejecutado */}
          {form.tipo !== "liquidacion" &&
            (info.anexoTipo === "valores_unitarios" ? (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[1050px] text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr className="[&_th]:px-2 [&_th]:py-2 [&_th]:font-medium">
                      <th>Actividad</th>
                      <th className="w-20">Unidad</th>
                      <th className="w-24 text-right">Contratada</th>
                      <th className="w-24 text-right">Acumulado anterior</th>
                      <th className="w-32 text-right">Esta acta</th>
                      <th className="w-24 text-right">Acumulado</th>
                      <th className="w-24 text-right">Saldo</th>
                      <th className="w-28 text-right">Valor unitario</th>
                      <th className="w-32 text-right">Valor esta acta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.actividades.map((a) => {
                      const l = lineaPorId.get(a.id)
                      const esta = l?.cantidad ?? 0
                      const acumulado = a.acumulado + esta
                      return (
                        <tr key={a.id} className={`border-t align-middle [&_td]:px-2 [&_td]:py-1.5 ${l?.excede ? "bg-red-50" : ""}`}>
                          <td>{a.actividad}</td>
                          <td className="text-muted-foreground">{a.unidad}</td>
                          <td className="text-right tabular-nums">{numero(a.cantidad)}</td>
                          <td className="text-right tabular-nums">{numero(a.acumulado)}</td>
                          <td>
                            <Input
                              inputMode="decimal"
                              className={`h-8 text-right tabular-nums ${l?.excede ? "border-destructive" : ""}`}
                              placeholder="0"
                              value={form.cantidades[a.id] ?? ""}
                              onChange={(e) => cambiar({ cantidades: { ...form.cantidades, [a.id]: e.target.value } })}
                              aria-label={`Cantidad de ${a.actividad} en esta acta (${a.unidad})`}
                              title={a.unidad}
                            />
                          </td>
                          <td className={`text-right tabular-nums ${l?.excede ? "font-medium text-destructive" : ""}`}>{numero(acumulado)}</td>
                          <td className="text-right tabular-nums">{numero(a.cantidad - acumulado)}</td>
                          <td className="text-right tabular-nums">{pesos(a.valorUnitario)}</td>
                          <td className="text-right font-medium tabular-nums">{l ? pesos(l.valor) : "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-4">
                <Cifra titulo="Avance anterior" texto={`${numero(info.avanceOtras)} %`} />
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground" htmlFor="acta-avance">
                    Avance de esta acta (%)
                  </label>
                  <Input
                    id="acta-avance"
                    inputMode="decimal"
                    className="h-9 text-right tabular-nums"
                    placeholder="0"
                    value={form.porcentajeAvance}
                    onChange={(e) => cambiar({ porcentajeAvance: e.target.value })}
                  />
                </div>
                <Cifra
                  titulo="Avance acumulado"
                  texto={`${numero(info.avanceOtras + (r.avance ?? 0))} %`}
                  rojo={info.avanceOtras + (r.avance ?? 0) > 100}
                />
                <Cifra titulo="Valor esta acta" texto={pesos(r.bruto)} fuerte rojo={r.bruto > r.saldoContrato} />
                <p
                  className={`text-xs sm:col-span-4 ${
                    r.bruto > r.saldoContrato || info.avanceOtras + (r.avance ?? 0) > 100 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  Saldo del contrato: {pesos(r.saldoContrato)}. Lo máximo que se puede cobrar en esta acta es{" "}
                  {numero(Math.max(Math.min(100 - info.avanceOtras, info.valor > 0 ? (r.saldoContrato * 100) / info.valor : 0), 0))} %.
                </p>
              </div>
            ))}

          {/* Otros descuentos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Otros descuentos (retención en la fuente, ICA…)</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => cambiar({ descuentos: [...form.descuentos, { concepto: "", valor: "" }] })}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Agregar descuento
              </Button>
            </div>
            {form.descuentos.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  placeholder="Concepto"
                  value={d.concepto}
                  onChange={(e) => cambiar({ descuentos: form.descuentos.map((x, k) => (k === i ? { ...x, concepto: e.target.value } : x)) })}
                />
                <Input
                  inputMode="decimal"
                  className="h-8 w-40 text-right tabular-nums"
                  placeholder="Valor"
                  value={d.valor}
                  onChange={(e) => cambiar({ descuentos: form.descuentos.map((x, k) => (k === i ? { ...x, valor: e.target.value } : x)) })}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => cambiar({ descuentos: form.descuentos.filter((_, k) => k !== i) })}
                  aria-label="Quitar descuento"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Resumen */}
          <div className="ml-auto max-w-md rounded-md border text-sm">
            <table className="w-full [&_td]:px-3 [&_td]:py-1.5">
              <tbody>
                {form.tipo === "liquidacion" ? (
                  <>
                    <FilaResumen titulo="Devolución de la retención en garantía" valor={r.devolucionRetencion} />
                    <FilaResumen
                      titulo={`Anticipo por amortizar${r.anticipoTotal ? ` (de ${pesos(r.anticipoTotal)})` : ""}`}
                      valor={-r.amortizacion}
                    />
                  </>
                ) : (
                  <>
                    <FilaResumen titulo="Valor bruto del acta" valor={r.bruto} />
                    <FilaResumen
                      titulo={`Amortización del anticipo${info.anticipoPorcentaje ? ` (${numero(info.anticipoPorcentaje)} %)` : ""}`}
                      valor={-r.amortizacion}
                    />
                    <FilaResumen
                      titulo={`Retención en garantía${info.retencionPorcentaje ? ` (${numero(info.retencionPorcentaje)} %)` : ""}`}
                      valor={-r.retencion}
                    />
                  </>
                )}
                <FilaResumen titulo="Otros descuentos" valor={-r.otros} />
                <tr className="border-t bg-muted/30 font-semibold">
                  <td>Neto a pagar</td>
                  <td className={`text-right text-base tabular-nums ${r.neto < 0 ? "text-destructive" : ""}`}>{pesos(r.neto)}</td>
                </tr>
                {form.tipo !== "liquidacion" && (
                  <tr className="text-muted-foreground">
                    <td>Saldo del contrato (antes de esta acta)</td>
                    <td className={`text-right tabular-nums ${r.bruto > r.saldoContrato ? "text-destructive" : ""}`}>{pesos(r.saldoContrato)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Observaciones */}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="acta-observaciones">
              Observaciones
            </label>
            <Textarea
              id="acta-observaciones"
              rows={3}
              value={form.observaciones}
              onChange={(e) => cambiar({ observaciones: e.target.value })}
              placeholder="Notas del acta (opcional)"
            />
          </div>

          {/* Soportes */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Soportes</h3>
            {(edicion?.soportes ?? []).map((s) => {
              const quitado = quitarSoportes.has(s.id)
              return (
                <div key={s.id} className={`flex items-center gap-2 text-sm ${quitado ? "text-muted-foreground line-through" : ""}`}>
                  <Paperclip className="h-4 w-4 shrink-0" />
                  <span className="truncate">{s.nombreArchivo}</span>
                  <span className="text-xs text-muted-foreground">({ETIQUETA_SOPORTE[s.tipo]})</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      setQuitarSoportes((q) => {
                        const n = new Set(q)
                        if (n.has(s.id)) n.delete(s.id)
                        else n.add(s.id)
                        return n
                      })
                    }
                  >
                    {quitado ? "Conservar" : "Quitar"}
                  </Button>
                </div>
              )
            })}
            {nuevos.map((n) => (
              <div key={n.clave} className="flex items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">{n.archivo.name}</span>
                <span className="text-xs text-muted-foreground">({ETIQUETA_SOPORTE[n.tipo]}, nuevo)</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => setNuevos((x) => x.filter((y) => y.clave !== n.clave))}
                  aria-label={`Quitar ${n.archivo.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={tipoNuevo} onValueChange={(v) => setTipoNuevo((v as TipoSoporte) ?? "factura")}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ETIQUETA_SOPORTE) as TipoSoporte[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {ETIQUETA_SOPORTE[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" /> Adjuntar archivo
                <input
                  type="file"
                  multiple
                  className="hidden"
                  accept={MIME_SOPORTES.join(",")}
                  onChange={(e) => {
                    agregarArchivos(e.target.files)
                    e.target.value = ""
                  }}
                />
              </label>
              <span className="text-xs text-muted-foreground">PDF, JPG, PNG o Excel de hasta 10 MB.</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
        {error && <p className="mr-auto text-sm text-destructive">{error}</p>}
        <Button variant="outline" onClick={onCancelar} disabled={guardando != null}>
          Cancelar
        </Button>
        <Button onClick={guardar} disabled={guardando != null || !info}>
          {guardando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {guardando ?? (edicion ? "Guardar cambios" : "Guardar acta")}
        </Button>
      </div>
    </section>
  )
}

function FilaResumen({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <tr>
      <td>{titulo}</td>
      <td className="text-right tabular-nums">{valor === 0 ? "—" : pesos(valor)}</td>
    </tr>
  )
}

function Cifra({ titulo, texto, fuerte, rojo }: { titulo: string; texto: string; fuerte?: boolean; rojo?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className={`pt-1.5 tabular-nums ${fuerte ? "font-semibold" : ""} ${rojo ? "text-destructive" : ""}`}>{texto}</p>
    </div>
  )
}
