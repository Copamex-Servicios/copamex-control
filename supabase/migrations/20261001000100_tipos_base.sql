do $$
begin
  if to_regtype('public.rol_usuario') is null then
    create type public.rol_usuario
      as enum ('calderas', 'ptar', 'admin');
  end if;

  if to_regtype('public.area_planta') is null then
    create type public.area_planta
      as enum ('calderas', 'ptar');
  end if;

  if to_regtype('public.turno_tipo') is null then
    create type public.turno_tipo
      as enum ('dia', 'tarde', 'noche');
  end if;

  if to_regtype('public.estado_turno') is null then
    create type public.estado_turno
      as enum ('activo', 'finalizado', 'cancelado');
  end if;

  if to_regtype('public.estado_alerta') is null then
    create type public.estado_alerta
      as enum ('abierta', 'reconocida', 'cerrada');
  end if;
end;
$$;