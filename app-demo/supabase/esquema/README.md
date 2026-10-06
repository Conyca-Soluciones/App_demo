# Esquema real de producción

Volcado del esquema de la base de producción (proyecto Supabase **App-demo**), sacado
**con solo lectura** el 2026-10-02 desde los catálogos (`pg_get_functiondef`,
`pg_get_constraintdef`, `pg_indexes`, `pg_policies`, …). No hay datos, solo estructura.

**No es una migración.** Las migraciones de `supabase/migrations/` no reflejan la base:
producción tiene 92 migraciones registradas y el repo 42, y algunas se aplicaron a mano.
Este volcado es la referencia de cómo está la base de verdad.

| Archivo | Contenido |
|---|---|
| `00_stubs_local.sql` | Roles y esquemas `auth`/`storage` mínimos para cargarlo fuera de Supabase |
| `01_tablas.sql` | Extensiones, secuencias y las 42 tablas de `public` (columnas y defaults) |
| `02a..02d_funciones.sql` | Las 110 funciones de `public`, en orden alfabético |
| `03_restricciones.sql` | 227 PK/UNIQUE/CHECK/FK, 178 índices, la vista `requisiciones_vista` y 15 triggers |
| `04_seguridad.sql` | RLS, 84 políticas de `public` + 6 de `storage`, buckets, permisos de funciones y tablas |

Se excluyó `_tmp_auditoria_buscar`, una tabla temporal que quedó en producción.

## Cargarlo en un Postgres local

```sh
createdb esquema
for f in 00_stubs_local 01_tablas 02a_funciones 02b_funciones 02c_funciones 02d_funciones 03_restricciones 04_seguridad; do
  psql -v ON_ERROR_STOP=1 -d esquema -f "$f.sql" || break
done
```

Se validó así en Postgres 16: carga sin errores y los conteos (tablas, políticas,
triggers, restricciones, índices, vistas) coinciden con producción.

## Volver a sacarlo

Las consultas son de solo lectura sobre los catálogos. Las funciones salen con:

```sql
select string_agg(pg_get_functiondef(p.oid)||';', E'\n\n' order by p.proname, p.oid)
from pg_proc p left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and d.objid is null;
```
