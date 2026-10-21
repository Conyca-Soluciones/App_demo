"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Eye, FileText, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MarcoPagina } from "@/components/encabezado-pagina"
import { BuscadorAsync, type OpcionBuscador } from "@/components/buscador-async"
import { VisorDocumento } from "@/components/visor-documento"
import { BadgePolizaContrato } from "@/components/badge-poliza"
import { VerContratoOtrosi } from "@/components/ver-contrato-otrosi"
import { PanelVistaPrevia, useVistaPreviaMinuta } from "@/components/minuta-comun"
import { rutaPdfActaPoliza } from "@/components/acta-poliza-editor"
import { fechaContrato } from "@/components/detalle-solicitud-contrato"
import { createClient } from "@/lib/supabase/client"
import { formatearFechaSinHora } from "@/lib/fechas"
import { pesos } from "@/lib/contratos"
import {
  CLASE_ESTADO_POLIZA,
  ETIQUETA_ESTADO_POLIZA,
  ETIQUETA_POLIZA_CONTRATO,
  rutaArchivoPoliza,
  tipoContratoPoliza,
  validarArchivoPoliza,
  type ContratoPoliza,
  type Poliza,
} from "@/lib/polizas"
import {
  buscarContratistasParaPoliza,
  buscarContratosParaPoliza,
  contratosDeContratistaParaPoliza,
  enlacePoliza,
  polizasDeContrato,
  subirPoliza,
} from "@/app/(app)/contratos/polizas/actions"

// ---------------------------------------------------------------------------
// Pólizas (ruta /contratos/polizas): se busca el contrato o el contratista,
// como en Actas por grupos (solo contratos aprobados por Subgerencia, de los
// proyectos que el usuario ve). Del contrato se ve el estado de su póliza, las
// que se han subido (con su revisión) y, si está pendiente, se sube el archivo.
// ?ver=<contrato_id> (campanita) abre ese contrato.
// ---------------------------------------------------------------------------

const mensaje = (e: unknown, otro: string) => (e instanceof Error ? e.message : otro)

