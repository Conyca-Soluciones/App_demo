"use client"

import { useMemo, useState } from "react"
import { FileText, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { FiltroSemanas } from "@/components/filtro-semanas"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { formatearFechaHora } from "@/lib/fechas"
import { formatoMoneda, semanaIso } from "@/lib/pagos"
import { enlaceSoporteDispersor, listarDispersoresGenerados, type DispersorGenerado } from "@/app/(app)/ayf/informes/actions"

// Informes de pagos (2026-11-25, decisión del usuario): se elige el tipo de informe en los
// filtros. El primero, Dispersores generados: una fila por dispersor con su soporte PDF
// (la lista de todos sus pagos); los archivos para el banco no se descargan aquí.

const TIPOS_INFORME = [{ clave: "dispersores", titulo: "Dispersores generados" }] as const
type TipoInforme = (typeof TIPOS_INFORME)[number]["clave"]

export function InformesPagosView() {
  const actual = semanaIso()
  const opcionesAnios = useMemo(() => {
    const lista: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) lista.push(y)
    return lista
  }, [actual.anio])

  const [tipo, setTipo] = useState<TipoInforme>("dispersores")
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([actual.semana])
  const [filas, setFilas] = useState<DispersorGenerado[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function consultar(): boolean {
    setCargando(true)
    setError(null)
    listarDispersoresGenerados({ anios: anios.length ? anios : undefined, semanas: semanas.length ? semanas : undefined })
      .then((r: DispersorGenerado[]) => setFilas(r))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el informe."))
      .finally(() => setCargando(false))
    return true
  }

  async function descargar(d: DispersorGenerado) {
    setAbriendo(d.id)
    setError(null)
    const r = await enlaceSoporteDispersor(d.id)
    setAbriendo(null)
    if (!r.ok) setError(r.error)
    else window.open(r.url, "_blank", "noopener")
  }

  const columnas: ColumnaExcel<DispersorGenerado>[] = [
    {
      clave: "semana",
      titulo: "Semana",
      ancho: 90,
      alinear: "center",
      texto: (d) => (d.semana != null ? `${d.semana} · ${d.anio ?? ""}` : ""),
      valorOrden: (d) => (d.anio ?? 0) * 100 + (d.semana ?? 0),
      claseCelda: "tabular-nums",
    },
    {
      clave: "cuenta",
      titulo: "Cuenta a debitar",
      ancho: 220,
      texto: (d) => `${d.apodo} · ${d.banco}${d.esNomina ? " · nómina" : ""}`,
    },
    { clave: "pagos", titulo: "Pagos", ancho: 70, alinear: "center", texto: (d) => String(d.registros), valorOrden: (d) => d.registros },
    {
      clave: "total",
      titulo: "Total",
      ancho: 140,
      alinear: "right",
      texto: (d) => formatoMoneda(d.total),
      valorOrden: (d) => d.total,
      celda: (d) => <span className="font-medium tabular-nums">{formatoMoneda(d.total)}</span>,
    },
    {
      clave: "generado",
      titulo: "Generado",
      ancho: 190,
      texto: (d) => `${formatearFechaHora(d.generadoEn)}${d.generadoPor ? ` · ${d.generadoPor}` : ""}`,
      valorOrden: (d) => d.generadoEn,
    },
    {
      clave: "soporte",
      titulo: "Soporte",
      ancho: 150,
      ordenable: false,
      texto: (d) => d.soporteNombre ?? "",
      celda: (d) =>
        d.soporteNombre ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1 px-2"
            disabled={abriendo !== null}
            onClick={() => descargar(d)}
            title={d.soporteNombre}
          >
            {abriendo === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Soporte PDF
          </Button>
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
  ]

  const total = (filas ?? []).reduce((a, d) => a + d.total, 0)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row con-filtros">
        <PanelFiltros
          apilarEnCelular
          cargando={cargando}
          onConsultar={consultar}
          onLimpiar={() => {
            setAnios([actual.anio])
            setSemanas([actual.semana])
          }}
        >
          <div className="space-y-1.5">
            <Label>Informe</Label>
            <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoInforme)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INFORME.map((t) => (
                  <SelectItem key={t.clave} value={t.clave}>
                    {t.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FiltroSemanas
            id="informe-dispersores"
            titulo="Semana de pago"
            opcionesAnios={opcionesAnios}
            anios={anios}
            semanas={semanas}
            onAnios={setAnios}
            onSemanas={setSemanas}
          />
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
          )}
          {filas === null ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige el informe y las semanas, y presiona Consultar.
            </div>
          ) : filas.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              No se generaron dispersores en estas semanas.
            </div>
          ) : (
            <>
              <TablaExcel
                ajustarAncho
                filas={filas}
                columnas={columnas}
                claveFila={(d) => d.id}
                tarjeta={{
                  titulo: (d) => d.apodo,
                  subtitulo: (d) => `${d.banco} · semana ${d.semana ?? "—"} de ${d.anio ?? "—"}`,
                  esquina: (d) => <span className="font-medium tabular-nums">{formatoMoneda(d.total)}</span>,
                  campos: ["pagos", "generado", "soporte"],
                }}
              />
              <div className="flex justify-end text-sm text-muted-foreground">
                {filas.length} {filas.length === 1 ? "dispersor" : "dispersores"} · Total{" "}
                <span className="ml-1 font-medium text-foreground tabular-nums">{formatoMoneda(total)}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
