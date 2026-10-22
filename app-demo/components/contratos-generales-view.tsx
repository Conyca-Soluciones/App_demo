"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, PencilLine, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { BadgePolizaContrato } from "@/components/badge-poliza"
import { ETIQUETA_POLIZA_CONTRATO } from "@/lib/polizas"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { ContratoGeneralFormulario } from "@/components/contrato-general-form"
import { DetalleSolicitudContrato, fechaContrato } from "@/components/detalle-solicitud-contrato"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"
import { formatearFechaSinHora } from "@/lib/fechas"
import {
  CLASE_ESTADO_CONTRATO,
  CLASE_ETAPA_CONTRATO,
  ETIQUETA_ETAPA_CONTRATO,
  etapaContrato,
  nombreTipoContrato,
  pesos,
  plazoTexto,
  type SolicitudContratoDetalle,
  type SolicitudContratoFila,
} from "@/lib/contratos"
import { listarContratosGenerales } from "@/app/(app)/contratos/generales/actions"

// ---------------------------------------------------------------------------
// Contratos generales (pestaña contratos.contratos): misma pantalla que
// Contratos por grupos (solicitudes-contratos-view.tsx), con el formulario del
// contrato general (sin ítems del presupuesto).
// ---------------------------------------------------------------------------

export function ContratosGeneralesView({ puedeSolicitar, verInicial }: { puedeSolicitar: boolean; verInicial: string | null }) {
  const proyecto = useProyectoActual().proyecto
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina
        titulo="Contratos generales"
        subtitulo="Contratos sin ítems del presupuesto: llénalo y mándalo a pre-aprobación de Jurídica."
      />
      {proyecto ? (
        // key: al cambiar de proyecto se limpia todo (lista y formulario a medias).
        <Solicitudes
          key={proyecto.id}
          proyectoId={proyecto.id}
          proyectoNombre={proyecto.nombre}
          puedeSolicitar={puedeSolicitar}
          verInicial={verInicial}
        />
      ) : (
        <div className="p-4 sm:p-6">
          <SinProyecto />
        </div>
      )}
    </div>
  )
}

