# Agentes de rol para revisar la app de CONYCA

## Qué hay en esta carpeta

```
.claude/
  agents/                      ← 10 subagentes, uno por rol
    rol-director-obra.md
    rol-compras.md
    rol-almacenista.md
    rol-juridica.md
    rol-gerencia.md
    rol-tesoreria.md
    rol-financiera.md
    rol-rrhh.md
    rol-auxiliar-administrativo.md
    rol-contabilidad.md
  skills/
    revision-por-rol/SKILL.md  ← reglas y formato de informe que comparten todos
docs/agentes/
  contexto-conyca.md           ← proceso de punta a punta y glosario (lo leen todos)
  roadmap-app.md               ← qué existe y qué está planeado (LO LLENAS TÚ)
```

### Por qué está armado así
- **Cada rol es un archivo:** su persona, su trabajo, sus probables dolores y escenarios concretos para probar.
- **Lo común está en un solo lugar:** las reglas, el método y el formato de informe viven en la habilidad `revision-por-rol`. Cada agente la precarga, así que si quieres cambiar el formato lo cambias una sola vez.
- **El contexto de la empresa está en `docs/agentes/`,** en archivos normales que puedes editar sin tocar los agentes.
- **Los agentes no pueden editar archivos** (`disallowedTools: Write, Edit`). Solo observan e informan; el líder consolida.
- **Modelo:** `sonnet` por defecto, para que 10 revisiones no salgan caras. Si quieres más profundidad en algún rol (por ejemplo gerencia o director de obra), cambia `model: sonnet` por `model: opus` o `model: inherit` en ese archivo.

## Instalación (una sola vez)

1. **Copia las carpetas a la raíz del repositorio de tu app,** al mismo nivel que `package.json` o equivalente:
   - `.claude/agents/` y `.claude/skills/revision-por-rol/`
   - `docs/agentes/`
   - Si ya tienes una carpeta `.claude/`, solo agrega estas subcarpetas; no borres lo que hay.
2. **Llena `docs/agentes/roadmap-app.md`.** Es lo que más mejora la calidad de los informes: qué existe, qué está planeado y cómo entrar a la app de pruebas.
3. **Revisa `docs/agentes/contexto-conyca.md`** y corrige lo que no sea exacto. Tiene una sección de "Decisiones y límites conocidos" con lo que aclaraste.
4. **Abre Claude Code en esa carpeta.** Si la carpeta `.claude/agents/` no existía antes de abrir la sesión, cierra y vuelve a abrir Claude Code para que la detecte.
5. **Comprueba que cargaron:** escribe `@` en el chat y deberían aparecer los agentes `rol-...` en la lista. También puedes preguntar "¿qué subagentes tienes disponibles?".

## Preparar la app para que la "usen" (recomendado)

Los agentes funcionan leyendo el código, pero los hallazgos son mucho mejores si usan la app de verdad:

- **App corriendo** en local o en un ambiente de pruebas, nunca en producción con datos reales.
- **Datos de prueba realistas:** uno o dos proyectos con presupuesto, unos cuantos proveedores, contratistas, requisiciones y pagos en distintos estados.
- **Un usuario de prueba por rol,** para que cada agente vea lo que vería esa persona con sus permisos.
- **Navegador conectado a Claude Code** (la extensión de Chrome o el navegador integrado del escritorio).
- **Cuando usen el navegador, córrelos de a uno** o pide que cada uno abra su propia pestaña. Varios agentes manejando el mismo navegador al tiempo se estorban.

## Cómo correr una revisión

### Primera prueba: un solo rol
Empieza con uno solo para calibrar antes de gastar en los diez:

```
Usa el subagente rol-director-obra para revisar el módulo de proyectos.
La app está corriendo en http://localhost:3000 (usuario de prueba: director@prueba).
Guarda su informe en docs/agentes/revisiones/2026-10-16/director-obra.md.
```

Lee el informe. Si es muy genérico, agrega detalles al archivo del rol o al contexto, y repite.

### Revisión completa: tu sesión principal actúa como líder
Pega algo así en Claude Code:

```
Vas a coordinar una revisión de la app por roles. Tú eres el líder.

1. Lee docs/agentes/contexto-conyca.md y docs/agentes/roadmap-app.md.
2. Lanza los subagentes de rol (rol-*) que apliquen a [MÓDULOS A REVISAR].
   Dale a cada uno: el módulo a revisar, la URL de la app y su usuario de prueba.
   [Si usan navegador: córrelos uno por uno.]
3. Guarda el informe de cada rol, sin editarlo, en
   docs/agentes/revisiones/<fecha>/<rol>.md
4. Cuando terminen todos, escribe docs/agentes/revisiones/<fecha>/consolidado.md con:
   - Los 10 hallazgos más importantes, priorizados (P1 primero), indicando qué roles los reportaron.
   - Hallazgos repetidos entre roles, unidos en uno solo.
   - Conflictos entre roles (lo que uno pide y otro rechaza), con una recomendación.
   - Problemas de traspaso entre roles.
   - Riesgos de control.
   - Lista de "sobra / simplificar".
   - Todas las preguntas para mí, agrupadas por la persona real a quien debo hacérselas.
   - Un backlog propuesto: falta / mejorar / quitar, con prioridad y esfuerzo estimado (S/M/L).
5. No modifiques código. Esto es solo diagnóstico.
```

### Revisiones parciales
No hace falta llamar a los diez cada vez. Elige los roles que tocan el módulo que cambiaste:

| Módulo | Roles que conviene llamar |
|---|---|
| Presupuesto / APU | director de obra, gerencia, compras |
| Requisiciones y compras | director de obra, compras, almacenista, gerencia, tesorería |
| Almacén | almacenista, director de obra, gerencia |
| Contratos y actas | director de obra, jurídica, gerencia, contabilidad |
| Pagos y dispersores | tesorería, contabilidad, gerencia, financiera |
| RRHH | rrhh, contabilidad, tesorería |
| Usabilidad general | auxiliar administrativo + el rol dueño del módulo |

## Costos y consejos

- **Cada subagente consume tokens por su cuenta.** Diez revisiones en paralelo gastan bastante más que una sesión normal. Empieza con 3 o 4 roles.
- **Los "Preguntas para Luis" son oro.** Llévaselas a las personas reales: lo que respondan va al archivo de su rol, y los agentes mejoran con cada ronda.
- **Lo que digan los agentes son hipótesis, no verdad.** Antes de construir algo grande, valídalo con quien hace ese trabajo.
- **Edita los roles cuando aprendas algo.** Si el almacenista real te dice "nunca tenemos señal en bodega", agrégalo a `rol-almacenista.md`.

## Siguientes pasos posibles
- **Ronda de debate con agent teams** (experimental): los mismos roles discuten entre sí los conflictos del consolidado.
- **Comando reutilizable:** convertir el prompt del líder en una habilidad propia (por ejemplo `/revision-roles`) para correrlo con un solo comando.
- **Memoria por rol:** el campo `memory: project` deja que cada agente recuerde lo que vio en revisiones anteriores. Tiene una contra: le da permiso de escribir en su carpeta de memoria.
