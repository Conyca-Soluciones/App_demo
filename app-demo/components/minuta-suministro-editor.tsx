"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CampoMinuta,
  ChipOrigen,
  ClausulasAdicionalesEditor,
  LeyendaOrigen,
  ListaEditable,
  ORIGEN,
  PanelVistaPrevia,
  Seccion,
  SelectorMinuta,
  TablaItemsMinuta,
  claseCampo,
  descargarPdfMinuta,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { leerNumero, pesos, type SolicitudContratoDetalle } from "@/lib/contratos"
import { origenRenglon, totalItemsMinuta, valorEnLetras, type OrigenDato } from "@/lib/minuta-mano-obra"
import { TIPOS_DOCUMENTO_ARRENDADOR } from "@/lib/minuta-arrendamiento"
import {
  CLAUSULAS_SUMINISTRO,
  OBLIGACIONES_CONTRATANTE_SUMINISTRO,
  OBLIGACIONES_CONTRATISTA_SUMINISTRO,
  PRIMERA_CLAUSULA_ADICIONAL_SUMINISTRO,
  nombreArchivoMinutaSuministro,
  origenCampoSuministro,
  type AmparoGarantia,
  type MinutaSuministro,
} from "@/lib/minuta-suministro"
import { guardarMinutaSuministro, obtenerMinutaSuministro, type MinutaContratoSuministro } from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de suministro (plantilla GJ-F-012) dentro del detalle de
// Pre-aprobación, para las solicitudes de "Suministro e instalación". Mismo
// funcionamiento que las de mano de obra y arrendamiento. El texto fijo de las
// cláusulas está en components/minuta-suministro-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaSuministro]: MinutaSuministro[K] extends string ? K : never }[keyof MinutaSuministro]
type CampoLista = "obligacionesContratante" | "obligacionesContratista"

const formatoValor = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 })
const letra = (i: number) => `${String.fromCharCode(97 + i)})`
const mismoAmparo = (a: AmparoGarantia, b: AmparoGarantia | undefined) =>
  Boolean(b) && a.amparo === b!.amparo && a.porcentaje === b!.porcentaje && a.vigencia === b!.vigencia

