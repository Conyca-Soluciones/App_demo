"use client"
// app/(app)/almacen/page.tsx
import Link from "next/link"
import { EncabezadoPagina } from "@/components/encabezado-pagina"
import { useEffect, useState } from "react"

import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormularioRequisicion } from "@/components/dialogue-nuevo-pedido"
import {
  SolicitudExtraordinariaDialog,
  TITULO_EXTRAORDINARIA,
  type InicialExtraordinaria,
} from "@/components/solicitud-extraordinaria-dialog"
import { useProyectoActual } from "@/components/proyecto-provider"
import { SinProyecto } from "@/components/sin-proyecto"

import { TarjetaEspera } from "@/components/requisiciones-administrativas-pagina"
import type { ReqAdministrativaEspera } from "@/lib/requisiciones-administrativas"

import { buscarPresupuestoActivo, listarMisExtraordinariasEnEspera } from "./actions"
import type { PresupuestoActivo } from "./types"

export default function Almacen() {
  // El proyecto se elige en /inicio (landing); acá solo se lee.
  const { proyecto: proyectoActual } = useProyectoActual()

  return (
    <>
      <EncabezadoPagina
        titulo="Elaboración de requisiciones"
        subtitulo="Haz requisiciones de insumos de almacén para el proyecto en el que estás trabajando."
      />

      {!proyectoActual && <SinProyecto />}

      {/* key: al cambiar de proyecto se empieza de cero (aviso, error y presupuesto). */}
      {proyectoActual && (
        <Requisiciones key={proyectoActual.id} proyectoId={proyectoActual.id} proyectoNombre={proyectoActual.nombre} />
      )}
    </>
  )
}

function Requisiciones({ proyectoId, proyectoNombre }: { proyectoId: string; proyectoNombre: string }) {
  // Aviso tras crear: "Requisición N creada" con enlace a su detalle.
  const [creada, setCreada] = useState<{ requisicionId: string; numero: number; codigo: string; extraordinaria?: boolean } | null>(null)
  // "Solicitar requisición extraordinaria a Gerencia" (requisición extraordinaria): null = cerrado.
  const [extraordinaria, setExtraordinaria] = useState<{ inicial: InicialExtraordinaria | null } | null>(null)
  // Extraordinaria guardada en espera de insumos nuevos (cuántos) y recarga de la lista.
  const [enEspera, setEnEspera] = useState<number | null>(null)
  const [recargaEspera, setRecargaEspera] = useState(0)
  // null = todavía cargando el presupuesto del proyecto.
  const [carga, setCarga] = useState<{ presupuesto: PresupuestoActivo | null; error: string | null } | null>(null)
  const presupuestoActivo = carga?.presupuesto ?? null
  const cargandoPresupuesto = carga === null
  const error = carga?.error ?? null

  useEffect(() => {
    let activo = true
    buscarPresupuestoActivo(proyectoId)
      .then((p) => activo && setCarga({ presupuesto: p, error: null }))
      .catch(
        (e) =>
          activo &&
          setCarga({ presupuesto: null, error: e instanceof Error ? e.message : "No se pudo cargar el presupuesto del proyecto." })
      )
    return () => {
      activo = false
    }
  }, [proyectoId])

  return (
      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          {proyectoId && cargandoPresupuesto && (
            <p className="text-xs text-muted-foreground">Cargando presupuesto del proyecto…</p>
          )}
          {proyectoId && !cargandoPresupuesto && !presupuestoActivo && (
            <p className="text-xs text-amber-700">
              {proyectoNombre} todavía no tiene un presupuesto
              cargado — sube uno desde el módulo de Presupuestos antes de crear requisiciones.
            </p>
          )}
          {creada && (
            <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {creada.extraordinaria
                ? `Requisición extraordinaria ${creada.codigo} enviada a Gerencia.`
                : `Requisición ${creada.codigo} creada y enviada a Compras.`}{" "}
              <Link
                href={`/almacen/registro-requisiciones/${creada.requisicionId}`}
                className="font-medium underline underline-offset-2"
              >
                Ver detalle
              </Link>
            </p>
          )}
          {enEspera !== null && (
            <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              La requisición extraordinaria quedó en espera de {enEspera} {enEspera === 1 ? "insumo nuevo" : "insumos nuevos"}.
              Cuando Aprobación de insumos los apruebe, se crea sola y pasa a Gerencia (te llega un aviso).
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <ExtraordinariasEnEspera key={recargaEspera} />

        {/* El formulario va directo en la página (sin botón para abrirlo). */}
        {presupuestoActivo && (
          <section className="rounded-lg border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
              <h2 className="text-xl font-semibold">Nueva requisición</h2>
              <Button variant="outline" onClick={() => setExtraordinaria({ inicial: null })}>
                <TriangleAlert className="size-4" />
                {TITULO_EXTRAORDINARIA}
              </Button>
            </div>
            <FormularioRequisicion
              versionId={presupuestoActivo.versionActualId}
              onPedidoCreado={(c) => setCreada(c ?? null)}
              onSolicitarGerencia={(inicial) => setExtraordinaria({ inicial })}
            />
          </section>
        )}

        {presupuestoActivo && (
          <SolicitudExtraordinariaDialog
            open={extraordinaria !== null}
            onOpenChange={(v) => !v && setExtraordinaria(null)}
            versionId={presupuestoActivo.versionActualId}
            inicial={extraordinaria?.inicial ?? null}
            onCreada={(c) => {
              setEnEspera(null)
              setCreada({ ...c, extraordinaria: true })
            }}
            onEnEspera={(n) => {
              setCreada(null)
              setEnEspera(n)
              setRecargaEspera((k) => k + 1)
            }}
          />
        )}
      </main>
  )
}
// Extraordinarias de quien consulta que esperan insumos nuevos (20270101005500):
// cambiar o quitar un insumo rechazado, reintentar o cancelar.
function ExtraordinariasEnEspera() {
  const [esperas, setEsperas] = useState<ReqAdministrativaEspera[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function cargar() {
    listarMisExtraordinariasEnEspera()
      .then((lista: ReqAdministrativaEspera[]) => {
        setEsperas(lista)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones en espera."))
  }

  useEffect(() => {
    let vigente = true
    listarMisExtraordinariasEnEspera()
      .then((lista: ReqAdministrativaEspera[]) => vigente && setEsperas(lista))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones en espera."))
    return () => {
      vigente = false
    }
  }, [])

  if (error) return <p className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
  if (!esperas || esperas.length === 0) return null

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Requisiciones extraordinarias en espera de insumos nuevos</h2>
      {esperas.map((e) => (
        <TarjetaEspera
          key={e.id}
          espera={e}
          titulo={`Extraordinaria${e.proyecto ? ` · ${e.proyecto}` : ""}`}
          onCambio={cargar}
        />
      ))}
    </section>
  )
}
