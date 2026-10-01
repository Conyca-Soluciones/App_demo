"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { Loader2, Lock, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  crearRol,
  eliminarRol,
  establecerPermisoRol,
  listarRolesConPermisos,
  type RolConPermisos,
} from "@/app/(app)/admin/roles/actions"
import { ACCIONES, PESTANAS, permisoAccion, permisoPestana } from "@/lib/pestanas"

type FilaMatriz = { tipo: "seccion"; titulo: string } | {
  tipo: "permiso"
  permiso: string
  titulo: string
  detalle?: string
}

// Filas: primero las pestañas por sección, luego las acciones por sección.
function construirFilas(): FilaMatriz[] {
  const filas: FilaMatriz[] = [{ tipo: "seccion", titulo: "PESTAÑAS — qué secciones del menú puede abrir" }]
  let seccionActual = ""
  for (const p of PESTANAS) {
    if (p.seccion !== seccionActual) {
      seccionActual = p.seccion
      filas.push({ tipo: "seccion", titulo: p.seccion })
    }
    filas.push({ tipo: "permiso", permiso: permisoPestana(p.clave), titulo: p.titulo, detalle: p.nota })
  }

  filas.push({ tipo: "seccion", titulo: "ACCIONES — qué puede hacer dentro de las pestañas" })
  seccionActual = ""
  for (const a of ACCIONES) {
    if (a.seccion !== seccionActual) {
      seccionActual = a.seccion
      filas.push({ tipo: "seccion", titulo: a.seccion })
    }
    filas.push({ tipo: "permiso", permiso: permisoAccion(a.clave), titulo: a.titulo, detalle: a.descripcion })
  }
  return filas
}

export function RolesPermisosView() {
  const [roles, setRoles] = useState<RolConPermisos[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null) // "rolId|permiso"
  const [nuevoRol, setNuevoRol] = useState("")
  const [creando, setCreando] = useState(false)

  const filas = useMemo(construirFilas, [])

  function cargar() {
    listarRolesConPermisos()
      .then((r: RolConPermisos[]) => setRoles(r))
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los roles."))
  }

  useEffect(cargar, [])

  async function alternar(rol: RolConPermisos, permiso: string, activo: boolean) {
    const llave = `${rol.id}|${permiso}`
    setGuardando(llave)
    setError(null)

    // Optimista: se marca al instante y se revierte si la base lo rechaza.
    const aplicar = (marcado: boolean) =>
      setRoles((prev) =>
        (prev ?? []).map((r) =>
          r.id !== rol.id
            ? r
            : {
                ...r,
                permisos: marcado
                  ? [...r.permisos.filter((p) => p !== permiso), permiso]
                  : r.permisos.filter((p) => p !== permiso),
              }
        )
      )
    aplicar(activo)

    try {
      await establecerPermisoRol(rol.id, permiso, activo)
    } catch (e) {
      aplicar(!activo)
      setError(e instanceof Error ? e.message : "No se pudo guardar el cambio.")
    } finally {
      setGuardando(null)
    }
  }

  async function handleCrear() {
    if (!nuevoRol.trim()) return
    setCreando(true)
    setError(null)
    try {
      await crearRol(nuevoRol)
      setNuevoRol("")
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el rol.")
    } finally {
      setCreando(false)
    }
  }

  async function handleEliminar(rol: RolConPermisos) {
    if (!confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return
    setError(null)
    try {
      await eliminarRol(rol.id)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar el rol.")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex max-w-md gap-2">
        <Input
          placeholder="Nombre de un rol nuevo (ej. Contabilidad)"
          value={nuevoRol}
          onChange={(e) => setNuevoRol(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCrear()}
        />
        <Button onClick={handleCrear} disabled={creando || !nuevoRol.trim()}>
          <Plus className="mr-1 h-4 w-4" /> Crear rol
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {roles === null ? (
        !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando roles...
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 min-w-64 border-b bg-background px-3 py-2 text-left font-medium">
                  Permiso
                </th>
                {roles.map((r) => (
                  <th
                    key={r.id}
                    className="sticky top-0 z-10 min-w-28 border-b border-l bg-background px-2 py-2 text-center font-medium"
                  >
                    <div className="flex items-center justify-center gap-1">
                      {r.clave === "administrador" && <Lock className="h-3 w-3 text-muted-foreground" />}
                      {r.nombre}
                    </div>
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {r.usuarios} {r.usuarios === 1 ? "usuario" : "usuarios"}
                    </div>
                    {!r.esSistema && (
                      <button
                        type="button"
                        onClick={() => handleEliminar(r)}
                        className="mt-0.5 text-muted-foreground hover:text-destructive"
                        title="Eliminar rol"
                      >
                        <Trash2 className="mx-auto h-3 w-3" />
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) =>
                f.tipo === "seccion" ? (
                  <tr key={`s-${i}`}>
                    <td
                      colSpan={roles.length + 1}
                      className="bg-muted/50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {f.titulo}
                    </td>
                  </tr>
                ) : (
                  <tr key={f.permiso} className="hover:bg-muted/30">
                    <td className="sticky left-0 z-10 border-b bg-background px-3 py-2">
                      <div className="font-medium">{f.titulo}</div>
                      {f.detalle && <div className="text-xs text-muted-foreground">{f.detalle}</div>}
                    </td>
                    {roles.map((r) => {
                      const esAdmin = r.clave === "administrador"
                      const marcado = esAdmin || r.permisos.includes(f.permiso)
                      const llave = `${r.id}|${f.permiso}`
                      return (
                        <Fragment key={r.id}>
                          <td className="border-b border-l text-center">
                            <Checkbox
                              checked={marcado}
                              disabled={esAdmin || guardando === llave}
                              onCheckedChange={(v) => alternar(r, f.permiso, v === true)}
                              aria-label={`${f.titulo} — ${r.nombre}`}
                            />
                          </td>
                        </Fragment>
                      )
                    })}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
