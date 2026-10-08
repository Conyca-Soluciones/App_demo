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
  claseCampo,
  descargarPdfMinuta,
  useVistaPreviaMinuta,
} from "@/components/minuta-comun"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { leerNumero, pesos, type SolicitudContratoDetalle } from "@/lib/contratos"
import { origenRenglon, valorEnLetras, type OrigenDato } from "@/lib/minuta-mano-obra"
import {
  CAUSALES_TERMINACION,
  CLAUSULAS_ARRENDAMIENTO,
  OBLIGACIONES_ARRENDADOR,
  OBLIGACIONES_ARRENDATARIO,
  OPCIONES_IVA,
  OPCIONES_SERVICIOS,
  PRIMERA_CLAUSULA_ADICIONAL_ARRENDAMIENTO,
  nombreArchivoMinutaArrendamiento,
  origenCampoArrendamiento,
  type MinutaArrendamiento,
} from "@/lib/minuta-arrendamiento"
import {
  guardarMinutaArrendamiento,
  obtenerMinutaArrendamiento,
  type MinutaContratoArrendamiento,
} from "@/app/(app)/contratos/pre-aprobacion/actions"

// ---------------------------------------------------------------------------
// Editor de la minuta de arrendamiento (plantilla GJ-F-014) dentro del detalle
// de Pre-aprobación. Mismo funcionamiento que el de mano de obra: campos
// prellenados con la solicitud, vista previa del PDF con lo que está en
// pantalla, descarga y guardado (contratos.minuta_datos). El texto fijo de las
// cláusulas está en components/minuta-arrendamiento-pdf.tsx.
// ---------------------------------------------------------------------------

type CampoTexto = { [K in keyof MinutaArrendamiento]: MinutaArrendamiento[K] extends string ? K : never }[keyof MinutaArrendamiento]
type CampoLista = "obligacionesArrendador" | "obligacionesArrendatario" | "causalesTerminacion"

const letra = (i: number) => `${String.fromCharCode(97 + i)})`

