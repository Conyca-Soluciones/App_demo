# Contexto CONYCA para los agentes de revisión por roles

Este documento lo leen todos los agentes de rol antes de empezar. Describe la empresa, el proceso de punta a punta y el vocabulario. Si algo aquí contradice lo que ves en la app, repórtalo: puede ser un error de la app o de este documento.

## La empresa

- CONYCA es una constructora colombiana con alrededor de 200 empleados. Forma parte de un conglomerado de varias empresas.
- Ejecuta obras para entidades (clientes). Cada obra es un proyecto con su propio presupuesto.
- La "everything app" se está construyendo para reemplazar Excel, correos y WhatsApp en la operación diaria. Hoy tiene administración de proyectos y un módulo financiero mínimo. Muchas funciones descritas aquí todavía no existen y se irán agregando (ver `roadmap-app.md`).

## Proceso de punta a punta

### 1. Presupuesto (Director de Obra)
1. El área comercial descarga la plantilla de la app y formula el presupuesto en ese formato. Esa es su única interacción con la app.
2. La plantilla tiene dos hojas:
   - **Presupuesto:** ítems numerados con cantidades y precios que paga la entidad.
   - **APU (análisis de precios unitarios):** el desglose de cada ítem en sus insumos.
3. El director de obra sube el presupuesto a la app.
4. La app compara los insumos del APU con la **maestra de insumos**:
   - Los que coinciden automáticamente quedan enlazados.
   - Los que no coinciden los enlaza el director a mano.
   - Si el insumo no existe en la maestra, el director solicita su creación.
5. Con la mano de obra se hace un trabajo similar.
6. **Transporte:** en el APU viene en horas, pero en realidad se paga por distancia. Por eso esos ítems quedan separados y el director descarga una plantilla de transporte, la llena y la vuelve a subir.

### 2. Compras de materiales
1. El director de obra (o un apoyo de obra) crea **requisiciones**. Solo puede pedir insumos que están en el presupuesto y hasta las cantidades presupuestadas.
2. **Subgerencia técnica** aprueba las requisiciones. Esa es su única función en la app.
3. **Compras** recibe las requisiciones aprobadas, cotiza con proveedores y, si el proveedor es nuevo, lo registra con toda su información vigente.
4. Compras genera la **orden de compra (OC)**. La OC no tiene una aprobación propia: pasa directo a pago, y queda aprobada en el momento en que gerencia aprueba ese pago.
5. El **almacenista** registra las **entradas** de material y verifica que llegó todo lo de la OC. Cuando el material sale para la obra, registra las **salidas** de almacén.

### 3. Subcontratación de mano de obra
1. El director de obra registra al **contratista** en la app con toda su información necesaria y vigente.
2. El director solicita el **contrato** en el módulo de Contratos.
3. **Jurídica** revisa la solicitud, ajusta la **minuta** según lo que haga falta y aprueba.
4. Cuando el contratista presenta su **cuenta de cobro**, el director completa el **acta parcial** en la app para pedir aprobación del pago. En la práctica esto implica hablar con gerencia, ajustar cuadros y explicar los pagos.

### 4. Pagos
1. **Gerencia** aprueba todos los pagos: actas parciales, compras y gastos.
2. Quien origina el pago (director, compras, RRHH, auxiliar administrativo) adjunta los **soportes** en la app para la conciliación contable.
3. **Tesorería** revisa y confirma pagos y soportes, y arma el **consolidado de pagos**.
4. **Contabilidad** toma el consolidado, revisa soportes e información de terceros y **liquida** cada pago (retenciones y valor final a pagar).
5. Tesorería genera los **dispersores bancarios** (archivos para el portal del banco) y ejecuta los pagos.
6. Contabilidad **concilia**.

### 5. Otros orígenes de pagos
- **Recursos Humanos:** solicitudes de pago de nómina, seguridad social y relacionados. Mantiene la base de datos de empleados de todas las empresas del conglomerado.
- **Auxiliar administrativo:** solicita compras y pagos de gastos administrativos (no de obra).

### 6. Control
- **Gerencia** sigue gastos, inversión y avance de obra (medido con entradas y salidas de almacén). Quiere ver cuánto dinero se ha pagado por proyecto.
- **Financiera** sigue los ingresos, revisa en los bancos cuándo pagan las entidades y mantiene los cuadros de flujo de caja. Hoy todo eso se hace fuera de la app.

## Glosario

| Término | Significado |
|---|---|
| Presupuesto | Ítems de obra con cantidad y precio que paga la entidad |
| APU | Desglose de cada ítem en insumos, mano de obra, equipo y transporte |
| Insumo | Material o recurso unitario (cemento, varilla, etc.) |
| Maestra de insumos | Catálogo único de insumos de la empresa |
| Requisición | Pedido de insumos desde la obra, limitado al presupuesto |
| OC | Orden de compra a un proveedor |
| Entrada / salida | Movimientos de almacén: recibido de proveedor / enviado a obra |
| Contratista | Tercero que ejecuta mano de obra subcontratada |
| Minuta | Texto del contrato |
| Cuenta de cobro | Documento con el que el contratista cobra |
| Acta parcial | Corte de obra ejecutada por un contratista que soporta un pago |
| Soporte | Documento que respalda un pago (factura, cuenta de cobro, comprobante) |
| Consolidado de pagos | Lista de pagos aprobados lista para liquidar y dispersar |
| Liquidación | Cálculo de retenciones y valor neto a pagar |
| Dispersor | Archivo de pagos masivos para el portal del banco |
| Conciliación | Cruce de lo pagado con soportes y movimientos bancarios |

## Decisiones y límites conocidos

- **Roles con participación mínima (sin agente propio):**
  - Subgerencia técnica: solo aprueba requisiciones.
  - Área comercial: solo descarga la plantilla y formula el presupuesto.
  - Apoyo de obra: hace requisiciones por encargo del director.
- **Las OC no tienen aprobación propia.** Se aprueban implícitamente cuando gerencia aprueba el pago. Si ves un riesgo en esto (por ejemplo, compromisos con proveedores antes de que gerencia vea algo), repórtalo como riesgo de control, no como error.
- **La facturación a las entidades y los ingresos se manejan fuera de la app.** No hay plan definido para integrarlos. Si tu rol depende de esa información, di qué es lo mínimo que necesitarías y por qué, sin asumir que existe.
- **Varias empresas del conglomerado: todavía no hay nada en la app.** Señálalo solo donde te bloquee o genere riesgo (por ejemplo, terceros, bancos o contabilidad mezclados entre empresas).
