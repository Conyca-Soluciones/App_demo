"use client"

import { COMODIN_LISTAR } from "@/lib/busqueda"
import { createClient } from "@/lib/supabase/client"
import { useEffect, useMemo, useState } from "react"
import { KeyRound, Loader2, Plus, Search } from "lucide-react"
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
  listarProyectosAdmin,
  crearUsuario,
  cambiarPasswordUsuario,
  type Proyecto,
} from "@/app/(app)/admin/actions"
import { listarRolesConPermisos, type RolConPermisos } from "@/app/(app)/admin/roles/actions"
import {
  asignarRolUsuario,
  establecerProyectosUsuario,
  listarUsuariosAcceso,
  type UsuarioAcceso,
} from "@/app/(app)/admin/accesos/actions"
import { TablaExcel, useOrdenExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { cambiarEnvioCorreos, cambiarPreferenciaCorreo, estadoCorreos, type PreferenciaCorreo } from "@/app/(app)/correos-actions"
import { AYUDA_DOBLE_CLIC, VentanaDetalle } from "@/components/ventana-detalle"

const SIN_ROL = "__sin_rol__"

export function UsuariosAccesosView() {
  const [usuarios, setUsuarios] = useState<UsuarioAcceso[] | null>(null)
  // Quien está en sesión: su propio rol no se cambia desde aquí (la base
  // tampoco deja quitarse el de Administrador).
  const [miId, setMiId] = useState<string | null>(null)
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setMiId(data.user?.id ?? null))
      .catch(() => setMiId(null))
  }, [])
  const [roles, setRoles] = useState<RolConPermisos[]>([])
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [guardandoRol, setGuardandoRol] = useState<string | null>(null)

  const [editando, setEditando] = useState<UsuarioAcceso | null>(null)
  const [edTodos, setEdTodos] = useState(false)
  const [edProyectos, setEdProyectos] = useState<Set<string>>(new Set())
  const [guardandoProyectos, setGuardandoProyectos] = useState(false)

  // Crear una cuenta nueva y cambiar la contraseña de una existente (antes se
  // hacía en Control administrativo > Usuarios).
  const [creandoUsuario, setCreandoUsuario] = useState(false)
  const [nuNombre, setNuNombre] = useState("")
  const [nuEmail, setNuEmail] = useState("")
  const [nuPassword, setNuPassword] = useState("")
  const [nuRol, setNuRol] = useState(SIN_ROL)
  const [guardandoNuevo, setGuardandoNuevo] = useState(false)
  const [cambiandoPassword, setCambiandoPassword] = useState<UsuarioAcceso | null>(null)
  const [passwordNueva, setPasswordNueva] = useState("")
  const [guardandoPassword, setGuardandoPassword] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [viendo, setViendo] = useState<UsuarioAcceso | null>(null)
  // Correos de 360: el interruptor general y quién recibe los avisos por correo.
  const [correos, setCorreos] = useState<{ activo: boolean; usuarios: Record<string, PreferenciaCorreo> } | null>(null)
  const [guardandoCorreo, setGuardandoCorreo] = useState<string | null>(null)

  async function cambiarCorreo(u: UsuarioAcceso, recibe: boolean) {
    setGuardandoCorreo(u.id)
    setError(null)
    try {
      const valor: PreferenciaCorreo = recibe ? "inmediato" : "nunca"
      await cambiarPreferenciaCorreo(u.id, valor)
      setCorreos((c) => (c ? { ...c, usuarios: { ...c.usuarios, [u.id]: valor } } : c))
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el correo.")
    } finally {
      setGuardandoCorreo(null)
    }
  }

  async function cambiarGeneral(activo: boolean) {
    setGuardandoCorreo("general")
    setError(null)
    try {
      await cambiarEnvioCorreos(activo)
      setCorreos((c) => (c ? { ...c, activo } : c))
      setAviso(activo ? "Envío de correos de 360 encendido." : "Envío de correos de 360 apagado: no sale ningún correo hasta encenderlo.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar el envío de correos.")
    } finally {
      setGuardandoCorreo(null)
    }
  }

  function cargar() {
    Promise.all([listarUsuariosAcceso(), listarRolesConPermisos(), listarProyectosAdmin()])
      .then(([u, r, p]: [UsuarioAcceso[], RolConPermisos[], Proyecto[]]) => {
        setUsuarios(u)
        setRoles(r)
        setProyectos(p)
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la información."))
    estadoCorreos()
      .then((c: { activo: boolean; usuarios: Record<string, PreferenciaCorreo> }) => setCorreos(c))
      .catch(() => setCorreos(null))
  }

  useEffect(cargar, [])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return (usuarios ?? []).filter(
      (u) =>
        !q ||
        q === COMODIN_LISTAR ||
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

  function abrirNuevoUsuario() {
    setError(null)
    setAviso(null)
    setNuNombre("")
    setNuEmail("")
    setNuPassword("")
    setNuRol(SIN_ROL)
    setCreandoUsuario(true)
  }

  async function guardarNuevoUsuario() {
    setGuardandoNuevo(true)
    setError(null)
    try {
      await crearUsuario({
        nombre: nuNombre,
        email: nuEmail,
        password: nuPassword,
        rolId: nuRol === SIN_ROL ? null : nuRol,
      })
      setCreandoUsuario(false)
      setAviso(`Cuenta creada para ${nuNombre.trim()}. Asígnale sus proyectos desde la lista.`)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el usuario.")
      setCreandoUsuario(false)
      cargar() // por si la cuenta sí se creó y solo falló el rol
    } finally {
      setGuardandoNuevo(false)
    }
  }

  async function guardarPassword() {
    if (!cambiandoPassword) return
    setGuardandoPassword(true)
    setError(null)
    try {
      await cambiarPasswordUsuario(cambiandoPassword.id, passwordNueva)
      setAviso(`Contraseña de ${cambiandoPassword.nombre} actualizada.`)
      setCambiandoPassword(null)
      setPasswordNueva("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.")
      setCambiandoPassword(null)
    } finally {
      setGuardandoPassword(false)
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

  const columnas: ColumnaExcel<UsuarioAcceso>[] = [
    { clave: "nombre", titulo: "Usuario", ancho: 200, fija: true, texto: (u) => u.nombre, claseCelda: "font-medium" },
    { clave: "correo", titulo: "Correo", ancho: 240, flexible: true, texto: (u) => u.email ?? u.username ?? "" },
    {
      clave: "rol",
      titulo: "Rol general",
      ancho: 240,
      texto: (u) => (u.rolId ? (roles.find((r) => r.id === u.rolId)?.nombre ?? "") : "Sin rol"),
      celda: (u) => (
        <select
          className="h-7 w-full rounded-md border bg-background px-2 text-sm disabled:opacity-60"
          aria-label={`Rol general de ${u.nombre}`}
          value={u.rolId ?? SIN_ROL}
          disabled={guardandoRol === u.id || u.id === miId}
          onChange={(e) => cambiarRol(u, e.target.value)}
          title={
            u.id === miId
              ? "Tu propio rol no se cambia desde tu usuario: pídeselo a otro administrador."
              : !u.rolId
                ? `Permisos anteriores${u.banderasAnteriores.length > 0 ? `: ${u.banderasAnteriores.join(", ")}` : ": ninguno especial"}`
                : undefined
          }
        >
          <option value={SIN_ROL}>Sin rol</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nombre}
            </option>
          ))}
        </select>
      ),
    },
    {
      clave: "proyectos",
      titulo: "Proyectos",
      ancho: 190,
      texto: (u) => resumenProyectos(u),
      celda: (u) => (
        <Button variant="outline" size="sm" className="h-7" onClick={() => abrirProyectos(u)}>
          {resumenProyectos(u)}
        </Button>
      ),
    },
    {
      clave: "avisosCorreo",
      titulo: "Correos",
      ancho: 90,
      alinear: "center",
      ordenable: false,
      texto: (u) => (correos?.usuarios[u.id] === "inmediato" ? "Sí" : "No"),
      celda: (u) =>
        correos ? (
          <Checkbox
            checked={correos.usuarios[u.id] === "inmediato"}
            disabled={guardandoCorreo === u.id}
            aria-label={`Enviar los avisos de ${u.nombre} por correo`}
            title={`Enviar los avisos de la campanita a ${u.email ?? u.username ?? "su correo"}`}
            onCheckedChange={(v) => cambiarCorreo(u, v === true)}
          />
        ) : null,
    },
    {
      clave: "clave",
      titulo: "Contraseña",
      ancho: 110,
      alinear: "center",
      ordenable: false,
      texto: () => "",
      celda: (u) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title="Cambiar contraseña"
          aria-label={`Cambiar contraseña de ${u.nombre}`}
          onClick={() => {
            setError(null)
            setAviso(null)
            setPasswordNueva("")
            setCambiandoPassword(u)
          }}
        >
          <KeyRound className="h-4 w-4" />
        </Button>
      ),
    },
  ]
  const { ordenadas, orden, ordenar } = useOrdenExcel(filtrados, columnas)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por nombre o correo"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Button onClick={abrirNuevoUsuario}>
          <Plus className="mr-1 h-4 w-4" /> Nuevo usuario
        </Button>
        {correos && (
          <label
            className="ml-auto flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
            title="Apagado, no sale ningún correo de 360 aunque las personas tengan los correos activados."
          >
            <Checkbox checked={correos.activo} disabled={guardandoCorreo === "general"} onCheckedChange={(v) => cambiarGeneral(v === true)} />
            Envío de correos de 360
            <span className={correos.activo ? "text-emerald-700" : "text-muted-foreground"}>{correos.activo ? "encendido" : "apagado"}</span>
          </label>
        )}
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        &quot;Correos&quot;: a quién le llegan los avisos de la campanita al correo con el que inicia sesión. Cada persona también lo puede cambiar en su menú.
      </p>

      {aviso && (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {aviso}
        </div>
      )}

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
        filtrados.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            Ningún usuario coincide con la búsqueda.
          </div>
        ) : (
          <TablaExcel
            filas={ordenadas}
            columnas={columnas}
            claveFila={(u) => u.id}
            orden={orden}
            onOrdenar={ordenar}
            onDobleClickFila={setViendo}
            tituloFila={AYUDA_DOBLE_CLIC}
            tarjeta={{
              titulo: (u) => u.nombre,
              subtitulo: (u) => u.email ?? u.username ?? "",
              esquina: (u) => columnas.find((c) => c.clave === "clave")!.celda!(u),
              campos: ["rol", "proyectos"],
            }}
          />
        )
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

      <VentanaDetalle
        abierta={viendo !== null}
        onCerrar={() => setViendo(null)}
        titulo={viendo?.nombre}
        subtitulo={viendo ? (viendo.email ?? viendo.username ?? undefined) : undefined}
        campos={
          viendo
            ? [
                { etiqueta: "Rol general", valor: roles.find((r) => r.id === viendo.rolId)?.nombre ?? "Sin rol" },
                { etiqueta: "Proyectos", valor: resumenProyectos(viendo) },
                ...(!viendo.rolId
                  ? [
                      {
                        etiqueta: "Permisos anteriores",
                        valor: viendo.banderasAnteriores.length > 0 ? viendo.banderasAnteriores.join(", ") : "Ninguno especial",
                        ancho: "completo" as const,
                      },
                    ]
                  : []),
              ]
            : []
        }
        onEditar={viendo ? () => abrirProyectos(viendo) : undefined}
        acciones={
          viendo && (
            <Button
              variant="outline"
              onClick={() => {
                setError(null)
                setAviso(null)
                setPasswordNueva("")
                setCambiandoPassword(viendo)
              }}
            >
              <KeyRound className="mr-1.5 h-4 w-4" /> Cambiar contraseña
            </Button>
          )
        }
      />

      <Dialog open={creandoUsuario} onOpenChange={(abierto) => !abierto && setCreandoUsuario(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo usuario</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se crea la cuenta y tú le entregas el correo y la contraseña a la persona. Después asígnale
            sus proyectos desde la lista.
          </p>
          <Input aria-label="Nombre" placeholder="Nombre" value={nuNombre} onChange={(e) => setNuNombre(e.target.value)} />
          <Input
            type="email"
            aria-label="Correo"
            placeholder="Correo"
            value={nuEmail}
            onChange={(e) => setNuEmail(e.target.value)}
          />
          <Input
            type="password"
            aria-label="Contraseña"
            placeholder="Contraseña (mínimo 6 caracteres)"
            value={nuPassword}
            onChange={(e) => setNuPassword(e.target.value)}
          />
          <div className="space-y-1">
            <label htmlFor="nuevo-usuario-rol" className="text-xs text-muted-foreground">
              Rol general
            </label>
            <select
              id="nuevo-usuario-rol"
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={nuRol}
              onChange={(e) => setNuRol(e.target.value)}
            >
              <option value={SIN_ROL}>Sin rol (se lo asigno después)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreandoUsuario(false)}>
              Cancelar
            </Button>
            <Button
              onClick={guardarNuevoUsuario}
              disabled={guardandoNuevo || !nuNombre.trim() || !nuEmail.trim() || nuPassword.length < 6}
            >
              {guardandoNuevo ? "Creando..." : "Crear usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cambiandoPassword !== null}
        onOpenChange={(abierto) => !abierto && setCambiandoPassword(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña de {cambiandoPassword?.nombre}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Útil si la cuenta la va a usar otra persona o si alguien perdió su contraseña. Entrégasela
            por un canal seguro.
          </p>
          <Input
            type="password"
            placeholder="Contraseña nueva (mínimo 6 caracteres)"
            value={passwordNueva}
            onChange={(e) => setPasswordNueva(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCambiandoPassword(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarPassword} disabled={guardandoPassword || passwordNueva.length < 6}>
              {guardandoPassword ? "Guardando..." : "Cambiar contraseña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
