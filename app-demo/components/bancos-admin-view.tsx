"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TablaExcel, type ColumnaExcel } from "@/components/tabla-excel"
import { guardarBanco, listarBancosAdmin, type BancoAdmin } from "@/app/(app)/admin/bancos/actions"

// ---------------------------------------------------------------------------
// Admin › Bancos: lista completa (activos e inactivos) con cuántas cuentas de
// terceros y contratistas usan cada uno. Un banco no se borra (lo usan cuentas
// y contratistas): se desactiva y deja de salir en las listas para elegir.
// ---------------------------------------------------------------------------

type Edicion = { id: string | null; nombre: string; codigo: string; activo: boolean }

export function BancosAdminView() {
  const [bancos, setBancos] = useState<BancoAdmin[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState("")
  const [editando, setEditando] = useState<Edicion | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let activo = true
    listarBancosAdmin()
      .then((lista: BancoAdmin[]) => activo && setBancos(lista))
      .catch((e) => activo && setError(e instanceof Error ? e.message : "No se pudieron cargar los bancos."))
    return () => {
      activo = false
    }
  }, [version])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toUpperCase()
    return (bancos ?? []).filter((b) => !q || b.nombre.includes(q) || (b.codigo ?? "").includes(q))
  }, [bancos, busqueda])

  async function guardar() {
    if (!editando) return
    setGuardando(true)
    setErrorDialogo(null)
    try {
      await guardarBanco(editando)
      setEditando(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setErrorDialogo(e instanceof Error ? e.message : "No se pudo guardar el banco.")
    } finally {
      setGuardando(false)
    }
  }

  const columnas: ColumnaExcel<BancoAdmin>[] = [
    { clave: "nombre", titulo: "Banco", ancho: 280, flexible: true, texto: (b) => b.nombre },
    { clave: "codigo", titulo: "Código", ancho: 90, texto: (b) => b.codigo ?? "", claseCelda: "tabular-nums" },
    {
      clave: "activo",
      titulo: "Estado",
      ancho: 110,
      texto: (b) => (b.activo ? "Activo" : "Inactivo"),
      celda: (b) => <Badge variant={b.activo ? "outline" : "secondary"}>{b.activo ? "Activo" : "Inactivo"}</Badge>,
    },
    { clave: "cuentas", titulo: "Cuentas", ancho: 100, alinear: "right", texto: (b) => String(b.cuentas), claseCelda: "tabular-nums" },
    { clave: "contratistas", titulo: "Contratistas", ancho: 110, alinear: "right", texto: (b) => String(b.contratistas), claseCelda: "tabular-nums" },
    {
      clave: "acciones",
      titulo: "",
      ancho: 100,
      ordenable: false,
      texto: () => "",
      celda: (b) => (
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => {
            setErrorDialogo(null)
            setEditando({ id: b.id, nombre: b.nombre, codigo: b.codigo ?? "", activo: b.activo })
          }}
        >
          <Pencil className="mr-1.5 h-4 w-4" />
          Editar
        </Button>
      ),
    },
  ]

  const original = editando?.id ? bancos?.find((b) => b.id === editando.id) : null
  const renombrando = Boolean(original && editando && editando.nombre.trim().toUpperCase() !== original.nombre)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar banco o código" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <Button
          onClick={() => {
            setErrorDialogo(null)
            setEditando({ id: null, nombre: "", codigo: "", activo: true })
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Nuevo banco
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {bancos === null && !error ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando bancos...
        </div>
      ) : (
        <TablaExcel
          filas={filtrados}
          columnas={columnas}
          claveFila={(b) => b.id}
          tarjeta={{
            titulo: (b) => b.nombre,
            subtitulo: (b) => (b.codigo ? `Código ${b.codigo}` : "Sin código"),
            esquina: (b) => <Badge variant={b.activo ? "outline" : "secondary"}>{b.activo ? "Activo" : "Inactivo"}</Badge>,
            campos: ["cuentas", "contratistas", "acciones"],
          }}
        />
      )}

      <Dialog open={editando !== null} onOpenChange={(abierto) => !abierto && !guardando && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar banco" : "Nuevo banco"}</DialogTitle>
          </DialogHeader>
          {editando && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="banco-nombre">Nombre</Label>
                <Input
                  id="banco-nombre"
                  value={editando.nombre}
                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                  placeholder="Ej. BANCOLOMBIA"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">Se guarda en mayúsculas.</p>
                {renombrando && original && original.contratistas > 0 && (
                  <p className="text-xs text-amber-800">
                    Al renombrarlo también se actualiza en {original.contratistas}{" "}
                    {original.contratistas === 1 ? "contratista" : "contratistas"}.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="banco-codigo">Código (opcional)</Label>
                <Input
                  id="banco-codigo"
                  value={editando.codigo}
                  onChange={(e) => setEditando({ ...editando, codigo: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                  placeholder="3 números"
                  inputMode="numeric"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={editando.activo} onCheckedChange={(v) => setEditando({ ...editando, activo: v === true })} />
                Activo (sale en las listas para elegir)
              </label>
              {errorDialogo && <p className="text-sm text-destructive">{errorDialogo}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={guardando} onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button disabled={guardando || !editando?.nombre.trim()} onClick={guardar}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
