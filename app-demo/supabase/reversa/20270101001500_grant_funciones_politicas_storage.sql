-- Reversa de 20270101001500 (vuelve a romper la lectura de archivos: no correr salvo para deshacer).
revoke execute on function public._puede_ver_rut(uuid) from authenticated;
revoke execute on function public._ve_balances(uuid) from authenticated;
