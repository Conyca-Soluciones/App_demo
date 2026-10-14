import { AprobacionActasView } from "@/components/aprobacion-actas-view"

// El acceso a la ruta lo controla la pestaña contratos.aprobar_actas
// (middleware). Es solo consulta: las actas se aprueban o rechazan con su pago
// en A&F (Aprobación de pagos, acción aprobar_pagos).
export default function AprobacionActasPage() {
  return <AprobacionActasView />
}
