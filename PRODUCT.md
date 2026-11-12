# COPAMEX — Contexto del producto

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Aplicación interna de COPAMEX para operadores de Calderas y PTAR, personal de Calidad de agua y personal administrativo dentro de una planta industrial.

- Los operadores registran turnos, lecturas, mediciones y bitácoras de sus áreas.
- Calidad consulta sus módulos e información de calidad de agua.
- Administración supervisa la operación, revisa capturas y genera reportes.

## Product Purpose

Facilitar el registro y la consulta de información operativa para que los operadores trabajen rápidamente y Administración supervise sin complicaciones.

Las prioridades, en orden, son:

1. Captura rápida, sencilla y sin errores.
2. Interfaces limpias, compactas y fáciles de entender.
3. Formularios claros que reduzcan equivocaciones al registrar mediciones.
4. Supervisión rápida para Administración, con información útil y sin datos repetidos.
5. Consulta sencilla de reportes técnicos e históricos.

## Operating Context

El uso principal ocurre en computadoras de escritorio dentro de la planta. La aplicación también debe adaptarse a celulares y tablets para consultar información y utilizar las funciones autorizadas para cada usuario.

Los flujos existentes incluyen turnos, bitácoras, Calderas, PTAR, Pozos, Ultrafiltración, Calidad de agua, consulta de planta, revisión administrativa y reportes. Las rutas y los permisos actuales determinan qué funciones puede utilizar cada rol.

## Capabilities and Constraints

- Conservar los permisos, las validaciones y la lógica de guardado existentes; respetar la separación entre Administración y operadores.
- Mantener la terminología operativa, las unidades y los datos técnicos de los registros.
- Reutilizar los componentes existentes y realizar cambios mínimos dentro del alcance solicitado.
- Conservar los cambios en curso del usuario.
- No modificar SQL, Supabase, políticas RLS ni funciones RPC sin autorización explícita para la tarea.
- No realizar commits, push ni despliegues sin autorización explícita.
- La implementación existente utiliza React, TypeScript y Vite, con Supabase para los servicios conectados.

## Brand Commitments

Conservar la identidad actual de COPAMEX, incluyendo el sidebar azul marino y sus iconos.

No agregar emojis, fotografías decorativas, iconos innecesarios, animaciones excesivas ni textos explicativos redundantes. Mantener textos claros, breves y útiles para completar las tareas.

## Evidence on Hand

- Aplicación existente: rutas en `src/App.tsx`, vistas y accesos en `src/pages/Inicio.tsx`, roles en `src/lib/tiposAuth.ts`.
- Componentes de interfaz existentes en `src/components/diseno/`.
- Recursos de marca existentes en `public/`, incluidos `CPXLOGO.png`, `copamex.png` y los iconos de módulos.
- Usuarios, contexto de uso, prioridades y compromisos de identidad confirmados por el usuario durante la inicialización.

No se han establecido métricas cuantitativas de éxito ni afirmaciones comerciales; no inventarlas.

## Product Principles

1. Reducir el esfuerzo y los errores en la captura operativa.
2. Mostrar la información necesaria para cada tarea y rol, evitando redundancias y desplazamientos innecesarios.
3. Facilitar una supervisión rápida y la consulta de reportes e históricos.
4. Preservar la confianza en los datos mediante permisos, validaciones y confirmaciones de guardado claras.
5. Mantener continuidad con la identidad de COPAMEX y permitir el uso de las funciones autorizadas en escritorio, celulares y tablets.

## Accessibility & Inclusion

- Textos legibles y buen contraste.
- Botones grandes y fáciles de identificar.
- Navegación mediante teclado.
- Indicaciones y validaciones claras.
- Diseño responsive que permita consultar tablas completas en celulares sin contenido cortado.
- Evitar desplazamientos innecesarios y exceso de información.

No se ha definido un estándar formal de conformidad de accesibilidad ni necesidades asistivas adicionales.