export function MinutaSuministroEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContratoSuministro | null>(null)
  const [m, setM] = useState<MinutaSuministro | null>(null)
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
    obtenerMinutaSuministro(detalle.id)
      .then((d: MinutaContratoSuministro) => {
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

  function actualizar(cambio: Partial<MinutaSuministro>) {
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

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean; filas?: number }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origenCampoSuministro(clave, m![clave] as string, datos!.porDefecto)}
        onChange={(v) => (clave === "valor" ? cambiarValor(v) : actualizar({ [clave]: v } as Partial<MinutaSuministro>))}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function lista(clave: CampoLista) {
    const plantilla = clave === "obligacionesContratante" ? OBLIGACIONES_CONTRATANTE_SUMINISTRO : OBLIGACIONES_CONTRATISTA_SUMINISTRO
    const deSolicitud = clave === "obligacionesContratista" ? detalle.obligaciones : []
    return (
      <ListaEditable
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaSuministro>)}
        marcador={letra}
        origen={(t) => origenRenglon(t, plantilla, deSolicitud)}
        textoAgregar="Agregar obligación"
        editable={editable}
        guardando={guardando}
      />
    )
  }

  const cambiarAmparo = (i: number, cambio: Partial<AmparoGarantia>) => actualizar({ amparos: m.amparos.map((a, j) => (j === i ? { ...a, ...cambio } : a)) })

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarMinutaSuministro(detalle.id, m)
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
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinutaSuministro(detalle.numero, m.contratistaNombre))
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
  const totalItems = totalItemsMinuta(m.items)
  const valorNumero = leerNumero(m.valor)
  const origenTipoDocumento: OrigenDato = m.contratistaTipoDocumento === datos.porDefecto.contratistaTipoDocumento ? "solicitud" : "editado"

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla GJ-F-012 · Contrato de suministro</p>
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
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("contratanteNombre", "Razón social")}
            {campo("contratanteNit", "NIT")}
            {campo("contratanteRepresentante", "Representante legal")}
            {campo("contratanteRepresentanteCedula", "Cédula del representante")}
            {campo("contratanteCorreo", "Correo de notificaciones (décima octava)", { tipo: "email", ancho: true })}
          </div>
        </Seccion>

        <Seccion titulo="Contratista">
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
            {campo("contratistaCedulaExpedida", "Documento expedido en")}
            {campo("contratistaCiudad", "Ciudad de domicilio")}
            {campo("contratistaCorreo", "Correo de notificaciones (décima octava)", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Primera · Objeto y especificaciones técnicas">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("objeto", "Objeto", { filas: 3, ayuda: "En el PDF sigue «…, para el proyecto <obra>. De conformidad con el valor dispuesto en la cotización…»." })}
            {campo("obra", "Proyecto", { ancho: true })}
          </div>
          <TablaItemsMinuta
            items={m.items}
            porDefecto={datos.porDefecto.items}
            onChange={(items) => actualizar({ items })}
            editable={editable}
            guardando={guardando}
            etiqueta="Detalle"
          />
          <p className="text-xs text-muted-foreground">
            Cambiar la tabla aquí solo cambia el documento; las cantidades reservadas del presupuesto siguen siendo las de la solicitud.
          </p>
        </Seccion>

        <Seccion titulo="Segunda · Valor y forma de pago">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("valor", "Valor del contrato ($)", {
              ayuda:
                valorNumero === null
                  ? "Escribe el valor en pesos, por ejemplo 1.500.000."
                  : `${pesos(valorNumero)}${Math.abs(valorNumero - totalItems) >= 0.01 ? ` · la tabla suma ${pesos(totalItems)}` : " · igual al total de la tabla"}`,
            })}
            <div className="flex items-end">
              {editable && valorNumero !== totalItems && totalItems > 0 && (
                <Button type="button" size="sm" variant="outline" disabled={guardando} onClick={() => cambiarValor(formatoValor.format(totalItems))}>
                  Usar el total de la tabla
                </Button>
              )}
            </div>
            {campo("valorLetras", "Valor en letras", { filas: 2, ayuda: "Se actualiza al cambiar el valor, salvo que lo hayas escrito a mano." })}
            {campo("formaPago", "Forma de pago", { filas: 4, ayuda: "Texto de la plantilla, el anticipo y la forma de pago de la solicitud." })}
          </div>
        </Seccion>

        <Seccion titulo="Tercera · Plazo">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("plazo", "Plazo de ejecución", {
              ancho: true,
              placeholder: "treinta (30) días calendario",
              ayuda: "«El plazo de ejecución será de … contados a partir de la aprobación de la garantía general de cumplimiento»."
            })}
          </div>
        </Seccion>

        <Seccion titulo="Cuarta y quinta · Obligaciones">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones del contratante:</p>
              {lista("obligacionesContratante")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Obligaciones del contratista:</p>
              {lista("obligacionesContratista")}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Séptima y décima cuarta · Lugar de ejecución y domicilio">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadEjecucion", "Ciudad de ejecución")}
            {campo("domicilioCiudad", "Ciudad de domicilio del contrato")}
          </div>
        </Seccion>

        <Seccion titulo="Novena · Garantía" ayuda="Amparos que debe cubrir la póliza. El de buen manejo de anticipo sale solo si la solicitud tiene anticipo.">
          <div className="space-y-2">
            {m.amparos.map((a, i) => {
              const original = datos.porDefecto.amparos[i]
              const origen: OrigenDato = !a.amparo.trim() || !a.porcentaje.trim() ? "vacio" : mismoAmparo(a, original) ? "plantilla" : "editado"
              return (
                <div key={i} className={`grid gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,1.2fr)_6rem_minmax(0,1.5fr)_auto] ${ORIGEN[origen].borde}`}>
                  <input
                    aria-label={`Amparo ${i + 1}`}
                    value={a.amparo}
                    onChange={(e) => cambiarAmparo(i, { amparo: e.target.value })}
                    disabled={deshabilitado}
                    placeholder="Amparo"
                    className={claseCampo}
                  />
                  <input
                    aria-label={`Porcentaje del amparo ${i + 1}`}
                    inputMode="decimal"
                    value={a.porcentaje}
                    onChange={(e) => cambiarAmparo(i, { porcentaje: e.target.value })}
                    disabled={deshabilitado}
                    placeholder="%"
                    className={`${claseCampo} text-right`}
                  />
                  <input
                    aria-label={`Vigencia del amparo ${i + 1}`}
                    value={a.vigencia}
                    onChange={(e) => cambiarAmparo(i, { vigencia: e.target.value })}
                    disabled={deshabilitado}
                    placeholder="Vigencia"
                    className={claseCampo}
                  />
                  <div className="flex items-center gap-1">
                    <ChipOrigen origen={origen} />
                    {editable && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Quitar amparo"
                        disabled={guardando}
                        onClick={() => actualizar({ amparos: m.amparos.filter((_, j) => j !== i) })}
                      >
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
            {editable && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={guardando}
                onClick={() => actualizar({ amparos: [...m.amparos, { amparo: "", porcentaje: "", vigencia: "" }] })}
              >
                <Plus className="size-4" /> Agregar amparo
              </Button>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Décima · Cláusula penal y multas">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("clausulaPenalPorcentaje", "Cláusula penal (% del valor)")}
            {campo("multaDiariaPorcentaje", "Multa por día de retraso (% del valor)")}
          </div>
        </Seccion>

        <Seccion titulo="Cláusulas" ayuda="Las de la plantilla van con su texto fijo; aquí se agregan otras.">
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Cláusulas de la plantilla ({CLAUSULAS_SUMINISTRO.length}) — texto fijo</summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_SUMINISTRO.map((t) => (
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
            desde={PRIMERA_CLAUSULA_ADICIONAL_SUMINISTRO}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date", ayuda: "El año también va en el número: Nº CJ-<número>-<año>." })}
          </div>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
