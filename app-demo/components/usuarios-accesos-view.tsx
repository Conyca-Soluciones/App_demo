"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { listarProyectosAdmin, type Proyecto } from "@/app/(app)/admin/actions"
import { listarRolesConPermisos, type RolConPermisos } from "@/app/(app)/admin/roles/actions"
import {
  asignarRolUsuario,
  establecerProyectosUsuario,
  listarUsuariosAcceso,
  type UsuarioAcceso,
} from "@/app/(app)/admin/accesos/actions"

const SIN_ROL = "__sin_rol__"

export function UsuariosAccesosView() {
  const [usuarios, setUsuarios] = useState<UsuarioAcceso[] | null>(null)
  const [roles, setRoles] = useState<RolConPermisos[]>([])
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardandoRol, setGuardandoRol] = useState<string | null>(null)

  const [editando, setEditando] = useState<UsuarioAcceso | null>(null)
  const [edTodos, setEdTodos] = useState(false)
  const [edProyectos, setEdProyectos] = useState<Set<string>>(new Set())
  const [guardandoProyectos, setGuardandoProyectos] = useState(false)

  function cargar() {
    Promise.all([listarUsuariosAcceso(), listarRolesConPermisos(), listarProyectosAdmin()])
      .then(([u, r, p]: [UsuarioAcceso[], RolConPermisos[], Proyecto[]]) => {
        setUsuarios(u)
        setRoles(r)
        setProyectos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la información."))
  }

  useEffect(cargar, [])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return (usuarios ?? []).filter(
      (u) =>
        !q ||
        u.nombre.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.username ?? "").toLowerCase().includes(q)
    )
  }, [usuarios, busqueda])

  const nombreRol = (rolId: string | null) => roles.find((r) => r.id === rolId)?.nombre

  async function cambiarRol(usuario: UsuarioAcceso, valor: string) {
    const rolId = valor === SIN_ROL ? null : valor
    setGuardandoRol(usuario.id)
    setError(null)
    try {
      await asignarRolUsuario(usuario.id, rolId)
      setUsuarios((prev) => (prev ?? []).map((u) => (u.id === usuario.id ? { ...u, rolId } : u)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el rol.")
    } finally {
      setGuardandoRol(null)
    }
  }

  function abrirProyectos(u: UsuarioAcceso) {
    setError(null)
    setEditando(u)
    setEdTodos(u.todosLosProyectos)
    setEdProyectos(new Set(u.proyectoIds))
  }

  function alternarProyecto(id: string, marcado: boolean) {
    setEdProyectos((prev) => {
      const s = new Set(prev)
      if (marcado) s.add(id)
      else s.delete(id)
      return s
    })
  }

  async function guardarProyectos() {
    if (!editando) return
    setGuardandoProyectos(true)
    setError(null)
    try {
      const ids = [...edProyectos]
      await establecerProyectosUsuario(editando.id, edTodos, ids)
      setUsuarios((prev) =>
        (prev ?? []).map((u) =>
          u.id === editando.id ? { ...u, todosLosProyectos: edTodos, proyectoIds: ids } : u
        )
      )
      setEditando(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron guardar los proyectos.")
      setEditando(null)
    } finally {
      setGuardandoProyectos(false)
    }
  }

  const resumenProyectos = (u: UsuarioAcceso) =>
    u.todosLosProyectos
      ? "Todos los proyectos"
      : u.proyectoIds.length === 0
        ? "Ninguno"
        : `${u.proyectoIds.length} ${u.proyectoIds.length === 1 ? "proyecto" : "proyectos"}`

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Usuarios y accesos</h1>
        <p className="text-sm text-muted-foreground">
          Elige el rol general de cada persona y los proyectos a los que puede entrar. Quien no tiene
          rol sigue con los permisos que tenía antes hasta que le asignes uno.
        </p>
      </div>

      <div className="relative w-80">
        <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Buscar por nombre o correo"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {usuarios === null ? (
        !error && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando usuarios...
          </div>
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead className="w-60">Rol general</TableHead>
                <TableHead className="w-56">Proyectos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.nombre}</div>
                    <div className="text-xs text-muted-foreground">{u.email ?? u.username ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      value={u.rolId ?? SIN_ROL}
                      disabled={guardandoRol === u.id}
                      onChange={(e) => cambiarRol(u, e.target.value)}
                    >
                      <option value={SIN_ROL}>Sin rol</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.nombre}
                        </option>
                      ))}
                    </select>
                    {!u.rolId && (
                      <div className="mt-1 text-[11px] text-amber-700">
                        Permisos anteriores
                        {u.banderasAnteriores.length > 0 ? `: ${u.banderasAnteriores.join(", ")}` : ": ninguno especial"}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => abrirProyectos(u)}>
                      {resumenProyectos(u)}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Ningún usuario coincide con la búsqueda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editando !== null}
        onOpenChange={(abierto) => {
          if (!abierto) setEditando(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Proyectos de {editando?.nombre}</DialogTitle>
          </DialogHeader>
          {editando && !editando.rolId && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Esta persona todavía no tiene rol: mientras tanto sus proyectos se siguen calculando con
              sus grupos anteriores. Asígnale un rol para que estos proyectos sean los que cuentan.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={edTodos} onCheckedChange={(v) => setEdTodos(v === true)} />
            Todos los proyectos (incluye los que se creen después)
          </label>
          <div
            className={`max-h-72 space-y-1 overflow-auto rounded-md border p-2 ${edTodos ? "opacity-50" : ""}`}
          >
            {proyectos.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
                <Checkbox
                  checked={edTodos || edProyectos.has(p.id)}
                  disabled={edTodos}
                  onCheckedChange={(v) => alternarProyecto(p.id, v === true)}
                />
                <span className="font-mono text-xs text-muted-foreground">{p.codigo ?? "—"}</span>
                <span>{p.nombre}</span>
              </label>
            ))}
            {proyectos.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">No hay proyectos creados.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Rol: {nombreRol(editando?.rolId ?? null) ?? "sin rol"}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarProyectos} disabled={guardandoProyectos}>
              {guardandoProyectos ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
