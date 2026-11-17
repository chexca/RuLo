<div align="center">
  <img src="public/favicon.png" alt="RuLo" width="96" height="96" />
  <h1>RuLo</h1>
  <p><strong>Entrenador minimalista de ciclismo indoor en modo ERG para Windows</strong></p>
</div>

**RuLo** es una aplicación de escritorio ligera y sin suscripciones pensada para entrenar en rodillo inteligente (probada con **Tacx Neo 2**) con control directo por **ANT+ USB** y **Bluetooth**, sin bloatware ni cuotas anuales.

## Características principales

- **Menú directo**:
  - **Solo Rodar**: rodaje libre inmediato **con ERG** (fija vatios manualmente o salta de zona con `Zona -` / `Zona +` y píldoras `Z1`–`Z6`) o **sin ERG** (resistencia base libre ajustable).
  - **Mis Workouts**: biblioteca de sesiones estructuradas con bloques fijos, rampas progresivas, generador rápido de series e importación de `.ZWO`, `.MRC`, `.ERG` y `.JSON`.
- **Conectividad hardware**:
  - **ANT+ USB (FE-C)**: soporte nativo para pinchos `ANT USB-m` / `Stick 2` (incluyendo driver `libusb-win32` vía `libusb0.dll` sin tocar drivers) y **pulsómetro ANT+ en paralelo** (Canal 1).
  - **Bluetooth (BLE)**: soporte para **Tacx FE-C sobre BLE** y **FTMS** estándar.
  - **Simulador Virtual**: prueba sesiones y exportaciones sin conectar la bici.
- **Cockpit adaptado al rodillo**:
  - Suavizado de potencia configurable (`Inst.` / `3s` / `5s`), avisos sonoros de cambio de bloque, gráfica en vivo y cálculo de calorías (`kcal` / `kJ`) y zonas de pulso Karvonen (`Z1`–`Z5`).
  - **Modo Sin Reloj / Blur y Ocultación**: desenfoca u oculta cualquier cronómetro o métrica durante la sesión para entrenar sin mirar el reloj.
- **Exportación y Garmin Connect**:
  - Exportación local en **`.TCX`** y **`.FIT`**.
  - **Conector directo con Garmin Connect** (sesión persistente compatible con 2FA y subida automática opcional al finalizar).

## Instalación rápida (Windows)

Descarga **`RuLo-ERG-1.0.0-Setup.exe`** desde la sección [Releases](../../releases) y ejecútalo.

## Desarrollo local

```powershell
npm.cmd install
npm.cmd run build
npm.cmd run dist:win   # Genera el instalador en release/
```
