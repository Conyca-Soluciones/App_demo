"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { confirmar } from "@/components/ui/confirmar"
import { useRouter } from "next/navigation"
import { ClipboardList, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatearFechaSinHora, hoyColombia, sumarDiasFecha } from "@/lib/fechas"
import { TIPOS_PAGO_OC, tipoPagoParaGuardar, validarTipoPagoOC, type TipoPagoOC } from "@/lib/tipo-pago-oc"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { BuscadorAsync, type OpcionBuscador } from "./buscador-async"
import { TarjetaProveedorOC } from "./tarjeta-proveedor-oc"
import { saldosFavorProveedor } from "@/app/(app)/almacen/ordenes-compra/saldos-actions"
import { saldoSugerido, validarUsoSaldo, type SaldoProveedor } from "@/lib/saldo-favor"
import { CampoTitularCuenta } from "@/components/campo-titular-cuenta"
import { mapTitularCuenta, titularParaGuardar, type TitularCuenta } from "@/lib/titular-cuenta"
import { MetodoPagoOC } from "@/components/metodo-pago-oc"
import {
  pagoOCParaGuardar,
  pagoOCVacio,
  validarPagoOC,
  type CuentasProveedorOC,
  type PagoOCForm,
} from "@/lib/metodo-pago-oc"
import { calcularLinea, calcularTotalesOrden } from "@/lib/ordenes-compra-calculos"
import {
  obtenerPedidosPorId,
  buscarProveedores,
  obtenerProveedorDetalle,
  cuentasProveedorOC,
  crearOrdenCompra,
  modificarOrdenCompra,
  obtenerOrdenParaModificar,
  type OrdenParaModificar,
  type PedidoParaComprar,
  type ProveedorDetalle,
} from "@/app/(app)/almacen/comprar-pedidos/actions"
import { nombreUnidad, unidadesDeCompra } from "@/lib/unidades"
import {
  cantidadPorPresentacion,
  conversionValida,
  maximoPresentaciones,
  presentacionesPara,
} from "@/lib/presentacion-compra"
import { CampoFecha } from "@/components/ui/campo-fecha"
import { CampoSoporte } from "@/components/campo-soporte"
import { createClient } from "@/lib/supabase/client"
import { ETIQUETA_SOPORTE_ORDEN, rutaSoporte, type TipoSoporteOrden } from "@/lib/soportes"

// Valor del desplegable "UM disponible" para la opción normal: la unidad de
// compra del insumo (la del maestro). Cualquier otra es una presentación.
const UM_PROPIA = "__propia__"

// Conversión escrita en pantalla ("1,44" o "50"): número mayor que cero, o null.
function numeroConversion(texto: string): number | null {
  const n = Number(texto.trim().replace(",", "."))
  return texto.trim() && Number.isFinite(n) && n > 0 ? n : null
}

const formatoCantidad = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 2 })

const CLAVE_SELECCION = "compras:seleccion"

// La selección la deja Comprar requisiciones en sessionStorage. Se lee con
// useSyncExternalStore: en el servidor no hay sessionStorage (undefined =
// todavía no se sabe, no se pinta nada).
const sinSuscripcion = () => () => {}
function leerSeleccion(raw: string | null): SeleccionGuardada | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SeleccionGuardada
    if (!parsed.proyectoId || !Array.isArray(parsed.pedidoIds) || parsed.pedidoIds.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

type SeleccionGuardada = { proyectoId: string; pedidoIds: string[] }

type LineaForm = {
  // "UM disponible": "" = la unidad de compra del insumo; si no, la
  // presentación elegida (CAJA, ROLLO...) y entonces `conversion` es
  // 1 presentación = conversion unidades de la requisición.
  umCompra: string
  // conversión: 1 unidad de compra = conversion unidades de la requisición
  conversion: string
  cantidad: string
  precioUnitario: string
  porcentajeDescuento: string
  porcentajeIva: string
}

const formatoMoneda = (n: number) =>
  n.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })

// Sobrecosto: precio más de 10 % por encima del precio promedio de compra del
// insumo (precioPromedio, sin IVA; decisión del usuario 2026-11-08, reemplaza
// el aviso de "3 veces el precio del maestro"). Mismo umbral que la
// notificación a quien aprueba pagos (trg_notificar_precio_sobre_efectivo_oc_item).
const SOBRECOSTO_MAXIMO = 0.1
function alertaPrecio(precio: number, promedio: number | null): string | null {
  if (promedio == null || promedio <= 0 || !Number.isFinite(precio)) return null
  if (precio > promedio * (1 + SOBRECOSTO_MAXIMO)) {
    const pct = Math.round((precio / promedio - 1) * 100)
    return `${pct} % por encima del precio promedio (${formatoMoneda(promedio)})`
  }
  return null
}

async function buscarProveedoresAdaptado(termino: string): Promise<OpcionBuscador[]> {
  const proveedores = await buscarProveedores(termino)
  return proveedores.map((p) => ({
    id: p.id,
    etiqueta: p.nombre,
    subetiqueta: p.idProv ? `ID ${p.idProv}` : null,
  }))
}

// Una línea de la orden como queda en el formulario (al modificarla).
function lineaFormDeOrden(l: OrdenParaModificar["lineas"][number]): LineaForm {
  const pr = l.presentacion
  return {
    umCompra: pr?.umCompra ?? "",
    conversion: String(pr ? pr.conversionCompra : l.factor),
    cantidad: String(pr ? pr.cantidadCompra : l.cantidad),
    precioUnitario: String(pr ? pr.precioCompra : l.precioUnitario),
    porcentajeDescuento: String(l.porcentajeDescuento),
    porcentajeIva: String(l.porcentajeIva),
  }
}

