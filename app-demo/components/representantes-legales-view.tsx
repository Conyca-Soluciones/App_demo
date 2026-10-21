"use client"

import { useEffect, useMemo, useState } from "react"
import { ImageUp, Loader2, PenLine, Plus, Trash2, UserCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FONDO_CUADRICULA, FotoFirma, LienzoFirma } from "@/components/mi-firma-dialog"
import { formatearFechaHora } from "@/lib/fechas"
import {
  ETIQUETA_TIPO_REPRESENTANTE,
  TIPOS_DOCUMENTO_REPRESENTANTE,
  origenFirmaRepresentante,
  validarRepresentante,
  type DatosRepresentante,
  type EmpresaConRepresentantes,
  type RepresentanteLegal,
  type TipoDocumentoRepresentante,
  type TipoRepresentante,
} from "@/lib/representantes"
import {
  desactivarRepresentanteLegal,
  guardarRepresentanteLegal,
  listarRepresentantesLegales,
  listarUsuariosParaRepresentante,
} from "@/app/(app)/contratos/representantes/actions"

// ---------------------------------------------------------------------------
// Representantes legales de cada empresa (Subgerencia): principal y suplentes,
// con su firma. Quien usa la app se enlaza a su usuario y firma con su "Mi
// firma"; de los demás, Subgerencia dibuja o sube la firma aquí. Se pone sola
// en el contrato al aprobar la minuta (20261201000000_representantes_legales.sql).
// ---------------------------------------------------------------------------

const SIN_USUARIO = "ninguno"

type Edicion = { empresa: EmpresaConRepresentantes; actual: RepresentanteLegal | null }

