"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Eye, Loader2, PencilLine, Plus, Search, Send, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { DetalleOtrosi } from "@/components/detalle-otrosi"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"
import { rutaPdfOtrosi } from "@/components/otrosi-editor"
import { VerContratoOtrosi } from "@/components/ver-contrato-otrosi"
import { formatearFechaSinHora, hoyColombia } from "@/lib/fechas"
import { SelectorItemPresupuesto } from "@/components/solicitud-contrato-form"
import { leerNumero, nombreTipoContrato, numero, pesos, pesosEnLetras, sinManoObraEnApu, topeValorUnitario } from "@/lib/contratos"
import {
  CLASE_ESTADO_OTROSI,
  ETIQUETA_ESTADO_OTROSI,
  MAXIMO_MODIFICACIONES_OTROSI,
  leerActividadesOtrosi,
  validarSolicitudOtrosi,
  type ActividadesOtrosiForm,
  type ActividadesParaOtrosi,
  type ContratoParaOtrosi,
  type EstadoOtrosi,
  type ModificacionOtrosi,
  type OtrosiDetalle,
  type OtrosiFila,
} from "@/lib/otrosi"
import { actividadesParaOtrosi, contratosParaOtrosi, crearOtrosi, listarOtrosis, reenviarOtrosi } from "@/app/(app)/contratos/otrosi/actions"

// ---------------------------------------------------------------------------
// Solicitud de otrosí (ruta /contratos/otrosi): el ingeniero escoge el
// contratista, ve sus contratos abiertos (aprobados, sin liquidar y con el
// plazo inicial sin terminar, de todos los proyectos que ve) y pide qué
// cláusulas cambian y cómo quedan. Abajo, la lista de otrosí con su estado;
// uno devuelto por Jurídica se corrige y se envía otra vez.
// ---------------------------------------------------------------------------

type Filtro = "tramite" | "devueltos" | "aprobados" | "rechazados" | "todos"

const FILTROS: { valor: Filtro; etiqueta: string; estados?: EstadoOtrosi[] }[] = [
  { valor: "tramite", etiqueta: "En trámite", estados: ["por_revisar", "en_revision", "devuelta_subgerencia"] },
  { valor: "devueltos", etiqueta: "Devueltos", estados: ["devuelta"] },
  { valor: "aprobados", etiqueta: "Aprobados", estados: ["aprobada"] },
  { valor: "rechazados", etiqueta: "Rechazados", estados: ["rechazada"] },
  { valor: "todos", etiqueta: "Todos" },
]

