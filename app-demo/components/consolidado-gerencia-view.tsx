"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { SelectorNumeros } from "@/components/selector-numeros"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { AYUDA_DOBLE_CLIC, camposDesdeColumnas } from "@/components/ventana-detalle"
import { DetalleOrigenPago } from "@/components/detalle-origen-pago"
import { verSoporteReqAdmin } from "@/components/detalle-requisicion-admin"
import {
  listarConsolidadoGerencia,
  opcionesConsolidadoGerencia,
  soportesDePagos,
} from "@/app/(app)/ayf/consolidado-gerencia/actions"
import { enlaceSoporteOrden } from "@/app/(app)/almacen/comprar-pedidos/actions"
import { enlaceSoporteActa } from "@/app/(app)/contratos/actas/actions"
import {
  fechasSemanaIso,
  formatoMoneda,
  semanaIso,
  semanasDelAnio,
  type FiltrosConsolidadoGerencia,
  type OpcionesConsolidadoGerencia,
  type Pago,
  type SoportePago,
} from "@/lib/pagos"

const TODOS = "todos"

// Abre el soporte en otra pestaña (la pestaña se abre antes de pedir el enlace:
// si no, el navegador la bloquea).
async function abrirSoporte(s: SoportePago) {
  if (s.origen === "requisicion_admin") return verSoporteReqAdmin(s.ruta)
  const ventana = window.open("", "_blank")
  try {
    const url = s.origen === "orden_compra" ? await enlaceSoporteOrden(s.id) : await enlaceSoporteActa(s.ruta)
    if (ventana) ventana.location.href = url
    else window.location.href = url
  } catch {
    ventana?.close()
    window.alert("No se pudo abrir el soporte.")
  }
}

