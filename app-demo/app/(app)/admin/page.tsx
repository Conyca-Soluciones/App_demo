"use client"

import { useEffect, useState } from "react"
import {
  listarProyectosAdmin,
  crearProyecto,
  editarProyecto,
  listarEmpresas,
  crearEmpresa,
  editarEmpresa,
  eliminarEmpresa,
  type Proyecto,
  type Empresa,
} from "./actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// Tab de Proyectos
// ---------------------------------------------------------------------------
function TabProyectos({
  proyectos,
  setProyectos,
  empresas,
}: {
  proyectos: Proyecto[]
  setProyectos: React.Dispatch<React.SetStateAction<Proyecto[]>>
  empresas: Empresa[]
}) {
  const [codigoNuevo, setCodigoNuevo] = useState("")
  const [nombreNuevo, setNombreNuevo] = useState("")
  const [ciudadNuevo, setCiudadNuevo] = useState("")
  const [empresaIdNuevo, setEmpresaIdNuevo] = useState<string | null>(null)
  const [proyectoEditandoId, setProyectoEditandoId] = useState<string | null>(null)
  const [codigoEditando, setCodigoEditando] = useState("")
  const [nombreEditando, setNombreEditando] = useState("")
  const [ciudadEditando, setCiudadEditando] = useState("")
  const [empresaIdEditando, setEmpresaIdEditando] = useState<string | null>(null)
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
        ciudad: ciudadNuevo || null,
        empresaId: empresaIdNuevo,
      })
      setProyectos((prev) => [nuevo, ...prev])
      setCodigoNuevo("")
      setNombreNuevo("")
      setCiudadNuevo("")
      setEmpresaIdNuevo(null)
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
    setCiudadEditando(p.ciudad ?? "")
    setEmpresaIdEditando(p.empresaId)
  }

  async function handleGuardarEdicion(proyectoId: string) {
    if (!nombreEditando.trim()) return
    try {
      await editarProyecto(proyectoId, {
        codigo: codigoEditando || null,
        nombre: nombreEditando.trim(),
        ciudad: ciudadEditando || null,
        empresaId: empresaIdEditando,
      })
      const empresa = empresas.find((e) => e.id === empresaIdEditando)
      setProyectos((prev) =>
        prev.map((p) =>
          p.id === proyectoId
            ? {
                ...p,
                codigo: codigoEditando || null,
                nombre: nombreEditando.trim(),
                ciudad: ciudadEditando || null,
                empresaId: empresaIdEditando,
                empresaNombre: empresa?.razonSocial ?? null,
                empresaNit: empresa?.nit ?? null,
              }
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
          <label className="text-xs text-muted-foreground">Empresa</label>
          <Select
            value={empresaIdNuevo ?? "__ninguna__"}
            onValueChange={(v) => setEmpresaIdNuevo(v === "__ninguna__" ? null : v)}
          >
            <SelectTrigger className="h-9 w-64">
              <SelectValue placeholder="Sin empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ninguna__">Sin empresa</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.razonSocial}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Ciudad</label>
          <Input
            value={ciudadNuevo}
            onChange={(e) => setCiudadNuevo(e.target.value)}
            className="h-9 w-36"
            placeholder="Ej. Bogotá"
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
                <Select
                  value={empresaIdEditando ?? "__ninguna__"}
                  onValueChange={(v) => setEmpresaIdEditando(v === "__ninguna__" ? null : v)}
                >
                  <SelectTrigger className="h-8 w-56">
                    <SelectValue placeholder="Sin empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__ninguna__">Sin empresa</SelectItem>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.razonSocial}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={ciudadEditando}
                  onChange={(e) => setCiudadEditando(e.target.value)}
                  className="h-8 w-32"
                  placeholder="Ciudad"
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
                <span className="w-56 shrink-0 text-xs text-muted-foreground">
                  {p.empresaNombre ?? "—"}
                </span>
                <span className="w-32 shrink-0 text-xs text-muted-foreground">
                  {p.ciudad ?? "—"}
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
// Tab de Empresas -- razones sociales bajo las que CONYCA ejecuta proyectos.
// Cada proyecto se enlaza a una (dropdown "Empresa" de Proyectos) y de ahí
// salen el nombre y el NIT del encabezado de las órdenes de compra. La lista
// vive en AdminPage: lo que se cambie acá se refleja al instante en el
// dropdown de la pestaña Proyectos.
// ---------------------------------------------------------------------------
function TabEmpresas({
  empresas,
  setEmpresas,
  proyectos,
  setProyectos,
}: {
  empresas: Empresa[]
  setEmpresas: React.Dispatch<React.SetStateAction<Empresa[]>>
  proyectos: Proyecto[]
  setProyectos: React.Dispatch<React.SetStateAction<Proyecto[]>>
}) {
  const [nitNuevo, setNitNuevo] = useState("")
  const [razonNueva, setRazonNueva] = useState("")
  const [creando, setCreando] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nitEditando, setNitEditando] = useState("")
  const [razonEditando, setRazonEditando] = useState("")
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const proyectosDe = (empresaId: string) => proyectos.filter((p) => p.empresaId === empresaId).length

  async function handleCrear() {
    if (!nitNuevo.trim() || !razonNueva.trim()) return
    setCreando(true)
    setError(null)
    try {
      const nueva = await crearEmpresa({ nit: nitNuevo, razonSocial: razonNueva })
      setEmpresas((prev) =>
        [...prev, nueva].sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, "es"))
      )
      setNitNuevo("")
      setRazonNueva("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la empresa.")
    } finally {
      setCreando(false)
    }
  }

  function empezarAEditar(e: Empresa) {
    setError(null)
    setEditandoId(e.id)
    setNitEditando(e.nit)
    setRazonEditando(e.razonSocial)
  }

  async function handleGuardarEdicion(empresaId: string) {
    if (!nitEditando.trim() || !razonEditando.trim()) return
    setError(null)
    try {
      await editarEmpresa(empresaId, { nit: nitEditando, razonSocial: razonEditando })
      const nit = nitEditando.trim()
      const razonSocial = razonEditando.trim()
      setEmpresas((prev) =>
        prev
          .map((e) => (e.id === empresaId ? { ...e, nit, razonSocial } : e))
          .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, "es"))
      )
      // Los proyectos de esta empresa muestran su nombre y NIT: se actualizan.
      setProyectos((prev) =>
        prev.map((p) =>
          p.empresaId === empresaId ? { ...p, empresaNombre: razonSocial, empresaNit: nit } : p
        )
      )
      setEditandoId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo editar la empresa.")
    }
  }

  async function handleEliminar(e: Empresa) {
    if (!confirm(`¿Eliminar la empresa "${e.razonSocial}"?`)) return
    setEliminandoId(e.id)
    setError(null)
    try {
      await eliminarEmpresa(e.id)
      setEmpresas((prev) => prev.filter((x) => x.id !== e.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la empresa.")
    } finally {
      setEliminandoId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">NIT</label>
          <Input
            value={nitNuevo}
            onChange={(e) => setNitNuevo(e.target.value)}
            className="h-9 w-40"
            placeholder="Ej. 900123456-7"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Razón social</label>
          <Input
            value={razonNueva}
            onChange={(e) => setRazonNueva(e.target.value)}
            className="h-9 w-80"
          />
        </div>
        <Button
          size="sm"
          onClick={handleCrear}
          disabled={creando || !nitNuevo.trim() || !razonNueva.trim()}
        >
          {creando ? "Creando..." : "+ Crear empresa"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="divide-y rounded-lg border">
        {empresas.map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
            {editandoId === e.id ? (
              <>
                <Input
                  value={nitEditando}
                  onChange={(ev) => setNitEditando(ev.target.value)}
                  className="h-8 w-40"
                  placeholder="NIT"
                  autoFocus
                />
                <Input
                  value={razonEditando}
                  onChange={(ev) => setRazonEditando(ev.target.value)}
                  className="h-8 flex-1"
                  placeholder="Razón social"
                />
                <Button size="sm" onClick={() => handleGuardarEdicion(e.id)}>
                  Guardar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <>
                <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">{e.nit}</span>
                <span className="flex-1 text-sm">{e.razonSocial}</span>
                <span className="w-28 shrink-0 text-xs text-muted-foreground">
                  {proyectosDe(e.id)} {proyectosDe(e.id) === 1 ? "proyecto" : "proyectos"}
                </span>
                <Button size="sm" variant="ghost" onClick={() => empezarAEditar(e)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={eliminandoId === e.id}
                  onClick={() => handleEliminar(e)}
                >
                  {eliminandoId === e.id ? "Eliminando..." : "Eliminar"}
                </Button>
              </>
            )}
          </div>
        ))}
        {empresas.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No hay empresas todavía. Crea una para poder asignarla a los proyectos.
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
  const [tab, setTab] = useState<"proyectos" | "empresas">("proyectos")
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])

  // Proyectos y empresas se cargan UNA VEZ al entrar al panel, no en cada
  // cambio de pestaña: así el dropdown de empresa de Proyectos y la pestaña
  // Empresas comparten la misma lista.
  useEffect(() => {
    listarProyectosAdmin()
      .then(setProyectos)
      .catch(() => {})
    listarEmpresas()
      .then(setEmpresas)
      .catch(() => {})
  }, [])

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Control administrativo</h1>

      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("proyectos")}
          className={`px-3 py-2 text-sm ${
            tab === "proyectos" ? "border-b-2 border-teal-600 font-medium" : "text-muted-foreground"
          }`}
        >
          Proyectos
        </button>
        <button
          type="button"
          onClick={() => setTab("empresas")}
          className={`px-3 py-2 text-sm ${
            tab === "empresas" ? "border-b-2 border-teal-600 font-medium" : "text-muted-foreground"
          }`}
        >
          Empresas
        </button>
      </div>

      {tab === "proyectos" && (
        <TabProyectos proyectos={proyectos} setProyectos={setProyectos} empresas={empresas} />
      )}
      {tab === "empresas" && (
        <TabEmpresas
          empresas={empresas}
          setEmpresas={setEmpresas}
          proyectos={proyectos}
          setProyectos={setProyectos}
        />
      )}
    </main>
  )
}
