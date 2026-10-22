"use client"

import { useEffect, useState } from "react"
import { ImageUp, Loader2, PenLine, Trash2, UserCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FONDO_CUADRICULA, FotoFirma, LienzoFirma } from "@/components/mi-firma-dialog"
import { formatearFechaHora } from "@/lib/fechas"
import {
  ETIQUETA_TIPO_REPRESENTANTE,
  origenFirmaRepresentante,
  type EmpresaConRepresentantes,
  type RepresentanteLegal,
} from "@/lib/representantes"
import {
  guardarFirmaRepresentante,
  listarRepresentantesLegales,
  listarUsuariosParaRepresentante,
} from "@/app/(app)/contratos/representantes/actions"

// ---------------------------------------------------------------------------
// «Adjuntar firma de RL» (Subgerencia, en Aprobación de contratos): los
// representantes de cada empresa (registrados en Admin › Empresas) y su firma:
// dibujada o subida, o, si usa la app, la de su "Mi firma". FirmaRepresentanteDialog
// también lo usa Admin › Empresas. La firma se pone sola en el contrato al
// aprobar la minuta (20261201000000_representantes_legales.sql).
// ---------------------------------------------------------------------------

const SIN_USUARIO = "ninguno"

export function RepresentantesLegalesView({ puedeEditar }: { puedeEditar: boolean }) {
  const [empresas, setEmpresas] = useState<EmpresaConRepresentantes[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [editando, setEditando] = useState<{ empresa: string; rep: RepresentanteLegal } | null>(null)

  useEffect(() => {
    let vigente = true
    listarRepresentantesLegales()
      .then((e: EmpresaConRepresentantes[]) => vigente && setEmpresas(e))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar los representantes."))
    return () => {
      vigente = false
    }
  }, [version])

  if (error && !empresas) return <p className="text-sm text-destructive">{error}</p>
  if (!empresas)
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando representantes…
      </p>
    )

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Los representantes se registran en Admin › Empresas. Firma el contrato el que esté en la minuta.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {empresas.length === 0 && <p className="text-sm text-muted-foreground">No hay empresas registradas.</p>}

      {empresas.map((e) => {
        const activos = e.representantes.filter((r) => r.activo).sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "principal" ? -1 : 1))
        return (
          <section key={e.id} className="rounded-lg border">
            <header className="border-b bg-muted/40 px-4 py-2.5">
              <p className="truncate font-medium">{e.razonSocial}</p>
              {e.nit && <p className="text-xs text-muted-foreground">NIT {e.nit}</p>}
            </header>
            {activos.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Sin representantes registrados (Admin › Empresas): sus contratos se aprueban sin la firma del representante legal.
              </p>
            ) : (
              <ul className="divide-y">
                {activos.map((r) => {
                  const origen = origenFirmaRepresentante(r)
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <div className={`flex h-12 w-32 shrink-0 items-center justify-center rounded border ${FONDO_CUADRICULA}`}>
                        {origen === "usuario" ? (
                          <span className="text-[11px] text-muted-foreground">Su “Mi firma”</span>
                        ) : r.imagenFirma ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.imagenFirma} alt={`Firma de ${r.nombre}`} className="max-h-10 max-w-28 object-contain" />
                        ) : (
                          <span className="text-[11px] text-amber-700">Sin firma</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.nombre}
                          <Badge variant="outline" className="ml-2 h-5 px-2 text-[11px]">
                            {r.tipo === "principal" ? "Representante legal" : ETIQUETA_TIPO_REPRESENTANTE[r.tipo]}
                          </Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.tipoDocumento} {r.numeroDocumento}
                          {r.expedidaEn ? ` de ${r.expedidaEn}` : ""}
                          {r.perfilNombre ? ` · usa la app como ${r.perfilNombre}` : ""}
                          {r.perfilNombre && !r.firmaDeUsuario ? (r.tieneImagen ? " (sin Mi firma: usa la de aquí)" : " (todavía sin Mi firma)") : ""}
                        </p>
                      </div>
                      {puedeEditar && (
                        <Button size="sm" variant="outline" onClick={() => setEditando({ empresa: e.razonSocial, rep: r })}>
                          <PenLine className="size-4" /> {origen ? "Cambiar firma" : "Poner firma"}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      {editando && (
        <FirmaRepresentanteDialog
          empresa={editando.empresa}
          rep={editando.rep}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}

export function FirmaRepresentanteDialog({
  empresa,
  rep,
  onCerrar,
  onGuardado,
}: {
  empresa: string
  rep: RepresentanteLegal
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [perfilId, setPerfilId] = useState<string | null>(rep.perfilId)
  // undefined = la firma no cambia; null = quitarla; texto = nueva.
  const [firmaNueva, setFirmaNueva] = useState<string | null | undefined>(undefined)
  const [modo, setModo] = useState<"dibujar" | "foto" | null>(null)
  const [usuarios, setUsuarios] = useState<{ id: string; nombre: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    let vigente = true
    listarUsuariosParaRepresentante()
      .then((u: { id: string; nombre: string }[]) => vigente && setUsuarios(u))
      .catch(() => vigente && setUsuarios([]))
    return () => {
      vigente = false
    }
  }, [])

  const imagen = firmaNueva === undefined ? rep.imagenFirma : firmaNueva
  const cambio = firmaNueva !== undefined || perfilId !== rep.perfilId

  async function guardar() {
    setGuardando(true)
    setError(null)
    try {
      await guardarFirmaRepresentante(rep.id, {
        ...(firmaNueva !== undefined ? { imagenFirma: firmaNueva } : {}),
        ...(perfilId !== rep.perfilId ? { perfilId } : {}),
      })
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.")
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onCerrar()}>
      <DialogContent className="max-h-[94svh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Firma de {rep.nombre}</DialogTitle>
          <DialogDescription>
            {rep.tipo === "principal" ? "Representante legal" : "Suplente"} de {empresa} · {rep.tipoDocumento} {rep.numeroDocumento}
          </DialogDescription>
        </DialogHeader>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">¿Usa la app?</span>
          <Select value={perfilId ?? SIN_USUARIO} onValueChange={(v) => setPerfilId(!v || v === SIN_USUARIO ? null : (v as string))}>
            <SelectTrigger className="h-9 w-full sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_USUARIO}>No usa la app</SelectItem>
              {(usuarios ?? []).map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {perfilId && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <UserCheck className="size-4" /> Firma con su “Mi firma”. La de aquí solo se usa si no ha registrado la suya.
          </p>
        )}

        <div className="space-y-2 border-t pt-3">
          {imagen ? (
            <div className="flex items-center gap-3">
              <div className={`flex h-20 w-56 items-center justify-center rounded-md border ${FONDO_CUADRICULA}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagen} alt="Firma" className="max-h-16 max-w-52 object-contain" />
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setFirmaNueva(null)}>
                <Trash2 className="size-4" /> Quitar firma
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Sin firma subida.</p>
          )}
          {firmaNueva === undefined && rep.imagenFirma && (
            <p className="text-xs text-muted-foreground">Actualizada el {formatearFechaHora(rep.actualizadoAt)}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant={modo === "dibujar" ? "default" : "outline"} onClick={() => setModo("dibujar")}>
              <PenLine className="size-4" /> Dibujar
            </Button>
            <Button size="sm" variant={modo === "foto" ? "default" : "outline"} onClick={() => setModo("foto")}>
              <ImageUp className="size-4" /> Subir foto
            </Button>
          </div>
          {modo === "dibujar" && <LienzoFirma onCambio={(png) => png && setFirmaNueva(png)} onError={setError} />}
          {modo === "foto" && <FotoFirma onCambio={(png) => png && setFirmaNueva(png)} onError={setError} />}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando || !cambio}>
            {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
