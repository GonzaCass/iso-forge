# Validación de v0.1.0

- TypeScript y compilación Vite: correctos.
- 14 pruebas del motor: descarga verificada, reanudación Range, servidor que ignora Range, rango incorrecto, paquete incompleto, SHA-256 incorrecto, hosts de Microsoft, nombres de archivo, metadatos XML, rechazo Evaluation, reconocimiento de la imagen en la ISO y reintentos del catálogo.
- 5 pruebas de interfaz con Playwright/Edge: selección, destino, inicio, progreso y pausa; biblioteca vacía; ayuda; ausencia de desbordamiento a 375, 768 y 1360 px.
- Electron real: renderer aislado sin `require`, puente IPC, protocolo local y consulta del catálogo Retail con Standard completa.
- Verificador de la app ejecutado sobre una ISO real de Server 2022: BIOS y UEFI reconocidos, edición Standard con escritorio confirmada.
- ESD de referencia: `ServerStandard_es-es.esd`, SHA-256 `3525f2813852836e15154365978bc96f569566a3774ca2290e30c896820a3160`.
- El motor nativo de la app creó una ISO real de Server 2022 Standard sin administrador. Se extrajo `install.wim` de esa ISO con la herramienta usada por la app; su integridad pasó la verificación y sus metadatos confirmaron Standard con escritorio, versión 10.0.20348.1. También pasó la comprobación BIOS/UEFI.

La imagen base de referencia es **10.0.20348.1**, aunque el catálogo utilizado incluye actualizaciones 20348.5622 separadas. No se confunde la compilación del catálogo con la imagen instalada.

No se realizó un arranque de VM, una instalación completa ni pruebas de conversión de cada edición de Windows 10, Windows 11 o Server 2025. La integración avanzada de actualizaciones y aplicaciones usa el conversor upstream; sigue pendiente la matriz de pruebas de esas variantes.
