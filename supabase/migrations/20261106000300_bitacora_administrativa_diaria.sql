-- LOCAL: pendiente de revisión y aplicación autorizada. No ejecutar remotamente sin autorización.
-- Un registro nuevo por fecha de México y área. Conserva todos los duplicados históricos.
-- No modifica roles, RLS/RPC existentes, actividades ni auditoría.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- Evita escrituras entre el recuento inicial y la instalación del trigger.
lock table public.bitacora_administrativa in share row exclusive mode;
create table private.bitacora_administrativa_dias (
  area text not null check (area in ('ptar','calderas','obra_civil')),
  fecha date not null,
  registros bigint not null check (registros >= 0),
  primary key (area,fecha)
);
alter table private.bitacora_administrativa_dias enable row level security;
revoke all on private.bitacora_administrativa_dias from public,anon,authenticated,service_role;
insert into private.bitacora_administrativa_dias(area,fecha,registros)
  select area,fecha,count(*) from public.bitacora_administrativa group by area,fecha;

-- Un contador privado permite conservar duplicados anteriores sin admitir otros nuevos.
-- La PK y ON CONFLICT serializan la reserva, incluso si llegan solicitudes concurrentes.
create function private.proteger_bitacora_administrativa_diaria()
returns trigger language plpgsql security definer set search_path='' as $funcion$
begin
  if tg_op='UPDATE' then
    if row(new.area,new.fecha) is not distinct from row(old.area,old.fecha) then return new; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    insert into private.bitacora_administrativa_dias(area,fecha,registros)
      values(new.area,new.fecha,1)
      on conflict(area,fecha) do update set registros=1
        where private.bitacora_administrativa_dias.registros=0;
    if not found then
      raise exception using errcode='23505',
        constraint='bitacora_administrativa_unica_diaria',
        message='Ya existe una actividad para esta fecha y área. Usa Corregir en el historial.';
    end if;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    update private.bitacora_administrativa_dias set registros=registros-1
      where area=old.area and fecha=old.fecha and registros>0;
    if not found then
      raise exception using errcode='55000',message='El control diario requiere revisión antes de modificar la actividad.';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$funcion$;
alter function private.proteger_bitacora_administrativa_diaria() owner to postgres;
revoke all on function private.proteger_bitacora_administrativa_diaria() from public,anon,authenticated,service_role;
create trigger proteger_bitacora_administrativa_diaria
  before insert or update or delete on public.bitacora_administrativa
  for each row execute function private.proteger_bitacora_administrativa_diaria();

comment on table private.bitacora_administrativa_dias is 'Control transaccional de una actividad diaria por área; conserva y cuenta duplicados históricos. No consultar desde clientes. Cambios solo mediante triggers de bitacora_administrativa.';
commit;