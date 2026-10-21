"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CampoMinuta,
  ChipOrigen,
  ClausulasAdicionalesEditor,
  LeyendaOrigen,
  ListaEditable,
  PanelVistaPrevia,
  Seccion,
  SelectorMinuta,
  TablaAmparosMinuta,
  claseCampo,
  descargarPdfMinuta,
  focoDeEvento,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { leerNumero, pesos, type SolicitudContratoDetalle } from "@/lib/contratos"
import { origenRenglon, valorEnLetras, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR } from "@/lib/minuta-arrendamiento"
import {
  CLAUSULAS_VEHICULO,
  OBLIGACIONES_CONTRATANTE_VEHICULO,
  OBLIGACIONES_ESPECIFICAS_VEHICULO,
  OBLIGACIONES_GENERALES_VEHICULO,
  OPCIONES_GARANTIA_VEHICULO,
  PRIMERA_CLAUSULA_ADICIONAL_VEHICULO,
  nombreArchivoMinutaVehiculo,
  obligacionOferta,
  origenCampoVehiculo,
  type MinutaVehiculo,
} from "@/lib/minuta-vehiculo"
import { guardarMinutaVehiculo, obtenerMinutaVehiculo, type MinutaContratoVehiculo } from "@/app/(app)/contratos/pre-aprobacion/actions"
import { SelectorRepresentante } from "@/components/selector-representante"

// ---------------------------------------------------------------------------
// Editor de la minuta de alquiler de vehículo o maquinaria dentro del detalle
// de Pre-aprobación. Mismo funcionamiento que las demás minutas. El texto fijo
// de las cláusulas está en components/minuta-vehiculo-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaVehiculo]: MinutaVehiculo[K] extends string ? K : never }[keyof MinutaVehiculo]
type CampoLista = "obligacionesContratante" | "obligacionesGenerales" | "obligacionesEspecificas"

const numero = (i: number) => `${i + 1}.`