export function SolicitudOtrosiView({ puedeSolicitar, verInicial }: { puedeSolicitar: boolean; verInicial: string | null }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>("todos")
  const [otrosis, setOtrosis] = useState<OtrosiFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)
  // null = lista; "nuevo" = formulario vacío; detalle = corrigiendo uno devuelto.
  const [formulario, setFormulario] = useState<"nuevo" | OtrosiDetalle | null>(null)

  function cargar() {
    const estados = FILTROS.find((f) => f.valor === filtro)?.estados
    listarOtrosis({ estados })
      .then((lista: OtrosiFila[]) => setOtrosis(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los otrosí."))
  }
  useEffect(cargar, [filtro])

  function cambiarFiltro(valor: Filtro) {
    setOtrosis(null)
    setError(null)
    setFiltro(valor)
  }

  const columnas: ColumnaExcel<OtrosiFila>[] = useMemo(
    () => [
      {
        clave: "contrato",
        titulo: "Contrato",
        ancho: 130,
        fija: true,
        texto: (o) => o.numeroContrato,
        celda: (o) => (
          <button
            type="button"
            onClick={() => setDetalleId(o.id)}
            title={`Ver el otrosí al contrato ${o.numeroContrato}`}
            className="cursor-pointer rounded-sm font-medium tabular-nums text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            {o.numeroContrato}
          </button>
        ),
      },
      { clave: "numero", titulo: "Otrosí N°", ancho: 90, alinear: "right", texto: (o) => (o.numero !== null ? String(o.numero) : "—") },
      { clave: "proyecto", titulo: "Proyecto", ancho: 140, texto: (o) => o.proyectoCodigo ?? o.proyectoNombre ?? "" },
      { clave: "contratista", titulo: "Contratista", ancho: 200, texto: (o) => o.contratistaNombre },
      { clave: "clausulas", titulo: "Cláusulas", ancho: 240, flexible: true, texto: (o) => o.clausulas },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 180,
        alinear: "center",
        texto: (o) => ETIQUETA_ESTADO_OTROSI[o.estado],
        celda: (o) => (
          <Badge variant="outline" className={CLASE_ESTADO_OTROSI[o.estado]}>
            {ETIQUETA_ESTADO_OTROSI[o.estado]}
          </Badge>
        ),
      },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 150, texto: (o) => o.solicitadoPorNombre ?? "" },
      { clave: "enviado", titulo: "Enviado", ancho: 110, texto: (o) => fechaContrato(o.enviadoAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/otrosi")
  }

  function terminado(texto: string) {
    setFormulario(null)
    setAviso(texto)
    setOtrosis(null)
    cargar()
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo="Solicitud de otrosí" subtitulo="Escoge el contratista y el contrato, y di qué cláusulas cambian y cómo quedan." />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        {formulario ? (
          <FormularioOtrosi edicion={formulario === "nuevo" ? null : formulario} onCancelar={() => setFormulario(null)} onTerminado={terminado} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado del otrosí">
                {FILTROS.map((f) => (
                  <Button key={f.valor} size="sm" role="tab" aria-selected={filtro === f.valor} variant={filtro === f.valor ? "default" : "outline"} onClick={() => cambiarFiltro(f.valor)}>
                    {f.etiqueta}
                  </Button>
                ))}
              </div>
              {otrosis && <span className="text-sm text-muted-foreground tabular-nums">{otrosis.length} otrosí</span>}
              {puedeSolicitar && (
                <Button
                  className="ml-auto"
                  onClick={() => {
                    setAviso(null)
                    setFormulario("nuevo")
                  }}
                >
                  <Plus className="size-4" /> Solicitar otrosí
                </Button>
              )}
            </div>

            {aviso && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
                <CheckCircle2 className="size-4" /> {aviso}
              </div>
            )}
            {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

            {otrosis === null && !error ? (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Cargando otrosí...
              </div>
            ) : otrosis && otrosis.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
                No hay otrosí con este filtro.
              </div>
            ) : (
              otrosis && (
                <TablaExcel
                  filas={otrosis}
                  columnas={columnas}
                  claveFila={(o) => o.id}
                  onDobleClickFila={(o) => setDetalleId(o.id)}
                  tituloFila="Doble clic para ver el otrosí"
                  tarjeta={{
                    titulo: (o) => (
                      <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(o.id)}>
                        {o.numeroContrato} · {o.contratistaNombre}
                      </button>
                    ),
                    subtitulo: (o) => `${nombreTipoContrato(o)} · ${o.proyectoCodigo ?? o.proyectoNombre ?? ""}`,
                    esquina: (o) => columnas.find((c) => c.clave === "estado")!.celda!(o),
                    campos: ["clausulas", "solicitante", "enviado"],
                  }}
                />
              )
            )}
          </>
        )}
      </main>

      <DetalleOtrosi
        id={detalleId}
        onCerrar={cerrarDetalle}
        // El documento aprobado, solo en PDF.
        documento={(d) => (d.estado === "aprobada" ? <OtrosiSoloPdf id={d.id} /> : <p className="text-sm text-muted-foreground">El documento se ve aquí cuando Subgerencia apruebe el otrosí.</p>)}
        acciones={(d) =>
          d.estado === "devuelta" && puedeSolicitar ? (
            <Button
              onClick={() => {
                cerrarDetalle()
                setAviso(null)
                setFormulario(d)
              }}
            >
              <PencilLine className="size-4" /> Corregir y enviar otra vez
            </Button>
          ) : null
        }
      />
    </div>
  )
}

// El PDF guardado (la ruta no usa lo que manda el navegador en un otrosí aprobado).
const SIN_CAMBIOS = {}
function OtrosiSoloPdf({ id }: { id: string }) {
  const vista = useVistaPreviaMinuta(id, SIN_CAMBIOS, null, rutaPdfOtrosi(id))
  return <PanelVistaPrevia {...vista} />
}

