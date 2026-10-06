"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PanelFiltros } from "@/components/panel-filtros"
import { PaginacionSimple } from "@/components/paginacion-simple"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { TerceroDialogo, NuevoTerceroDialogo } from "@/components/tercero-dialogo"
import { listarBancos, listarTerceros } from "@/app/(app)/ayf/terceros/actions"
import { puedeBuscar } from "@/lib/busqueda"
import {
  CLASE_ESTADO_CUENTA,
  ETIQUETA_ESTADO_CUENTA,
  documentoFormateado,
  type Banco,
  type EstadoCuentaTercero,
  type FiltrosTerceros,
  type Tercero,
} from "@/lib/terceros"

const ESTADOS_FILTRO: { valor: EstadoCuentaTercero; etiqueta: string }[] = [
  { valor: "PENDIENTE", etiqueta: "Con cuentas pendientes de verificar" },
  { valor: "ACTIVO", etiqueta: "Con cuentas verificadas" },
  { valor: "INACTIVO", etiqueta: "Con cuentas inactivas" },
]

function EstadoTercero({ t }: { t: Tercero }) {
  const pendientes = t.cuentas.filter((c) => c.estado === "PENDIENTE").length
  if (t.cuentas.length === 0) {
    return <Badge variant="outline" className="h-6 border-gray-300 bg-gray-50 px-3 text-xs text-gray-600">Sin cuentas</Badge>
  }
  if (pendientes > 0) {
    return (
      <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_CUENTA.PENDIENTE}`}>
        {pendientes} por verificar
      </Badge>
    )
  }
  const activas = t.cuentas.some((c) => c.estado === "ACTIVO")
  return (
    <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_CUENTA[activas ? "ACTIVO" : "INACTIVO"]}`}>
      {ETIQUETA_ESTADO_CUENTA[activas ? "ACTIVO" : "INACTIVO"]}
    </Badge>
  )
}