function Solicitudes({
  proyectoId,
  proyectoNombre,
  puedeSolicitar,
  verInicial,
}: {
  proyectoId: string
  proyectoNombre: string
  puedeSolicitar: boolean
  verInicial: string | null
}) {
  const router = useRouter()
  const [solicitudes, setSolicitudes] = useState<SolicitudContratoFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // null = lista; "nueva" = formulario vacío; detalle = corrigiendo una devuelta.
  const [formulario, setFormulario] = useState<"nueva" | SolicitudContratoDetalle | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // ?ver=<id> (desde la campanita) abre el detalle de esa solicitud.
  const [detalleId, setDetalleId] = useState<string | null>(verInicial)

  function cargar() {
    listarContratosGenerales(proyectoId)
      .then((lista: SolicitudContratoFila[]) => setSolicitudes(lista))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los contratos."))
  }
  useEffect(cargar, [proyectoId])

  const columnas: ColumnaExcel<SolicitudContratoFila>[] = useMemo(
    () => [
      { clave: "numero", titulo: "N°", ancho: 70, fija: true, alinear: "right", texto: (s) => String(s.numero), claseCelda: "tabular-nums" },
      { clave: "tipo", titulo: "Tipo", ancho: 170, texto: (s) => nombreTipoContrato(s) },
      { clave: "contratista", titulo: "Contratista", ancho: 220, texto: (s) => s.contratistaNombre },
      { clave: "objeto", titulo: "Descripción", ancho: 260, flexible: true, texto: (s) => s.objeto },
      { clave: "valor", titulo: "Valor", ancho: 150, alinear: "right", texto: (s) => pesos(s.valor), claseCelda: "tabular-nums" },
      { clave: "plazo", titulo: "Plazo", ancho: 190, texto: (s) => plazoTexto(s, formatearFechaSinHora) },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 200,
        alinear: "center",
        // Junta la solicitud y la minuta: termina en "Aprobado por Subgerencia".
        texto: (s) => ETIQUETA_ETAPA_CONTRATO[etapaContrato(s)],
        celda: (s) => (
          <Badge variant="outline" className={CLASE_ETAPA_CONTRATO[etapaContrato(s)]} title={s.motivoResolucion ?? undefined}>
            {ETIQUETA_ETAPA_CONTRATO[etapaContrato(s)]}
          </Badge>
        ),
      },
      {
        clave: "otrosi",
        titulo: "Otrosí",
        ancho: 80,
        alinear: "center",
        texto: (s) => (s.otrosisAprobados ? String(s.otrosisAprobados) : ""),
        celda: (s) =>
          s.otrosisAprobados ? (
            <Badge variant="outline" className="border-transparent bg-violet-100 text-violet-800" title="Otrosí aprobados: ábrelo para verlos">
              {s.otrosisAprobados}
            </Badge>
          ) : null,
      },
      {
        clave: "poliza",
        titulo: "Póliza",
        ancho: 150,
        alinear: "center",
        texto: (s) => (s.polizaEstado ? ETIQUETA_POLIZA_CONTRATO[s.polizaEstado] : ""),
        celda: (s) => <BadgePolizaContrato estado={s.polizaEstado} />,
      },
      { clave: "solicitante", titulo: "Solicitado por", ancho: 150, texto: (s) => s.solicitadoPorNombre ?? "" },
      { clave: "fecha", titulo: "Enviada", ancho: 110, texto: (s) => fechaContrato(s.enviadoAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  const devueltas = solicitudes?.filter((s) => s.estado === "devuelta").length ?? 0

  function cerrarDetalle() {
    setDetalleId(null)
    if (verInicial) router.replace("/contratos/generales")
  }

  if (formulario) {
    return (
      <main className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 sm:p-6">
        <ContratoGeneralFormulario
          proyectoId={proyectoId}
          proyectoNombre={proyectoNombre}
          edicion={formulario === "nueva" ? undefined : formulario}
          onCancelar={() => setFormulario(null)}
          onEnviado={(n) => {
            setAviso(
              formulario === "nueva"
                ? `Contrato general N° ${n} enviado a pre-aprobación.`
                : `Contrato general N° ${n} corregido y reenviado a pre-aprobación.`
            )
            setFormulario(null)
            cargar()
          }}
        />
      </main>
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {solicitudes && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {solicitudes.length} {solicitudes.length === 1 ? "contrato" : "contratos"}
          </span>
        )}
        {devueltas > 0 && (
          <Badge variant="outline" className={CLASE_ESTADO_CONTRATO.devuelta}>
            {devueltas} {devueltas === 1 ? "devuelto por corregir" : "devueltos por corregir"}
          </Badge>
        )}
        {puedeSolicitar && (
          <Button
            className="ml-auto"
            onClick={() => {
              setAviso(null)
              setFormulario("nueva")
            }}
          >
            <Plus className="size-4" /> Nuevo contrato
          </Button>
        )}
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" /> {aviso}
        </div>
      )}
      {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

      {solicitudes === null && !error ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" /> Cargando contratos...
        </div>
      ) : solicitudes && solicitudes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          <p>Este proyecto todavía no tiene contratos generales.</p>
          {puedeSolicitar && (
            <Button variant="outline" onClick={() => setFormulario("nueva")}>
              <Plus className="size-4" /> Crear la primera
            </Button>
          )}
        </div>
      ) : (
        solicitudes && (
          <TablaExcel
            filas={solicitudes}
            columnas={columnas}
            claveFila={(s) => s.id}
            onDobleClickFila={(s) => setDetalleId(s.id)}
            tituloFila="Doble clic para ver el contrato"
            tarjeta={{
              titulo: (s) => (
                <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(s.id)}>
                  N° {s.numero} · {s.contratistaNombre}
                </button>
              ),
              subtitulo: (s) => nombreTipoContrato(s),
              esquina: (s) => columnas.find((c) => c.clave === "estado")!.celda!(s),
              campos: ["objeto", "valor", "plazo", "solicitante"],
            }}
          />
        )
      )}

      <DetalleSolicitudContrato
        id={detalleId}
        onCerrar={cerrarDetalle}
        acciones={(d) =>
          d.estado === "devuelta" && puedeSolicitar && d.proyectoId === proyectoId && d.clase === "general" ? (
            <Button
              onClick={() => {
                cerrarDetalle()
                setAviso(null)
                setFormulario(d)
              }}
            >
              <PencilLine className="size-4" /> Corregir y reenviar
            </Button>
          ) : null
        }
      />
    </main>
  )
}