export function PolizasView({ verInicial }: { verInicial: string | null }) {
  const router = useRouter()
  const [contratista, setContratista] = useState<OpcionBuscador | null>(null)
  const [contratosContratista, setContratosContratista] = useState<ContratoPoliza[] | null>(null)
  const [contrato, setContrato] = useState<ContratoPoliza | null>(null)
  const [cargandoContratos, setCargandoContratos] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ultimosContratos = useRef(new Map<string, ContratoPoliza>())

  const buscarContratistas = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratistasParaPoliza(t)
    return lista.map((k) => ({
      id: k.id,
      etiqueta: k.nombre,
      subetiqueta: `${k.documento} · ${k.contratos} ${k.contratos === 1 ? "contrato" : "contratos"}`,
    }))
  }, [])

  const buscarContratos = useCallback(async (t: string): Promise<OpcionBuscador[]> => {
    const lista = await buscarContratosParaPoliza(t)
    ultimosContratos.current = new Map(lista.map((c) => [c.id, c]))
    return lista.map((c) => ({
      id: c.id,
      etiqueta: `${c.numeroContrato} · ${c.contratista.nombre}`,
      subetiqueta: `${c.proyectoCodigo ?? ""} · ${c.polizaEstado ? ETIQUETA_POLIZA_CONTRATO[c.polizaEstado] : ""} · ${c.objeto}`,
    }))
  }, [])

  function cargarContratosDe(contratistaId: string, elegido: ContratoPoliza | null, elegirId?: string) {
    setCargandoContratos(true)
    setError(null)
    contratosDeContratistaParaPoliza(contratistaId)
      .then((lista: ContratoPoliza[]) => {
        setContratosContratista(lista)
        if (elegirId) setContrato(lista.find((x) => x.id === elegirId) ?? null)
        else if (!elegido) setContrato(lista.length === 1 ? lista[0] : null)
      })
      .catch((e) => setError(mensaje(e, "No se pudieron cargar los contratos.")))
      .finally(() => setCargandoContratos(false))
  }

  function elegirContratista(op: OpcionBuscador | null) {
    setContratista(op)
    setContrato(null)
    setContratosContratista(null)
    if (op) cargarContratosDe(op.id, null)
  }

  function elegirContrato(c: ContratoPoliza | null) {
    setContrato(c)
    if (c && c.contratista.id !== contratista?.id) {
      setContratista({ id: c.contratista.id, etiqueta: c.contratista.nombre, subetiqueta: c.contratista.documento })
      setContratosContratista(null)
      cargarContratosDe(c.contratista.id, c)
    }
  }

  // Desde un aviso: abre el contrato.
  useEffect(() => {
    if (!verInicial) return
    polizasDeContrato(verInicial)
      .then(({ contrato: c }) => {
        setContratista({ id: c.contratista.id, etiqueta: c.contratista.nombre, subetiqueta: c.contratista.documento })
        cargarContratosDe(c.contratista.id, null, c.id)
      })
      .catch((e) => setError(mensaje(e, "No se pudo abrir el contrato.")))
    // Solo al entrar a la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const variosContratos = contratosContratista != null && contratosContratista.length > 1

  return (
    <MarcoPagina titulo="Pólizas" subtitulo="Busca el contrato o el contratista y sube la póliza para que Jurídica la apruebe." scroll>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contratista</label>
            <BuscadorAsync
              placeholder="Buscar por nombre o documento..."
              valorSeleccionado={contratista}
              onSeleccionar={elegirContratista}
              buscar={buscarContratistas}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Contrato</label>
            {cargandoContratos ? (
              <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando contratos...
              </div>
            ) : variosContratos ? (
              <Select value={contrato?.id ?? ""} onValueChange={(v) => elegirContrato(contratosContratista.find((c) => c.id === v) ?? null)}>
                <SelectTrigger className="h-10 w-full">
                  <SelectValue placeholder={`Escoge uno de sus ${contratosContratista.length} contratos`} />
                </SelectTrigger>
                <SelectContent>
                  {contratosContratista.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.numeroContrato} · {c.polizaEstado ? ETIQUETA_POLIZA_CONTRATO[c.polizaEstado] : ""} ·{" "}
                      {c.objeto.length > 60 ? `${c.objeto.slice(0, 60)}…` : c.objeto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : contratista && contratosContratista?.length === 0 ? (
              <p className="flex h-10 items-center text-sm text-muted-foreground">Este contratista no tiene contratos aprobados.</p>
            ) : (
              <BuscadorAsync
                placeholder="Buscar por número de contrato u objeto..."
                valorSeleccionado={contrato ? { id: contrato.id, etiqueta: contrato.numeroContrato, subetiqueta: `· ${contrato.objeto}` } : null}
                onSeleccionar={(op) => {
                  if (!op) {
                    elegirContratista(null)
                    return
                  }
                  elegirContrato(ultimosContratos.current.get(op.id) ?? null)
                }}
                buscar={buscarContratos}
              />
            )}
          </div>
          {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
        </section>

        {contrato && (
          <PolizaDelContrato
            key={contrato.id}
            contratoId={contrato.id}
            onCambio={(c) => {
              // El estado nuevo también en la lista del contratista.
              setContrato(c)
              setContratosContratista((l) => l?.map((x) => (x.id === c.id ? c : x)) ?? l)
              if (verInicial) router.replace("/contratos/polizas")
            }}
          />
        )}
      </div>
    </MarcoPagina>
  )
}

// ---------------------------------------------------------------- contrato
function PolizaDelContrato({ contratoId, onCambio }: { contratoId: string; onCambio: (c: ContratoPoliza) => void }) {
  const [datos, setDatos] = useState<{ contrato: ContratoPoliza; polizas: Poliza[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [viendo, setViendo] = useState<Poliza | null>(null)
  const [verContrato, setVerContrato] = useState(false)
  const [verActa, setVerActa] = useState<Poliza | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  function cargar() {
    polizasDeContrato(contratoId)
      .then((d) => setDatos(d))
      .catch((e) => setError(mensaje(e, "No se pudo cargar el contrato.")))
  }
  useEffect(cargar, [contratoId])

  async function subir() {
    if (!archivo || !datos) return
    const problema = validarArchivoPoliza(archivo)
    if (problema) {
      setError(problema)
      return
    }
    setSubiendo(true)
    setError(null)
    const supabase = createClient()
    const ruta = rutaArchivoPoliza(contratoId, archivo.name, Date.now())
    let subido = false
    try {
      const { error: e } = await supabase.storage.from("polizas").upload(ruta, archivo, { contentType: archivo.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el archivo: ${e.message}`)
      subido = true
      await subirPoliza(contratoId, { ruta, nombreArchivo: archivo.name, tamano: archivo.size, mime: archivo.type })
      setArchivo(null)
      if (entrada.current) entrada.current.value = ""
      setAviso("Póliza enviada a Jurídica para su revisión.")
      const d = await polizasDeContrato(contratoId)
      setDatos(d)
      onCambio(d.contrato)
    } catch (e) {
      // Si no quedó registrada, el archivo se borra (la base solo deja borrar
      // archivos que todavía no son póliza de nadie).
      if (subido) await supabase.storage.from("polizas").remove([ruta])
      setError(mensaje(e, "No se pudo subir la póliza."))
    } finally {
      setSubiendo(false)
    }
  }

  if (error && !datos) return <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
  if (!datos)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando contrato...
      </div>
    )

  const c = datos.contrato
  const ultima = datos.polizas[0] ?? null

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            Contrato {c.numeroContrato} · {c.contratista.nombre}
          </h2>
          <p className="text-sm text-muted-foreground">
            {tipoContratoPoliza(c)} · {c.proyectoCodigo ?? c.proyectoNombre ?? ""} · {pesos(c.valor)}
            {c.fechaFin && ` · hasta el ${formatearFechaSinHora(c.fechaFin)}`}
          </p>
          <p className="mt-1 text-sm">{c.objeto}</p>
        </div>
        <div className="flex items-center gap-2">
          <BadgePolizaContrato estado={c.polizaEstado} />
          <Button size="sm" variant="outline" onClick={() => setVerContrato(true)}>
            <Eye className="size-4" /> Ver contrato
          </Button>
        </div>
      </div>

      {aviso && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" /> {aviso}
        </div>
      )}

      {c.polizaEstado === "pendiente" && (
        <div className="space-y-2 rounded-md border border-dashed p-4">
          {ultima?.estado === "devuelta" && (
            <p className="rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
              Jurídica devolvió la póliza anterior: {ultima.motivo}
            </p>
          )}
          <p className="text-sm font-medium">Subir la póliza</p>
          <p className="text-xs text-muted-foreground">PDF, JPG o PNG, máximo 10 MB. Jurídica la revisa; mientras no la apruebe no se pueden hacer actas.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={entrada}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={subiendo}
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null)
                setError(null)
                setAviso(null)
              }}
              className="max-w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
            <Button onClick={subir} disabled={!archivo || subiendo}>
              {subiendo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar a Jurídica
            </Button>
          </div>
        </div>
      )}
      {c.polizaEstado === "recibida" && (
        <p className="text-sm text-muted-foreground">La póliza está en revisión de Jurídica. Si la devuelve, aquí se sube otra.</p>
      )}
      {c.polizaEstado === "aprobada" && <p className="text-sm text-muted-foreground">La póliza está aprobada: ya se pueden hacer actas del contrato.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase">Pólizas subidas</h3>
        {datos.polizas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no se ha subido ninguna.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {datos.polizas.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" title={p.nombreArchivo}>
                  {p.nombreArchivo}
                  <span className="block text-xs text-muted-foreground">
                    Subida por {p.subidaPorNombre ?? "—"} · {fechaContrato(p.createdAt)}
                    {p.resueltaAt && ` · revisada por ${p.resueltaPorNombre ?? "—"} el ${fechaContrato(p.resueltaAt)}`}
                    {p.estado === "devuelta" && p.motivo && ` · Motivo: ${p.motivo}`}
                  </span>
                </span>
                <Badge variant="outline" className={`h-6 px-3 text-xs ${CLASE_ESTADO_POLIZA[p.estado]}`}>
                  {ETIQUETA_ESTADO_POLIZA[p.estado]}
                </Badge>
                <Button size="xs" variant="outline" onClick={() => setViendo(p)}>
                  <Eye className="size-3.5" /> Ver
                </Button>
                {p.estado === "aprobada" && (
                  <Button size="xs" variant="outline" onClick={() => setVerActa(p)} title="Acta de aprobación de la póliza (GJ-F-013)">
                    <FileText className="size-3.5" /> Acta
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={viendo !== null} onOpenChange={(abierto) => !abierto && setViendo(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-[min(1400px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Póliza · contrato {c.numeroContrato}</DialogTitle>
          </DialogHeader>
          {viendo && (
            <VisorDocumento
              titulo={`Póliza ${ETIQUETA_ESTADO_POLIZA[viendo.estado].toLowerCase()}`}
              nombreArchivo={viendo.nombreArchivo}
              mime={viendo.mime}
              cargarUrl={() => enlacePoliza(viendo.id)}
              onVolver={() => setViendo(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <VerContratoOtrosi contrato={verContrato ? { id: c.id, numeroContrato: c.numeroContrato } : null} onCerrar={() => setVerContrato(false)} />
      <Dialog open={verActa !== null} onOpenChange={(abierto) => !abierto && setVerActa(null)}>
        <DialogContent className="flex h-[98svh] max-h-[98svh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden sm:max-w-[min(1400px,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Acta de aprobación de la póliza · contrato {c.numeroContrato}</DialogTitle>
          </DialogHeader>
          {verActa && <PdfActa polizaId={verActa.id} />}
        </DialogContent>
      </Dialog>
    </section>
  )
}

const SIN_CAMBIOS = {}
// El acta guardada (la póliza ya está aprobada: la ruta ignora lo que se mande).
function PdfActa({ polizaId }: { polizaId: string }) {
  const vista = useVistaPreviaMinuta(polizaId, SIN_CAMBIOS, null, rutaPdfActaPoliza(polizaId))
  return (
    <div className="min-h-0 flex-1">
      <PanelVistaPrevia {...vista} />
    </div>
  )
}
