"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { DetalleActa } from "@/components/detalle-acta"
import { useProyectoActual } from "@/components/proyecto-provider"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import { CLASE_ESTADO_ACTA, ETIQUETA_ESTADO_ACTA, ETIQUETA_TIPO_ACTA, type ActaAprobacionFila, type EstadoActa } from "@/lib/actas"
import { listarActasAprobacion } from "@/app/(app)/contratos/aprobacion-actas/actions"

// ---------------------------------------------------------------------------
// Aprobación de actas: CONSULTA de las actas de todos los proyectos que el
// usuario ve (no depende del proyecto actual). Las actas no se aprueban aquí:
// se aprueban o rechazan al aprobar o rechazar su pago en A&F (Aprobación de
// pagos, 20261112100000_actas_aprobacion_por_pago.sql).
// ---------------------------------------------------------------------------

const FILTROS: { valor: EstadoActa | "todas"; etiqueta: string }[] = [
  { valor: "pendiente", etiqueta: "Pago por aprobar" },
  { valor: "aprobada", etiqueta: "Aprobadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "todas", etiqueta: "Todas" },
]

export function AprobacionActasView() {
  const { proyectos } = useProyectoActual()
  const [filtro, setFiltro] = useState<EstadoActa | "todas">("pendiente")
  const [proyectoId, setProyectoId] = useState("")
  const [actas, setActas] = useState<ActaAprobacionFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  function cargar() {
    listarActasAprobacion({ estado: filtro === "todas" ? undefined : filtro, proyectoId: proyectoId || undefined })
      .then(setActas)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las actas."))
  }
  useEffect(cargar, [filtro, proyectoId])

  function cambiarFiltro(valor: EstadoActa | "todas") {
    setActas(null)
    setError(null)
    setFiltro(valor)
  }
  function cambiarProyecto(valor: string) {
    setActas(null)
    setError(null)
    setProyectoId(valor)
  }

  const columnas: ColumnaExcel<ActaAprobacionFila>[] = useMemo(
    () => [
      {
        clave: "acta",
        titulo: "Acta",
        ancho: 90,
        fija: true,
        texto: (a) => `Acta ${a.numero}`,
        celda: (a) => (
          <button
            type="button"
            onClick={() => setDetalleId(a.id)}
            title={`Revisar el acta ${a.numero} del contrato ${a.numeroContrato}`}
            className="cursor-pointer rounded-sm font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            Acta {a.numero}
          </button>
        ),
      },
      { clave: "contrato", titulo: "N° contrato", ancho: 130, texto: (a) => a.numeroContrato },
      { clave: "proyecto", titulo: "Proyecto", ancho: 140, texto: (a) => a.proyectoCodigo || a.proyectoNombre },
      { clave: "contratista", titulo: "Contratista", ancho: 220, flexible: true, texto: (a) => a.contratistaNombre },
      { clave: "tipo", titulo: "Tipo", ancho: 150, texto: (a) => ETIQUETA_TIPO_ACTA[a.tipo] },
      { clave: "bruto", titulo: "Valor bruto", ancho: 140, alinear: "right", texto: (a) => pesos(a.valorBruto), claseCelda: "tabular-nums" },
      { clave: "total", titulo: "Neto a pagar", ancho: 140, alinear: "right", texto: (a) => pesos(a.neto), claseCelda: "tabular-nums" },
      { clave: "valor", titulo: "Valor contrato", ancho: 150, alinear: "right", texto: (a) => pesos(a.contratoValor), claseCelda: "tabular-nums" },
      {
        clave: "estado",
        titulo: "Estado",
        ancho: 130,
        alinear: "center",
        texto: (a) => ETIQUETA_ESTADO_ACTA[a.estado],
        celda: (a) => <Badge className={`h-6 px-3 text-xs ${CLASE_ESTADO_ACTA[a.estado]}`}>{ETIQUETA_ESTADO_ACTA[a.estado]}</Badge>,
      },
      { clave: "elaborada", titulo: "Elaborada por", ancho: 150, texto: (a) => a.creadoPorNombre ?? "" },
      { clave: "fecha", titulo: "Fecha", ancho: 110, texto: (a) => formatearFechaSinHora(a.createdAt), claseCelda: "tabular-nums" },
    ],
    []
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <EncabezadoPagina titulo="Aprobación de actas" subtitulo="Consulta las actas de los contratos. Se aprueban o rechazan al aprobar o rechazar su pago en A&F (Aprobación de pagos)." />
      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Estado">
            {FILTROS.map((f) => (
              <Button
                key={f.valor}
                size="sm"
                role="tab"
                aria-selected={filtro === f.valor}
                variant={filtro === f.valor ? "default" : "outline"}
                onClick={() => cambiarFiltro(f.valor)}
              >
                {f.etiqueta}
              </Button>
            ))}
          </div>
          <select
            aria-label="Proyecto"
            value={proyectoId}
            onChange={(e) => cambiarProyecto(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <option value="">Todos los proyectos</option>
            {proyectos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
              </option>
            ))}
          </select>
          {actas && (
            <span className="ml-auto text-sm text-muted-foreground tabular-nums">
              {actas.length} {actas.length === 1 ? "acta" : "actas"}
            </span>
          )}
        </div>

        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}

        {actas === null && !error ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando actas...
          </div>
        ) : actas && actas.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            {filtro === "pendiente" ? "No hay actas por aprobar." : "No hay actas con este filtro."}
          </div>
        ) : (
          actas && (
            <TablaExcel
              filas={actas}
              columnas={columnas}
              claveFila={(a) => a.id}
              onDobleClickFila={(a) => setDetalleId(a.id)}
              tituloFila="Doble clic para revisar el acta"
              tarjeta={{
                titulo: (a) => (
                  <button type="button" className="text-left hover:underline" onClick={() => setDetalleId(a.id)}>
                    Acta {a.numero} · {a.numeroContrato}
                  </button>
                ),
                subtitulo: (a) => `${a.contratistaNombre} · ${a.proyectoCodigo || a.proyectoNombre}`,
                esquina: (a) => columnas.find((c) => c.clave === "estado")!.celda!(a),
                campos: ["total", "valor", "elaborada", "fecha"],
              }}
            />
          )
        )}
      </main>

      <DetalleActa
        id={detalleId}
        onCerrar={() => setDetalleId(null)}
      />

    </div>
  )
}
