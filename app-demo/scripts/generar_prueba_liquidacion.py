"""Arma los casos para probar el motor de liquidación (lib/liquidacion.ts)
contra lo que Contabilidad liquidó a mano en el cuadro de pagos.

Uso (desde app-demo/):
    python scripts/generar_prueba_liquidacion.py RUT.xlsx PAGOS.xlsx [salida.json]

Por defecto escribe referencias/prueba_liquidacion.json (fuera de git). La
prueba tests/liquidacion-historial.test.ts lo lee si existe: recorre los pagos
en orden de fecha y, como la app, aprende de cada liquidación de Contabilidad
(memoria por documento) antes de sugerir el siguiente.

Cada caso trae lo que la app tendría: tercero y su perfil del RUT, qué retiene
la empresa (inferido del historial, como la carga inicial), municipio de ICA
del proyecto con sus tarifas (las de la migración), base, IVA, tipo de pago y
el concepto del pago; y lo que hizo Contabilidad (retefuente, ReteICA, ReteIVA).
"""

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generar_datos_liquidacion as g  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
MIGRACION = RAIZ / "supabase" / "migrations" / "20261203000000_liquidacion_pagos.sql"
SALIDA_POR_DEFECTO = RAIZ / "referencias" / "prueba_liquidacion.json"

CONCEPTO_DE_CATEGORIA = {
    "compras": "compras", "transporte": "transporte_carga", "construccion": "construccion",
    "servicios": "servicios", "honorarios": "honorarios", "arriendo_inmueble": "arrendamiento_inmuebles",
    "arriendo_mueble": "arrendamiento_muebles", "hotel": "hoteles_restaurantes", "combustible": "combustibles",
    "no_aplica": None,
}


def municipios_de_migracion():
    sql = MIGRACION.read_text(encoding="utf-8")
    bases = {}
    for d, m, bc, bs, bp in re.findall(r"\('([A-Z ]+)', '([A-Z ]+)', (\w+), (\w+), (\w+), [\w.]+, [\w.]+\)", sql):
        n = lambda x: None if x == "null" else float(x)
        bases[(d, m)] = {"baseCompras": n(bc), "baseServicios": n(bs), "baseProfesionales": n(bp)}
    tarifas = {}
    for d, m, a, t in re.findall(r"\('([A-Z ]+)','([A-Z ]+)','([a-z_]+)',([0-9.]+)\)", sql):
        tarifas.setdefault((d, m), {})[a] = float(t)
    return {k: {"id": f"{k[0]}/{k[1]}", "nombre": k[1], **v, "tarifas": tarifas.get(k, {})} for k, v in bases.items()}


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    ruts = g.leer_ruts(Path(sys.argv[1]))
    pagos = g.leer_pagos(Path(sys.argv[2]))
    salida = Path(sys.argv[3]) if len(sys.argv) > 3 else SALIDA_POR_DEFECTO
    municipios = municipios_de_migracion()
    emps = g.empresas(pagos, ruts)

    casos = []
    for k, p in enumerate(pagos):
        if not p["doc"] or not p["base"] or p["base"] <= 0 or not p["fecha"]:
            continue
        if re.search(r"REEMBOLSO|CAJA MENOR|LEGALIZACI", p["concepto"].upper()):
            continue  # varias facturas en un pago
        r = ruts.get(p["doc"])
        clave = g.clave_empresa(p["empresa"])
        e = emps.get(clave)
        mun_k = g.municipio_de_proyecto(p["proyecto"])
        mun = municipios.get(mun_k) if mun_k else None
        cat = g.clasificar(p["concepto"])
        tarifa_real = round(p["rete"] / p["base"], 4) if p["rete"] > 0 else 0
        casos.append({
            "n": k,
            "fecha": p["fecha"],
            "empresa": p["empresa"],
            "concepto_texto": p["concepto"][:80],
            "contexto": {
                "tipo": "anticipo" if "ANTICIPO" in p["concepto"].upper() else "unico",
                "anio": int(p["fecha"][:4]),
                "valor": p["base"] + (p["iva"] or 0),
                "valorDocumento": p["base"] + (p["iva"] or 0),
                "baseGravable": p["base"],
                "iva": p["iva"] or 0,
                "tercero": {"documento": p["doc"],
                            "tipoDocumento": "NIT" if len(p["doc"]) == 9 and p["doc"][0] in "89" else "CC",
                            "razonSocial": ""},
                "perfil": None if not r else {
                    "tipoPersona": r["tipo"],
                    "declarante": r["tipo"] == "juridica" or "05" in r["resp"],
                    "responsableIva": "48" in r["resp"],
                    "regimenSimple": "47" in r["resp"],
                    "autorretenedor": "15" in r["resp"],
                    "granContribuyente": "13" in r["resp"],
                    "zomac": "ZOMAC" in (r["nombre"] or "") or "ZOMAC" in p["concepto"].upper(),
                    "ciiuPrincipal": r["ciiu1"], "municipioRut": r["municipio"], "fechaRut": r["fecha"] or None,
                    "estado": "PENDIENTE", "alerta": None,
                },
                "empresa": None if not e else {
                    "agenteRetefuente": e["con_rete"] > 0 or e["evid_rete"] < 5,
                    "agenteReteiva": e["con_reteiva"] > 0 or e["evid_reteiva"] == 0,
                    "confirmado": True,
                },
                "empresaIca": bool(e and mun_k and mun_k in e["ica"]),
                "municipio": mun,
                "preferencias": [],
                "origen": {"fuente": "texto", "concepto": CONCEPTO_DE_CATEGORIA[cat]},
                "retefuenteAnticipos": 0,
            },
            "real": {"retefuente": round(p["rete"]), "reteica": round(p["ica"]), "reteiva": round(p["reteiva"]),
                     "conceptoRetefuente": g.concepto_de_tarifa(tarifa_real, cat) if tarifa_real else None,
                     "tarifaRetefuente": tarifa_real,
                     "tarifaIca": round(p["ica"] / p["base"], 5) if p["ica"] > 0 else 0},
        })
    casos.sort(key=lambda c: (c["fecha"], c["n"]))
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(json.dumps(casos, ensure_ascii=False), encoding="utf-8")
    print(f"{len(casos)} casos en {salida}")


if __name__ == "__main__":
    main()