export function TercerosView({ puedeEditar, puedeVerificar }: { puedeEditar: boolean; puedeVerificar: boolean }) {
  // null = todavía no se consultó: no se muestra nada hasta presionar Consultar.
  const [terceros, setTerceros] = useState<Tercero[] | null>(null)
  const [cargando, setCargando] = useState(false)
  const [pagina, setPagina] = useState(0)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ultimosFiltros, setUltimosFiltros] = useState<FiltrosTerceros>({})

  const [bancos, setBancos] = useState<Banco[]>([])
  const [documento, setDocumento] = useState("")
  const [nombre, setNombre] = useState("")
  const [bancoId, setBancoId] = useState("todos")
  const [estado, setEstado] = useState<EstadoCuentaTercero | "todos">("todos")

  const [abierto, setAbierto] = useState<Tercero | null>(null)
  const [creando, setCreando] = useState(false)

  function cargar(filtros: FiltrosTerceros = ultimosFiltros, pag: number = pagina) {
    setUltimosFiltros(filtros)
    setCargando(true)
    setError(null)
    listarTerceros(filtros, pag)
      .then((r: { terceros: Tercero[]; hayMas: boolean }) => {
        setTerceros(r.terceros)
        setPagina(pag)
        setHayMas(r.hayMas)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los terceros."))
      .finally(() => setCargando(false))
  }

  useEffect(() => {
    listarBancos()
      .then((b: Banco[]) => setBancos(b))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los bancos."))
  }, [])

  function handleConsultar(): boolean {
    if (nombre.trim() && !puedeBuscar(nombre)) {
      setError("Escribe al menos 2 letras para buscar por nombre (o _ para listar todos).")
      return false
    }
    cargar(
      {
        documento: documento.trim() || undefined,
        nombre: nombre.trim() || undefined,
        bancoId: bancoId === "todos" ? undefined : bancoId,
        estadoCuenta: estado === "todos" ? undefined : estado,
      },
      0
    )
    return true
  }

  function limpiar() {
    setDocumento("")
    setNombre("")
    setBancoId("todos")
    setEstado("todos")
  }

  // Un cambio dentro del diálogo (cuenta verificada, editada...) se refleja en
  // la fila sin volver a consultar toda la página.
  function actualizarFila(t: Tercero) {
    setAbierto(t)
    setTerceros((actuales) => (actuales ? actuales.map((x) => (x.id === t.id ? t : x)) : actuales))
  }

  const columnas: ColumnaExcel<Tercero>[] = [
    {
      clave: "documento",
      titulo: "Documento",
      ancho: 180,
      fija: true,
      texto: (t) => `${t.tipoDocumento} ${documentoFormateado(t)}`,
    },
    { clave: "nombre", titulo: "Nombre o razón social", ancho: 320, flexible: true, texto: (t) => t.razonSocial },
    {
      clave: "cuentas",
      titulo: "Cuentas",
      ancho: 90,
      alinear: "center",
      texto: (t) => String(t.cuentas.length),
    },
    {
      clave: "estado",
      titulo: "Estado",
      ancho: 170,
      texto: (t) => t.cuentas.filter((c) => c.estado === "PENDIENTE").length + " por verificar",
      celda: (t) => <EstadoTercero t={t} />,
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      ancho: 110,
      ordenable: false,
      texto: () => "",
      celda: (t) => (
        <Button size="sm" variant="outline" className="h-8 w-20 shrink-0" onClick={() => setAbierto(t)} aria-label={`Ver ${t.razonSocial}`}>
          <Eye className="mr-1.5 h-4 w-4" />
          Ver
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <PanelFiltros
          cargando={cargando}
          onConsultar={handleConsultar}
          onLimpiar={limpiar}
          ayuda="Ningún filtro es obligatorio: sin filtros se consultan todos los terceros."
        >
          <div className="space-y-1.5">
            <Label htmlFor="doc-tercero">Documento</Label>
            <Input
              id="doc-tercero"
              inputMode="numeric"
              placeholder="Empieza por…"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nombre-tercero">Nombre o razón social</Label>
            <Input
              id="nombre-tercero"
              placeholder="Mínimo 2 letras (o _ para todos)"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsultar()}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Banco de la cuenta</Label>
            <Select value={bancoId} onValueChange={(v) => setBancoId(v ?? "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {bancos.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Estado de las cuentas</Label>
            <Select value={estado} onValueChange={(v) => setEstado((v ?? "todos") as EstadoCuentaTercero | "todos")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {ESTADOS_FILTRO.map((e) => (
                  <SelectItem key={e.valor} value={e.valor}>
                    {e.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PanelFiltros>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          {puedeEditar && (
            <div className="flex justify-end">
              <Button onClick={() => setCreando(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Nuevo tercero
              </Button>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {terceros === null && !cargando ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Elige los filtros que quieras y presiona Consultar para ver los terceros.
            </div>
          ) : terceros === null ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando terceros...
            </div>
          ) : terceros.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
              Ningún tercero coincide con los filtros.
            </div>
          ) : (
            <TablaExcel
              filas={terceros}
              columnas={columnas}
              claveFila={(t) => t.id}
              onDobleClickFila={setAbierto}
              tituloFila="Doble clic para ver"
              tarjeta={{
                titulo: (t) => t.razonSocial,
                subtitulo: (t) => `${t.tipoDocumento} ${documentoFormateado(t)}`,
                esquina: (t) => (
                  <Button size="sm" variant="outline" className="h-8" onClick={() => setAbierto(t)}>
                    <Eye className="mr-1.5 h-4 w-4" />
                    Ver
                  </Button>
                ),
                campos: ["cuentas", "estado"],
              }}
            />
          )}

          {terceros !== null && terceros.length > 0 && (
            <PaginacionSimple pagina={pagina} hayMas={hayMas} cargando={cargando} onCambiar={(n) => cargar(ultimosFiltros, n)} />
          )}
        </div>
      </div>

      <TerceroDialogo
        tercero={abierto}
        bancos={bancos}
        puedeEditar={puedeEditar}
        puedeVerificar={puedeVerificar}
        onCambio={actualizarFila}
        onCerrar={() => setAbierto(null)}
      />

      <NuevoTerceroDialogo
        abierto={creando}
        bancos={bancos}
        onCerrar={() => setCreando(false)}
        onCreado={(t) => {
          setCreando(false)
          setAbierto(t)
        }}
      />
    </div>
  )
}
