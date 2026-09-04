"use client"

import { useEffect, useState } from "react"
import {
  listarUsuarios,
  crearUsuario,
  actualizarGruposDeUsuario,
  cambiarPasswordUsuario,
  listarGrupos,
  crearGrupo,
  actualizarGrupo,
  listarAsignacionesDeGrupo,
  actualizarProyectoDeGrupo,
  listarAsignacionesDeUsuario,
  actualizarProyectoDeUsuario,
  listarProyectosAdmin,
  crearProyecto,
  editarProyecto,
  type UsuarioConGrupos,
  type Grupo,
  type AsignacionProyecto,
  type Proyecto,
} from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// ---------------------------------------------------------------------------
// Forma que ya esperaba ListaProyectosConPermiso -- antes la devolvía el
// servidor ya combinada (proyecto + asignación en un solo objeto); ahora
// se combina acá mismo, del lado del cliente, cruzando la lista de
// proyectos (cargada una sola vez en AdminPage) con la lista liviana de
// asignaciones (proyecto_id + puede_editar, sin nombre) que sí se pide
// cada vez que se abre un grupo/usuario distinto.
// ---------------------------------------------------------------------------
type ProyectoConPermiso = {
  proyectoId: string
  nombre: string
  asignado: boolean
  puedeEditar: boolean
}

function combinarConProyectos(
  proyectos: Proyecto[],
  asignaciones: AsignacionProyecto[]
): ProyectoConPermiso[] {
  const mapa = new Map(asignaciones.map((a) => [a.proyectoId, a.puedeEditar]))
  return proyectos.map((p) => ({
    proyectoId: p.id,
    nombre: p.nombre,
    asignado: mapa.has(p.id),
    puedeEditar: mapa.get(p.id) ?? false,
  }))
}

