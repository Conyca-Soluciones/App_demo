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
  TablaItemsMinuta,
  claseCampo,
  descargarPdfMinuta,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { leerNumero, pesos } from "@/lib/contratos"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import {
  CLAUSULAS_PLANTILLA,
  OBLIGACIONES_CONTRATANTE,
  OBLIGACIONES_CONTRATISTA,
  POSICION_OBLIGACION_CORRECCION,
  REQUISITOS_PAGO,
  ordinalClausula,
  origenCampo,
  origenRenglon,
  nombreArchivoMinuta,
  obligacionCorreccion,
  totalItemsMinuta,
  valorEnLetras,
  type MinutaManoObra,
} from "@/lib/minuta-mano-obra"
import type { SolicitudContratoDetalle } from "@/lib/contratos"
import { guardarMinutaContrato, obtenerMinutaContrato, type MinutaContrato } from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de mano de obra (plantilla GJ-F-003) dentro del detalle
// de Pre-aprobación: todos los campos de la plantilla, prellenados con la
// solicitud; vista previa del PDF con lo que está en pantalla, descarga y
// guardado (contratos.minuta_datos). El texto fijo de las cláusulas está en
// components/minuta-mano-obra-pdf.tsx.
// ---------------------------------------------------------------------------

const formatoValor = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })

type CampoTexto = { [K in keyof MinutaManoObra]: MinutaManoObra[K] extends string ? K : never }[keyof MinutaManoObra]
type CampoLista = "obligacionesContratante" | "obligacionesContratista" | "requisitosPago"

