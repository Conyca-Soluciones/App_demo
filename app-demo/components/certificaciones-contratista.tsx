"use client"

import { useEffect, useState } from "react"
import { Eye, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatearFechaSinHora } from "@/lib/fechas"
import type { CertificacionCuenta } from "@/lib/contratistas"
import { certificacionesContratista, enlaceCertificacionContratista, enlaceDocumentoContratista } from "@/app/(app)/contratos/contratistas/actions"

export type DocumentoEnVisor = { titulo: string; nombreArchivo: string; mime: string; cargarUrl: () => Promise<string> }

// Certificación bancaria de las cuentas del tercero del contratista: vive en
// Terceros y la cambia quien tiene "Cambiar RUT y certificación bancaria" (la
// nueva queda pendiente hasta que Financiera la verifique). La ven el detalle del
// contratista y Jurídica en la solicitud de contrato, solo con
// ver_datos_bancarios (sin el permiso no se muestra nada). `anteriores`: las que
// el contratista tenía antes de 20270101007100, solo para ver.
export function CertificacionesContratista({
  contratistaId,
  anteriores = [],
  onVer,
  titulo = "Certificación bancaria",
}: {
  contratistaId: string
  anteriores?: { id: string; nombreArchivo: string; mime: string; subidoAt?: string }[]
  onVer: (d: DocumentoEnVisor) => void
  titulo?: string
}) {
  const [carga, setCarga] = useState<{ lista: CertificacionCuenta[] | null; error: string | null } | null>(null)

  useEffect(() => {
    let vigente = true
    certificacionesContratista(contratistaId)
      .then((lista: CertificacionCuenta[] | null) => vigente && setCarga({ lista, error: null }))
      .catch((e) => vigente && setCarga({ lista: [], error: e instanceof Error ? e.message : "No se pudo cargar la certificación." }))
    return () => {
      vigente = false
    }
  }, [contratistaId])

  // Sin ver_datos_bancarios: nada.
  if (carga && carga.lista === null) return null

  return (
    <div className="space-y-1 pt-1">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      {!carga ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Cargando…
        </p>
      ) : carga.error ? (
        <p className="text-xs text-destructive">{carga.error}</p>
      ) : carga.lista!.length === 0 ? (
        <p className="text-xs text-amber-700">Su cuenta no tiene certificación en Terceros.</p>
      ) : (
        <ul className="space-y-1">
          {carga.lista!.map((k) => (
            <li key={k.cuentaId} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={k.nombreArchivo}>
                {[k.banco, k.tipoCuenta, k.numeroFinal ? `…${k.numeroFinal}` : null].filter(Boolean).join(" · ")}
                {k.subidaEn ? <span className="text-xs text-muted-foreground"> · subida {formatearFechaSinHora(k.subidaEn)}</span> : null}
              </span>
              {k.estado === "PENDIENTE" && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pendiente de verificar en Financiera</span>
              )}
              {k.estado === "ACTIVO" && (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">Verificada</span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onVer({
                    titulo: "Certificación bancaria",
                    nombreArchivo: k.nombreArchivo,
                    mime: k.mime,
                    cargarUrl: () => enlaceCertificacionContratista(contratistaId, k.cuentaId),
                  })
                }
              >
                <Eye className="size-4" /> Ver
              </Button>
            </li>
          ))}
        </ul>
      )}
      {anteriores.map((d) => (
        <div key={d.id} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.nombreArchivo}>
            Anterior, del contratista{d.subidoAt ? ` (${formatearFechaSinHora(d.subidoAt)})` : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onVer({
                titulo: "Certificación bancaria anterior",
                nombreArchivo: d.nombreArchivo,
                mime: d.mime,
                cargarUrl: () => enlaceDocumentoContratista(d.id),
              })
            }
          >
            <Eye className="size-4" /> Ver
          </Button>
        </div>
      ))}
    </div>
  )
}
