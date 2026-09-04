"use client"
import { FileUpload } from "@/components/file-upload"
import { PresupuestoTable } from "@/components/presupuesto-table"
import { PresupuestoTree } from "@/components/presupuesto-tree"
import { ApuEditorDialog } from "@/components/apu-editor-dialog"
import { AgregarItemManualDialog } from "@/components/agregar-item-manual-dialog"
import * as XLSX from "xlsx"
import ExcelJS from "exceljs"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ExportTemplateButton } from "@/components/export-template-button"
import { calcularNivelDesdeCodigo, nuevoStackNiveles, mensajeError } from "@/lib/calcular-nivel"
import { parseApuSheet, type BloqueApu } from "@/lib/parse-apu-excel"
import { RevisionApuDialog } from "@/components/revision-apu-dialog"
import {
  crearPresupuesto,
  verProyectos,
  verPresupuestoDeProyecto,
  cargarItemsDePresupuesto,
  cargarItemsConEstadoApu,
  cargarVersionConEstadoApu,
  AñadirItemPresuouesto,
  recalcularValorItemDesdeApu,
  obtenerApusParaExportar,
  actualizarCantidadPresupuestoItem,
  listarVersiones,
  crearNuevaVersion,
  crearVersionVacia,
  actualizarEstadoPresupuesto,
  matchearYGuardarImportApu,
  obtenerEstadoApuPorItem,
  obtenerValoresItems,
  EliminarPresupuesto,
  type ItemPresupuesto,
  type PresupuestoExistente,
  type VersionPresupuesto,
  type EstadoApuItem,
  type MotivoRechazoPorItem,
} from "./actions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ---------------------------------------------------------------------------
// El tipo del ítem (ItemPresupuesto) vive en ./actions -- se comparte con
// PresupuestoTable así los dos lados siempre concuerdan. `id` y `padreId`
// son UUIDs generados en el cliente desde el momento en que el ítem se
// crea -- así el guardado es incremental: se puede guardar varias veces,
// solo con los ítems nuevos (guardado === false), sin duplicar nada ni
// romper la jerarquía, aunque el padre ya se haya guardado en una tanda
// anterior.
// ---------------------------------------------------------------------------

const PREFIJO_CODIGO_PENDIENTE = "PEND-"

// Mismo formato que usa apu-editor-dialog.tsx -- se repite acá en vez de
// importarlo porque ese archivo no lo exporta; si se necesita en un tercer
// lugar, vale la pena moverlo a un helper compartido en /lib.
function formatoCOP(valor: number) {
  return valor.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  })
}



// El excel debe tener columnas Codigo, descripcion,unidad y cantidad
//Accepta puntos 1/ 1.1/1.2 y 1 /101 / 10101

//Versiones acceptadas por el programa
const ALIAS_COLUMNAS: Record<"codigo" | "descripcion" | "unidad" | "cantidad" | "valorTotal", string[]> = {
  codigo: ["codigo", "código", "item", "ítem", "cod"],
  descripcion: ["descripcion", "descripción", "actividad", "concepto", "detalle"],
  unidad: ["unidad", "um", "un", "u","unidad de medida"],
  cantidad: ["cantidad", "cant", "cant."],
  valorTotal: ["valor total", "vr total", "vr. total", "total"],
}