const lineaFormNueva = (p: PedidoParaComprar): LineaForm => ({
  umCompra: "",
  conversion: String(p.factor),
  cantidad: String(p.cantidadPendiente),
  precioUnitario: "",
  porcentajeDescuento: "0",
  porcentajeIva: "0",
})

// puedeEditarProveedor: acción `editar_proveedores` (o Administrador); lo
// calcula la página en el servidor. La base vuelve a exigirlo (RLS).
// ordenId: modificar esa orden (20261231400000) en vez de crear una: se llena
// con lo que tiene, se pueden agregar insumos de sus mismas requisiciones o
// quitarlos, y cambiar precios y proveedor. Al guardar vuelve a quedar por
// aprobar y su pago se reemplaza en Aprobación de pagos.
export function GenerarOCView({
  puedeEditarProveedor = false,
  ordenId,
}: {
  puedeEditarProveedor?: boolean
  ordenId?: string
}) {
  const router = useRouter()
  const modificar = !!ordenId

  const seleccionRaw = useSyncExternalStore(
    sinSuscripcion,
    () => sessionStorage.getItem(CLAVE_SELECCION),
    () => undefined
  )
  const seleccion = useMemo(
    () => (seleccionRaw === undefined ? undefined : leerSeleccion(seleccionRaw)),
    [seleccionRaw]
  )
  const [pedidos, setPedidos] = useState<PedidoParaComprar[]>([])
  // Al modificar: las líneas que quedan en la orden (las demás de sus
  // requisiciones se pueden marcar para agregarlas).
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set())
  const [codigoOrden, setCodigoOrden] = useState<string | null>(null)
  const lineasOrden = modificar ? pedidos.filter((p) => incluidos.has(p.id)) : pedidos
  const [lineas, setLineas] = useState<Record<string, LineaForm>>({})
  const [cargandoPedidos, setCargandoPedidos] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [proveedor, setProveedor] = useState<OpcionBuscador | null>(null)
  // Detalle con el proveedor al que corresponde: el de otro no se muestra y
  // mientras no llegue el del elegido se está cargando.
  const [cargaProveedor, setCargaProveedor] = useState<{ proveedorId: string; detalle: ProveedorDetalle | null } | null>(null)
  const detalleProveedor = proveedor && cargaProveedor?.proveedorId === proveedor.id ? cargaProveedor.detalle : null
  const cargandoProveedor = proveedor !== null && cargaProveedor?.proveedorId !== proveedor.id
  // Saldo a favor del proveedor en la empresa del proyecto (Paquete C, entrega
  // 3). Solo al crear; Compras decide usarlo.
  const [cargaSaldos, setCargaSaldos] = useState<{ proveedorId: string; saldos: SaldoProveedor[] } | null>(null)
  const saldosProveedor = proveedor && cargaSaldos?.proveedorId === proveedor.id ? cargaSaldos.saldos : []
  const saldoDisponible = saldosProveedor.reduce((a, x) => a + x.disponible, 0)
  const [usarSaldo, setUsarSaldo] = useState(false)
  const [valorSaldo, setValorSaldo] = useState("")

  const [sitioEntrega, setSitioEntrega] = useState("")
  const [fechaEntrega, setFechaEntrega] = useState("")
  const [contactoProyecto, setContactoProyecto] = useState("")
  const [condicionesPago, setCondicionesPago] = useState("")
  // Tipo de pago (20261228400000): obligatorio; con crédito, la fecha de pago.
  const [tipoPago, setTipoPago] = useState<TipoPagoOC | null>(null)
  const [fechaCredito, setFechaCredito] = useState("")
  const [observaciones, setObservaciones] = useState("")
  // Soporte obligatorio de la orden (cotización, cuenta de cobro o factura).
  const [tipoSoporte, setTipoSoporte] = useState<TipoSoporteOrden>("cotizacion")
  const [archivoSoporte, setArchivoSoporte] = useState<File | null>(null)
  // Cuenta de otro tercero (quien factura es el proveedor).
  const [titular, setTitular] = useState<TitularCuenta | null>(null)
  // Transferencia o PSE (lib/metodo-pago-oc.ts).
  const [pago, setPago] = useState<PagoOCForm>(pagoOCVacio)
  // Cuentas del proveedor en Terceros, por proveedor + documento (si se
  // corrige el documento en la tarjeta, el tercero puede ser otro).
  const claveCuentas = proveedor && detalleProveedor ? `${proveedor.id}|${detalleProveedor.numeroDocumento ?? ""}` : null
  const [cargaCuentas, setCargaCuentas] = useState<{ clave: string; info: CuentasProveedorOC | null; error: string | null } | null>(null)
  const infoCuentas = cargaCuentas && cargaCuentas.clave === claveCuentas ? cargaCuentas.info : null
  const errorCuentas = cargaCuentas && cargaCuentas.clave === claveCuentas ? cargaCuentas.error : null
  // Anticipo (A&F): % del total y cuándo se paga el saldo.
  const [conAnticipo, setConAnticipo] = useState(false)
  const [anticipoPct, setAnticipoPct] = useState("")
  const [saldoModo, setSaldoModo] = useState<"entrega" | "fecha">("entrega")
  const [saldoFecha, setSaldoFecha] = useState("")

  const [generando, setGenerando] = useState(false)
  const [ordenCreada, setOrdenCreada] = useState<string | null>(null)

  // La selección no cambia mientras se está en la página (cargandoPedidos ya
  // empieza en true).
  useEffect(() => {
    if (modificar || !seleccion) return
    obtenerPedidosPorId(seleccion.pedidoIds)
      .then((data) => {
        setPedidos(data)
        setLineas(Object.fromEntries(data.map((p) => [p.id, lineaFormNueva(p)])))
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudieron cargar las requisiciones."))
      .finally(() => setCargandoPedidos(false))
  }, [seleccion, modificar])

  // Modificar: el formulario se llena con la orden guardada.
  useEffect(() => {
    if (!ordenId) return
    obtenerOrdenParaModificar(ordenId)
      .then((o) => {
        const deOrden = new Map(o.lineas.map((l) => [l.pedidoId, lineaFormDeOrden(l)]))
        setCodigoOrden(o.codigo)
        setPedidos(o.pedidos)
        setIncluidos(new Set(o.lineas.map((l) => l.pedidoId)))
        setLineas(Object.fromEntries(o.pedidos.map((p) => [p.id, deOrden.get(p.id) ?? lineaFormNueva(p)])))
        setProveedor({ id: o.proveedor.id, etiqueta: o.proveedor.nombre, subetiqueta: o.proveedor.idProv ? `ID ${o.proveedor.idProv}` : null })
        setSitioEntrega(o.sitioEntrega ?? "")
        setFechaEntrega(o.fechaEntrega ?? "")
        setContactoProyecto(o.contactoNombre ?? "")
        setCondicionesPago(o.condicionesPago ?? "")
        setObservaciones(o.observaciones ?? "")
        setTipoPago(o.tipoPago)
        setFechaCredito(o.fechaPagoCredito ?? "")
        setConAnticipo(o.anticipoPorcentaje != null)
        setAnticipoPct(o.anticipoPorcentaje != null ? String(o.anticipoPorcentaje) : "")
        setSaldoModo(o.saldoModo ?? "entrega")
        setSaldoFecha(o.saldoFecha ?? "")
        setTitular(mapTitularCuenta(o.titular))
        setPago({
          ...pagoOCVacio(),
          metodo: o.metodoPago,
          cuentaId: o.cuentaTerceroId,
          observaciones: o.pagoObservaciones ?? "",
          titularDistinto: o.pseTitular !== null,
          titularNombre: o.pseTitular?.nombre ?? "",
          titularTipoDocumento: o.pseTitular?.tipoDocumento ?? "",
          titularDocumento: o.pseTitular?.documento ?? "",
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar la orden."))
      .finally(() => setCargandoPedidos(false))
  }, [ordenId])

  function cambiarIncluido(pedidoId: string, incluir: boolean) {
    setIncluidos((prev) => {
      const n = new Set(prev)
      if (incluir) n.add(pedidoId)
      else n.delete(pedidoId)
      return n
    })
  }

  useEffect(() => {
    if (!proveedor) return
    let activo = true
    obtenerProveedorDetalle(proveedor.id)
      .then((d) => activo && setCargaProveedor({ proveedorId: proveedor.id, detalle: d }))
      .catch((e) => {
        if (!activo) return
        setError(e instanceof Error ? e.message : "No se pudo cargar el proveedor.")
        setCargaProveedor({ proveedorId: proveedor.id, detalle: null })
      })
    return () => {
      activo = false
    }
  }, [proveedor])

  useEffect(() => {
    if (modificar || !proveedor || !seleccion?.proyectoId) return
    let activo = true
    saldosFavorProveedor(proveedor.id, seleccion.proyectoId)
      .then((saldos: SaldoProveedor[]) => activo && setCargaSaldos({ proveedorId: proveedor.id, saldos }))
      // Si no se pueden leer, la orden se hace sin saldo (como siempre).
      .catch(() => activo && setCargaSaldos({ proveedorId: proveedor.id, saldos: [] }))
    return () => {
      activo = false
    }
  }, [modificar, proveedor, seleccion?.proyectoId])

  useEffect(() => {
    if (!proveedor || !claveCuentas) return
    let activo = true
    cuentasProveedorOC(proveedor.id)
      .then((info: CuentasProveedorOC) => activo && setCargaCuentas({ clave: claveCuentas, info, error: null }))
      .catch(
        (e) =>
          activo &&
          setCargaCuentas({
            clave: claveCuentas,
            info: null,
            error: e instanceof Error ? e.message : "No se pudieron cargar las cuentas del proveedor.",
          })
      )
    return () => {
      activo = false
    }
  }, [proveedor, claveCuentas])

  function actualizarLinea(pedidoId: string, campo: keyof LineaForm, valor: string) {
    setLineas((prev) => ({ ...prev, [pedidoId]: { ...prev[pedidoId], [campo]: valor } }))
  }

  // Al cambiar la conversión, la cantidad sugerida pasa a las unidades
  // completas que cubren lo pendiente con esa conversión.
  function actualizarConversion(pedido: PedidoParaComprar, valor: string) {
    const conv = numeroConversion(valor)
    setLineas((prev) => {
      const actual = prev[pedido.id]
      let cantidad: string | null = null
      if (conv != null) {
        cantidad = actual?.umCompra
          ? conversionValida(conv)
            ? String(maximoPresentaciones(pedido.pendienteUso, conv, pedido.factor))
            : null
          : String(unidadesDeCompra(pedido.pendienteUso, conv))
      }
      return {
        ...prev,
        [pedido.id]: { ...actual, conversion: valor, ...(cantidad != null ? { cantidad } : {}) },
      }
    })
  }

  // "UM disponible": la opción normal vuelve a lo de siempre (unidad del
  // insumo, conversión del APU); una presentación (caja...) deja la conversión
  // y la cantidad en blanco hasta que Compras escriba cuánto trae cada una.
  function cambiarUm(pedido: PedidoParaComprar, valor: string) {
    const um = valor === UM_PROPIA ? "" : valor
    setLineas((prev) => ({
      ...prev,
      [pedido.id]: {
        ...prev[pedido.id],
        umCompra: um,
        conversion: um ? "" : String(pedido.factor),
        cantidad: um ? "" : String(pedido.cantidadPendiente),
      },
    }))
  }

  // Devuelve los números parseados de una línea, o null si algo es inválido
  // (cantidad vacía/0/negativa/mayor a lo pendiente, o precio vacío/negativo).
  function lineaValida(pedido: PedidoParaComprar) {
    const l = lineas[pedido.id]
    if (!l) return null
    const factor = numeroConversion(l.conversion)
    if (factor == null) return null
    const cantidad = Number(l.cantidad)
    const precioUnitario = Number(l.precioUnitario)
    const porcentajeDescuento = Number(l.porcentajeDescuento || "0")
    const porcentajeIva = Number(l.porcentajeIva || "0")

    // Otra presentación (cajas): la cantidad son unidades de esa presentación y
    // el precio es por una de ellas; la base deriva lo del insumo.
    if (l.umCompra) {
      if (!conversionValida(factor)) return null
      if (
        !l.cantidad.trim() ||
        !Number.isInteger(cantidad) ||
        cantidad <= 0 ||
        cantidad > maximoPresentaciones(pedido.pendienteUso, factor, pedido.factor)
      )
        return null
      if (!l.precioUnitario.trim() || Number.isNaN(precioUnitario) || precioUnitario < 0) return null
      if (Number.isNaN(porcentajeDescuento) || porcentajeDescuento < 0 || porcentajeDescuento > 100) return null
      if (Number.isNaN(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) return null
      return {
        cantidad,
        factor: pedido.factor,
        precioUnitario,
        porcentajeDescuento,
        porcentajeIva,
        presentacion: {
          umCompra: l.umCompra,
          conversionCompra: factor,
          cantidadCompra: cantidad,
          precioCompra: precioUnitario,
        },
      }
    }

    // Cantidad: solo enteros (Entradas solo recibe enteros; una línea de 2,5
    // dejaría 0,5 imposible de recibir). Precio y porcentajes sí decimales.
    // Hasta las unidades completas que cubren lo pendiente con esta conversión.
    if (
      !l.cantidad.trim() ||
      !Number.isInteger(cantidad) ||
      cantidad <= 0 ||
      cantidad > unidadesDeCompra(pedido.pendienteUso, factor)
    )
      return null
    if (!l.precioUnitario.trim() || Number.isNaN(precioUnitario) || precioUnitario < 0) return null
    if (Number.isNaN(porcentajeDescuento) || porcentajeDescuento < 0 || porcentajeDescuento > 100) return null
    if (Number.isNaN(porcentajeIva) || porcentajeIva < 0 || porcentajeIva > 100) return null

    return { cantidad, factor, precioUnitario, porcentajeDescuento, porcentajeIva, presentacion: undefined }
  }

  const todasLasLineasValidas = lineasOrden.length > 0 && lineasOrden.every((p) => lineaValida(p) !== null)

  const totales = todasLasLineasValidas
    ? calcularTotalesOrden(lineasOrden.map((p) => lineaValida(p)!))
    : null

  // Hoy en hora local (YYYY-MM-DD): la fecha del saldo no puede ser anterior.
  const hoy = hoyColombia()
  const pctNumero = Number(anticipoPct)
  const anticipoValido =
    !conAnticipo ||
    (anticipoPct.trim() !== "" &&
      Number.isFinite(pctNumero) &&
      pctNumero > 0 &&
      pctNumero < 100 &&
      (saldoModo === "entrega" || (saldoFecha !== "" && saldoFecha >= hoy)))
  const montoAnticipo = conAnticipo && totales && anticipoValido ? Math.round((totales.total * pctNumero) / 100) : null

  const usoSaldo =
    !modificar && usarSaldo && saldoDisponible > 0 && totales ? validarUsoSaldo(valorSaldo, totales.total, saldoDisponible) : null

  const puedeGenerar =
    (usoSaldo === null || usoSaldo.ok) &&
    proveedor !== null &&
    !cargandoProveedor &&
    todasLasLineasValidas &&
    anticipoValido &&
    archivoSoporte !== null &&
    !generando

  async function handleGenerar() {
    if ((!modificar && !seleccion) || !proveedor || !todasLasLineasValidas) return
    // Sobrecosto: confirmar antes de crear la orden (ver alertaPrecio). Con una
    // presentación se compara el equivalente por unidad del insumo, igual que
    // el aviso de cada línea.
    const sospechosos = lineasOrden
      .map((p) => {
        const l = lineas[p.id]
        if (!l) return null
        const conv = numeroConversion(l.conversion)
        const porUm = l.umCompra && conv != null ? cantidadPorPresentacion(conv, p.factor) : 1
        const alerta = porUm > 0 ? alertaPrecio(Number(l.precioUnitario) / porUm, p.precioPromedio) : null
        return alerta ? `• ${p.insumoDescripcion}: ${alerta}` : null
      })
      .filter((x): x is string => x !== null)
    if (
      sospechosos.length > 0 &&
      !(await confirmar(
        `Estos precios están más de 10 % por encima del precio promedio de compra:\n\n${sospechosos.join("\n")}\n\nUn precio equivocado en una orden aprobada afecta el precio promedio con el que se valoran los APU. ¿Los precios son correctos?`,
        { titulo: "Sobrecosto", boton: "Sí, son correctos" }
      ))
    ) {
      return
    }
    if (!archivoSoporte) {
      setError("Adjunta el soporte de la orden (cotización, cuenta de cobro o factura).")
      return
    }
    if (!fechaEntrega) {
      setError("Escribe la fecha estimada de entrega.")
      return
    }
    if (!modificar && fechaEntrega < hoyColombia()) {
      setError("La fecha estimada de entrega no puede ser anterior a hoy.")
      return
    }
    const conTitularAparte = pago.metodo === "transferencia" && titular !== null
    const errorTipo = validarTipoPagoOC(tipoPago, fechaCredito, hoyColombia())
    if (errorTipo) {
      setError(errorTipo)
      return
    }
    const errorPago = validarPagoOC(pago, infoCuentas, conTitularAparte)
    if (errorPago) {
      setError(errorPago)
      return
    }
    const t = titularParaGuardar(conTitularAparte ? titular : null)
    if (!t.ok) {
      setError(t.error)
      return
    }
    if (
      modificar &&
      !(await confirmar(
        "La orden vuelve a quedar por aprobar y su pago se reemplaza en Aprobación de pagos (A&F lo aprueba otra vez). ¿Guardar los cambios?",
        { titulo: "Modificar la orden", boton: "Guardar" }
      ))
    ) {
      return
    }
    setGenerando(true)
    setError(null)
    // El soporte se sube primero; si la orden no se crea, se borra.
    const supabase = createClient()
    const ruta = rutaSoporte(crypto.randomUUID(), tipoSoporte, archivoSoporte)
    let subido = false
    try {
      const { error: e } = await supabase.storage
        .from("ordenes_compra")
        .upload(ruta, archivoSoporte, { contentType: archivoSoporte.type, upsert: false })
      if (e) throw new Error(`No se pudo subir el soporte: ${e.message}`)
      subido = true
      const soporte = { tipo: tipoSoporte, ruta, nombreArchivo: archivoSoporte.name, tamano: archivoSoporte.size, mime: archivoSoporte.type }
      const datos = {
        proveedorId: proveedor.id,
        sitioEntrega: sitioEntrega.trim() || null,
        fechaEntrega: fechaEntrega || null,
        contactoNombre: contactoProyecto.trim() || null,
        telefono: detalleProveedor?.telefono ?? null,
        ciudad: detalleProveedor?.ciudad ?? null,
        email: detalleProveedor?.correo ?? null,
        condicionesPago: condicionesPago.trim() || null,
        observaciones: observaciones.trim() || null,
        titular: t.titular,
        pago: pagoOCParaGuardar(pago, infoCuentas, conTitularAparte),
        ...tipoPagoParaGuardar(tipoPago!, fechaCredito),
        ...(conAnticipo
          ? { anticipoPorcentaje: pctNumero, saldoModo, saldoFecha: saldoModo === "fecha" ? saldoFecha : null }
          : {}),
        saldoFavor: usoSaldo?.ok ? usoSaldo.desglose.aplicado : null,
        lineas: lineasOrden.map((p) => {
          const l = lineaValida(p)!
          return {
            pedidoId: p.id,
            cantidadComprar: l.cantidad,
            factor: l.factor,
            precioUnitario: l.precioUnitario,
            porcentajeDescuento: l.porcentajeDescuento,
            porcentajeIva: l.porcentajeIva,
            ...(l.presentacion ? { presentacion: l.presentacion } : {}),
          }
        }),
      }
      if (ordenId) {
        await modificarOrdenCompra(ordenId, datos, soporte)
        setOrdenCreada(ordenId)
      } else {
        const nueva = await crearOrdenCompra({ ...datos, proyectoId: seleccion!.proyectoId }, soporte)
        sessionStorage.removeItem(CLAVE_SELECCION)
        setOrdenCreada(nueva)
      }
    } catch (e) {
      if (subido) await supabase.storage.from("ordenes_compra").remove([ruta])
      setError(e instanceof Error ? e.message : modificar ? "No se pudo modificar la orden de compra." : "No se pudo generar la orden de compra.")
    } finally {
      setGenerando(false)
    }
  }

  // Primero la orden creada: al crearla se borra la selección guardada y,
  // si no, saldría "No hay requisiciones seleccionadas".
  if (ordenCreada && modificar) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <ClipboardList className="h-10 w-10 text-primary" />
        <p className="text-lg font-medium">Orden de compra {codigoOrden} modificada</p>
        <p className="text-sm text-muted-foreground">
          Quedó por aprobar otra vez: su pago nuevo está en A&amp;F (Aprobación de pagos) y el anterior se borró.
        </p>
        <Button onClick={() => router.push("/almacen/ordenes-compra")}>Ir a Órdenes de compra</Button>
      </div>
    )
  }

  if (ordenCreada) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <ClipboardList className="h-10 w-10 text-primary" />
        <p className="text-lg font-medium">Orden de compra generada</p>
        <p className="text-sm text-muted-foreground">
          Se creó correctamente para el proveedor {detalleProveedor?.nombre}. Su pago quedó por
          aprobar en A&amp;F (Aprobación de pagos); al aprobarlo, la orden queda aprobada.
        </p>
        <Button onClick={() => router.push("/almacen/comprar-pedidos")}>Volver a Requisiciones por comprar</Button>
      </div>
    )
  }

  if (!modificar && seleccion === undefined) return null

  if (!modificar && seleccion === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
        <p>No hay líneas seleccionadas para generar una orden de compra.</p>
        <Button variant="outline" onClick={() => router.push("/almacen/comprar-pedidos")}>
          Volver a Requisiciones por comprar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {modificar && codigoOrden && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Modificando la orden {codigoOrden}. Marca los insumos que quedan en la orden (solo de sus mismas requisiciones).
          Al guardar vuelve a quedar por aprobar y su pago se reemplaza en Aprobación de pagos.
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
            {cargandoPedidos ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando requisiciones...
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {modificar && <TableHead className="w-10">En OC</TableHead>}
                    <TableHead>Cod</TableHead>
                    <TableHead>Insumo</TableHead>
                    <TableHead>Ítem</TableHead>
                    <TableHead className="text-right">Solicitado</TableHead>
                    <TableHead className="w-40">UM disponible</TableHead>
                    <TableHead className="w-44">Conversión</TableHead>
                    <TableHead className="w-28 text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Equivale a</TableHead>
                    <TableHead className="w-28 text-right">Vr. Unitario</TableHead>
                    <TableHead className="w-20 text-right">% Dto.</TableHead>
                    <TableHead className="w-20 text-right">% IVA</TableHead>
                    <TableHead className="w-28 text-right">Total línea</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map((pedido) => {
                    const l = lineas[pedido.id] ?? {
                      umCompra: "",
                      conversion: "1",
                      cantidad: "",
                      precioUnitario: "",
                      porcentajeDescuento: "0",
                      porcentajeIva: "0",
                    }
                    const enOrden = !modificar || incluidos.has(pedido.id)
                    const valida = enOrden ? lineaValida(pedido) : null
                    const totalLinea = valida ? calcularLinea(valida).total : null
                    return (
                      <TableRow key={pedido.id} className={enOrden ? undefined : "opacity-50"}>
                        {modificar && (
                          <TableCell>
                            <Checkbox
                              checked={enOrden}
                              onCheckedChange={(v) => cambiarIncluido(pedido.id, v === true)}
                              aria-label="Incluir en la orden"
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-muted-foreground">{pedido.insumoCodigo}</TableCell>
                        {/* whitespace-normal: la celda de tabla trae nowrap por defecto y los
                            nombres largos se salían de su columna tapando las demás. Ahora
                            bajan a una segunda línea (máximo 2); el nombre completo queda
                            en el tooltip. */}
                        <TableCell className="min-w-56 max-w-72 whitespace-normal">
                          <span className="line-clamp-2 break-words" title={pedido.insumoDescripcion}>
                            {pedido.insumoDescripcion}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums text-muted-foreground">{pedido.itemCodigo ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {formatoCantidad(pedido.pendienteUso)} {nombreUnidad(pedido.unidadUso)}
                          {pedido.pendienteUso < pedido.cantidadUso && (
                            <span className="block text-[11px] text-muted-foreground">
                              de {formatoCantidad(pedido.cantidadUso)} pedidos
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select value={l.umCompra || UM_PROPIA} onValueChange={(v) => cambiarUm(pedido, v ?? UM_PROPIA)}>
                            <SelectTrigger className="h-8 w-36 text-xs" aria-label="UM disponible">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UM_PROPIA}>
                                {nombreUnidad(pedido.um) || "und"} (del insumo)
                              </SelectItem>
                              {presentacionesPara(pedido.um).map((u) => (
                                <SelectItem key={u} value={u}>
                                  {u.charAt(0) + u.slice(1).toLowerCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 whitespace-nowrap text-xs">
                            <span>1 {l.umCompra ? l.umCompra.toLowerCase() : nombreUnidad(pedido.um) || "und"} =</span>
                            <Input
                              inputMode="decimal"
                              value={l.conversion}
                              onChange={(e) => actualizarConversion(pedido, e.target.value)}
                              placeholder={l.umCompra ? "¿cuánto trae?" : undefined}
                              className={`h-8 w-16 text-right ${
                                numeroConversion(l.conversion) == null ||
                                (l.umCompra && !conversionValida(numeroConversion(l.conversion) ?? 0))
                                  ? "border-destructive"
                                  : ""
                              }`}
                              aria-label="Conversión"
                            />
                            <span>{nombreUnidad(pedido.unidadUso)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="1"
                            inputMode="numeric"
                            value={l.cantidad}
                            onChange={(e) => actualizarLinea(pedido.id, "cantidad", e.target.value)}
                            className={`text-right ${enOrden && !valida ? "border-destructive" : ""}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {(() => {
                            const conv = numeroConversion(l.conversion)
                            const cant = Number(l.cantidad)
                            if (conv == null || !(cant > 0)) return "—"
                            const equivale = cant * conv
                            const cubre = equivale >= pedido.pendienteUso - 1e-9
                            return (
                              <>
                                {formatoCantidad(equivale)} {nombreUnidad(pedido.unidadUso)}
                                <span className={`block text-[11px] ${cubre ? "text-emerald-700" : "text-amber-700"}`}>
                                  {cubre
                                    ? equivale > pedido.pendienteUso + 1e-9
                                      ? `cubre; ${formatoCantidad(equivale - pedido.pendienteUso)} de más`
                                      : "cubre lo solicitado"
                                    : `faltan ${formatoCantidad(pedido.pendienteUso - equivale)}`}
                                </span>
                              </>
                            )
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.precioUnitario}
                            onChange={(e) => actualizarLinea(pedido.id, "precioUnitario", e.target.value)}
                            className={`text-right ${enOrden && !valida ? "border-destructive" : ""}`}
                          />
                          {l.umCompra && (
                            <p className="mt-0.5 text-right text-[10px] leading-tight text-muted-foreground">
                              por {l.umCompra.toLowerCase()}
                            </p>
                          )}
                          {(() => {
                            // El precio promedio es por unidad del insumo: con una
                            // presentación se compara el equivalente.
                            const conv = numeroConversion(l.conversion)
                            const precio = Number(l.precioUnitario)
                            const porUm = l.umCompra && conv != null ? cantidadPorPresentacion(conv, pedido.factor) : 1
                            const alerta =
                              l.precioUnitario.trim() && porUm > 0
                                ? alertaPrecio(precio / porUm, pedido.precioPromedio)
                                : null
                            return alerta ? (
                              <p className="mt-0.5 text-right text-[10px] leading-tight text-amber-700">{alerta}</p>
                            ) : null
                          })()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={l.porcentajeDescuento}
                            onChange={(e) =>
                              actualizarLinea(pedido.id, "porcentajeDescuento", e.target.value)
                            }
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={l.porcentajeIva}
                            onChange={(e) => actualizarLinea(pedido.id, "porcentajeIva", e.target.value)}
                            className="text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {totalLinea != null ? formatoMoneda(totalLinea) : "—"}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {totales && (
            <div className="flex justify-end">
              <div className="w-64 space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Descuento</span>
                  <span>{formatoMoneda(totales.descuento)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>IVA</span>
                  <span>{formatoMoneda(totales.iva)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-medium">
                  <span>Total</span>
                  <span>{formatoMoneda(totales.total)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-full max-w-sm shrink-0 space-y-4 overflow-auto rounded-lg border bg-card p-4">
          <div className="space-y-1.5">
            <Label>
              Proveedor <span className="text-destructive">*</span>
            </Label>
            <BuscadorAsync
              placeholder="Buscar proveedor"
              valorSeleccionado={proveedor}
              onSeleccionar={(o) => {
                setProveedor(o)
                setUsarSaldo(false)
                setValorSaldo("")
                // La cuenta escogida era del proveedor anterior.
                setPago((p) => ({ ...p, cuentaId: null }))
              }}
              buscar={buscarProveedoresAdaptado}
            />
          </div>

          {cargandoProveedor && (
            <p className="text-sm text-muted-foreground">Cargando datos del proveedor...</p>
          )}

          {detalleProveedor && !cargandoProveedor && (
            <TarjetaProveedorOC
              key={detalleProveedor.id}
              detalle={detalleProveedor}
              puedeEditar={puedeEditarProveedor}
              onActualizado={(d) => proveedor && setCargaProveedor({ proveedorId: proveedor.id, detalle: d })}
            />
          )}

          {!modificar && detalleProveedor && !cargandoProveedor && saldoDisponible > 0 && (
            <div className="space-y-2 rounded-md border-2 border-emerald-500 bg-emerald-50 p-3 text-sm text-emerald-950">
              <p className="font-semibold">
                {detalleProveedor.nombre} tiene {formatoMoneda(saldoDisponible)} a favor
              </p>
              <p className="text-xs">
                De {saldosProveedor.map((x) => `${x.ordenOrigen} (${formatoMoneda(x.disponible)})`).join(", ")}.
              </p>
              <label className="flex w-fit cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={usarSaldo}
                  disabled={generando}
                  onChange={(e) => {
                    setUsarSaldo(e.target.checked)
                    if (e.target.checked && totales) setValorSaldo(String(saldoSugerido(totales.total, saldoDisponible)))
                  }}
                />
                Usar saldo a favor
              </label>
              {usarSaldo && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="valor-saldo-favor" className="text-xs">
                      Valor a usar
                    </Label>
                    <Input
                      id="valor-saldo-favor"
                      inputMode="decimal"
                      className="h-8 bg-white"
                      value={valorSaldo}
                      disabled={generando}
                      onChange={(e) => setValorSaldo(e.target.value)}
                    />
                  </div>
                  {!totales ? (
                    <p className="text-xs">Completa cantidad y precio de las líneas para ver el desglose.</p>
                  ) : usoSaldo && !usoSaldo.ok ? (
                    <p className="text-xs text-destructive">{usoSaldo.error}</p>
                  ) : usoSaldo?.ok ? (
                    <div className="space-y-0.5 rounded border border-emerald-300 bg-white p-2 tabular-nums">
                      <div className="flex justify-between gap-3">
                        <span>Costo de la orden</span>
                        <span>{formatoMoneda(usoSaldo.desglose.costo)}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Saldo a favor aplicado</span>
                        <span>− {formatoMoneda(usoSaldo.desglose.aplicado)}</span>
                      </div>
                      <div className="flex justify-between gap-3 border-t pt-0.5 font-semibold">
                        <span>Valor a pagar</span>
                        <span>{formatoMoneda(usoSaldo.desglose.aPagar)}</span>
                      </div>
                      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                        <span>Saldo a favor restante</span>
                        <span>{formatoMoneda(usoSaldo.desglose.restante)}</span>
                      </div>
                      {conAnticipo && <p className="pt-1 text-xs text-muted-foreground">Se descuenta primero del saldo de la orden y después del anticipo.</p>}
                      {usoSaldo.desglose.aPagar === 0 && (
                        <p className="pt-1 text-xs text-muted-foreground">El pago queda en $ 0: Gerencia lo aprueba igual y queda pagado con el saldo a favor.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {detalleProveedor && !cargandoProveedor && (
            <MetodoPagoOC
              valor={pago}
              onCambiar={setPago}
              info={infoCuentas}
              errorCuentas={errorCuentas}
              proveedorNombre={detalleProveedor.nombre}
              conTitularAparte={titular !== null}
            >
              <CampoTitularCuenta valor={titular} onCambiar={setTitular} />
            </MetodoPagoOC>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="contacto-proyecto">Contacto del proyecto (opcional)</Label>
            <Input
              id="contacto-proyecto"
              value={contactoProyecto}
              onChange={(e) => setContactoProyecto(e.target.value)}
              placeholder="Nombre de quien recibe en obra"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sitio-entrega">Sitio de entrega (opcional)</Label>
            <Input
              id="sitio-entrega"
              value={sitioEntrega}
              onChange={(e) => setSitioEntrega(e.target.value)}
              placeholder="Dirección o punto de entrega"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fecha-entrega">
              Fecha estimada de entrega <span className="text-destructive">*</span>
            </Label>
            <CampoFecha
              id="fecha-entrega"
              value={fechaEntrega}
              min={modificar ? undefined : hoy}
              onChange={(e) => setFechaEntrega(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Tipo de pago <span className="text-destructive">*</span>
            </Label>
            <Select value={tipoPago ?? ""} onValueChange={(v) => {
                setTipoPago((v || null) as TipoPagoOC | null)
                if (v === "credito") setConAnticipo(false)
              }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Elige el tipo de pago" />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_PAGO_OC.map((t) => (
                  <SelectItem key={t.valor} value={t.valor}>
                    {t.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {tipoPago === "credito" && (
            <div className="space-y-1.5">
              <Label htmlFor="fecha-credito">
                Fecha en que se debe pagar <span className="text-destructive">*</span>
              </Label>
              <CampoFecha id="fecha-credito" value={fechaCredito} onChange={(e) => setFechaCredito(e.target.value)} />
              {fechaCredito && fechaCredito <= hoyColombia() && (
                <p className="text-xs text-destructive">Tiene que ser posterior a hoy.</p>
              )}
              <p className="text-xs text-muted-foreground">
                Va a Aprobación de pagos de una vez. Aprobado por Gerencia, el pago espera hasta el lunes de la semana de esta fecha para pasar a pago. A crédito no hay anticipo.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="condiciones-pago">Condiciones de pago (opcional)</Label>
            <Input
              id="condiciones-pago"
              value={condicionesPago}
              onChange={(e) => setCondicionesPago(e.target.value)}
              placeholder="Ej. Anticipado, 30 días..."
            />
          </div>

          {tipoPago !== "credito" && (
          <div className="space-y-2 rounded-lg border p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox checked={conAnticipo} onCheckedChange={(v) => setConAnticipo(v === true)} />
              Anticipo
            </label>
            {conAnticipo && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="anticipo-pct">Porcentaje del anticipo (%)</Label>
                  <Input
                    id="anticipo-pct"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    max="99.99"
                    step="0.01"
                    value={anticipoPct}
                    onChange={(e) => setAnticipoPct(e.target.value)}
                    placeholder="Ej. 30"
                  />
                  {montoAnticipo !== null && totales && (
                    <p className="text-xs text-muted-foreground">
                      Anticipo {formatoMoneda(montoAnticipo)} · Saldo {formatoMoneda(Math.round(totales.total) - montoAnticipo)}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>¿Cuándo se paga el saldo?</Label>
                  <Select value={saldoModo} onValueChange={(v) => setSaldoModo((v ?? "entrega") as "entrega" | "fecha")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entrega">Al ser entregado</SelectItem>
                      <SelectItem value="fecha">En una fecha</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {saldoModo === "fecha" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="saldo-fecha">Fecha de pago del saldo</Label>
                    <CampoFecha
                      id="saldo-fecha"
                      min={hoy}
                      value={saldoFecha}
                      onChange={(e) => setSaldoFecha(e.target.value)}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  El anticipo va a Aprobación de pagos (A&amp;F) apenas se crea la orden; aprobarlo aprueba la orden. El saldo llega a Aprobación de pagos
                  {saldoModo === "entrega"
                    ? " cuando la orden quede entregada por completo."
                    : saldoFecha
                      ? ` 3 días antes de la fecha indicada (${
                          sumarDiasFecha(saldoFecha, -3) <= hoy ? "apenas se apruebe el anticipo" : `el ${formatearFechaSinHora(sumarDiasFecha(saldoFecha, -3))}`
                        }).`
                      : " 3 días antes de la fecha indicada."}
                </p>
              </div>
            )}
          </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="observaciones-oc">Observaciones (opcional)</Label>
            <Textarea
              id="observaciones-oc"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={2}
            />
          </div>

          <CampoSoporte
            etiqueta={modificar ? "Soporte de la modificación (los anteriores se conservan)" : "Soporte de la orden"}
            obligatorio
            tipos={ETIQUETA_SOPORTE_ORDEN}
            tipo={tipoSoporte}
            onTipo={setTipoSoporte}
            archivo={archivoSoporte}
            onArchivo={setArchivoSoporte}
            onError={setError}
            disabled={generando}
          />

          <Button className="w-full" disabled={!puedeGenerar} onClick={handleGenerar}>
            {generando ? (modificar ? "Guardando..." : "Generando...") : modificar ? "Guardar cambios" : "Generar OC"}
          </Button>
          {!proveedor && (
            <p className="text-xs text-muted-foreground">Selecciona un proveedor para continuar.</p>
          )}
          {proveedor && todasLasLineasValidas && !archivoSoporte && (
            <p className="text-xs text-muted-foreground">
              Adjunta el soporte (cotización, cuenta de cobro o factura) para {modificar ? "guardar los cambios" : "generar la orden"}.
            </p>
          )}
          {proveedor && !cargandoPedidos && lineasOrden.length === 0 && (
            <p className="text-xs text-destructive">La orden necesita al menos un insumo.</p>
          )}
          {proveedor && lineasOrden.length > 0 && !todasLasLineasValidas && (
            <p className="text-xs text-destructive">
              Revisa cantidad y precio de cada línea — ninguna cantidad puede superar lo pendiente.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}