// ---------------------------------------------------------------- formulario
function FormularioOtrosi({
  edicion,
  onCancelar,
  onTerminado,
}: {
  edicion: OtrosiDetalle | null
  onCancelar: () => void
  onTerminado: (aviso: string) => void
}) {
  const [contratos, setContratos] = useState<ContratoParaOtrosi[] | null>(null)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [contratistaId, setContratistaId] = useState<string | null>(null)
  const [contratoId, setContratoId] = useState<string | null>(edicion?.contratoId ?? null)
  const [modificaciones, setModificaciones] = useState<ModificacionOtrosi[]>(edicion?.modificaciones ?? [{ clausula: "", redaccion: "" }])
  const [justificacion, setJustificacion] = useState(edicion?.justificacion ?? "")
  // Prórroga: si se marca, la fecha nueva pasa a ser el fin del contrato al aprobarse.
  const [extender, setExtender] = useState(Boolean(edicion?.nuevaFechaFin))
  const [nuevaFechaFin, setNuevaFechaFin] = useState(edicion?.nuevaFechaFin ?? "")
  // Nuevo valor total: si se marca, al aprobarse es el tope de las actas.
  const [cambiarValor, setCambiarValor] = useState(edicion?.nuevoValor != null)
  const [nuevoValorTexto, setNuevoValorTexto] = useState(edicion?.nuevoValor != null ? String(edicion.nuevoValor).replace(".", ",") : "")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Contrato abierto en PDF (botón Ver).
  const [viendo, setViendo] = useState<{ id: string; numeroContrato: string } | null>(null)
  // Actividades (contratos por valores unitarios). Van con el contrato al que
  // se escribieron: al cambiar de contrato quedan vacías.
  const [actsEstado, setActsEstado] = useState<{ contratoId: string | null; form: ActividadesOtrosiForm }>(() => ({
    contratoId: edicion?.contratoId ?? null,
    form: actividadesDesdeEdicion(edicion),
  }))
  const [datosActs, setDatosActs] = useState<{ contratoId: string; datos: ActividadesParaOtrosi | null; error: string | null } | null>(null)

  // Al corregir uno devuelto el contrato ya está escogido: no hace falta la lista.
  useEffect(() => {
    if (edicion) return
    let cancelado = false
    contratosParaOtrosi()
      .then((l: ContratoParaOtrosi[]) => !cancelado && setContratos(l))
      .catch((e) => !cancelado && setErrorCarga(e instanceof Error ? e.message : "No se pudieron cargar los contratos."))
    return () => {
      cancelado = true
    }
  }, [edicion])

  // Contratistas con contratos abiertos (una pasada) y sus contratos.
  const { contratistas, porContratista } = useMemo(() => {
    const porContratista = new Map<string, ContratoParaOtrosi[]>()
    const contratistas: { id: string; nombre: string; documento: string; n: number }[] = []
    for (const c of contratos ?? []) {
      let lista = porContratista.get(c.contratistaId)
      if (!lista) {
        lista = []
        porContratista.set(c.contratistaId, lista)
        contratistas.push({ id: c.contratistaId, nombre: c.contratistaNombre, documento: c.contratistaDocumento, n: 0 })
      }
      lista.push(c)
    }
    for (const k of contratistas) k.n = porContratista.get(k.id)!.length
    return { contratistas, porContratista }
  }, [contratos])

  const termino = busqueda.trim().toLowerCase()
  const visibles = termino
    ? contratistas.filter((k) => k.nombre.toLowerCase().includes(termino) || k.documento.toLowerCase().includes(termino))
    : contratistas
  const delContratista = contratistaId ? (porContratista.get(contratistaId) ?? []) : []
  const contratistaElegido = contratistas.find((k) => k.id === contratistaId) ?? null
  const contratoElegido = delContratista.find((x) => x.id === contratoId) ?? null
  const finVigente = edicion ? edicion.fechaFin : (contratoElegido?.fechaFin ?? null)
  const valorVigente = edicion ? edicion.valor : (contratoElegido?.valor ?? 0)
  const nuevoValor = cambiarValor ? leerNumero(nuevoValorTexto) : null

  const porActividades = (edicion ? edicion.anexoTipo : contratoElegido?.anexoTipo) === "valores_unitarios"
  const acts = actsEstado.contratoId === contratoId ? actsEstado.form : ACTIVIDADES_VACIAS
  const cambiarActs = (form: ActividadesOtrosiForm) => {
    setActsEstado({ contratoId, form })
    setError(null)
  }
  const cargaActs = datosActs && datosActs.contratoId === contratoId ? datosActs : null
  useEffect(() => {
    if (!contratoId || !porActividades) return
    let cancelado = false
    actividadesParaOtrosi(contratoId)
      .then((datos) => !cancelado && setDatosActs({ contratoId, datos, error: null }))
      .catch((e) => !cancelado && setDatosActs({ contratoId, datos: null, error: e instanceof Error ? e.message : "No se pudieron cargar las actividades." }))
    return () => {
      cancelado = true
    }
  }, [contratoId, porActividades])
  const lecturaActs =
    porActividades && cargaActs?.datos
      ? leerActividadesOtrosi(acts, {
          anexo: cargaActs.datos.anexo,
          catalogo: cargaActs.datos.catalogo,
          topeDe: (item) => topeValorUnitario(item, cargaActs.datos!.tipo),
        })
      : null
  const totalActs = lecturaActs?.ok ? lecturaActs.total : 0
  const conActividades = Boolean(lecturaActs?.ok && lecturaActs.envio.length > 0)

  function cambiar(i: number, cambio: Partial<ModificacionOtrosi>) {
    setModificaciones((l) => l.map((x, j) => (j === i ? { ...x, ...cambio } : x)))
    setError(null)
  }

  async function enviar() {
    const fechaProrroga = extender ? nuevaFechaFin : null
    if (extender && !nuevaFechaFin) {
      setError("Escoge la nueva fecha de terminación o quita la marca de extender la fecha.")
      return
    }
    if (lecturaActs && !lecturaActs.ok) {
      setError(lecturaActs.error)
      return
    }
    const envioActs = lecturaActs?.ok ? lecturaActs.envio : []
    // Con actividades el valor lo pone la base (vigente + actividades).
    const valorEnvio = envioActs.length > 0 ? null : nuevoValor
    if (envioActs.length === 0 && cambiarValor && nuevoValor === null) {
      setError("Escribe el nuevo valor del contrato o quita la marca de cambiar el valor.")
      return
    }
    const problema = validarSolicitudOtrosi({
      contratoId,
      modificaciones,
      justificacion,
      prorroga: { nuevaFechaFin: fechaProrroga, finVigente, hoy: hoyColombia() },
      cambioValor: { nuevoValor: valorEnvio, valorVigente },
    })
    if (problema) {
      setError(problema)
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const mods = modificaciones.map((m) => ({ clausula: m.clausula.trim(), redaccion: m.redaccion.trim() }))
      if (edicion) {
        await reenviarOtrosi(edicion.id, mods, justificacion.trim(), fechaProrroga, valorEnvio, envioActs)
        onTerminado(`Otrosí al contrato ${edicion.numeroContrato} corregido y enviado otra vez a Jurídica.`)
      } else {
        await crearOtrosi(contratoId!, mods, justificacion.trim(), fechaProrroga, valorEnvio, envioActs)
        const c = delContratista.find((x) => x.id === contratoId)
        onTerminado(`Otrosí al contrato ${c?.numeroContrato ?? ""} enviado a Jurídica.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el otrosí.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelar} disabled={enviando}>
          <ArrowLeft className="size-4" /> Volver
        </Button>
        <h2 className="text-base font-semibold">{edicion ? `Corregir otrosí al contrato ${edicion.numeroContrato}` : "Solicitar otrosí"}</h2>
      </div>

      {edicion ? (
        <div className="space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
          <p className="font-medium">
            {edicion.numeroContrato} · {nombreTipoContrato(edicion)} · {edicion.contratistaNombre}
          </p>
          <p className="text-muted-foreground">{edicion.objeto}</p>
          <Button size="sm" variant="outline" onClick={() => setViendo({ id: edicion.contratoId, numeroContrato: edicion.numeroContrato })}>
            <Eye className="size-4" /> Ver contrato
          </Button>
          {edicion.motivo && <p className="text-orange-800">Motivo de la devolución: {edicion.motivo}</p>}
        </div>
      ) : (
        <>
          {/* 1. Contratista */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">1. Contratista</h3>
            {errorCarga && <p className="text-sm text-destructive">{errorCarga}</p>}
            {contratos === null && !errorCarga ? (
              <p className="flex items-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Cargando contratos abiertos...
              </p>
            ) : contratos && contratos.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                No hay contratos abiertos en tus proyectos: el otrosí solo se puede pedir a un contrato aprobado, sin liquidar y con el plazo sin terminar.
              </p>
            ) : contratistaElegido ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">{contratistaElegido.nombre}</span>
                <span className="text-muted-foreground">{contratistaElegido.documento}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => {
                    setContratistaId(null)
                    setContratoId(null)
                  }}
                  disabled={enviando}
                >
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    aria-label="Buscar contratista"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar por nombre o documento"
                    className="h-9 w-full rounded-md border bg-background pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                  {visibles.slice(0, 100).map((k) => (
                    <li key={k.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setContratistaId(k.id)
                          const lista = porContratista.get(k.id) ?? []
                          setContratoId(lista.length === 1 ? lista[0].id : null)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <span className="flex-1 font-medium">{k.nombre}</span>
                        <span className="text-xs text-muted-foreground">{k.documento}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {k.n} {k.n === 1 ? "contrato" : "contratos"}
                        </span>
                      </button>
                    </li>
                  ))}
                  {visibles.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Ningún contratista coincide.</li>}
                </ul>
                {visibles.length > 100 && <p className="text-xs text-muted-foreground">Mostrando 100 de {visibles.length}: escribe para filtrar.</p>}
              </div>
            )}
          </section>

          {/* 2. Contrato */}
          {contratistaElegido && (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">2. Contrato abierto</h3>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-left text-xs">
                      <th className="w-8 px-2 py-1.5" />
                      <th className="px-2 py-1.5">Contrato</th>
                      <th className="px-2 py-1.5">Tipo</th>
                      <th className="px-2 py-1.5">Proyecto</th>
                      <th className="px-2 py-1.5">Objeto</th>
                      <th className="px-2 py-1.5 text-right">Valor</th>
                      <th className="px-2 py-1.5">Fin del plazo</th>
                      <th className="px-2 py-1.5 text-right">Otrosí</th>
                      <th className="w-16 px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {delContratista.map((c) => (
                      <tr key={c.id} className={`cursor-pointer border-t ${contratoId === c.id ? "bg-primary/5" : "hover:bg-muted/40"}`} onClick={() => setContratoId(c.id)}>
                        <td className="px-2 py-1.5">
                          <input
                            type="radio"
                            name="contrato-otrosi"
                            aria-label={`Contrato ${c.numeroContrato}`}
                            checked={contratoId === c.id}
                            onChange={() => setContratoId(c.id)}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-medium tabular-nums">{c.numeroContrato}</td>
                        <td className="px-2 py-1.5">{nombreTipoContrato(c)}</td>
                        <td className="px-2 py-1.5">{c.proyectoCodigo ?? c.proyectoNombre}</td>
                        <td className="max-w-64 truncate px-2 py-1.5" title={c.objeto}>
                          {c.objeto}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pesos(c.valor)}</td>
                        <td className="px-2 py-1.5 tabular-nums">{c.fechaFin ? formatearFechaSinHora(c.fechaFin) : "Sin fecha"}</td>
                        <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                          {c.otrosisAprobados} aprob.{c.otrosisEnTramite > 0 && ` · ${c.otrosisEnTramite} en trámite`}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <Button
                            size="xs"
                            variant="outline"
                            title={`Ver el contrato ${c.numeroContrato}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              setViendo({ id: c.id, numeroContrato: c.numeroContrato })
                            }}
                          >
                            <Eye className="size-3.5" /> Ver
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* 3. Cláusulas */}
      {(edicion || contratoId) && (
        <>
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{edicion ? "Cláusulas que se modifican" : "3. Cláusulas que se modifican"}</h3>
              <p className="text-xs text-muted-foreground">
                Por cada una: qué cláusula del contrato cambia y cómo queda escrita completa (es lo que sale en el documento). Si cambian el
                plazo, el valor o las actividades, márcalo también abajo para que el sistema lo tome al aprobarse.
              </p>
            </div>
            {modificaciones.map((m, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">Modificación {i + 1}</span>
                  {modificaciones.length > 1 && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Quitar la modificación ${i + 1}`}
                      onClick={() => setModificaciones((l) => l.filter((_, j) => j !== i))}
                      disabled={enviando}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor={`otrosi-clausula-${i}`} className="text-xs font-medium text-muted-foreground">
                    Cláusula que se modifica *
                  </label>
                  <input
                    id={`otrosi-clausula-${i}`}
                    value={m.clausula}
                    onChange={(e) => cambiar(i, { clausula: e.target.value })}
                    placeholder="TERCERA. PLAZO"
                    maxLength={200}
                    disabled={enviando}
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={`otrosi-redaccion-${i}`} className="text-xs font-medium text-muted-foreground">
                    Cómo queda la cláusula *
                  </label>
                  <textarea
                    id={`otrosi-redaccion-${i}`}
                    rows={5}
                    value={m.redaccion}
                    onChange={(e) => cambiar(i, { redaccion: e.target.value })}
                    placeholder="Redacción completa de la cláusula nueva"
                    disabled={enviando}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </div>
              </div>
            ))}
            {modificaciones.length < MAXIMO_MODIFICACIONES_OTROSI && (
              <Button type="button" size="sm" variant="outline" onClick={() => setModificaciones((l) => [...l, { clausula: "", redaccion: "" }])} disabled={enviando}>
                <Plus className="size-4" /> Agregar otra cláusula
              </Button>
            )}
          </section>

          <section className="space-y-1">
            <label htmlFor="otrosi-justificacion" className="text-sm font-semibold">
              {edicion ? "Justificación *" : "4. Justificación *"}
            </label>
            <textarea
              id="otrosi-justificacion"
              rows={3}
              value={justificacion}
              onChange={(e) => {
                setJustificacion(e.target.value)
                setError(null)
              }}
              placeholder="Por qué se necesita el otrosí (para Jurídica)"
              maxLength={5000}
              disabled={enviando}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </section>

          <section className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={extender}
                onChange={(e) => {
                  setExtender(e.target.checked)
                  setError(null)
                }}
                disabled={enviando}
                className="size-4"
              />
              ¿Se va a extender la fecha de terminación del contrato?
            </label>
            <p className="text-xs text-muted-foreground">
              Fin vigente: {finVigente ? formatearFechaSinHora(finVigente) : "sin fecha (sin inicio definido)"}
            </p>
            {extender && (
              <div className="space-y-1">
                <label htmlFor="otrosi-nueva-fecha" className="text-sm">
                  Nueva fecha de terminación *
                </label>
                <input
                  id="otrosi-nueva-fecha"
                  type="date"
                  value={nuevaFechaFin}
                  min={finVigente && finVigente > hoyColombia() ? finVigente : hoyColombia()}
                  onChange={(e) => {
                    setNuevaFechaFin(e.target.value)
                    setError(null)
                  }}
                  disabled={enviando}
                  className="block rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Cuando el otrosí quede aprobado, esta pasa a ser la fecha de terminación del contrato (actas, avisos de vencimiento y
                  nuevos otrosí). Recuerda modificar también la cláusula del plazo arriba.
                </p>
              </div>
            )}
          </section>

          {porActividades && (
            <section className="space-y-2 rounded-md border p-3">
              <h3 className="text-sm font-semibold">Actividades (opcional)</h3>
              <p className="text-xs text-muted-foreground">
                Más cantidad de actividades del contrato (a su valor pactado) o actividades nuevas del presupuesto. Cuando el otrosí quede
                aprobado se agregan al contrato y se pueden cobrar en las actas; el valor del contrato sube solo.
              </p>
              {!cargaActs ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Cargando actividades…
                </p>
              ) : cargaActs.error || !cargaActs.datos ? (
                <p className="text-sm text-destructive">{cargaActs.error}</p>
              ) : !cargaActs.datos.tienePresupuesto ? (
                <p className="text-sm text-muted-foreground">El proyecto no tiene presupuesto vigente: no se pueden agregar actividades.</p>
              ) : (
                <ActividadesOtrosi datos={cargaActs.datos} form={acts} onChange={cambiarActs} disabled={enviando} />
              )}
              {lecturaActs && !lecturaActs.ok && <p className="text-xs text-destructive">{lecturaActs.error}</p>}
            </section>
          )}

          {conActividades ? (
            <section className="space-y-1 rounded-md border p-3 text-sm">
              <p className="font-semibold">Valor del contrato</p>
              <p className="tabular-nums">
                Vigente {pesos(valorVigente)} + actividades {pesos(totalActs)} = <strong>{pesos(valorVigente + totalActs)}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Con actividades el nuevo valor es este (no se escribe a mano). Al aprobarse pasa a ser el tope de las actas. Recuerda
                modificar también la cláusula del valor arriba.
              </p>
            </section>
          ) : (
          <section className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={cambiarValor}
                onChange={(e) => {
                  setCambiarValor(e.target.checked)
                  setError(null)
                }}
                disabled={enviando}
                className="size-4"
              />
              ¿Cambia el valor total del contrato?
            </label>
            <p className="text-xs text-muted-foreground tabular-nums">Valor vigente: {pesos(valorVigente)}</p>
            {cambiarValor && (
              <div className="space-y-1">
                <label htmlFor="otrosi-nuevo-valor" className="text-sm">
                  Nuevo valor total del contrato (pesos) *
                </label>
                <input
                  id="otrosi-nuevo-valor"
                  inputMode="decimal"
                  value={nuevoValorTexto}
                  onChange={(e) => {
                    setNuevoValorTexto(e.target.value)
                    setError(null)
                  }}
                  placeholder="Ej. 30.000.000"
                  disabled={enviando}
                  className="block w-full max-w-sm rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                {nuevoValor !== null && nuevoValor > 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {pesosEnLetras(nuevoValor)}
                    {nuevoValor !== valorVigente && ` · ${nuevoValor > valorVigente ? "adición" : "reducción"} de ${pesos(Math.abs(nuevoValor - valorVigente))}`}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Cuando el otrosí quede aprobado, este pasa a ser el tope de las actas del contrato (no puede ser menor que lo ya cobrado).
                  El anticipo sigue calculado sobre el valor inicial. Recuerda modificar también la cláusula del valor arriba.
                </p>
                {porActividades && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Este contrato es por actividades: en las actas cada actividad sigue limitada a su cantidad; para cobrar más, agrega
                    actividades o aumenta cantidades arriba.
                  </p>
                )}
              </div>
            )}
          </section>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onCancelar} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={enviar} disabled={enviando}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {edicion ? "Enviar otra vez a Jurídica" : "Enviar a Jurídica"}
            </Button>
          </div>
        </>
      )}
      <VerContratoOtrosi contrato={viendo} onCerrar={() => setViendo(null)} />
    </div>
  )
}

// ---------------------------------------------------------------- actividades
const ACTIVIDADES_VACIAS: ActividadesOtrosiForm = { adiciones: {}, nuevas: [] }
const comoTexto = (n: number) => String(n).replace(".", ",")

function actividadesDesdeEdicion(edicion: OtrosiDetalle | null): ActividadesOtrosiForm {
  if (!edicion) return ACTIVIDADES_VACIAS
  const adiciones: Record<string, string> = {}
  const nuevas: ActividadesOtrosiForm["nuevas"] = []
  for (const a of edicion.actividades) {
    if (a.tipo === "adicion" && a.anexoItemId) adiciones[a.anexoItemId] = comoTexto(a.cantidad)
    else nuevas.push({ presupuestoItemId: a.presupuestoItemId, cantidad: comoTexto(a.cantidad), valorUnitario: comoTexto(a.valorUnitario) })
  }
  return { adiciones, nuevas }
}

const claseNumero =
  "w-full rounded-md border bg-background px-2 py-1 text-right text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-primary"

// Adiciones a las actividades del contrato y actividades nuevas del
// presupuesto (con el tope del tipo de contrato: mano de obra en mano de obra).
function ActividadesOtrosi({
  datos,
  form,
  onChange,
  disabled,
}: {
  datos: ActividadesParaOtrosi
  form: ActividadesOtrosiForm
  onChange: (f: ActividadesOtrosiForm) => void
  disabled: boolean
}) {
  const catalogoPorId = useMemo(() => new Map(datos.catalogo.map((c) => [c.id, c])), [datos.catalogo])
  const catalogoConTope = useMemo(
    () => datos.catalogo.map((c) => ({ ...c, valorUnitario: topeValorUnitario(c, datos.tipo) })),
    [datos.catalogo, datos.tipo]
  )
  const usados = new Set(form.nuevas.map((n) => n.presupuestoItemId).filter(Boolean))
  const cambiarNueva = (i: number, cambio: Partial<ActividadesOtrosiForm["nuevas"][number]>) =>
    onChange({ ...form, nuevas: form.nuevas.map((n, j) => (j === i ? { ...n, ...cambio } : n)) })

  return (
    <div className="space-y-3">
      {datos.anexo.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Actividad del contrato</th>
                <th className="px-2 py-1.5 text-right font-medium">Contratada</th>
                <th className="px-2 py-1.5 text-right font-medium">Valor unitario</th>
                <th className="px-2 py-1.5 text-right font-medium">Disponible</th>
                <th className="w-32 px-2 py-1.5 text-right font-medium">Cantidad adicional</th>
              </tr>
            </thead>
            <tbody>
              {datos.anexo.map((a) => (
                <tr key={a.id} className="border-t align-top">
                  <td className="px-2 py-1.5">
                    {a.codigo && <span className="font-medium tabular-nums">{a.codigo} </span>}
                    {a.actividad}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {numero(a.cantidad)} {a.unidad}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{pesos(a.valorUnitario)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{a.enPresupuesto ? numero(a.disponible) : "No está en el presupuesto"}</td>
                  <td className="p-1">
                    <input
                      aria-label={`Cantidad adicional de ${a.actividad}`}
                      inputMode="decimal"
                      value={form.adiciones[a.id] ?? ""}
                      onChange={(e) => onChange({ ...form, adiciones: { ...form.adiciones, [a.id]: e.target.value } })}
                      disabled={disabled || !a.enPresupuesto || a.disponible <= 0}
                      className={claseNumero}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form.nuevas.length > 0 && (
        <div className="space-y-2">
          {form.nuevas.map((n, i) => {
            const item = n.presupuestoItemId ? catalogoPorId.get(n.presupuestoItemId) : undefined
            const tope = item ? topeValorUnitario(item, datos.tipo) : 0
            const cantidad = leerNumero(n.cantidad)
            const vu = leerNumero(n.valorUnitario)
            return (
              <div key={i} className="space-y-2 rounded-md border p-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {item ? (
                      <>
                        <p className="text-sm break-words">
                          <span className="font-medium tabular-nums">{item.codigo}</span> {item.descripcion}
                        </p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          Disponible {numero(item.disponible)} {item.unidad ?? ""} · máx. {pesos(tope)} c/u
                          {datos.tipo === "mano_obra" && !sinManoObraEnApu(item, datos.tipo) && ` (mano de obra; ítem completo ${pesos(item.valorUnitario)})`}
                        </p>
                        {sinManoObraEnApu(item, datos.tipo) && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            El APU de este ítem no tiene mano de obra: el tope es el ítem completo y Jurídica lo verá marcado.
                          </p>
                        )}
                      </>
                    ) : (
                      <SelectorItemPresupuesto
                        etiqueta={`Actividad nueva ${i + 1}`}
                        catalogo={catalogoConTope}
                        excluir={usados}
                        disabled={disabled}
                        onElegir={(c) => cambiarNueva(i, { presupuestoItemId: c.id, valorUnitario: comoTexto(c.valorUnitario) })}
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Quitar la actividad nueva ${i + 1}`}
                    onClick={() => onChange({ ...form, nuevas: form.nuevas.filter((_, j) => j !== i) })}
                    disabled={disabled}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                {item && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Cantidad ({item.unidad ?? "und"})</span>
                      <input
                        inputMode="decimal"
                        value={n.cantidad}
                        onChange={(e) => cambiarNueva(i, { cantidad: e.target.value })}
                        disabled={disabled}
                        className={claseNumero}
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Valor unitario</span>
                      <input
                        inputMode="decimal"
                        value={n.valorUnitario}
                        onChange={(e) => cambiarNueva(i, { valorUnitario: e.target.value })}
                        disabled={disabled}
                        className={claseNumero}
                      />
                    </label>
                    <div className="space-y-0.5 text-right">
                      <span className="text-muted-foreground">Total</span>
                      <p className="py-1 text-sm tabular-nums">{cantidad && vu ? pesos(Math.round(cantidad * vu * 100) / 100) : "—"}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onChange({ ...form, nuevas: [...form.nuevas, { presupuestoItemId: "", cantidad: "", valorUnitario: "" }] })}
        disabled={disabled || form.nuevas.length >= 50 || datos.catalogo.length === 0}
      >
        <Plus className="size-4" /> Agregar actividad nueva del presupuesto
      </Button>
    </div>
  )
}
