-- Esquema inicial del lector Pneuma: perfiles, catálogo, pedidos, biblioteca y datos de lectura.
-- Modelo de venta: se compra en la web; la app solo lee lo que está en la biblioteca del usuario.

-- ---------- Perfiles ----------
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text,
  rol text not null default 'lector' check (rol in ('lector', 'editor', 'admin')),
  creado_en timestamptz not null default now()
);

create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre) values (new.id, new.raw_user_meta_data ->> 'nombre');
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

create or replace function public.es_editor()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('editor', 'admin'));
$$;

-- ---------- Catálogo ----------
create table public.libros (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  autor text not null,
  descripcion text,
  formato text not null check (formato in ('epub', 'pdf')),
  archivo_ruta text not null,          -- ruta en el bucket privado "libros": <libro_id>/<archivo>
  portada_ruta text,                   -- ruta en el bucket público "portadas"
  color text,                          -- color de respaldo para la portada generada
  precio_centavos integer not null default 0 check (precio_centavos >= 0),
  moneda text not null default 'GTQ',
  publicado boolean not null default false,
  creado_en timestamptz not null default now()
);

-- ---------- Pedidos (se crean en la tienda web) ----------
create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  libro_id uuid not null references public.libros (id),
  metodo text not null check (metodo in ('paypal', 'tarjeta', 'fri', 'deposito', 'gratis')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'cancelado')),
  monto_centavos integer not null check (monto_centavos >= 0),
  moneda text not null default 'GTQ',
  referencia text,                     -- id de PayPal o pasarela, número de boleta, etc.
  comprobante_ruta text,               -- foto de la boleta en depósitos
  creado_en timestamptz not null default now(),
  pagado_en timestamptz
);
create index on public.pedidos (usuario_id);

-- ---------- Biblioteca: libros a los que cada usuario tiene acceso ----------
create table public.biblioteca (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  libro_id uuid not null references public.libros (id) on delete cascade,
  pedido_id uuid references public.pedidos (id),
  agregado_en timestamptz not null default now(),
  primary key (usuario_id, libro_id)
);

-- Al marcar un pedido como pagado, el libro entra a la biblioteca.
create or replace function public.entregar_pedido()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.estado = 'pagado' and (old.estado is distinct from 'pagado') then
    new.pagado_en := coalesce(new.pagado_en, now());
    insert into public.biblioteca (usuario_id, libro_id, pedido_id)
    values (new.usuario_id, new.libro_id, new.id)
    on conflict (usuario_id, libro_id) do nothing;
  end if;
  return new;
end $$;

create trigger al_pagar_pedido before insert or update of estado on public.pedidos
  for each row execute function public.entregar_pedido();

-- Libros gratuitos: el usuario los agrega sin pasar por pago.
create or replace function public.agregar_libro_gratis(p_libro uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Debes iniciar sesión'; end if;
  if not exists (select 1 from public.libros where id = p_libro and publicado and precio_centavos = 0) then
    raise exception 'Este libro no es gratuito';
  end if;
  insert into public.biblioteca (usuario_id, libro_id) values (auth.uid(), p_libro)
  on conflict do nothing;
end $$;

-- ---------- Datos de lectura ----------
create table public.progreso_lectura (
  usuario_id uuid not null references auth.users (id) on delete cascade,
  libro_id uuid not null references public.libros (id) on delete cascade,
  ubicacion text not null,             -- CFI en EPUB, número de página en PDF
  porcentaje real not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (usuario_id, libro_id)
);

create table public.marcadores (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  libro_id uuid not null references public.libros (id) on delete cascade,
  ubicacion text not null,
  etiqueta text not null default '',
  creado_en timestamptz not null default now()
);
create index on public.marcadores (usuario_id, libro_id);

create table public.subrayados (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  libro_id uuid not null references public.libros (id) on delete cascade,
  ubicacion text not null,             -- rango CFI
  texto text not null,
  nota text not null default '',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index on public.subrayados (usuario_id, libro_id);

-- ---------- Seguridad a nivel de fila ----------
alter table public.perfiles enable row level security;
alter table public.libros enable row level security;
alter table public.pedidos enable row level security;
alter table public.biblioteca enable row level security;
alter table public.progreso_lectura enable row level security;
alter table public.marcadores enable row level security;
alter table public.subrayados enable row level security;

create policy "ver mi perfil" on public.perfiles for select using (id = auth.uid() or public.es_editor());
create policy "editar mi nombre" on public.perfiles for update using (id = auth.uid()) with check (id = auth.uid());
-- El usuario solo puede cambiar su nombre; el rol lo asigna un administrador desde el panel de Supabase.
revoke update on public.perfiles from authenticated, anon;
grant update (nombre) on public.perfiles to authenticated;

create policy "ver catálogo publicado" on public.libros for select using (publicado or public.es_editor());
create policy "editores gestionan catálogo" on public.libros for all using (public.es_editor()) with check (public.es_editor());

-- El usuario solo crea pedidos pendientes; el pago lo confirma la pasarela (clave de servicio) o un editor.
create policy "ver mis pedidos" on public.pedidos for select using (usuario_id = auth.uid() or public.es_editor());
create policy "crear pedido pendiente" on public.pedidos for insert
  with check (usuario_id = auth.uid() and estado = 'pendiente' and metodo <> 'gratis');
create policy "editores confirman pedidos" on public.pedidos for update using (public.es_editor()) with check (public.es_editor());

create policy "ver mi biblioteca" on public.biblioteca for select using (usuario_id = auth.uid() or public.es_editor());
create policy "editores gestionan bibliotecas" on public.biblioteca for all using (public.es_editor()) with check (public.es_editor());

create policy "mi progreso" on public.progreso_lectura for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "mis marcadores" on public.marcadores for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
create policy "mis subrayados" on public.subrayados for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- ---------- Almacenamiento ----------
insert into storage.buckets (id, name, public) values ('libros', 'libros', false), ('portadas', 'portadas', true), ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

-- Archivos de libros: solo quien lo tiene en su biblioteca (o un editor) puede leerlos. Ruta: <libro_id>/<archivo>
create policy "leer libros de mi biblioteca" on storage.objects for select using (
  bucket_id = 'libros' and (
    public.es_editor() or exists (
      select 1 from public.biblioteca b
      where b.usuario_id = auth.uid() and b.libro_id::text = (storage.foldername(name))[1]
    )
  )
);
create policy "editores suben libros" on storage.objects for insert with check (bucket_id in ('libros', 'portadas') and public.es_editor());
create policy "editores cambian libros" on storage.objects for update using (bucket_id in ('libros', 'portadas') and public.es_editor());
create policy "editores borran libros" on storage.objects for delete using (bucket_id in ('libros', 'portadas') and public.es_editor());

-- Comprobantes de depósito: cada usuario sube y ve los suyos en <usuario_id>/...; los editores los revisan.
create policy "subir mi comprobante" on storage.objects for insert with check (
  bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "ver comprobantes" on storage.objects for select using (
  bucket_id = 'comprobantes' and ((storage.foldername(name))[1] = auth.uid()::text or public.es_editor())
);