export function MinutaVehiculoEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContratoVehiculo | null>(null)
  const [m, setM] = useState<MinutaVehiculo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  // Dato que se está editando: la vista previa lo resalta y abre en su página.
  const [foco, setFoco] = useState<string | null>(null)
  const vistaPrevia = useVistaPreviaMinuta(detalle.id, m, foco)

  const editable = puedeEditar && detalle.estado !== "rechazada"
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerMinutaVehiculo(detalle.id)
      .then((d: MinutaContratoVehiculo) => {
        if (cancelado) return
        setDatos(d)
        setM(d.minuta)
      })
      .catch((e) => !cancelado && setError(e instanceof Error ? e.message : "No se pudo cargar la minuta."))
    return () => {
      cancelado = true
    }
  }, [detalle.id])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!m || !datos) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> Cargando minuta...
      </div>
    )
  }

  function actualizar(cambio: Partial<MinutaVehiculo>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  // El valor en letras sigue al número mientras nadie lo haya escrito a mano
  // (valor del contrato y anticipo).
  function cambiarConLetras(numeroClave: "valor" | "anticipo", letrasClave: "valorLetras" | "anticipoLetras", texto: string) {
    const anterior = leerNumero(m![numeroClave])
    const nuevo = leerNumero(texto)
    const automaticas = anterior !== null && m![letrasClave] === valorEnLetras(anterior)
    actualizar({
      [numeroClave]: texto,
      ...(nuevo !== null && (automaticas || !m![letrasClave].trim()) ? { [letrasClave]: valorEnLetras(nuevo) } : {}),
      ...(!texto.trim() ? { [letrasClave]: "" } : {}),
    } as Partial<MinutaVehiculo>)
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean; filas?: number }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampoVehiculo(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) =>
          clave === "valor"
            ? cambiarConLetras("valor", "valorLetras", v)
            : clave === "anticipo"
              ? cambiarConLetras("anticipo", "anticipoLetras", v)
              : actualizar({ [clave]: v } as Partial<MinutaVehiculo>)
        }
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function lista(clave: CampoLista) {
    const plantilla =
      clave === "obligacionesContratante"
        ? OBLIGACIONES_CONTRATANTE_VEHICULO
        : clave === "obligacionesGenerales"
          ? OBLIGACIONES_GENERALES_VEHICULO
          : OBLIGACIONES_ESPECIFICAS_VEHICULO
    const deSolicitud = clave === "obligacionesEspecificas" ? detalle.obligaciones : []
    return (
      <ListaEditable
        foco={clave}
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaVehiculo>)}
        marcador={numero}
        origen={(t) => origenRenglon(t, plantilla, deSolicitud)}
        textoAgregar="Agregar obligación"
        editable={editable}
        guardando={guardando}
      />
    )
  }

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarMinutaVehiculo(detalle.id, m)
      setDatos((d) => (d ? { ...d, guardadaAt: r.guardadaAt, guardadaPorNombre: null } : d))
      setCambios(false)
      setAviso({ ok: true, texto: "Minuta guardada." })
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo guardar la minuta." })
    } finally {
      setGuardando(false)
    }
  }

  async function descargar() {
    if (!m) return
    setDescargando(true)
    try {
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinutaVehiculo(detalle.numero, m.contratistaNombre))
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : "No se pudo generar el PDF." })
    } finally {
      setDescargando(false)
    }
  }

  function restablecer() {
    if (!datos) return
    if (!confirm("¿Volver a llenar la minuta con los datos de la solicitud? Se pierde lo que se haya editado (hasta que guardes, lo guardado no cambia).")) return
    setM(datos.porDefecto)
    setCambios(true)
    setAviso(null)
  }

  const juridica = m.contratistaTipoPersona === "juridica"
  const valorNumero = leerNumero(m.valor)
  const anticipoNumero = leerNumero(m.anticipo)
  const origenTipoDocumento: OrigenDato = m.contratistaTipoDocumento === datos.porDefecto.contratistaTipoDocumento ? "solicitud" : "editado"
  const origenGarantia: OrigenDato = !m.garantia ? "vacio" : "editado"

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      onFocus={(e) => {
        const f = focoDeEvento(e)
        if (f) setFoco(f)
      }}
    >
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla · Contrato de alquiler de vehículo o maquinaria (versión 04)</p>
            {datos.guardadaAt ? (
              <p>
                Guardada el {fechaContrato(datos.guardadaAt)}
                {datos.guardadaPorNombre && ` por ${datos.guardadaPorNombre}`}
                {cambios && " · hay cambios sin guardar"}
              </p>
            ) : (
              <p>{cambios ? "Cambios sin guardar." : "Llenada con los datos de la solicitud; todavía no se ha guardado."}</p>
            )}
            {!editable && <p>Solo lectura{detalle.estado === "rechazada" ? ": la solicitud fue rechazada." : "."}</p>}
          </div>
          {editable && (
            <Button type="button" size="sm" variant="ghost" onClick={restablecer} disabled={guardando}>
              <RotateCcw className="size-4" /> Restablecer
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={descargar} disabled={descargando}>
            {descargando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Descargar PDF
          </Button>
          {editable && (
            <Button type="button" size="sm" onClick={guardar} disabled={guardando || !cambios}>
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Guardar
            </Button>
          )}
        </div>
        {aviso && <p className={`text-sm ${aviso.ok ? "text-emerald-700" : "text-destructive"}`}>{aviso.texto}</p>}
        <LeyendaOrigen />

        <Seccion titulo="Contratante" ayuda="La empresa del proyecto.">
          <SelectorRepresentante contratoId={detalle.id} documentoActual={m.contratanteRepresentanteCedula} deshabilitado={deshabilitado} onElegir={(r) => actualizar({ contratanteRepresentante: r.nombre, contratanteRepresentanteCedula: r.numeroDocumento })} />
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteCorreo", "Correo de notificaciones (vigésima cuarta)", { tipo: "email", ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Contratista" ayuda="Propietario del vehículo o la maquinaria.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor="minuta-contratista-tipo" className="text-xs font-medium text-muted-foreground">
                Tipo de persona
              </label>
              <select
                id="minuta-contratista-tipo"
                value={m.contratistaTipoPersona}
                onChange={(e) => actualizar({ contratistaTipoPersona: e.target.value as "natural" | "juridica" })}
                disabled={deshabilitado}
                className={claseCampo}
              >
                <option value="natural">Persona natural</option>
                <option value="juridica">Persona jurídica (firma su representante legal)</option>
              </select>
            </div>
            {campo("contratistaNombre", juridica ? "Razón social" : "Nombre completo")}
            {juridica && campo("contratistaNit", "NIT")}
            {juridica && campo("contratistaRepresentante", "Representante legal")}
            <SelectorMinuta
              id="minuta-contratista-tipo-documento"
              etiqueta={juridica ? "Documento del representante" : "Tipo de documento"}
              valor={m.contratistaTipoDocumento}
              opciones={TIPOS_DOCUMENTO_ARRENDADOR}
              origen={origenTipoDocumento}
              onChange={(v) => v && actualizar({ contratistaTipoDocumento: v })}
              disabled={deshabilitado}
            />
            {campo("contratistaCedula", juridica ? "Número de documento del representante" : "Número de documento")}
            {campo("contratistaCorreo", "Correo de notificaciones (vigésima cuarta)", { tipo: "email", ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Primera · Objeto">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("bien", "Vehículo o maquinaria", {
              filas: 3,
              ayuda: "Sigue a «…para su utilización durante el periodo contratado,» y va antes de «para uso en el proyecto …».",
            })}
            {campo("bienNombre", "Nombre corto (décima sexta)", { placeholder: "retroexcavadora", ayuda: "«La utilización de la … por un período adicional»." })}
            {campo("obra", "Proyecto")}
            {campo("ofertaMercantil", "Oferta mercantil No.", {
              ancho: true,
              ayuda: "Sale en la primera (accesorios), en la octava (obligación 7) y en la décima octava (documentos).",
            })}
          </div>
        </Seccion>

        <Seccion titulo="Segunda · Plazo">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("periodo", "Periodo de operación", { placeholder: "tres (3) meses", ayuda: "«…será de … contado a partir de su llegada a la obra»." })}
            {campo("horasOperacion", "Horas de operación (opcional)", {
              placeholder: "doscientas (200) horas de operación",
              ayuda: "Si se escribe: «…o …, lo que ocurra primero»."
            })}
          </div>
        </Seccion>

        <Seccion titulo="Tercera a quinta · Valor, anticipo y forma de pago">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("valor", "Valor del contrato ($)", { ayuda: valorNumero === null ? "Escribe el valor en pesos." : pesos(valorNumero) })}
            {campo("valorLetras", "Valor en letras", { ayuda: "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano." })}
            {campo("detalleValor", "Detalle del valor («correspondiente a:»)", { filas: 3, ayuda: "Como esté en la oferta o la cotización." })}
            {campo("anticipo", "Anticipo ($)", {
              ayuda: anticipoNumero === null ? "Vacío = sin anticipo (la cuarta dice que no se entrega)." : pesos(anticipoNumero),
            })}
            {campo("anticipoLetras", "Anticipo en letras")}
            {campo("periodicidadPago", "Actas parciales", { placeholder: "mensuales", ayuda: "«Los pagos se efectuaran mediante actas parciales …»." })}
            {campo("condicionesPago", "Forma de pago de la solicitud (párrafo aparte, opcional)", { filas: 2 })}
          </div>
        </Seccion>

        <Seccion titulo="Sexta a octava · Obligaciones">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones del contratante:</p>
              {lista("obligacionesContratante")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones generales del contratista:</p>
              {lista("obligacionesGenerales")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones específicas del contratista:</p>
              {lista("obligacionesEspecificas")}
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ChipOrigen origen="plantilla" />
                <span>
                  Va siempre al final ({m.obligacionesEspecificas.length + 1}.): {obligacionOferta(m.ofertaMercantil)}
                </span>
              </p>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Décima quinta · Garantías" ayuda="La plantilla trae las dos opciones; elige una.">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectorMinuta
              id="minuta-garantia"
              etiqueta="Garantía"
              valor={m.garantia}
              opciones={OPCIONES_GARANTIA_VEHICULO}
              origen={origenGarantia}
              onChange={(garantia) => actualizar({ garantia })}
              disabled={deshabilitado}
              ancho
            />
          </div>
          {m.garantia === "exige" && (
            <TablaAmparosMinuta
              amparos={m.amparos}
              porDefecto={datos.porDefecto.amparos}
              onChange={(amparos) => actualizar({ amparos })}
              editable={editable}
              guardando={guardando}
            />
          )}
        </Seccion>

        <Seccion titulo="Domicilio y lugar de ejecución">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("domicilio", "Domicilio del contrato (décima séptima)", { ancho: true })}
            {campo("ciudadEjecucion", "Ciudad de ejecución (vigésima segunda)")}
            {campo("departamentoEjecucion", "Departamento de ejecución")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Las de la plantilla van con su texto fijo; aquí se agregan otras.">
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Cláusulas de la plantilla ({CLAUSULAS_VEHICULO.length}) — texto fijo</summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_VEHICULO.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <ChipOrigen origen="plantilla" />
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </details>
          <ClausulasAdicionalesEditor
            clausulas={m.clausulasAdicionales}
            onChange={(clausulasAdicionales) => actualizar({ clausulasAdicionales })}
            desde={PRIMERA_CLAUSULA_ADICIONAL_VEHICULO}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date", ayuda: "El año también va en el número: No. CJ-<número>-<año>." })}
          </div>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
