-- Catálogo de mano de obra: categorías de ISVIMED con "(incluye retiro)"
-- (decisión del usuario, 2026-11-12).
--
-- Las 145 categorías del 2026-09-03 salen de "Relacion mano de obra.xlsx", que
-- trae nombres cortos. La lista completa de ISVIMED ("PRECIOS ACTUALIZADOS
-- ISVIMED.xlsx", docs/fuentes-precios) dice en cada actividad qué incluye. A
-- las que incluyen "cargue, retiro, transporte y disposición final de
-- escombros" se les agrega solo " (incluye retiro)", no el párrafo completo,
-- para no dañar la búsqueda por similitud. Mismo formato que ya tenía
-- "Demolicion de placa de contrapiso(incluye retiro)".
--
-- No se tocan: las que ya dicen "Retiro de ..." (aparatos sanitarios, cubierta
-- en teja de barro), las de preparación de superficie (su "retiro" es de
-- pintura o partículas, no de escombros) ni las que solo vienen del precio del
-- Cesar (sin descripción de ISVIMED). Ninguna está usada en un APU.
-- Se puede correr más de una vez (solo cambia si el nombre sigue igual).

update public.mano_obra_categorias as m
   set categoria = m.categoria || ' (incluye retiro)',
       updated_at = now()
  from (values
    ('96842538-b7b2-46a8-b4be-112dffe9629c'::uuid, 'Demolicion Mamposteria en Ladrillo'),            -- ISVIMED 10101
    ('26e16f40-78e5-46cb-8438-f4d66830ab9e'::uuid, 'Demolicion de piso en mortero'),                 -- 10102
    ('54357d76-91f4-41c1-b8ed-7df08ffb7868'::uuid, 'Demolicion de penchape de pared'),               -- 10103
    ('b96c48c5-74f9-4c3b-9cde-427e850a61a3'::uuid, 'Demolicion de Revoque'),                         -- 10105
    ('05c48b09-c288-4b76-8e96-7cb0f9e64afa'::uuid, 'DESMONTE DE CUBIERTA EN FIBROCEMENTO'),          -- 10106
    ('7b07451e-8dfa-4206-bd19-2f9446cd9a5d'::uuid, 'Desmonte de lavaplatos'),                        -- 10112
    ('497371a3-508d-44d6-a8fd-1eb752051847'::uuid, 'Demolicion de meson en concreto'),               -- 10113
    ('077ad3e1-b155-4613-9b24-2f0f75c8bb25'::uuid, 'Demolicion de estructuras de concreto'),         -- 10114
    ('15f1adff-ad2e-4e61-bbb0-f362b76755b1'::uuid, 'Excavacion manual de material heterogeneo de 0-2m de profundidad') -- 10201
  ) as v(id, nombre)
 where m.id = v.id
   and m.categoria = v.nombre;