// ---------------------------------------------------------------------------
// Lista de proyectos con checkbox de "asignado" + toggle de "puede
// editar" -- se reutiliza igual para un grupo que para una persona, la
// única diferencia es qué función de actualizar le pasa el padre.
// ---------------------------------------------------------------------------
function ListaProyectosConPermiso({
  proyectos,
  onCambiar,
}: {
  proyectos: ProyectoConPermiso[]
  onCambiar: (proyectoId: string, asignado: boolean, puedeEditar: boolean) => void
}) {
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
      {proyectos.map((p) => (
        <div key={p.proyectoId} className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-muted">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={p.asignado}
              onChange={(e) => onCambiar(p.proyectoId, e.target.checked, p.puedeEditar)}
            />
            {p.nombre}
          </label>
          {p.asignado && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={p.puedeEditar}
                onChange={(e) => onCambiar(p.proyectoId, true, e.target.checked)}
              />
              puede editar
            </label>
          )}
        </div>
      ))}
      {proyectos.length === 0 && (
        <p className="p-2 text-xs text-muted-foreground">No hay proyectos todavía.</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab de Grupos
// ---------------------------------------------------------------------------
function TabGrupos({
  grupos,
  setGrupos,
  proyectos,
}: {
  grupos: Grupo[]
  setGrupos: React.Dispatch<React.SetStateAction<Grupo[]>>
  proyectos: Proyecto[]
}) {
  const [grupoAbiertoId, setGrupoAbiertoId] = useState<string | null>(null)
  const [asignacionesDelGrupo, setAsignacionesDelGrupo] = useState<AsignacionProyecto[]>([])
  const [nombreNuevoGrupo, setNombreNuevoGrupo] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function abrirGrupo(id: string) {
    if (grupoAbiertoId === id) {
      setGrupoAbiertoId(null)
      return
    }
    setGrupoAbiertoId(id)
    try {
      setAsignacionesDelGrupo(await listarAsignacionesDeGrupo(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos del grupo.")
    }
  }

  async function handleCambiarFlag(
    grupo: Grupo,
    campo: "veTodosProyectos" | "puedeEditarTodos",
    valor: boolean
  ) {
    setError(null)
    try {
      await actualizarGrupo(grupo.id, { [campo]: valor })
      setGrupos((prev) => prev.map((g) => (g.id === grupo.id ? { ...g, [campo]: valor } : g)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el grupo.")
    }
  }

  async function handleCambiarProyecto(
    grupoId: string,
    proyectoId: string,
    asignado: boolean,
    puedeEditar: boolean
  ) {
    setAsignacionesDelGrupo((prev) => {
      const sinEste = prev.filter((a) => a.proyectoId !== proyectoId)
      return asignado ? [...sinEste, { proyectoId, puedeEditar }] : sinEste
    })
    try {
      await actualizarProyectoDeGrupo(grupoId, proyectoId, asignado, puedeEditar)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el permiso.")
    }
  }

  async function handleCrearGrupo() {
    if (!nombreNuevoGrupo.trim()) return
    try {
      const nuevo = await crearGrupo(nombreNuevoGrupo.trim())
      setGrupos((prev) => [...prev, nuevo].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setNombreNuevoGrupo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el grupo.")
    }
  }

  const proyectosConPermiso = combinarConProyectos(proyectos, asignacionesDelGrupo)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nombre del grupo nuevo..."
          value={nombreNuevoGrupo}
          onChange={(e) => setNombreNuevoGrupo(e.target.value)}
          className="w-64"
        />
        <Button size="sm" onClick={handleCrearGrupo} disabled={!nombreNuevoGrupo.trim()}>
          + Crear grupo
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {grupos.map((g) => (
          <div key={g.id} className="rounded-lg border">
            <button
              type="button"
              onClick={() => abrirGrupo(g.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
            >
              <span className="font-medium">{g.nombre}</span>
              <span className="text-xs text-muted-foreground">
                {g.veTodosProyectos ? "ve todos los proyectos" : "proyectos asignados a mano"}
              </span>
            </button>

            {grupoAbiertoId === g.id && (
              <div className="space-y-3 border-t p-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={g.veTodosProyectos}
                    onChange={(e) => handleCambiarFlag(g, "veTodosProyectos", e.target.checked)}
                  />
                  Ve todos los proyectos (viejos y nuevos, sin asignar uno por uno)
                </label>

                {g.veTodosProyectos ? (
                  <label className="ml-6 flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={g.puedeEditarTodos}
                      onChange={(e) => handleCambiarFlag(g, "puedeEditarTodos", e.target.checked)}
                    />
                    Puede editar todos los presupuestos
                  </label>
                ) : (
                  <ListaProyectosConPermiso
                    proyectos={proyectosConPermiso}
                    onCambiar={(proyectoId, asignado, puedeEditar) =>
                      handleCambiarProyecto(g.id, proyectoId, asignado, puedeEditar)
                    }
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab de Usuarios
// ---------------------------------------------------------------------------
function TabUsuarios({ grupos, proyectos }: { grupos: Grupo[]; proyectos: Proyecto[] }) {
  const [usuarios, setUsuarios] = useState<UsuarioConGrupos[]>([])
  const [usuarioAbiertoId, setUsuarioAbiertoId] = useState<string | null>(null)
  const [asignacionesDelUsuario, setAsignacionesDelUsuario] = useState<AsignacionProyecto[]>([])
  const [error, setError] = useState<string | null>(null)

  const [mostrandoForm, setMostrandoForm] = useState(false)
  const [nombre, setNombre] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [esAdmin, setEsAdmin] = useState(false)
  const [gruposElegidos, setGruposElegidos] = useState<Set<string>>(new Set())
  const [creando, setCreando] = useState(false)
  //Nuevos scopes
  const [esAdmin_insumos, setadmin_insumos] = useState(false)
  const [esAdmin_mo, setadmin_mo] = useState(false)
  // Cambiar contraseña de una cuenta ya existente -- ej. "esta cuenta
  // ahora la va a usar otra persona".
  const [passwordNuevaPorUsuario, setPasswordNuevaPorUsuario] = useState<Record<string, string>>({})
  const [cambiandoPasswordId, setCambiandoPasswordId] = useState<string | null>(null)
  const [mensajePasswordId, setMensajePasswordId] = useState<string | null>(null)

  useEffect(() => {
    listarUsuarios()
      .then(setUsuarios)
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar los usuarios."))
  }, [])

  async function abrirUsuario(id: string) {
    if (usuarioAbiertoId === id) {
      setUsuarioAbiertoId(null)
      return
    }
    setUsuarioAbiertoId(id)
    try {
      setAsignacionesDelUsuario(await listarAsignacionesDeUsuario(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos del usuario.")
    }
  }

  async function handleCambiarProyecto(
    usuarioId: string,
    proyectoId: string,
    asignado: boolean,
    puedeEditar: boolean
  ) {
    setAsignacionesDelUsuario((prev) => {
      const sinEste = prev.filter((a) => a.proyectoId !== proyectoId)
      return asignado ? [...sinEste, { proyectoId, puedeEditar }] : sinEste
    })
    try {
      await actualizarProyectoDeUsuario(usuarioId, proyectoId, asignado, puedeEditar)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el permiso.")
    }
  }

  async function handleCambiarGrupoDeUsuario(usuario: UsuarioConGrupos, grupoId: string, marcado: boolean) {
    const nuevosGrupoIds = marcado
      ? [...usuario.grupoIds, grupoId]
      : usuario.grupoIds.filter((id) => id !== grupoId)

    setUsuarios((prev) =>
      prev.map((u) => (u.id === usuario.id ? { ...u, grupoIds: nuevosGrupoIds } : u))
    )
    try {
      await actualizarGruposDeUsuario(usuario.id, nuevosGrupoIds)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el grupo del usuario.")
    }
  }

  async function handleCambiarPassword(usuarioId: string) {
    const nuevaPassword = passwordNuevaPorUsuario[usuarioId] ?? ""
    if (nuevaPassword.length < 6) {
      setMensajePasswordId(null)
      setError("La contraseña nueva debe tener al menos 6 caracteres.")
      return
    }
    setCambiandoPasswordId(usuarioId)
    setError(null)
    try {
      await cambiarPasswordUsuario(usuarioId, nuevaPassword)
      setPasswordNuevaPorUsuario((prev) => ({ ...prev, [usuarioId]: "" }))
      setMensajePasswordId(usuarioId)
      setTimeout(() => setMensajePasswordId((actual) => (actual === usuarioId ? null : actual)), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.")
    } finally {
      setCambiandoPasswordId(null)
    }
  }

  async function handleCrearUsuario() {
    if (!nombre.trim() || !email.trim() || password.length < 6) {
      setError("Nombre, email, y contraseña de al menos 6 caracteres son obligatorios.")
      return
    }
    setCreando(true)
    setError(null)
    try {
      await crearUsuario({
        nombre: nombre.trim(),
        email: email.trim(),
        password,
        esAdmin,
        grupoIds: Array.from(gruposElegidos),
      })
      setUsuarios(await listarUsuarios())
      setMostrandoForm(false)
      setNombre("")
      setEmail("")
      setPassword("")
      setEsAdmin(false)
      setGruposElegidos(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el usuario.")
    } finally {
      setCreando(false)
    }
  }

  const proyectosConPermiso = combinarConProyectos(proyectos, asignacionesDelUsuario)

  return (
    <div className="space-y-4">
      {!mostrandoForm ? (
        <Button size="sm" onClick={() => setMostrandoForm(true)}>
          + Crear usuario
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-56" />
            <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-56" />
            <Input
              placeholder="Contraseña (mínimo 6 caracteres)"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-56"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={esAdmin} onChange={(e) => setEsAdmin(e.target.checked)} />
            Puede entrar al panel de admin

            <input type="checkbox" checked={esAdmin_insumos} onChange={(e) => setadmin_insumos(e.target.checked)} />
            Puede modificar maestro de insumos

            <input type="checkbox" checked={esAdmin_insumos} onChange={(e) => setadmin_mo(e.target.checked)} />
            Puede acceptar solicitudes de mo

            

            {/* Aca añadaria los siguientes scopes de permisos */}
          </label>

          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Grupos</p>
            <div className="flex flex-wrap gap-3">
              {grupos.map((g) => (
                <label key={g.id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={gruposElegidos.has(g.id)}
                    onChange={(e) =>
                      setGruposElegidos((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) next.add(g.id)
                        else next.delete(g.id)
                        return next
                      })
                    }
                  />
                  {g.nombre}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleCrearUsuario} disabled={creando}>
              {creando ? "Creando..." : "Crear"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMostrandoForm(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {usuarios.map((u) => (
          <div key={u.id} className="rounded-lg border">
            <button
              type="button"
              onClick={() => abrirUsuario(u.id)}
              className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
            >
              <div>
                <span className="font-medium">{u.nombre}</span>{" "}
                <span className="text-xs text-muted-foreground">{u.email}</span>
                {u.esAdmin && (
                  <span className="ml-2 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">
                    admin
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {u.grupoIds
                  .map((id) => grupos.find((g) => g.id === id)?.nombre)
                  .filter(Boolean)
                  .join(", ") || "sin grupo"}
              </span>
            </button>

            {usuarioAbiertoId === u.id && (
              <div className="space-y-3 border-t p-4">
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Grupos</p>
                  <div className="flex flex-wrap gap-3">
                    {grupos.map((g) => (
                      <label key={g.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={u.grupoIds.includes(g.id)}
                          onChange={(e) => handleCambiarGrupoDeUsuario(u, g.id, e.target.checked)}
                        />
                        {g.nombre}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Proyectos individuales (además de lo que le dan sus grupos)
                  </p>
                  <ListaProyectosConPermiso
                    proyectos={proyectosConPermiso}
                    onCambiar={(proyectoId, asignado, puedeEditar) =>
                      handleCambiarProyecto(u.id, proyectoId, asignado, puedeEditar)
                    }
                  />
                </div>

                <div className="space-y-1.5 border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    Cambiar contraseña -- por ejemplo, si esta cuenta ahora la va a
                    usar otra persona
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      placeholder="Contraseña nueva (mínimo 6 caracteres)"
                      value={passwordNuevaPorUsuario[u.id] ?? ""}
                      onChange={(e) =>
                        setPasswordNuevaPorUsuario((prev) => ({ ...prev, [u.id]: e.target.value }))
                      }
                      className="h-8 w-64 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCambiarPassword(u.id)}
                      disabled={cambiandoPasswordId === u.id}
                    >
                      {cambiandoPasswordId === u.id ? "Cambiando..." : "Cambiar contraseña"}
                    </Button>
                    {mensajePasswordId === u.id && (
                      <span className="text-xs text-emerald-600">✓ Cambiada</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab de Proyectos
// ---------------------------------------------------------------------------
function TabProyectos({
  proyectos,
  setProyectos,
}: {
  proyectos: Proyecto[]
  setProyectos: React.Dispatch<React.SetStateAction<Proyecto[]>>
}) {
  const [codigoNuevo, setCodigoNuevo] = useState("")
  const [nombreNuevo, setNombreNuevo] = useState("")
  const [clienteNuevo, setClienteNuevo] = useState("")
  const [proyectoEditandoId, setProyectoEditandoId] = useState<string | null>(null)
  const [codigoEditando, setCodigoEditando] = useState("")
  const [nombreEditando, setNombreEditando] = useState("")
  const [clienteEditando, setClienteEditando] = useState("")
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCrear() {
    if (!nombreNuevo.trim()) return
    setCreando(true)
    setError(null)
    try {
      const nuevo = await crearProyecto({
        codigo: codigoNuevo || null,
        nombre: nombreNuevo.trim(),
        cliente: clienteNuevo || null,
      })
      setProyectos((prev) => [nuevo, ...prev])
      setCodigoNuevo("")
      setNombreNuevo("")
      setClienteNuevo("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el proyecto.")
    } finally {
      setCreando(false)
    }
  }

  function empezarAEditar(p: Proyecto) {
    setProyectoEditandoId(p.id)
    setCodigoEditando(p.codigo ?? "")
    setNombreEditando(p.nombre)
    setClienteEditando(p.cliente ?? "")
  }

  async function handleGuardarEdicion(proyectoId: string) {
    if (!nombreEditando.trim()) return
    try {
      await editarProyecto(proyectoId, {
        codigo: codigoEditando || null,
        nombre: nombreEditando.trim(),
        cliente: clienteEditando || null,
      })
      setProyectos((prev) =>
        prev.map((p) =>
          p.id === proyectoId
            ? { ...p, codigo: codigoEditando || null, nombre: nombreEditando.trim(), cliente: clienteEditando || null }
            : p
        )
      )
      setProyectoEditandoId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar el proyecto.")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Código</label>
          <Input
            value={codigoNuevo}
            onChange={(e) => setCodigoNuevo(e.target.value)}
            className="h-9 w-28"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Nombre</label>
          <Input
            value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)}
            className="h-9 w-56"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cliente</label>
          <Input
            value={clienteNuevo}
            onChange={(e) => setClienteNuevo(e.target.value)}
            className="h-9 w-56"
          />
        </div>
        <Button size="sm" onClick={handleCrear} disabled={creando || !nombreNuevo.trim()}>
          {creando ? "Creando..." : "+ Crear proyecto"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="divide-y rounded-lg border">
        {proyectos.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            {proyectoEditandoId === p.id ? (
              <>
                <Input
                  value={codigoEditando}
                  onChange={(e) => setCodigoEditando(e.target.value)}
                  className="h-8 w-24"
                  placeholder="Código"
                  autoFocus
                />
                <Input
                  value={nombreEditando}
                  onChange={(e) => setNombreEditando(e.target.value)}
                  className="h-8 flex-1"
                  placeholder="Nombre"
                />
                <Input
                  value={clienteEditando}
                  onChange={(e) => setClienteEditando(e.target.value)}
                  className="h-8 w-48"
                  placeholder="Cliente"
                />
                <Button size="sm" onClick={() => handleGuardarEdicion(p.id)}>
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setProyectoEditandoId(null)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                  {p.codigo ?? "—"}
                </span>
                <span className="flex-1 text-sm">{p.nombre}</span>
                <span className="w-48 shrink-0 text-xs text-muted-foreground">
                  {p.cliente ?? "—"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => empezarAEditar(p)}>
                  Editar
                </Button>
              </>
            )}
          </div>
        ))}
        {proyectos.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No hay proyectos todavía.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
export default function AdminPage() {
  const [tab, setTab] = useState<"usuarios" | "grupos" | "proyectos">("usuarios")
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [proyectos, setProyectos] = useState<Proyecto[]>([])

  // Grupos y proyectos se cargan UNA VEZ al entrar al panel, no en cada
  // cambio de pestaña (ver el comentario que ya había sobre esto) --
  // ahora también aplica a proyectos, que antes se volvía a pedir
  // completo cada vez que se abría un grupo o una persona distinta.
  useEffect(() => {
    listarGrupos()
      .then(setGrupos)
      .catch(() => {})
    listarProyectosAdmin()
      .then(setProyectos)
      .catch(() => {})
  }, [])

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Administración</h1>

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("usuarios")}
          className={`px-3 py-2 text-sm ${
            tab === "usuarios" ? "border-b-2 border-teal-600 font-medium" : "text-muted-foreground"
          }`}
        >
          Usuarios
        </button>
        <button
          type="button"
          onClick={() => setTab("grupos")}
          className={`px-3 py-2 text-sm ${
            tab === "grupos" ? "border-b-2 border-teal-600 font-medium" : "text-muted-foreground"
          }`}
        >
          Grupos
        </button>
        <button
          type="button"
          onClick={() => setTab("proyectos")}
          className={`px-3 py-2 text-sm ${
            tab === "proyectos" ? "border-b-2 border-teal-600 font-medium" : "text-muted-foreground"
          }`}
        >
          Proyectos
        </button>
      </div>

      {tab === "usuarios" && <TabUsuarios grupos={grupos} proyectos={proyectos} />}
      {tab === "grupos" && <TabGrupos grupos={grupos} setGrupos={setGrupos} proyectos={proyectos} />}
      {tab === "proyectos" && <TabProyectos proyectos={proyectos} setProyectos={setProyectos} />}
    </main>
  )
}