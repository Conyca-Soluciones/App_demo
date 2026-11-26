-- Reversa de 20270101007300: solo si ya no hay políticas que llamen a
-- _puede_revisar_cuentas (si no, Terceros vuelve a fallar).
revoke execute on function public._puede_revisar_cuentas(uuid) from authenticated;
