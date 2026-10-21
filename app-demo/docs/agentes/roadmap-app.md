# Estado y roadmap de la app (lo llena Luis)

Los agentes leen este archivo para saber qué existe y qué ya está planeado. Así no reportan como "falta" algo que ya está en camino y se enfocan en qué tan bien está pensado.

Mantenlo corto y actualízalo cuando cambie algo.

## Ya existe y está en uso
- **Administración de proyectos (AdPro)**, con permisos por rol y por proyecto:
  - **Presupuestos:** carga del presupuesto desde Excel con APU, cruce de los insumos contra la maestra de insumos (revisión de los que no cuadran) y versiones del presupuesto. Maestra de insumos (precio vigente = promedio de compra, presentaciones, descarga a Excel) y aprobación de insumos y de mano de obra/equipos nuevos.
  - **Requisiciones:** el ingeniero pide insumos contra el presupuesto (no deja pasar del cupo), la aprobación técnica las aprueba o rechaza, y hay registro con filtros y descarga a Excel.
  - **Compras:** cola de requisiciones por comprar, órdenes de compra (presentación de compra, anticipo y saldo, aprobación, desaprobar o cancelar, PDF), registro de órdenes resumido o detallado con descarga a Excel, saldos pendientes y proveedores.
  - **Almacén:** entradas contra la orden de compra, salidas e inventario por proyecto.
  - **Control del proyecto:** a dónde va la plata (presupuesto contra gastado aprobado, por capítulo, proveedores y avance).
- **Financiero (mínimo, módulo A&F):** aprobación de pagos (saldos de órdenes de compra y pagos de actas), consolidado de pagos con ITEM por semana, y terceros con sus cuentas.
- **Administración (módulo Admin, solo Administrador):** empresas y proyectos, roles y permisos, usuarios y accesos.

## Existe pero está incompleto o en pruebas
- **Contratos:** contratistas con sus documentos, solicitud de contrato (por grupos sobre ítems del presupuesto, y contratos generales), pre-aprobación de Jurídica con minuta (6 plantillas en PDF) y aprobación de Subgerencia. Probado solo con datos de prueba. Falta: otrosí (ampliar plazo o valor), retención en garantía en la minuta de mano de obra, firmas digitales, pago del anticipo del contrato y alertas de documentos vencidos del contratista.
- **Actas:** actas parcial, final y de liquidación sobre las actividades del contrato, con descuentos (anticipo, retención, otros), soportes (la factura es obligatoria), PDF e historial. El acta se aprueba al aprobar su pago en A&F. Aviso de contrato vencido. Probado solo con datos de prueba. Falta: actas de contratos generales (página "Actas generales"), código del formato del acta e informes de contratos.
- **Pagos:** los pagos ya pasan por aprobado, liquidado, en dispersión y pagado, pero la app todavía no genera el archivo de dispersión para el banco.

## Planeado (no existe todavía)
- Cotizaciones de compras (comparar proveedores antes de la orden de compra)
- Liquidación de pagos y archivos de dispersión bancaria
- RRHH: base de empleados y solicitudes de pago de nómina

## Prioridades de los próximos meses
1. <...>
2. <...>

## Cómo probar la app
- URL local: http://localhost:3000 (se levanta con `npm run dev` dentro de app-demo)
- Usuarios de prueba por rol: <usuario / dónde están las credenciales de prueba>
- Datos de prueba disponibles: 3 proyectos (Malecón con el presupuesto completo, Estuario Casa con un presupuesto pequeño y COMFIAR sin presupuesto); unos 870 insumos en la maestra (los que quedaron tras la limpieza del IVA) y ~400 proveedores; contratistas y solicitudes de contrato marcados "(PRUEBA)"; contratos de prueba CJ-14, CJ-17 (liquidado, con 3 actas) y CJ-19 (vencido) en Estuario Casa; 3 órdenes de compra de prueba (45, 46 y 48).