function normalizarHeader(h: string): string {
  return h
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

function detectarColumnas(filas: Record<string, unknown>[]) {
  if (filas.length === 0) {
    throw new Error("El archivo no tiene filas de datos.")
  }
  // OJO: no basta con mirar las keys de filas[0] -- si la primera fila
  // tiene alguna columna vacía (ej. un capítulo sin UM ni Cantidad,
  // como "1 | PRELIMINARES | | "), sheet_to_json puede omitir esa key
  // en ESE objeto puntual, aunque sí exista en filas siguientes. Por
  // eso se juntan las keys de TODAS las filas antes de buscar alias.
  const headersReales = new Set<string>()
  for (const fila of filas) {
    for (const key of Object.keys(fila)) headersReales.add(key)
  }

  const colMap: Partial<Record<keyof typeof ALIAS_COLUMNAS, string>> = {}

  for (const header of headersReales) {
    const h = normalizarHeader(header)
    for (const [campo, alias] of Object.entries(ALIAS_COLUMNAS)) {
      if (alias.includes(h) && !colMap[campo as keyof typeof ALIAS_COLUMNAS]) {
        colMap[campo as keyof typeof ALIAS_COLUMNAS] = header
      }
    }
  }

  if (!colMap.codigo || !colMap.descripcion) {
    throw new Error(
      "No se encontraron las columnas de Código y Descripción en el archivo. " +
        "Verifica que el Excel tenga esas columnas (o Item/Actividad como alias)."
    )
  }

  return colMap
}

// Palabras que identifican una fila de total/subtotal -- puede venir en
// la columna Código o en la de Descripción, según cómo la haya escrito
// el ingeniero (a veces el Excel original trae "TOTAL PRELIMINARES" en
// una sola celda fusionada que cae en cualquiera de las dos columnas al
// leerla). Se compara sin tildes/mayúsculas, con match exacto o al
// inicio del texto, para no descartar por error un ítem real que solo
// mencione la palabra "total" en su descripción (ej. "revoque total del
// muro").
const PALABRAS_TOTAL = ["total", "subtotal", "sub total", "costo directo", "costo indirecto"]

function normalizarTexto(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
}

function esFilaDeTotal(codigoRaw: string, descripcionRaw: string): boolean {
  for (const texto of [codigoRaw, descripcionRaw]) {
    const t = normalizarTexto(texto)
    if (!t) continue
    if (PALABRAS_TOTAL.some((palabra) => t === palabra || t.startsWith(palabra + " "))) {
      return true
    }
  }
  return false
}

//Convierte los numeros al formato leible por excel
function parsearCantidad(valor: unknown): number {
  if (typeof valor === "number") return valor
  const texto = String(valor).trim()
  if (texto === "") return 0
  // quita puntos de miles y cambia la coma decimal por punto
  const normalizado = texto.replace(/\./g, "").replace(",", ".")
  const numero = Number(normalizado)
  return Number.isNaN(numero) ? 0 : numero
}

function parsearValorTotalOriginal(valor: unknown): number | null {
  if (typeof valor === "number") return valor
  const texto = String(valor ?? "").trim()
  if (texto === "") return null
  const soloNumero = texto.replace(/[^0-9.,-]/g, "")
  if (soloNumero === "") return null
  const normalizado = soloNumero.replace(/\./g, "").replace(",", ".")
  const numero = Number(normalizado)
  return Number.isNaN(numero) ? null : numero
}

// Se lanza cuando alguna fila trae un código en un formato no
// reconocido -- se corta toda la importación (nada se agrega al
// presupuesto) y se muestra este mensaje con el detalle de las filas
// problemáticas, para que el ingeniero corrija el Excel y vuelva a subir.


//ACTUALMENTE NO SE MUESTRA, ENTONCES NO QUIERO QUE CAIGA SILENCIOSAMENTE
class ErrorFilasInvalidas extends Error {
  constructor(detalles: string[]) {
    super(
      `El archivo tiene ${detalles.length} fila(s) con un código que no se pudo interpretar. ` +
        `Corrige el Excel y vuelve a subirlo:\n` +
        detalles.join("\n")
    )
    this.name = "ErrorFilasInvalidas"
  }
}

function procesarOrdenPresupuesto(data: Record<string, unknown>[]): ItemPresupuesto[] {
  const colMap = detectarColumnas(data)
  const stackIds: string[] = [] // stack de UUIDs -- así el padreId es un UUID real
  const stackCodigos = nuevoStackNiveles() // stack de códigos de texto, para resolver el patrón B (dígitos seguidos) por contexto -- ver lib/calcular-nivel.ts
  const items: ItemPresupuesto[] = []
  const filasInvalidas: string[] = []

  data.forEach((fila, index) => {
    const codigoRaw = String(fila[colMap.codigo!] ?? "").trim()
    const descripcionRaw = String(fila[colMap.descripcion!] ?? "").trim()

    if (!codigoRaw && !descripcionRaw) return // fila completamente vacía, se ignora

    // Fila de TOTAL/SUBTOTAL -- puede venir en cualquiera de las dos
    // columnas (Código o Descripción). Se ignora en silencio, no corta
    // la importación.
    if (esFilaDeTotal(codigoRaw, descripcionRaw)) return

    // Fila sin código pero CON descripción y que no es un total
    // reconocido -- también se ignora en silencio (mismo criterio que
    // antes: sin código no hay nada que ubicar en la jerarquía).
    if (!codigoRaw) return

    const resultado = calcularNivelDesdeCodigo(codigoRaw, stackCodigos)
    if (!resultado.ok) {
      const numeroFila = index + 2 // +1 por índice 0-based, +1 por la fila de encabezado
      filasInvalidas.push(
        `  Fila ${numeroFila}: "${codigoRaw}" — ${mensajeError(resultado.razon)}` +
          (descripcionRaw ? ` (${descripcionRaw})` : "")
      )
      return
    }

    const nivel = resultado.nivel
    while (stackIds.length >= nivel) {
      stackIds.pop()
    }
    const padreId = nivel === 1 ? null : stackIds[nivel - 2] ?? null
    const id = crypto.randomUUID()
    stackIds.push(id)

    const unidad = colMap.unidad ? fila[colMap.unidad] : null
    const cantidadRaw = colMap.cantidad ? fila[colMap.cantidad] : null
    const cantidad =
      cantidadRaw === null || cantidadRaw === undefined || String(cantidadRaw).trim() === ""
        ? 0 // cantidad faltante -> 0, se completa manualmente después
        : parsearCantidad(cantidadRaw)

    // precioOriginal: snapshot del "Valor total" que trae el Excel --
    // no participa en ningún cálculo de la app (el valor real siempre
    // sale del APU), solo se guarda para comparar después y disparar la
    // alerta si el valor calculado se pasa del original. Si la columna
    // no existe o la celda viene vacía, queda null a propósito (no 0 --
    // 0 significaría "el original es cero", que es un dato distinto de
    // "no sabemos el original").
    const valorTotalRaw = colMap.valorTotal ? fila[colMap.valorTotal] : null
    const precioOriginal = parsearValorTotalOriginal(valorTotalRaw)

    items.push({
      id,
      padreId,
      nivel,
      codigo: codigoRaw,
      descripcion: descripcionRaw,
      cantidad,
      unidad:
        unidad !== null && unidad !== undefined && String(unidad).trim() !== ""
          ? String(unidad).trim()
          : null,
      precioOriginal,
      guardado: false,
    })
  })

  if (filasInvalidas.length > 0) {
    throw new ErrorFilasInvalidas(filasInvalidas)
  }

  return items
}

function encontrarHojaApu(workbook: XLSX.WorkBook): string | null {
  return (
    workbook.SheetNames.find((n) => n.trim().toUpperCase() === "APU") ?? null
  )
}

// Devuelve tanto los ítems de la hoja 1 (como antes) como los bloques de
// la hoja 2 "APU" si el archivo la trae -- si no la trae, bloques queda
// vacío y todo el resto del flujo (guardar, etc.) se comporta EXACTAMENTE
// igual que antes de este cambio.
async function procesarPresupuesto(
  documentoPresupuesto: File
): Promise<{ items: ItemPresupuesto[]; bloquesApu: BloqueApu[] }> {
  const buffer = await documentoPresupuesto.arrayBuffer()
  const workbook = XLSX.read(buffer)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  const items = procesarOrdenPresupuesto(data)

  const nombreHojaApu = encontrarHojaApu(workbook)
  if (!nombreHojaApu) {
    return { items, bloquesApu: [] }
  }

  const { bloques, erroresEstructura } = parseApuSheet(workbook, nombreHojaApu)
  if (erroresEstructura.length > 0) {
    throw new Error(
      `La hoja "${nombreHojaApu}" tiene ${erroresEstructura.length} error(es) de estructura:\n` +
        erroresEstructura.join("\n")
    )
  }

  return { items, bloquesApu: bloques }
}

// ---------------------------------------------------------------------------
// Estilos reutilizables para la exportación a Excel
// ---------------------------------------------------------------------------

const ESTILO_ENCABEZADO = {
  font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
  fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1F4E78" } },
  alignment: { vertical: "middle" as const, horizontal: "center" as const, wrapText: true },
}

const ESTILO_TITULO_APU = {
  font: { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
  fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF2E75B6" } },
  alignment: { vertical: "middle" as const, wrapText: true },
}

const ESTILO_SUBENCABEZADO = {
  font: { bold: true, size: 10 },
  fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD9E2F3" } },
  alignment: { vertical: "middle" as const, horizontal: "center" as const, wrapText: true },
}

const ESTILO_TOTAL = {
  font: { bold: true, size: 10 },
  fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F2F2" } },
}

const BORDE_FINO = {
  top: { style: "thin" as const, color: { argb: "FFD9D9D9" } },
  left: { style: "thin" as const, color: { argb: "FFD9D9D9" } },
  bottom: { style: "thin" as const, color: { argb: "FFD9D9D9" } },
  right: { style: "thin" as const, color: { argb: "FFD9D9D9" } },
}

const FORMATO_MONEDA = '$ #,##0;[Red]-$ #,##0'
const FORMATO_CANTIDAD = "#,##0.000"

// ---------------------------------------------------------------------------
// Ruta: /presupuestos
// ---------------------------------------------------------------------------

export default function Presupuestos() {
  const [proyectos, setProyectos] = useState<{ id: string; codigo: string | null; nombre: string }[]>([])
  const [proyectoId, setProyectoId] = useState<string | null>(null)
  const [presupuestoDbId, setPresupuestoDbId] = useState<string | null>(null)
  const [presupuesto, setPresupuesto] = useState<ItemPresupuesto[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [itemApuAbierto, setItemApuAbierto] = useState<ItemPresupuesto | null>(null)
  const [itemResaltadoId, setItemResaltadoId] = useState<string | null>(null)
  const [dialogoAgregarAbierto, setDialogoAgregarAbierto] = useState(false)
  const [exportando, setExportando] = useState(false)

  const [presupuestoExistente, setPresupuestoExistente] = useState<PresupuestoExistente | null>(
    null
  )
  const [cargandoExistente, setCargandoExistente] = useState(false)
  const [cargandoPresupuesto, setCargandoPresupuesto] = useState(false)


  const [versiones, setVersiones] = useState<VersionPresupuesto[]>([])
  const [viendoVersionActual, setViendoVersionActual] = useState(true)
  const [versionViendoId, setVersionViendoId] = useState<string | null>(null)
  const [creandoVersion, setCreandoVersion] = useState(false)
  const [nombreNuevaVersion, setNombreNuevaVersion] = useState("")
  const [estadoPresupuesto, setEstadoPresupuesto] = useState<
    "Borrador" | "En ejecucion" | "Con movimientos"
  >("Borrador")


  const [itemsPendientesDeVersion, setItemsPendientesDeVersion] = useState<
    ItemPresupuesto[] | null
  >(null)
  const [nombreVersionDesdeImport, setNombreVersionDesdeImport] = useState("")
  const [versionPendienteDesdeImport, setVersionPendienteDesdeImport] = useState<{
    nombre: string
  } | null>(null)
  // Bloques de la hoja APU que vinieron junto con itemsPendientesDeVersion
  // -- se guardan aparte porque el flujo de "nombre de versión" es un paso
  // intermedio antes de arrancar el flujo de recomendaciones de APU.
  const [bloquesApuPendientesDeVersion, setBloquesApuPendientesDeVersion] = useState<BloqueApu[]>(
    []
  )

  const [guardandoImportApu, setGuardandoImportApu] = useState(false)

  const [progresoImport, setProgresoImport] = useState<{ procesados: number; total: number } | null>(
    null
  )

  const [estadosApu, setEstadosApu] = useState<Record<string, EstadoApuItem>>({})
  const [motivosRechazo, setMotivosRechazo] = useState<Record<string, MotivoRechazoPorItem[]>>({})
  const [dialogoRevisionAbierto, setDialogoRevisionAbierto] = useState(false)
  const [itemIdsParaRevisar, setItemIdsParaRevisar] = useState<string[]>([])
  const [modoGeneralRevision, setModoGeneralRevision] = useState(false)

  async function refrescarEstadosApu(idsAConsultar: string[]) {
    if (idsAConsultar.length === 0) return
    try {
      const { estados, motivosRechazo: motivos } = await obtenerEstadoApuPorItem(idsAConsultar)
      // OJO con el orden: antes esto borraba la clave y la volvía a
      // agregar (delete + spread) -- en JS eso mueve la clave al FINAL
      // del objeto aunque el valor no haya cambiado. Como
      // idsConAlgoPendiente sale de Object.entries(estadosApu), cada vez
      // que se resolvía algo en el diálogo (que refresca TODOS los ids
      // que está mostrando, no solo el que cambió) esto reordenaba todo
      // -- se sentía como que la lista "saltaba" mientras se trabajaba
      // en ella. Ahora se actualiza el valor en el lugar (sin borrar
      // primero) para los que siguen -- en JS eso SÍ conserva la
      // posición original. Solo las claves genuinamente NUEVAS quedan
      // al final, que es justo lo que se quería.
      setEstadosApu((prev) => {
        const nuevo = { ...prev }
        for (const id of idsAConsultar) {
          if (id in estados) nuevo[id] = estados[id]
          else delete nuevo[id] // ya no tiene nada pendiente/rechazado -- se saca de verdad
        }
        return nuevo
      })
      setMotivosRechazo((prev) => {
        const nuevo = { ...prev }
        for (const id of idsAConsultar) {
          if (id in motivos) nuevo[id] = motivos[id]
          else delete nuevo[id]
        }
        return nuevo
      })
    } catch (e) {
      console.error("No se pudo cargar el estado de APU de los ítems:", e)
    }
  }


  //Se encarga de que la actualizacion sea en tiempo real, no cuando
  // se recarga la pagina
  async function refrescarValores(idsAConsultar: string[]) {
    if (idsAConsultar.length === 0) return
    try {
      const valores = await obtenerValoresItems(idsAConsultar)
      setPresupuesto((prev) =>
        prev.map((item) => {
          const nuevo = valores[item.id]
          if (!nuevo) return item
          return { ...item, valorUnitario: nuevo.valorUnitario, valorTotal: nuevo.valorTotal, apuId: nuevo.apuId }
        })
      )
    } catch (e) {
      console.error("No se pudieron cargar los valores actualizados:", e)
    }
  }

  // Se llama junto a refrescarEstadosApu en los dos lugares donde el
  // diálogo de revisión avisa que algo cambió (onCambio, y al cerrar) --
  // ver la nota de arriba, colores y precio son dos consultas separadas
  // a propósito (una es liviana, la otra no hace falta pedirla tan
  // seguido), pero SIEMPRE deben refrescarse juntas para no repetir este
  // mismo bug.
  async function refrescarEstadosYValores(idsAConsultar: string[]) {
    await Promise.all([refrescarEstadosApu(idsAConsultar), refrescarValores(idsAConsultar)])
  }

  // Ítems con algo sin terminar en TODO el presupuesto actual (no solo
  // el último import) -- alimenta el banner de "N pendientes -- Revisar"
  // y el botón de reabrir el diálogo sobre todo lo que falte.
  const idsConAlgoPendiente = Object.entries(estadosApu)
    .filter(([, estado]) => estado !== "listo")
    .map(([id]) => id)

  // Mientras el diálogo esté abierto en modo general, su lista de ítems
  // se mantiene sincronizada con `idsConAlgoPendiente` -- así, si una
  // tanda que sigue procesando en el fondo deja algo nuevo pendiente,
  // aparece solo en el diálogo que ya está abierto, sin que el usuario
  // tenga que cerrarlo y volver a abrirlo. El diálogo mismo (ver
  // revision-apu-dialog.tsx) NO resetea las elecciones ya hechas cuando
  // esto pasa -- solo cuando se abre de nuevo desde cero.
  useEffect(() => {
    if (!dialogoRevisionAbierto || !modoGeneralRevision) return
    setItemIdsParaRevisar(idsConAlgoPendiente)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogoRevisionAbierto, modoGeneralRevision, idsConAlgoPendiente.join(",")])

  function handleAbrirRevisionGeneral() {
    setModoGeneralRevision(true)
    setItemIdsParaRevisar(idsConAlgoPendiente)
    setDialogoRevisionAbierto(true)
  }

  function handleAbrirRevisionDeItem(itemId: string) {
    setModoGeneralRevision(false)
    setItemIdsParaRevisar([itemId])
    setDialogoRevisionAbierto(true)
  }

  function handleCerrarDialogoRevision() {
    setDialogoRevisionAbierto(false)
    refrescarEstadosYValores(itemIdsParaRevisar)
  }

  useEffect(() => {
    if (!presupuestoDbId) {
      setVersiones([])
      setVersionViendoId(null)
      return
    }
    listarVersiones(presupuestoDbId)
      .then((lista: VersionPresupuesto[]) => {
        setVersiones(lista)
        setVersionViendoId(lista.find((v: VersionPresupuesto) => v.esActual)?.id ?? null)
      })
      .catch((e) => console.error("No se pudieron cargar las versiones:", e))
  }, [presupuestoDbId])

  async function handleVerVersion(versionId: string) {
    setCargandoPresupuesto(true)
    setError(null)
    try {
      const { items, estados, motivosRechazo: motivos } = await cargarVersionConEstadoApu(versionId)
      setPresupuesto(items)
      setEstadosApu(estados)
      setMotivosRechazo(motivos)
      setVersionViendoId(versionId)
      setViendoVersionActual(versiones.find((v: VersionPresupuesto) => v.id === versionId)?.esActual ?? false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar esa versión.")
    } finally {
      setCargandoPresupuesto(false)
    }
  }

  async function handleVolverAVersionActual() {
    if (!presupuestoDbId) return
    setCargandoPresupuesto(true)
    setError(null)
    try {
      const { items, estados, motivosRechazo: motivos } = await cargarItemsConEstadoApu(presupuestoDbId)
      setPresupuesto(items)
      setEstadosApu(estados)
      setMotivosRechazo(motivos)
      setVersionViendoId(versiones.find((v: VersionPresupuesto) => v.esActual)?.id ?? null)
      setViendoVersionActual(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la versión actual.")
    } finally {
      setCargandoPresupuesto(false)
    }
  }


  async function handleCrearNuevaVersion() {
    if (!presupuestoDbId || !nombreNuevaVersion.trim()) return
    setCreandoVersion(true)
    setError(null)
    try {
      const nueva = await crearNuevaVersion(presupuestoDbId, nombreNuevaVersion.trim())
      const [{ items, estados, motivosRechazo: motivos }, listaVersiones] = await Promise.all([
        cargarItemsConEstadoApu(presupuestoDbId),
        listarVersiones(presupuestoDbId),
      ])
      setPresupuesto(items)
      setEstadosApu(estados)
      setMotivosRechazo(motivos)
      setVersiones(listaVersiones)
      setVersionViendoId(nueva.id)
      setViendoVersionActual(true)
      setNombreNuevaVersion("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear la nueva versión.")
    } finally {
      setCreandoVersion(false)
    }
  }

  async function handleCambiarEstado(nuevoEstado: "Borrador" | "En ejecucion" | "Con movimientos") {
    if (!presupuestoDbId) return
    setEstadoPresupuesto(nuevoEstado) // optimista -- se revierte si falla
    try {
      await actualizarEstadoPresupuesto(presupuestoDbId, nuevoEstado)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar el estado.")
    }
  }

  useEffect(() => {
    verProyectos()
      .then(setProyectos)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos")
      )
  }, [])

  // Al elegir proyecto, se resuelve su ÚNICO presupuesto (o null) -- ya
  // no hay lista que traer ni "aviso descartado" que rastrear.
    useEffect(() => {
    setPresupuestoExistente(null)
    setPresupuesto([])
    setPresupuestoDbId(null)

    if (!proyectoId) return

    setCargandoExistente(true)
    verPresupuestoDeProyecto(proyectoId)
      .then(async (existente) => {
        setPresupuestoExistente(existente)
        if (existente) {
          await handleContinuarPresupuesto(existente)
        }
      })
      .catch((e) => console.error("No se pudo consultar el presupuesto existente:", e))
      .finally(() => setCargandoExistente(false))
  }, [proyectoId])

  async function handleContinuarPresupuesto(existente: PresupuestoExistente) {
    setCargandoPresupuesto(true)
    setError(null)
    try {
      const { items, estados, motivosRechazo: motivos } = await cargarItemsConEstadoApu(existente.id)
      setPresupuesto(items)
      setEstadosApu(estados)
      setMotivosRechazo(motivos)
      setPresupuestoDbId(existente.id)
      setViendoVersionActual(true)
      if (
        existente.estado === "Borrador" ||
        existente.estado === "En ejecucion" ||
        existente.estado === "Con movimientos"
      ) {
        setEstadoPresupuesto(existente.estado)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el presupuesto.")
    } finally {
      setCargandoPresupuesto(false)
    }
  }

  // -------------------------------------------------------------------
  // Matching + guardado ahora es UNA sola llamada de servidor
  // (matchearYGuardarImportApu) -- antes eran dos pasos separados, y el
  // segundo mandaba los candidatos de matching de vuelta al servidor
  // dentro del body, lo que con presupuestos grandes (700+ ítems) pasaba
  // el límite de 1 MB de los Server Actions de Next.js ("Body exceeded
  // 1 MB limit") y tronaba a mitad de guardado. Ver la nota larga en
  // actions.ts.
  //
  // Los ítems NO se aplican al estado (`setPresupuesto`) hasta que todo
  // el proceso termine -- por eso la tabla no se ve hasta que está listo
  // (ver el spinner condicionado a guardandoImportApu en el render). Si
  // algo falla ANTES de terminar de guardar (validación de códigos), ahí
  // sí se aplican para no perder el progreso.
  // -------------------------------------------------------------------
  const [bloquesParaReintentar, setBloquesParaReintentar] = useState<BloqueApu[] | null>(null)

  async function iniciarFlujoApu(
    items: ItemPresupuesto[],
    bloques: BloqueApu[],
    modo: "append" | "replace"
  ) {
    const aplicarItemsAlPresupuesto = () => {
      if (modo === "append") setPresupuesto((prev) => [...prev, ...items])
      else setPresupuesto(items)
    }

    if (bloques.length === 0) {
      aplicarItemsAlPresupuesto()
      return
    }

    // Validar ANTES de guardar: el código de cada bloque de la hoja APU
    // debe existir EXACTO en la hoja PRESUPUESTO.
    const codigosPresupuesto = new Set(items.map((i) => i.codigo))
    const codigosSinMatch = bloques
      .map((b) => b.codigoItem)
      .filter((codigo) => !codigosPresupuesto.has(codigo))

    if (codigosSinMatch.length > 0) {
      setError(
        `La hoja APU trae código(s) que no existen tal cual en la hoja PRESUPUESTO: ` +
          `${codigosSinMatch.join(", ")}. Revisa que el Código sea IDÉNTICO en las dos hojas ` +
          `(ej. "1.1" en una hoja y "1.01" en la otra NO son el mismo código).`
      )
      aplicarItemsAlPresupuesto()
      return
    }

    await guardarPresupuestoConApu(items, bloques, aplicarItemsAlPresupuesto)
  }

  async function guardarPresupuestoConApu(
    items: ItemPresupuesto[],
    bloques: BloqueApu[],
    aplicarItemsAlPresupuesto: () => void
  ) {
    setGuardandoImportApu(true)
    setError(null)
    setBloquesParaReintentar(null)
    setProgresoImport(null)

    const TAMANO_TANDA = 40 // ítems (bloques) por tanda -- balance entre
    // "se actualiza seguido" y "no demasiadas llamadas al servidor"

    try {
      const idPresupuesto = await handleGuardar(items) // items directo -- ver nota en handleGuardar sobre el timing de React
      if (!idPresupuesto) throw new Error("No se pudo guardar el presupuesto.")

      // Se aplican los ítems al estado DE UNA (ya no se espera a que
      // termine todo el matching) -- la tabla se ve desde ya, sin
      // colores todavía, y se van pintando tanda por tanda. Así se
      // puede empezar a revisar lo que ya está listo mientras el resto
      // sigue procesando en el fondo -- ya no hay que esperar los 715
      // ítems de una sola vez.
      aplicarItemsAlPresupuesto()

      const idPorCodigo = Object.fromEntries(items.map((i) => [i.codigo, i.id]))
      const loteImportId = crypto.randomUUID()

      for (let i = 0; i < bloques.length; i += TAMANO_TANDA) {
        const tanda = bloques.slice(i, i + TAMANO_TANDA)
        const idPorCodigoTanda = Object.fromEntries(
          tanda.map((b) => [b.codigoItem, idPorCodigo[b.codigoItem]])
        )

        try {
          await matchearYGuardarImportApu(loteImportId, idPorCodigoTanda, tanda)
        } catch (e) {
          // se guarda lo que ya se alcanzó a procesar (tandas
          // anteriores) -- el reintento solo repite lo que falta, no
          // todo desde cero.
          const bloquesRestantes = bloques.slice(i)
          setBloquesParaReintentar(bloquesRestantes)
          throw e
        }

        const idsTanda = tanda.map((b) => idPorCodigo[b.codigoItem])
        await refrescarEstadosApu(idsTanda)
        setProgresoImport({ procesados: Math.min(i + TAMANO_TANDA, bloques.length), total: bloques.length })
      }

      // ya no se abre el diálogo de revisión automático al final -- con
      // el procesamiento por tandas, "el final" ya no es un solo
      // momento. El banner de "N pendientes -- Revisar" (que ya existe,
      // reactivo a estadosApu) aparece solo apenas la primera tanda deje
      // algo pendiente, y se puede usar en cualquier momento, incluso
      // con tandas todavía procesando de fondo.

      // recargar de la base al final -- trae valorUnitario/valorTotal
      // recalculados que el estado local no tiene (más simple y
      // confiable que reconstruirlos a mano tanda por tanda).
      const itemsFrescos = await cargarItemsDePresupuesto(idPresupuesto)
      setPresupuesto(itemsFrescos)
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el APU importado.")
      aplicarItemsAlPresupuesto() // por si falló antes de aplicarlos (ej. handleGuardar) -- no se pierde lo que se alcanzó a parsear. Si ya se habían aplicado, llamar de nuevo no hace daño.
    } finally {
      setGuardandoImportApu(false)
      setProgresoImport(null)
    }
  }

  async function handleReintentarMatching() {
    if (!bloquesParaReintentar) return
    const bloques = bloquesParaReintentar
    // Los items ya están aplicados en `presupuesto` desde el primer
    // intento -- se toman de ahí, filtrando a los que trajeron bloque en
    // este import, para no re-agregar nada.
    const codigosDelImport = new Set(bloques.map((b) => b.codigoItem))
    const itemsDelImport = presupuesto.filter((i) => codigosDelImport.has(i.codigo))
    await guardarPresupuestoConApu(itemsDelImport, bloques, () => {})
  }

  async function handleFileSelected(file: File) {
    setError(null)

    let resultado: { items: ItemPresupuesto[]; bloquesApu: BloqueApu[] }
    try {
      resultado = await procesarPresupuesto(file)
    } catch (e) {
      // Incluye tanto ErrorFilasInvalidas (algún código no se pudo
      // interpretar) como cualquier otro error de lectura del archivo, o
      // un error de estructura en la hoja APU -- en todos los casos NO
      // se agrega nada al presupuesto.
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo.")
      return
    }

    // Si el proyecto YA tiene presupuesto, este Excel SIEMPRE es una
    // versión nueva de ESE presupuesto (no puede ser "aparte" -- ya no
    // existe esa opción con la constraint 1:1). Se pide el nombre antes
    // de aplicar.
    if (presupuestoExistente) {
      setItemsPendientesDeVersion(resultado.items)
      setBloquesApuPendientesDeVersion(resultado.bloquesApu)
      return
    }

    await iniciarFlujoApu(resultado.items, resultado.bloquesApu, "append")
  }

  async function handleConfirmarNombreVersion() {
    if (!itemsPendientesDeVersion || !nombreVersionDesdeImport.trim() || !presupuestoExistente)
      return

    setPresupuestoDbId(presupuestoExistente.id)
    setVersionPendienteDesdeImport({ nombre: nombreVersionDesdeImport.trim() })
    setViendoVersionActual(true)

    const items = itemsPendientesDeVersion
    const bloques = bloquesApuPendientesDeVersion

    setItemsPendientesDeVersion(null)
    setBloquesApuPendientesDeVersion([])
    setNombreVersionDesdeImport("")

    await iniciarFlujoApu(items, bloques, "replace")
  }

  function handleAgregarManual(item: ItemPresupuesto) {
    setPresupuesto((prev) => [...prev, item])
  }

  // Elimina un ítem del presupuesto (y sus sub-ítems en cascada, si los
  // tiene). OJO: si el ítem ya estaba guardado en la base de datos
  // (item.guardado === true), esto solo lo quita del estado local -- no
  // borra la fila en Supabase. Si en algún momento hace falta también
  // borrarlo de la base cuando ya está guardado, se puede agregar una
  // server action tipo eliminarItemPresupuesto(id) y llamarla acá.
  function handleEliminarItem(id: string) {
    setPresupuesto((prev) => {
      const idsAEliminar = new Set<string>([id])
      let cambio = true
      while (cambio) {
        cambio = false
        for (const item of prev) {
          if (item.padreId && idsAEliminar.has(item.padreId) && !idsAEliminar.has(item.id)) {
            idsAEliminar.add(item.id)
            cambio = true
          }
        }
      }
      return prev.filter((item) => !idsAEliminar.has(item.id))
    })
  }

  // itemsOverride: cuando se llama justo después de un setPresupuesto()
  // sin esperar a que React re-renderice (ver guardarPresupuestoConApu),
  // el `presupuesto` de este closure todavía puede ser el ESTADO VIEJO
  // -- pasar los ítems directo evita depender del timing de React. El
  // botón normal "Guardar en base de datos" sigue sin pasar nada, y usa
  // el estado tal cual (comportamiento de siempre).
  async function handleGuardar(itemsOverride?: ItemPresupuesto[]): Promise<string | null> {
    if (!proyectoId) return null

    setGuardando(true)
    setError(null)

    try {
      let idPresupuesto = presupuestoDbId

      if (versionPendienteDesdeImport && presupuestoDbId) {
        // "versión nueva del único presupuesto de este proyecto" --
        // primero crear la versión vacía, para que los ítems de este
        // Excel caigan ahí y no se mezclen con lo que ya hubiera en la
        // versión actual (ver crearVersionVacia en actions.ts).
        await crearVersionVacia(presupuestoDbId, versionPendienteDesdeImport.nombre)
        idPresupuesto = presupuestoDbId
        setVersionPendienteDesdeImport(null)
      } else if (!idPresupuesto) {
        const proyecto = proyectos.find((p) => p.id === proyectoId)
        const nombre = `Presupuesto ${proyecto?.nombre ?? ""} — ${new Date().toLocaleDateString("es-CO")}`
        const nuevo = await crearPresupuesto(proyectoId, nombre)
        idPresupuesto = nuevo.id
        setPresupuestoDbId(nuevo.id)
      }

      if (!idPresupuesto) {
        throw new Error("No se pudo crear o encontrar el presupuesto.")
      }

      const itemsNuevos = (itemsOverride ?? presupuesto).filter((i) => !i.guardado)

      if (itemsNuevos.length === 0) {
        setGuardando(false)
        return idPresupuesto
      }

      await AñadirItemPresuouesto(idPresupuesto, itemsNuevos)

      const idsGuardados = new Set(itemsNuevos.map((i) => i.id))
      setPresupuesto((prev) =>
        prev.map((i) => (idsGuardados.has(i.id) ? { ...i, guardado: true } : i))
      )

      // se acaba de crear una versión (nueva de import, o "inicial" la
      // primera vez que se guarda algo) -- refrescar la lista para que el
      // selector de versión la muestre de una vez.
      const listaVersiones: VersionPresupuesto[] = await listarVersiones(idPresupuesto)
      setVersiones(listaVersiones)
      setVersionViendoId(listaVersiones.find((v: VersionPresupuesto) => v.esActual)?.id ?? null)

      const itemsConApuPendiente = itemsNuevos.filter((i) => i.apuId)
      for (const item of itemsConApuPendiente) {
        try {
          const { valorUnitario, valorTotal } = await recalcularValorItemDesdeApu(item.id)
          setPresupuesto((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, valorUnitario, valorTotal } : i))
          )
        } catch (e) {
          console.error(`No se pudo recalcular el valor del ítem ${item.id}:`, e)
        }
      }

      return idPresupuesto
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el presupuesto")
      return null
    } finally {
      setGuardando(false)
    }
  }

  // -------------------------------------------------------------------
  async function handleExportar() {
    if (presupuesto.length === 0) return

    setExportando(true)
    setError(null)

    try {
      // =====================================================
      // 1. MATRIZ
      // =====================================================
      const matriz = presupuesto.map((item) => ({
        numero: item.codigo ?? "",
        descripcion: item.descripcion ?? "",
        unidad: item.unidad ?? "",
        costoDirecto: item.valorUnitario != null ? Number(item.valorUnitario) : null,
      }))

      // =====================================================
      // 2. APUS DEL PRESUPUESTO ACTUAL, YA AGRUPADOS POR APU
      //    (antes venían en una tabla plana, una fila por insumo con
      //    el código de APU repetido -- ahora cada APU trae sus
      //    propias líneas adentro, para armar un bloque por APU)
      // =====================================================
      const apuIds = [
        ...new Set(presupuesto.map((item) => item.apuId).filter((id): id is string => Boolean(id))),
      ]
      const apusAgrupados = await obtenerApusParaExportar(apuIds)

      // para dar contexto en cada bloque: qué ítem(s) del presupuesto
      // usan este APU (normalmente uno solo, pero un mismo apu_id
      // puede estar en varios si se compartió a propósito)
      const itemsPorApu = new Map<string, ItemPresupuesto[]>()
      for (const item of presupuesto) {
        if (!item.apuId) continue
        const lista = itemsPorApu.get(item.apuId) ?? []
        lista.push(item)
        itemsPorApu.set(item.apuId, lista)
      }

      // =====================================================
      // 3. LIBRO
      // =====================================================
      const workbook = new ExcelJS.Workbook()
      workbook.creator = "Presupuestos"
      workbook.created = new Date()
      workbook.modified = new Date()

      // =====================================================
      // 4. HOJA MATRIZ
      // =====================================================
      const wsMatriz = workbook.addWorksheet("MATRIZ")
      wsMatriz.columns = [
        { header: "N°", key: "numero", width: 14 },
        { header: "DESCRIPCIÓN", key: "descripcion", width: 75 },
        { header: "UN", key: "unidad", width: 10 },
        { header: "COSTO DIRECTO", key: "costoDirecto", width: 20 },
      ]
      matriz.forEach((fila) => wsMatriz.addRow(fila))

      wsMatriz.getRow(1).height = 28
      wsMatriz.getRow(1).eachCell((cell) => (cell.style = ESTILO_ENCABEZADO))

      wsMatriz.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        row.alignment = { vertical: "middle", wrapText: true }
        row.getCell(1).alignment = { vertical: "middle", horizontal: "center" }
        row.getCell(3).alignment = { vertical: "middle", horizontal: "center" }
        row.getCell(4).alignment = { vertical: "middle", horizontal: "right" }
        row.getCell(4).numFmt = FORMATO_MONEDA
        row.height = 30
      })

      wsMatriz.eachRow((row) => row.eachCell((cell) => (cell.border = BORDE_FINO)))

      if (matriz.length > 0) {
        wsMatriz.autoFilter = { from: "A1", to: `D${matriz.length + 1}` }
      }
      wsMatriz.views = [{ state: "frozen", ySplit: 1 }]

      // =====================================================
      // 5. HOJA APU -- un bloque/tabla POR CADA APU (con su propio
      //    encabezado, sus líneas, y su PRECIO UNITARIO al final),
      //    en vez de una tabla plana con todo mezclado.
      // =====================================================
      const wsApu = workbook.addWorksheet("APU")
      wsApu.columns = [
        { key: "a", width: 16 },
        { key: "b", width: 55 },
        { key: "c", width: 12 },
        { key: "d", width: 14 },
        { key: "e", width: 18 },
        { key: "f", width: 18 },
      ]

      const apusOrdenados = [...apusAgrupados].sort((a, b) =>
        String(a.codigoApu ?? "").localeCompare(String(b.codigoApu ?? ""), "es", { numeric: true })
      )

      for (const apu of apusOrdenados) {
        const itemsQueLoUsan = itemsPorApu.get(apu.apuId) ?? []
        const codigosItems = itemsQueLoUsan.map((i) => i.codigo).join(", ")

        // --- título del bloque: código + descripción + qué ítem(s) del
        // presupuesto lo usan ---
        const filaTitulo = wsApu.addRow([
          `APU ${apu.codigoApu ?? ""}`,
          apu.descripcionApu ?? "",
          "",
          "",
          "",
          codigosItems ? `Ítem(s): ${codigosItems}` : "",
        ])
        wsApu.mergeCells(filaTitulo.number, 2, filaTitulo.number, 4)
        filaTitulo.eachCell((cell) => (cell.style = ESTILO_TITULO_APU))
        filaTitulo.height = 22

        // --- mini-encabezado de la tabla de insumos de este APU ---
        const filaEncabezado = wsApu.addRow([
          "Tipo",
          "Descripción del insumo",
          "Código",
          "Unidad",
          "Cantidad",
          "Vr. Unitario",
        ])
        filaEncabezado.getCell(7).value = "Parcial"
        filaEncabezado.eachCell((cell) => (cell.style = ESTILO_SUBENCABEZADO))
        filaEncabezado.height = 18

        // --- líneas del APU ---
        for (const linea of apu.lineas) {
          const fila = wsApu.addRow([
            linea.tipo ?? "",
            linea.descripcionInsumo,
            linea.codigoInsumo ?? "",
            linea.unidad ?? "",
            linea.cantidad,
            linea.valorUnitario,
            linea.parcial,
          ])
          fila.getCell(1).alignment = { horizontal: "center" }
          fila.getCell(3).alignment = { horizontal: "center" }
          fila.getCell(4).alignment = { horizontal: "center" }
          fila.getCell(5).alignment = { horizontal: "right" }
          fila.getCell(5).numFmt = FORMATO_CANTIDAD
          fila.getCell(6).alignment = { horizontal: "right" }
          fila.getCell(6).numFmt = FORMATO_MONEDA
          fila.getCell(7).alignment = { horizontal: "right" }
          fila.getCell(7).numFmt = FORMATO_MONEDA
          fila.eachCell((cell) => (cell.border = BORDE_FINO))
        }

        if (apu.lineas.length === 0) {
          const filaVacia = wsApu.addRow(["", "Este APU no tiene insumos.", "", "", "", "", ""])
          filaVacia.font = { italic: true, color: { argb: "FF888888" } }
        }

        // --- total del APU, visible de una vez al final del bloque ---
        const filaTotal = wsApu.addRow(["", "PRECIO UNITARIO", "", "", "", "", apu.precioUnitario])
        wsApu.mergeCells(filaTotal.number, 2, filaTotal.number, 6)
        filaTotal.eachCell((cell) => (cell.style = ESTILO_TOTAL))
        filaTotal.getCell(7).alignment = { horizontal: "right" }
        filaTotal.getCell(7).numFmt = FORMATO_MONEDA
        filaTotal.eachCell((cell) => (cell.border = BORDE_FINO))

        // fila en blanco separando este bloque del siguiente APU
        wsApu.addRow([])
      }

      // =====================================================
      // 6. NOMBRE DEL ARCHIVO Y DESCARGA
      // =====================================================
      const nombreProyecto = proyectos.find((p) => p.id === proyectoId)?.nombre ?? "proyecto"
      const nombreArchivo = `presupuesto-${nombreProyecto}`
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .toLowerCase()

      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `${nombreArchivo}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (e) {
      console.error("Error exportando presupuesto:", e)
      setError(e instanceof Error ? e.message : "No se pudo exportar el presupuesto.")
    } finally {
      setExportando(false)
    }
  }

  const hayCambiosSinGuardar = presupuesto.some((i) => !i.guardado)

  // Al clickear un nodo en el árbol de navegación (PresupuestoTree): hace
  // scroll hasta esa fila en la tabla principal y la resalta un momento
  // para que sea fácil ubicarla entre cientos de filas. Ver id={`item-...`}
  // en presupuesto-table.tsx.
  function handleSeleccionarEnArbol(id: string) {
    setItemResaltadoId(id)
    document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
    setTimeout(() => {
      setItemResaltadoId((actual) => (actual === id ? null : actual))
    }, 2000)
  }

  // Ítem YA guardado en la base -- necesita su propio round-trip (ver
  // comentario en actualizarCantidadPresupuestoItem, actions.ts) en vez de
  // solo tocar el estado local como con los ítems sin guardar.
  async function handleActualizarCantidadGuardada(id: string, nuevaCantidad: number) {
    try {
      const { cantidad, valorTotal } = await actualizarCantidadPresupuestoItem(
        id,
        nuevaCantidad
      )
      setPresupuesto((prev) =>
        prev.map((item) => (item.id === id ? { ...item, cantidad, valorTotal } : item))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar la cantidad.")
    }
  }

  // Valor total del presupuesto: suma de valorTotal de los ítems que
  // realmente tienen costo (los capítulos/subcapítulos de estructura no
  // traen cantidad/valorUnitario propios, así que su valorTotal queda
  // null y no se duplica al sumar -- solo entran los ítems con APU).
  const valorTotalPresupuesto = presupuesto.reduce(
    (acc, item) => acc + (item.valorTotal ?? 0),
    0
  )

  return (
    <>
      <header className="flex h-16 items-center gap-4 border-b px-6">
        <SidebarTrigger />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nuevo presupuesto</h1>
          <p className="text-sm text-muted-foreground">
            Seleccione un proyecto e importe el presupuesto.
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-6 p-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Select value={proyectoId} onValueChange={setProyectoId}>
              <SelectTrigger className="h-10 w-64 rounded-sm">
                <SelectValue placeholder="Selecciona un proyecto" />
              </SelectTrigger>
              <SelectContent>
                {proyectos.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <FileUpload
              accept=".xlsx,.xls"
              onFileSelected={handleFileSelected}
              disabled={!proyectoId || guardandoImportApu}
              className="flex-1"
            />

            <ExportTemplateButton
              columnas={["Código", "Descripción", "Unidad", "Cantidad"]}
              nombreArchivo="plantilla-presupuesto.xlsx"
              nombreHoja="Presupuesto"
              filasEjemplo={[
                ["1", "Preliminares", "", ""],
                ["1.1", "Cerramiento o cerca", "m", "11720"],
              ]}
              etiqueta="Plantilla"
            />
          </div>

          {!proyectoId && (
            <p className="text-xs text-muted-foreground">
              Seleccione un proyecto para habilitar la importación.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Use puntos (1, 1.1, 4.1.1.1) o dígitos
            seguidos (1, 101, 10101) para numerar los items del presupuesto. Si el archivo trae una
            hoja &ldquo;APU&rdquo;, se ofrece armar los APU automáticamente al subirlo.
          </p>
        </div>

        {/* Excel subido sobre un proyecto que YA tiene presupuesto: solo
            se pide el nombre de la versión nueva -- ya no hay que elegir
            "a cuál" ni preguntar si es "aparte" (un proyecto no puede
            tener más de un presupuesto). */}
        {itemsPendientesDeVersion && presupuestoExistente && (
          <div className="space-y-3 rounded-lg border border-sky-300 bg-sky-50 p-4">
            <p className="text-sm font-medium text-sky-900">
              Este Excel trae {itemsPendientesDeVersion.length} ítems y se guardará como una
              versión nueva de &ldquo;{presupuestoExistente.nombre}&rdquo;.
            </p>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label className="text-xs text-sky-800">Nombre de la versión</label>
                <input
                  type="text"
                  placeholder='ej. "Cambio de alcance agosto"'
                  value={nombreVersionDesdeImport}
                  onChange={(e) => setNombreVersionDesdeImport(e.target.value)}
                  className="h-9 w-56 rounded border bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <Button
                size="sm"
                onClick={handleConfirmarNombreVersion}
                disabled={!nombreVersionDesdeImport.trim()}
              >
                Crear versión
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setItemsPendientesDeVersion(null)
                  setBloquesApuPendientesDeVersion([])
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {proyectoId && cargandoExistente && (
          <p className="text-xs text-muted-foreground">Cargando presupuesto…</p>
        )}

        {guardandoImportApu && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3">
            <span className="animate-spin inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
            <p className="text-sm text-muted-foreground">
              {progresoImport
                ? `Procesando insumos… ${progresoImport.procesados} de ${progresoImport.total} ítems. Ya puedes revisar los que estén en amarillo/rojo abajo mientras el resto termina.`
                : "Leyendo el Excel y guardando los ítems…"}
            </p>
          </div>
        )}

        {!guardandoImportApu && error && bloquesParaReintentar && (
          <div className="space-y-2 rounded-lg border border-destructive/50 p-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={handleReintentarMatching}>
              Reintentar
            </Button>
          </div>
        )}

        {idsConAlgoPendiente.length > 0 && !dialogoRevisionAbierto && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900">
              {idsConAlgoPendiente.length} ítem(s) todavía tienen insumos sin resolver o rechazados
              -- se ven en amarillo/rojo en la tabla.
            </p>
            <Button size="sm" onClick={handleAbrirRevisionGeneral}>
              Revisar pendientes
            </Button>
          </div>
        )}

        {proyectoId && viendoVersionActual && (
          <div>
            <Button variant="outline" onClick={() => setDialogoAgregarAbierto(true)}>
              + Agregar ítem manual
            </Button>
          </div>
        )}

        {presupuesto.length > 0 && (
          <>
            {presupuestoDbId && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Versión</span>
                  <Select
                    value={versionViendoId ?? ""}
                    onValueChange={(id) => id && handleVerVersion(id)}
                    disabled={cargandoPresupuesto}
                  >
                    <SelectTrigger className="h-8 w-52 text-xs">
                      <SelectValue placeholder="Versión..." />
                    </SelectTrigger>
                    <SelectContent>
                      {versiones.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          v{v.numero} — {v.nombre}
                          {v.esActual ? " (actual)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {viendoVersionActual ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="Nombre de la nueva versión..."
                      value={nombreNuevaVersion}
                      onChange={(e) => setNombreNuevaVersion(e.target.value)}
                      className="h-8 w-52 rounded border px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handleCrearNuevaVersion}
                      disabled={creandoVersion || !nombreNuevaVersion.trim()}
                    >
                      {creandoVersion ? "Creando..." : "+ Nueva versión"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 rounded bg-amber-50 px-2.5 py-1">
                    <span className="text-xs text-amber-800">
                      Viendo una versión anterior — solo lectura
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs"
                      onClick={handleVolverAVersionActual}
                    >
                      Volver a la actual
                    </Button>
                  </div>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Estado</span>
                  <Select
                    value={estadoPresupuesto}
                    onValueChange={(v) =>
                      handleCambiarEstado(v as "Borrador" | "En ejecucion" | "Con movimientos")
                    }
                  >
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Borrador">Borrador</SelectItem>
                      <SelectItem value="En ejecucion">En ejecución</SelectItem>
                      <SelectItem value="Con movimientos">Con movimientos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 rounded-lg bg-gradient-to-r from-primary/90 to-primary px-6 py-4 text-primary-foreground">              <div>
                <p className="text-sm font-medium text-teal-50">Valor presupuesto</p>
                <p className="text-3xl font-semibold tracking-tight">
                  {formatoCOP(valorTotalPresupuesto)}
                </p>
              </div>
              {presupuestoDbId && (
                <a
                  href={`/presupuestos/graficas?presupuestoId=${presupuestoDbId}`}
                  className="ml-auto rounded-md bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25"
                >
                  Ver gráficas →
                </a>
              )}
            </div>

            <p className="text-sm text-muted-foreground">
              
              {presupuesto.some((i) => i.pendienteAprobacion) &&
                ` · ${presupuesto.filter((i) => i.pendienteAprobacion).length} pendientes de aprobación`}
              {"  Revisar y editar antes de guardar"}
            </p>

            <div className="flex items-start gap-4">
              <PresupuestoTree
                data={presupuesto}
                onSeleccionar={handleSeleccionarEnArbol}
                idSeleccionado={itemResaltadoId}
              />

              <div className="min-w-0 flex-1 space-y-4">
                <PresupuestoTable
                  data={presupuesto}
                  onChange={setPresupuesto}
                  onEditarApu={viendoVersionActual ? setItemApuAbierto : undefined}
                  onActualizarCantidadGuardada={
                    viendoVersionActual ? handleActualizarCantidadGuardada : undefined
                  }
                  onEliminarItem={viendoVersionActual ? handleEliminarItem : undefined}
                  idResaltado={itemResaltadoId}
                  soloLectura={!viendoVersionActual}
                  estadosApu={estadosApu}
                  motivosRechazo={motivosRechazo}
                  onRevisarItem={handleAbrirRevisionDeItem}
                />

                {error && (
                  <p className="whitespace-pre-line text-sm text-destructive">{error}</p>
                )}

                <div className="flex items-center justify-end gap-3 border-t pt-4">
                  {!hayCambiosSinGuardar && idsConAlgoPendiente.length === 0 && (
                    <p className="mr-auto text-xs text-muted-foreground">
                      Cantidad y APU de ítems ya guardados se guardan solos, apenas
                      los editas -- este botón es solo para ítems nuevos (importados
                      o agregados a mano).
                    </p>
                  )}
                  {idsConAlgoPendiente.length > 0 && (
                    <p className="mr-auto text-xs text-amber-700">
                      {idsConAlgoPendiente.length} ítem(s) todavía no están listos -- aunque ya se
                      guardaron en la base, faltan insumos por aprobar. Usa "Revisar pendientes"
                      arriba.
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPresupuesto([])
                      setPresupuestoDbId(null)
                      setViendoVersionActual(true)
                      setEstadoPresupuesto("Borrador")
                      if (presupuestoDbId) {
                        EliminarPresupuesto(presupuestoDbId)
                      }
                    }}
                    disabled={guardando}
                  >
                    Descartar y cargar otro
                  </Button>
                  <Button
                    onClick={() => handleGuardar()}
                    disabled={guardando || !hayCambiosSinGuardar || idsConAlgoPendiente.length > 0}
                    title={
                      idsConAlgoPendiente.length > 0
                        ? "Ya se guardó en la base, pero todavía faltan insumos por aprobar -- este botón no lo va a decir 'guardado' hasta que estén resueltos."
                        : undefined
                    }
                  >
                    {guardando
                      ? "Guardando..."
                      : idsConAlgoPendiente.length > 0
                        ? `Faltan ${idsConAlgoPendiente.length} por aprobar`
                        : hayCambiosSinGuardar
                          ? "Guardar en base de datos"
                          : "Todo guardado"}
                  </Button>

                  <Button variant="default" onClick={handleExportar} disabled={exportando}>
                    {exportando ? "Exportando..." : "Exportar"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {itemApuAbierto && (
        <ApuEditorDialog
          open={!!itemApuAbierto}
          onOpenChange={(abierto) => {
            if (!abierto) setItemApuAbierto(null)
          }}
          presupuestoItemId={itemApuAbierto.id}
          codigo={itemApuAbierto.codigo}
          descripcion={itemApuAbierto.descripcion}
          guardado={
            presupuesto.find((i) => i.id === itemApuAbierto.id)?.guardado ??
            itemApuAbierto.guardado
          }
          apuIdPendiente={presupuesto.find((i) => i.id === itemApuAbierto.id)?.apuId}
          onApuIdPendienteCreado={(apuId) => {
            setPresupuesto((prev) =>
              prev.map((i) => (i.id === itemApuAbierto.id ? { ...i, apuId } : i))
            )
          }}
          onValorActualizado={(valorUnitario, valorTotal) => {
          setPresupuesto((prev) =>
            prev.map((i) => {
              if (i.id !== itemApuAbierto.id) return i
              const total =
                i.cantidad != null && valorUnitario != null
                  ? i.cantidad * valorUnitario
                  : undefined
              return { ...i, valorUnitario, valorTotal: total }
            })
          )
        }}
        />
      )}

      <AgregarItemManualDialog
        open={dialogoAgregarAbierto}
        onOpenChange={setDialogoAgregarAbierto}
        itemsActuales={presupuesto}
        onAgregar={(item) => {
          handleAgregarManual(item)
          setDialogoAgregarAbierto(false)
        }}
      />

      <RevisionApuDialog
        open={dialogoRevisionAbierto}
        itemIds={itemIdsParaRevisar}
        onCerrar={handleCerrarDialogoRevision}
        onCambio={() => refrescarEstadosYValores(itemIdsParaRevisar)}
      />
    </>
  )
}