export function MinutaArrendamientoEditor({ detalle, puedeEditar }: { detalle: SolicitudContratoDetalle; puedeEditar: boolean }) {
  const [datos, setDatos] = useState<MinutaContratoArrendamiento | null>(null)
  const [m, setM] = useState<MinutaArrendamiento | null>(null)
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
    obtenerMinutaArrendamiento(detalle.id)
      .then((d: MinutaContratoArrendamiento) => {
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

  function actualizar(cambio: Partial<MinutaArrendamiento>) {
    setM((prev) => (prev ? { ...prev, ...cambio } : prev))
    setCambios(true)
    setAviso(null)
  }

  function cambiarCanon(texto: string) {
    // El canon en letras sigue al número mientras nadie lo haya escrito a mano.
    const anterior = leerNumero(m!.canon)
    const nuevo = leerNumero(texto)
    const letrasAutomaticas = anterior !== null && m!.canonLetras === valorEnLetras(anterior)
    actualizar({ canon: texto, ...(nuevo !== null && (letrasAutomaticas || !m!.canonLetras.trim()) ? { canonLetras: valorEnLetras(nuevo) } : {}) })
  }

  const origen = (clave: CampoTexto): OrigenDato => origenCampoArrendamiento(clave, m![clave] as string, datos!.porDefecto)

  function campo(clave: CampoTexto, etiqueta: string, opciones?: { placeholder?: string; tipo?: string; ayuda?: string; ancho?: boolean; filas?: number }) {
    return (
      <CampoMinuta
        id={`minuta-${clave}`}
        etiqueta={etiqueta}
        valor={m![clave] as string}
        origen={origen(clave)}
        onChange={(v) => (clave === "canon" ? cambiarCanon(v) : actualizar({ [clave]: v } as Partial<MinutaArrendamiento>))}
        disabled={deshabilitado}
        {...opciones}
      />
    )
  }

  function lista(clave: CampoLista, textoAgregar: string) {
    const plantilla =
      clave === "obligacionesArrendador" ? OBLIGACIONES_ARRENDADOR : clave === "obligacionesArrendatario" ? OBLIGACIONES_ARRENDATARIO : CAUSALES_TERMINACION
    const deSolicitud = clave === "obligacionesArrendador" ? detalle.obligaciones : []
    return (
      <ListaEditable
        items={m![clave]}
        onChange={(items) => actualizar({ [clave]: items } as Partial<MinutaArrendamiento>)}
        marcador={letra}
        origen={(t) => origenRenglon(t, plantilla, deSolicitud)}
        textoAgregar={textoAgregar}
        editable={editable}
        guardando={guardando}
      />
    )
  }

  // Selectores: vacío = falta; igual al valor inicial = de la solicitud; si no, editado.
  const origenSelector = (actual: string, inicial: string): OrigenDato => (!actual ? "vacio" : actual === inicial ? "solicitud" : "editado")

  async function guardar() {
    if (!m) return
    setGuardando(true)
    setAviso(null)
    try {
      const r = await guardarMinutaArrendamiento(detalle.id, m)
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
      await descargarPdfMinuta(detalle.id, m, nombreArchivoMinutaArrendamiento(detalle.numero, m.arrendadorNombre))
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

  const juridica = m.arrendadorTipoPersona === "juridica"
  const canonNumero = leerNumero(m.canon)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- formulario ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <div className="min-w-0 flex-1 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Plantilla GJ-F-014 · Contrato de arrendamiento</p>
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

        <Seccion titulo="Arrendador" ayuda="El contratista: propietario del inmueble.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1 sm:col-span-2">
              <label htmlFor="minuta-arrendador-tipo" className="text-xs font-medium text-muted-foreground">
                Tipo de persona
              </label>
              <select
                id="minuta-arrendador-tipo"
                value={m.arrendadorTipoPersona}
                onChange={(e) => actualizar({ arrendadorTipoPersona: e.target.value as "natural" | "juridica" })}
                disabled={deshabilitado}
                className={claseCampo}
              >
                <option value="natural">Persona natural</option>
                <option value="juridica">Persona jurídica (firma su representante legal)</option>
              </select>
            </div>
            {campo("arrendadorNombre", juridica ? "Razón social" : "Nombre completo")}
            {juridica && campo("arrendadorNit", "NIT")}
            {juridica && campo("arrendadorRepresentante", "Representante legal")}
            {campo("arrendadorCedula", juridica ? "Cédula del representante" : "Cédula")}
            {campo("arrendadorCedulaExpedida", "Cédula expedida en")}
            {campo("arrendadorCorreo", "Correo de notificaciones (décima novena)", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Arrendatario" ayuda="La empresa del proyecto.">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("arrendatarioNombre", "Razón social")}
            {campo("arrendatarioNit", "NIT")}
            {campo("arrendatarioRepresentante", "Representante legal")}
            {campo("arrendatarioCedula", "Cédula del representante")}
            {campo("arrendatarioCorreo", "Correo de notificaciones (décima novena)", { tipo: "email" })}
          </div>
        </Seccion>

        <Seccion titulo="Primera y segunda · Inmueble y destinación">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("inmuebleDireccion", "Dirección del inmueble", { placeholder: "Calle 10 # 20-30, local 2" })}
            {campo("inmuebleCiudad", "Ciudad del inmueble")}
            {campo("destinacion", "Destinación (segunda)", {
              ancho: true,
              placeholder: "uso comercial, como oficina y almacén de la obra",
              ayuda: "Sigue a «El ARRENDATARIO destinará el inmueble arrendado exclusivamente para…».",
            })}
          </div>
        </Seccion>

        <Seccion titulo="Tercera · Canon de arrendamiento">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("canon", "Canon mensual ($)", {
              ayuda: canonNumero === null ? "Escribe el valor en pesos, por ejemplo 2.500.000." : pesos(canonNumero),
            })}
            <SelectorMinuta
              id="minuta-iva"
              etiqueta="IVA"
              valor={m.iva}
              opciones={OPCIONES_IVA}
              origen={origenSelector(m.iva, datos.porDefecto.iva)}
              onChange={(iva) => actualizar({ iva })}
              disabled={deshabilitado}
            />
            {campo("canonLetras", "Canon en letras", { filas: 2, ayuda: "Se actualiza al cambiar el canon, salvo que lo hayas escrito a mano." })}
            {campo("correoFacturacion", "Correo para radicar la factura", { tipo: "email", ancho: true })}
            {campo("condicionesPago", "Condiciones de pago de la solicitud (párrafo aparte, opcional)", {
              filas: 3,
              ayuda: "Forma de pago y anticipo que escribió quien solicitó. Si se deja vacío, no sale en el PDF.",
            })}
            {campo("paragrafoAdministracion", "Parágrafo segundo (administración)", {
              filas: 4,
              ayuda: "Si el inmueble está en propiedad horizontal, ajústalo; si se deja vacío, no sale en el PDF.",
            })}
          </div>
        </Seccion>

        <Seccion titulo="Cuarta · Término de duración">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("plazo", "Término", { placeholder: "doce (12) meses", ayuda: "«El término de arrendamiento es de …»." })}
            {campo("fechaInicio", "Inicia el", { tipo: "date" })}
            <SelectorMinuta
              id="minuta-servicios"
              etiqueta="Servicios públicos (parágrafo)"
              valor={m.serviciosPublicos}
              opciones={OPCIONES_SERVICIOS}
              origen={origenSelector(m.serviciosPublicos, datos.porDefecto.serviciosPublicos)}
              onChange={(serviciosPublicos) => actualizar({ serviciosPublicos })}
              disabled={deshabilitado}
              ancho
            />
          </div>
        </Seccion>

        <Seccion titulo="Quinta · Obligaciones de las partes">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Serán obligaciones de EL ARRENDADOR:</p>
              {lista("obligacionesArrendador", "Agregar obligación")}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Serán obligaciones de EL ARRENDATARIO:</p>
              {lista("obligacionesArrendatario", "Agregar obligación")}
            </div>
          </div>
        </Seccion>

        <Seccion titulo="Décima tercera · Causales de terminación">{lista("causalesTerminacion", "Agregar causal")}</Seccion>

        <Seccion titulo="Cláusulas" ayuda="Las de la plantilla van con su texto fijo; aquí se agregan otras.">
          <details className="rounded-md border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Cláusulas de la plantilla ({CLAUSULAS_ARRENDAMIENTO.length}) — texto fijo
            </summary>
            <ol className="space-y-1 border-t px-3 py-2 text-xs">
              {CLAUSULAS_ARRENDAMIENTO.map((t) => (
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
            desde={PRIMERA_CLAUSULA_ADICIONAL_ARRENDAMIENTO}
            editable={editable}
            guardando={guardando}
          />
        </Seccion>

        <Seccion titulo="Lugar y fecha de firma">
          <div className="grid gap-3 sm:grid-cols-2">
            {campo("ciudadFirma", "Ciudad")}
            {campo("fechaFirma", "Fecha", { tipo: "date", ayuda: "El año también va en el número: Nº CJ-<número> DE <año>." })}
          </div>
        </Seccion>
      </div>

      {/* ---------------- vista previa ---------------- */}
      <PanelVistaPrevia {...vistaPrevia} />
    </div>
  )
}
