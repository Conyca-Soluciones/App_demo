-- Corrección del IVA doble en el maestro de insumos (decisión del usuario,
-- 2026-10-15). Ver CLAUDE.md "IVA en el maestro de insumos".
--
-- En la mayoría de insumos con historial de compras (historico_precios_compra,
-- Excel de compras sept. 2026), vr_unitario era lo pagado CON IVA y vr_neto le
-- sumaba el IVA otra vez. Desde aquí: vr_unitario = SIN IVA, vr_neto = CON IVA
-- (una sola vez). Reglas del usuario:
--   G1  Todas las compras con 19 % y vr_unitario = promedio pagado con IVA
--       (±2 %): iva 19 %, vr_unitario = actual / 1,19, vr_neto = actual.
--   G2  Todas con 19 % y vr_unitario = promedio pagado sin IVA (±2 %): iva 19 %,
--       vr_neto = vr_unitario × 1,19.
--   G3  No todas con 19 %, iva actual > 0 y vr_unitario = pagado con IVA: se
--       quita el IVA doble con el % ACTUAL (vr_unitario = actual / (1 + iva),
--       vr_neto = actual). El % queda por confirmar (Excel de revisión).
--   Todo lo demás (mezclas, 0 %, 5 %, precio que no coincide, sin historial)
--   no se toca: lo confirma el usuario.
-- Antes de cambiar se guarda una copia en maestro_insumos_respaldo_iva_20261015
-- (sin acceso por la API). Para deshacer: update maestro_insumos m set
-- vr_unitario = r.vr_unitario, iva_porcentaje = r.iva_porcentaje, vr_neto =
-- r.vr_neto from maestro_insumos_respaldo_iva_20261015 r where r.id = m.id;
-- Los precios ya congelados en los APU (precio_unitario_congelado) no cambian.
-- Se puede correr más de una vez: el respaldo guarda los valores de antes y
-- las actualizaciones parten de él.

create table if not exists public.maestro_insumos_respaldo_iva_20261015 (
  id uuid primary key,
  codigo integer,
  vr_unitario numeric,
  iva_porcentaje numeric,
  vr_neto numeric,
  grupo text not null,
  respaldado_at timestamptz not null default now()
);
alter table public.maestro_insumos_respaldo_iva_20261015 enable row level security;
revoke all on public.maestro_insumos_respaldo_iva_20261015 from anon, authenticated;

-- Respaldo con el grupo de cada insumo (los valores de ANTES). Las
-- actualizaciones de abajo parten del respaldo, así que correr la migración
-- otra vez da el mismo resultado.
insert into public.maestro_insumos_respaldo_iva_20261015 (id, codigo, vr_unitario, iva_porcentaje, vr_neto, grupo)
with c as (
  select h.insumo_id,
         h.precio_unitario * (1 - coalesce(h.porcentaje_descuento, 0) / 100.0) as p,
         coalesce(h.iva_monto, 0) as iva
  from public.historico_precios_compra h
  where h.fuente <> 'test_desarrollo' and h.precio_unitario > 0
), h as (
  select insumo_id, count(*) as n, avg(p) as p_sin, avg(p + iva) as p_con,
         count(*) filter (where iva / p >= 0.12) as c19
  from c group by insumo_id
), g as (
  select mi.id, mi.codigo, mi.vr_unitario, mi.iva_porcentaje, mi.vr_neto,
         case
           when h.c19 = h.n and abs(mi.vr_unitario / nullif(h.p_con, 0) - 1) < 0.02 then 'G1'
           when h.c19 = h.n and abs(mi.vr_unitario / nullif(h.p_sin, 0) - 1) < 0.02 then 'G2'
           when h.c19 < h.n and coalesce(mi.iva_porcentaje, 0) > 0
                and abs(mi.vr_unitario / nullif(h.p_con, 0) - 1) < 0.02 then 'G3'
         end as grupo
  from public.maestro_insumos mi
  join h on h.insumo_id = mi.id
  where not coalesce(mi.excluye_iva, false)
    and mi.vr_unitario > 1
)
select id, codigo, vr_unitario, iva_porcentaje, vr_neto, grupo from g where grupo is not null
on conflict (id) do nothing;

-- G1: 19 %, el precio de antes es el pagado con IVA.
update public.maestro_insumos m
   set iva_porcentaje = 19,
       vr_unitario = round(r.vr_unitario / 1.19, 2),
       vr_neto = r.vr_unitario
  from public.maestro_insumos_respaldo_iva_20261015 r
 where r.id = m.id and r.grupo = 'G1';

-- G2: 19 %, el precio de antes ya estaba sin IVA.
update public.maestro_insumos m
   set iva_porcentaje = 19,
       vr_unitario = r.vr_unitario,
       vr_neto = round(r.vr_unitario * 1.19, 2)
  from public.maestro_insumos_respaldo_iva_20261015 r
 where r.id = m.id and r.grupo = 'G2';

-- G3: se quita el IVA doble con el % de antes (el % lo confirma el usuario).
update public.maestro_insumos m
   set iva_porcentaje = r.iva_porcentaje,
       vr_unitario = round(r.vr_unitario / (1 + r.iva_porcentaje / 100.0), 2),
       vr_neto = r.vr_unitario
  from public.maestro_insumos_respaldo_iva_20261015 r
 where r.id = m.id and r.grupo = 'G3';