// Consolidado Gerencia: los pagos de los tres consolidados, para control. Solo
// consulta; doble clic abre el documento de donde sale el pago.
export function ConsolidadoGerenciaView() {
  const [pagos, setPagos] = useState<Pago[] | null>(null)
  const [soportes, setSoportes] = useState<Record<string, SoportePago>>({})
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimos, setUltimos] = useState<FiltrosConsolidadoGerencia>({})
  const [opciones, setOpciones] = useState<OpcionesConsolidadoGerencia | null>(null)
  const [viendo, setViendo] = useState<Pago | null>(null)

  const actual = semanaIso()
  const [anios, setAnios] = useState<number[]>([actual.anio])
  const [semanas, setSemanas] = useState<number[]>([actual.semana])
  const [empresaId, setEmpresaId] = useState(TODOS)
  const [proyectoId, setProyectoId] = useState(TODOS)
  const [solicitanteId, setSolicitanteId] = useState(TODOS)
  const [tercero, setTercero] = useState("")

  useEffect(() => {
    opcionesConsolidadoGerencia()
      .then((o: OpcionesConsolidadoGerencia) => setOpciones(o))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los filtros."))
  }, [])

  const opcionesAnios = useMemo(() => {
    const lista: number[] = []
    for (let y = actual.anio; y >= Math.min(2026, actual.anio); y--) lista.push(y)
    return lista
  }, [actual.anio])
  const totalSemanas = anios.length === 1 ? semanasDelAnio(anios[0]) : 53
  const opcionesSemanas = useMemo(() => Array.from({ length: totalSemanas }, (_, i) => i + 1), [totalSemanas])

  function cargar(filtros: FiltrosConsolidadoGerencia = ultimos, pag: number = pagina) {
    setUltimos(filtros)
    setCargando(true)
    setError(null)
    listarConsolidadoGerencia(filtros, pag)
      .then(async (r: { pagos: Pago[]; hayMas: boolean }) => {
        setPagos(r.pagos)
        setPagina(pag)
        setHayMas(r.hayMas)
        setSoportes({})
        if (r.pagos.length > 0) {
          const s = await soportesDePagos(
            r.pagos.map((p) => ({
              id: p.id,
              ordenCompraId: p.ordenCompraId,
              actaId: p.actaId,
              requisicionAdminItemId: p.requisicionAdminItemId,
            }))
          )
          setSoportes(s)
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar el consolidado."))
      .finally(() => setCargando(false))
  }

  function handleConsultar(): boolean {
    cargar(
      {
        anios: anios.length === 0 ? undefined : anios,
        semanas: semanas.length === 0 ? undefined : semanas,
        empresaId: empresaId === TODOS ? undefined : empresaId,
        proyectoId: proyectoId === TODOS ? undefined : proyectoId,
        solicitanteId: solicitanteId === TODOS ? undefined : solicitanteId,
        tercero: tercero.trim() || undefined,
      },
      0
    )
    return true
  }

  function limpiar() {
    setAnios([actual.anio])
    setSemanas([actual.semana])
    setEmpresaId(TODOS)
    setProyectoId(TODOS)
    setSolicitanteId(TODOS)
    setTercero("")
  }

  const pagosQueSuman = pagos ? pagos.filter((p) => p.estado !== "anulado" && p.estado !== "rechazado") : []
  const totalPagina = pagosQueSuman.reduce((acc, p) => acc + p.valor, 0)

  const columnas: ColumnaExcel<Pago>[] = [
    { clave: "item", titulo: "ITEM", ancho: 70, fija: true, alinear: "center", texto: (p) => (p.item != null ? String(p.item) : "") },
    {
      clave: "semana",
      titulo: "Semana / año",
      ancho: 110,
      alinear: "center",
      texto: (p) => (p.semana != null ? `${p.semana} · ${p.anio}` : ""),
      valorOrden: (p) => (p.anio ?? 0) * 100 + (p.semana ?? 0),
      claseCelda: "tabular-nums",
    },
    { clave: "empresa", titulo: "Grupo empresarial", ancho: 220, texto: (p) => p.empresaNombre ?? "" },
    {
      clave: "tercero",
      titulo: "Tercero",
      ancho: 280,
      flexible: true,
      texto: (p) => p.terceroNombre ?? "",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate" title={p.terceroNombre ?? undefined}>
            {p.terceroNombre ?? <span className="text-muted-foreground/60">Sin tercero</span>}
          </div>
          {p.terceroDocumento && <div className="truncate text-xs text-muted-foreground">{p.terceroDocumento}</div>}
        </div>
      ),
    },
    { clave: "proyecto", titulo: "Proyecto", ancho: 160, texto: (p) => p.proyectoCodigo ?? p.proyectoNombre ?? "" },
    { clave: "solicita", titulo: "Solicitante", ancho: 180, texto: (p) => p.solicitadoPorNombre ?? "" },
    {
      clave: "valor",
      titulo: "Valor a pagar",
      ancho: 150,
      alinear: "right",
      texto: (p) => formatoMoneda(p.valor),
      valorOrden: (p) => p.valor,
      celda: (p) => <span className="font-medium">{formatoMoneda(p.valor)}</span>,
      claseCelda: "tabular-nums",
    },
    {
      clave: "soporte",
      titulo: "Soporte",
      ancho: 120,
      ordenable: false,
      texto: (p) => soportes[p.id]?.nombre ?? "",
      celda: (p) => {
        const s = soportes[p.id]
        if (!s) return <span className="text-muted-foreground/60">—</span>
        return (
          <Button size="sm" variant="ghost" className="h-8 gap-1 px-2" title={s.nombre} onClick={() => abrirSoporte(s)}>
            <Paperclip className="h-4 w-4" /> Ver
          </Button>
        )
      },
    },
  ]

  const selector = (
    etiqueta: string,
    valor: string,
    onCambiar: (v: string) => void,
    lista: { id: string; texto: string }[]
  ) => (
    <div className="space-y-1.5">
      <Label>{etiqueta}</Label>
      <Select value={valor} onValueChange={(v) => onCambiar(v ?? TODOS)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Todos</SelectItem>
          {lista.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Los pagos aprobados de todos los consolidados. Por omisión, la semana actual. El ITEM se numera por consolidado y semana."
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="anio-gerencia">Años</Label>
              <SelectorNumeros
                id="anio-gerencia"
                opciones={opcionesAnios}
                seleccion={anios}
                onChange={setAnios}
                textoTodas="Todos"
                plural="años"
                columnas={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="semana-gerencia">Semanas</Label>
              <SelectorNumeros
                id="semana-gerencia"
                opciones={opcionesSemanas}
                seleccion={semanas}
                onChange={setSemanas}
                textoTodas="Todas"
                plural="semanas"
                ayuda={anios.length === 1 ? (n) => fechasSemanaIso(anios[0], n) : undefined}
              />
            </div>
          </div>
          {selector("Grupo empresarial", empresaId, setEmpresaId, (opciones?.empresas ?? []).map((e) => ({ id: e.id, texto: e.nombre })))}
          <div className="space-y-1.5">
            <Label htmlFor="tercero-gerencia">Tercero</Label>
            <Input
              id="tercero-gerencia"
              placeholder="Nombre o razón social"
              value={tercero}
              onChange={(e) => setTercero(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>
          {selector(
            "Proyecto",
            proyectoId,
            setProyectoId,
            (opciones?.proyectos ?? []).map((p) => ({ id: p.id, texto: [p.codigo, p.nombre].filter(Boolean).join(" · ") }))
          )}
          {selector("Solicitante", solicitanteId, setSolicitanteId, (opciones?.solicitantes ?? []).map((s) => ({ id: s.id, texto: s.nombre })))}
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
          )}

          {pagos === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar.
            </div>
          ) : pagos === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando consolidado...
            </div>
          ) : pagos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún pago coincide con los filtros.
            </div>
          ) : (
            <>
              <TablaExcel
                filas={pagos}
                columnas={columnas}
                claveFila={(p) => p.id}
                onDobleClickFila={setViendo}
                tituloFila={AYUDA_DOBLE_CLIC}
                fondoFila={(p) => (p.estado === "anulado" || p.estado === "rechazado" ? "bg-muted/60 text-muted-foreground" : undefined)}
                tarjeta={{
                  titulo: (p) => p.terceroNombre ?? "Sin tercero",
                  subtitulo: (p) => `ITEM ${p.item ?? "—"}${p.semana != null ? ` · semana ${p.semana} de ${p.anio}` : ""} · ${p.empresaNombre ?? ""}`,
                  campos: ["proyecto", "solicita", "valor", "soporte"],
                }}
              />
              <div className="text-right text-sm text-muted-foreground">
                {pagos.length} {pagos.length === 1 ? "pago" : "pagos"} en esta página · Total de la página{" "}
                <span className="font-medium text-foreground tabular-nums">{formatoMoneda(totalPagina)}</span>
              </div>
            </>
          )}

          {pagos !== null && pagos.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimos, n)} />
          )}
        </div>
      </div>

      <DetalleOrigenPago
        pago={viendo}
        acciones={null}
        camposPago={viendo ? camposDesdeColumnas(columnas, viendo, ["soporte"]) : []}
        onCerrar={() => setViendo(null)}
      />
    </div>
  )
}