export function MinutaManoObraEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContrato | null>(null)
  const [m, setM] = useState<MinutaManoObra | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)
  const [descargando, setDescargando] = useState(false)
  const vistaPrevia = useVistaPreviaMinuta(detalle.id, m)

  const editable = puedeEditar && detalle.estado !== "rechazada"
  const deshabilitado = !editable || guardando

  useEffect(() => {
    let cancelado = false
    obtenerMinutaContrato(detalle.id)
      .then((d: MinutaContrato) => {
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

  function actualizar(cambio: Partial<MinutaManoObra>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  function cambiarValor(texto: string) {
    // El valor en letras sigue al número mientras nadie lo haya escrito a mano.
    const anterior = leerNumero(m!.valor)
    const nuevo = leerNumero(texto)
    const letrasAutomaticas = anterior !== null && m!.valorLetras === valorEnLetras(anterior)
    actualizar({ valor: texto, ...(nuevo !== null && (letrasAutomaticas || !m!.valorLetras.trim()) ? { valorLetras: valorEnLetras(nuevo) } : {}) })
  }

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampo(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => (clave === "valor" ? cambiarValor(v) : actualizar({ [clave]: v } as Partial<MinutaManoObra>))}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function area(clave: CampoTexto, etiqueta: string, filas = 3, ayuda?: string) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampo(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => actualizar({ [clave]: v } as Partial<MinutaManoObra>)}
        disabled={deshabilitado}
        filas={filas}
        ayuda={ayuda}
      />
    )
  }

  function lista(clave: CampoLista, marcador: (i: number) => string, textoAgregar: string) {
    const plantilla =
      clave === "obligacionesContratante" ? OBLIGACIONES_CONTRATANTE : clave === "obligacionesContratista" ? OBLIGACIONES_CONTRATISTA : REQUISITOS_PAGO
    const deSolicitud = clave === "obligacionesContratista" ? detalle.obligaciones : []
    return (
      <ListaEditable
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaManoObra>)}
        marcador={marcador}
        origen={(t) => origenRenglon(t, plantilla, deSolicitud)}
        textoAgregar={textoAgregar}
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
      const r = await guardarMinutaContrato(detalle.id, m)
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
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinuta(detalle.numero, m.contratistaNombre))
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

  const totalAnexo = totalItemsMinuta(m.items)
  const valorNumero = leerNumero(m.valor)
  const juridica = m.contratistaTipoPersona === "juridica"

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla GJ-F-003 · Contrato de mano de obra</p>
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

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date" })}
          </div>
        </Seccion>

        <Seccion titulo="Contratante">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteRepresentanteExpedida", "Cédula expedida en")}
            {campo("contratanteCorreo", "Correo de notificaciones", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Contratista">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor="minuta-tipo-persona" className="text-xs font-medium text-muted-foreground">
                Tipo de persona
              </label>
              <select
                id="minuta-tipo-persona"
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
            {campo("contratistaCedula", juridica ? "Cédula del representante" : "Cédula")}
            {campo("contratistaCedulaExpedida", "Cédula expedida en")}
            {campo("contratistaCiudad", "Ciudad de domicilio")}
            {campo("contratistaCorreo", "Correo de notificaciones", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Primera · Objeto" ayuda="Texto que sigue a «EL CONTRATANTE encarga al CONTRATISTA…».">
          <div className="grid gap-3 sm:grid-cols-2">
            {area("objeto", "Objeto", 3)}
            {campo("obra", "Obra denominada", { ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Segunda · Obligaciones de las partes">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">El contratante se compromete a:</p>
              {lista("obligacionesContratante", (i) => `${i + 1}.`, "Agregar obligación")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">El contratista se compromete a:</p>
              {lista(
                "obligacionesContratista",
                (i) => `${i < POSICION_OBLIGACION_CORRECCION ? i + 1 : i + 2}.`,
                "Agregar obligación"
              )}
            </div>
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Obligación de corrección de actividades (va en el puesto {Math.min(POSICION_OBLIGACION_CORRECCION, m.obligacionesContratista.length) + 1}):
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {campo("plazoSolicitudCorreccion", "Plazo para pedir corrección", { placeholder: "cinco (5) días hábiles" })}
                {campo("plazoAjustes", "Plazo máximo de ajustes", { placeholder: "cinco (5) días hábiles" })}
                {campo("plazoSilencio", "Silencio = aceptación tras", { placeholder: "siete (7) días hábiles" })}
              </div>
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <ChipOrigen origen="plantilla" />
                <span>{obligacionCorreccion(m)}</span>
              </p>
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Tercera · Duración" ayuda="Texto que sigue a «…se llevará a cabo dentro de un plazo».">
          <div className="grid gap-3 sm:grid-cols-2">{campo("plazo", "Plazo", { ancho: true, placeholder: "de tres (3) meses contados a partir de la firma de este" })}</div>
        </Seccion>

        <Seccion titulo="Cuarta · Precio y forma de pago">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("valor", "Valor del contrato ($)", {
              ayuda:
                valorNumero === null
                  ? "Escribe el valor en pesos, por ejemplo 1.500.000."
                  : `${pesos(valorNumero)}${Math.abs(valorNumero - totalAnexo) >= 0.01 ? ` · el anexo suma ${pesos(totalAnexo)}` : " · igual al total del anexo"}`,
            })}
            <div className="flex items-end">
              {editable && valorNumero !== totalAnexo && totalAnexo > 0 && (
                <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => cambiarValor(formatoValor.format(totalAnexo))}>
                  Usar el total del anexo
                </Button>
              )}
            </div>
            {area("valorLetras", "Valor en letras", 2, "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano.")}
            {area("formaPago", "Forma de pago", 3)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Para el respectivo pago se requiere:</p>
            {lista("requisitosPago", (i) => `${String.fromCharCode(97 + i)})`, "Agregar requisito")}
          </div>
        </Seccion>

        <Seccion titulo="Lugar de ejecución, domicilio y controversias">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("municipioEjecucion", "Municipio de ejecución (quinta)")}
            {campo("ciudadArbitramento", "Sede del tribunal de arbitramento (décima quinta)")}
            {campo("domicilioMunicipio", "Domicilio: municipio (décima segunda)")}
            {campo("domicilioDepartamento", "Domicilio: departamento")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Vencimiento, porcentajes y cláusulas que se agregan a las de la plantilla.">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("vencimiento", "Vencimiento del contrato (tercera)", { tipo: "date", ayuda: "En el PDF: «El presente contrato vence el …»." })}
            <div />
            {campo("clausulaPenalPorcentaje", "Cláusula penal (% del valor)")}
            {campo("polizaPorcentaje", "Póliza de cumplimiento (% del valor)")}
            {campo("anexos", "Anexos que forman parte del contrato (décima tercera)", { ancho: true })}
          </div>

          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Cláusulas de la plantilla ({CLAUSULAS_PLANTILLA.length}) — texto fijo
            </summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_PLANTILLA.map((t, i) => (
                <li key={t} className="flex items-center gap-2">
                  <ChipOrigen origen="plantilla" />
                  <span>
                    <span className="font-medium">{ordinalClausula(i + 1)}.</span> {t}
                  </span>
                </li>
              ))}
            </ol>
          </details>

          <ClausulasAdicionalesEditor
            clausulas={m.clausulasAdicionales}
            onChange={(clausulasAdicionales) => actualizar({ clausulasAdicionales })}
            desde={CLAUSULAS_PLANTILLA.length + 1}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Anexo N° 1 · Actividades, cantidades y valores">
          <TablaItemsMinuta
            items={m.items}
            porDefecto={datos.porDefecto.items}
            onChange={(items) => actualizar({ items })}
            editable={editable}
            guardando={guardando}
          />
          <p className="text-xs text-muted-foreground">
            Cambiar el anexo aquí solo cambia el documento; las cantidades reservadas del presupuesto siguen siendo las de la solicitud.
          </p>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
