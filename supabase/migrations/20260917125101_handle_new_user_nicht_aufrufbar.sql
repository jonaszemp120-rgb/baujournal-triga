-- handle_new_user ist eine Trigger-Funktion und laeuft als security definer.
-- Ueber /rest/v1/rpc waere sie sonst von aussen aufrufbar, das gehoert
-- zugemacht. Der Trigger auf auth.users laeuft davon unberuehrt weiter,
-- der braucht kein execute-Recht der Aufruferrolle.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