export function RepresentantesLegalesView({ puedeEditar }: { puedeEditar: boolean }) {
  const [empresas, setEmpresas] = useState<EmpresaConRepresentantes[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [verInactivos, setVerInactivos] = useState(false)

  useEffect(() => {
    let vigente = true
    listarRepresentantesLegales()
      .then((e: EmpresaConRepresentantes[]) => vigente && setEmpresas(e))
      .catch((e) => vigente && setError(e instanceof Error ? e.message : "No se pudieron cargar los representantes."))
    return () => {
      vigente = false
    }
  }, [version])

  async function desactivar(r: RepresentanteLegal) {
    if (!window.confirm(`¿Quitar a ${r.nombre} como representante? Los contratos que ya firmó no cambian.`)) return
    try {
      await desactivarRepresentanteLegal(r.id)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo quitar.")
    }
  }

  if (error && !empresas) return <p className="text-sm text-destructive">{error}</p>
  if (!empresas)
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Cargando representantes…
      </p>
    )

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-muted-foreground">
          La minuta trae al principal; Jurídica puede cambiarlo por un suplente. Firma el representante cuya cédula está en
          la minuta.
        </p>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver los
          anteriores
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {empresas.length === 0 && <p className="text-sm text-muted-foreground">No hay empresas registradas.</p>}
      {empresas.map((e) => {
        const reps = e.representantes.filter((r) => verInactivos || r.activo)
        const sinPrincipal = !e.representantes.some((r) => r.activo && r.tipo === "principal")
        return (
          <section key={e.id} className="rounded-lg border">
            <header className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{e.razonSocial}</p>
                {e.nit && <p className="text-xs text-muted-foreground">NIT {e.nit}</p>}
              </div>
              {sinPrincipal && <Badge className="h-6 bg-amber-100 px-3 text-xs text-amber-800 hover:bg-amber-100">Sin principal</Badge>}
              {puedeEditar && (
                <Button size="sm" variant="outline" className="ml-auto" onClick={() => setEdicion({ empresa: e, actual: null })}>
                  <Plus className="size-4" /> Agregar representante
                </Button>
              )}
            </header>
            {reps.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Sin representantes: sus contratos se aprueban sin la firma del representante legal.
              </p>
            ) : (
              <ul className="divide-y">
                {reps.map((r) => {
                  const origen = origenFirmaRepresentante(r)
                  return (
                    <li key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 text-sm ${r.activo ? "" : "opacity-60"}`}>
                      <div className={`flex h-12 w-32 shrink-0 items-center justify-center rounded border ${FONDO_CUADRICULA}`}>
                        {r.imagenFirma && origen === "subida" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.imagenFirma} alt={`Firma de ${r.nombre}`} className="max-h-10 max-w-28 object-contain" />
                        ) : origen === "usuario" ? (
                          <span className="text-[11px] text-muted-foreground">Su “Mi firma”</span>
                        ) : (
                          <span className="text-[11px] text-amber-700">Sin firma</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">
                          {r.nombre}{" "}
                          <Badge variant="outline" className="ml-1 h-5 px-2 text-[11px]">
                            {ETIQUETA_TIPO_REPRESENTANTE[r.tipo]}
                          </Badge>
                          {!r.activo && <span className="ml-2 text-xs text-muted-foreground">(anterior)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {r.tipoDocumento} {r.numeroDocumento}
                          {r.expedidaEn ? ` de ${r.expedidaEn}` : ""}
                          {r.perfilNombre ? ` · usa la app como ${r.perfilNombre}` : ""}
                          {r.perfilNombre && !r.firmaDeUsuario ? (r.tieneImagen ? " (sin Mi firma: usa la subida)" : " (todavía sin Mi firma)") : ""}
                        </p>
                      </div>
                      {puedeEditar && r.activo && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setEdicion({ empresa: e, actual: r })}>
                            Editar
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => desactivar(r)} aria-label="Quitar">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        )
      })}

      {edicion && (
        <EditarRepresentante
          edicion={edicion}
          onCerrar={() => setEdicion(null)}
          onGuardado={() => {
            setEdicion(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- crear / editar
function EditarRepresentante({ edicion, onCerrar, onGuardado }: { edicion: Edicion; onCerrar: () => void; onGuardado: () => void }) {
  const r = edicion.actual
  const [datos, setDatos] = useState<DatosRepresentante>({
    tipo: r?.tipo ?? (edicion.empresa.representantes.some((x) => x.activo && x.tipo === "principal") ? "suplente" : "principal"),
    nombre: r?.nombre ?? "",
    tipoDocumento: r?.tipoDocumento ?? "CC",
    numeroDocumento: r?.numeroDocumento ?? "",
    expedidaEn: r?.expedidaEn ?? "",
    perfilId: r?.perfilId ?? null,
  })
  // undefined = la firma no cambia; null = quitarla; texto = nueva.
  const [firmaNueva, setFirmaNueva] = useState<string | null | undefined>(undefined)
  const [modoFirma, setModoFirma] = useState<"dibujar" | "foto" | null>(null)
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

  const principalActual = useMemo(
    () => edicion.empresa.representantes.find((x) => x.activo && x.tipo === "principal" && x.id !== r?.id) ?? null,
    [edicion.empresa.representantes, r?.id]
  )
  const cambiar = (c: Partial<DatosRepresentante>) => setDatos((d) => ({ ...d, ...c }))
  const imagenVisible = firmaNueva === undefined ? (r?.imagenFirma ?? null) : firmaNueva

  async function guardar() {
    const problema = validarRepresentante(datos)
    if (problema) return setError(problema)
    if (datos.tipo === "principal" && principalActual && !window.confirm(`${principalActual.nombre} dejará de ser el principal. ¿Seguir?`)) return
    setGuardando(true)
    setError(null)
    try {
      await guardarRepresentanteLegal(r?.id ?? null, edicion.empresa.id, datos, firmaNueva)
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
          <DialogTitle>{r ? "Editar representante" : "Nuevo representante"}</DialogTitle>
          <DialogDescription>{edicion.empresa.razonSocial}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo titulo="Tipo">
            <Select value={datos.tipo} onValueChange={(v) => cambiar({ tipo: (v as TipoRepresentante) ?? "principal" })}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="principal">Principal</SelectItem>
                <SelectItem value="suplente">Suplente</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo titulo="Nombre completo">
            <Input value={datos.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} />
          </Campo>
          <Campo titulo="Tipo de documento">
            <Select value={datos.tipoDocumento} onValueChange={(v) => cambiar({ tipoDocumento: (v as TipoDocumentoRepresentante) ?? "CC" })}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DOCUMENTO_REPRESENTANTE.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo titulo="Número de documento">
            <Input inputMode="numeric" value={datos.numeroDocumento} onChange={(e) => cambiar({ numeroDocumento: e.target.value })} />
          </Campo>
          <Campo titulo="Expedido en">
            <Input value={datos.expedidaEn} onChange={(e) => cambiar({ expedidaEn: e.target.value })} placeholder="Ciudad" />
          </Campo>
          <Campo titulo="¿Usa la app?">
            <Select value={datos.perfilId ?? SIN_USUARIO} onValueChange={(v) => cambiar({ perfilId: !v || v === SIN_USUARIO ? null : (v as string) })}>
              <SelectTrigger className="h-9 w-full">
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
          </Campo>
        </div>

        <div className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">Firma</p>
          {datos.perfilId && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserCheck className="size-4" /> Firma con su “Mi firma”. La de aquí solo se usa si no ha registrado la suya.
            </p>
          )}
          {imagenVisible && (
            <div className="flex items-center gap-3">
              <div className={`flex h-20 w-56 items-center justify-center rounded-md border ${FONDO_CUADRICULA}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagenVisible} alt="Firma" className="max-h-16 max-w-52 object-contain" />
              </div>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setFirmaNueva(null)}>
                <Trash2 className="size-4" /> Quitar firma
              </Button>
            </div>
          )}
          {r && firmaNueva === undefined && r.imagenFirma && (
            <p className="text-xs text-muted-foreground">Actualizada el {formatearFechaHora(r.actualizadoAt)}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant={modoFirma === "dibujar" ? "default" : "outline"} onClick={() => setModoFirma("dibujar")}>
              <PenLine className="size-4" /> Dibujar
            </Button>
            <Button size="sm" variant={modoFirma === "foto" ? "default" : "outline"} onClick={() => setModoFirma("foto")}>
              <ImageUp className="size-4" /> Subir foto
            </Button>
          </div>
          {modoFirma === "dibujar" && <LienzoFirma onCambio={(png) => png && setFirmaNueva(png)} onError={setError} />}
          {modoFirma === "foto" && <FotoFirma onCambio={(png) => png && setFirmaNueva(png)} onError={setError} />}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2 className="size-4 animate-spin" />} Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Campo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
      {children}
    </label>
  )
}
