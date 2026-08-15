---
title: Director's guide — PANOPTICON OS
description: How to shoot, cue, and deliver takes with the PANOPTICON OS scene tool.
ms.date: 2026-08-11
ms.topic: how-to
---

# Director's guide

This is the on-set manual for the person filming: how to set up a shoot,
run a take, cue the fiction live, and get footage that cuts together.

If you only read one thing: **press `?` in the app.** It lists every
shortcut plus the cues for whatever scene is on screen.

---

## 1. Before the first take (5-minute setup)

Open the app (`pnpm dev` → <http://localhost:5173/>). The **DIRECCIÓN**
panel is bottom-right; drag it by its title bar, hide it with `Ctrl+H`.
Only the canvas is ever recorded — the panel, the REC badge, the count-in
and every warning banner are DOM overlays and never appear in footage.

Set these once and they persist across reloads and shoot days:

| Where | What to set | Why |
|---|---|---|
| **CAPTURA → FORMATO** | `1080P` (default), `1440P`, `4K`, or `9:16` | Pins the render to that exact resolution, letterboxed on screen. Every take matches, whatever the window does. `VENTANA` follows the browser window instead — only pick it if you want a non-standard size. |
| **CAPTURA → ARCHIVO** | `MP4` (default) or `WEBM` | MP4/H.264 drops straight into any NLE. WEBM is the fallback if a browser can't encode MP4; the TOMA row always shows which one you'll actually get. |
| **CAPTURA → AUDIO** | on if you want scratch sound | Mixes your mic into the take so you have a reference track to sync real audio against. |
| **CAPTURA → REVISAR 1º / AUTO-GUARDA** | `REVISAR 1º` (default) | Review-first: takes land in the list and you choose. `AUTO-GUARDA` saves every take to disk the instant you cut. |
| **CAPTURA → CUENTA** | 3, 5, or 10 s | Count-in length. Pick 10 s if you have to cross the room into frame. |
| **LOOK → TÍTULO** | your production name | Goes in the cinematic, on the burned-in slate, and in every filename. Set it before you shoot anything. |
| **LOOK → TEMA / AMBIENTE** | palette + CRT feel | Sliders show numeric values, so a look is reproducible. `RESET LOOK` restores the factory values. |

The panel's lower half is collapsible. Leave `CAPTURA` and `MEDIA` open
while prepping, then collapse everything for a lean shoot-mode panel —
the section headers keep showing a summary of what's inside.

---

## 2. Running a take

1. **Pick the scene** — the `ESCENA` row. Each button rebuilds that
   scene from scratch.
2. **Load footage** if the scene has cameras — `MEDIA → VIDEO`, or just
   drag a video file onto the window you want it in. Dropping on CAM-B
   feeds CAM-B. Dropping image files anywhere loads them as gallery
   dossiers.
3. **Roll** — `● GRABAR` (or `Ctrl+G`). Use `● EN 3S` when you're the one
   on camera; a full-screen countdown runs (click or `Esc` cancels) and
   never appears in footage.
4. **Perform and cue** — see §3.
5. **Cut** — `■ CORTAR` or `Ctrl+G` again.
6. **Review and circle** — see §4.

Every take opens with a ~1.6 s burned-in slate showing **production
title, take number, scene name, and wall clock**, so a clip is
identifiable on sight in the bin.

### What's protected while you're rolling

Recording used to sit one mis-click away from disaster. Now, while REC is
live:

- **Scene buttons, RECARGA, and REINICIAR dim and need two clicks.** The
  first click arms the button (it turns amber and the panel says
  `PULSA DE NUEVO PARA CONFIRMAR`); the second commits. Arming expires
  after 4 seconds.
- **`Ctrl+R` is blocked** — it tells you to cut first.
- **Window resizing can't touch the take.** Resizing no longer rebuilds
  the scene mid-recording, so window positions, loaded footage and scene
  state all survive. With a fixed FORMATO it can't affect the frame at
  all.
- **Closing the tab warns you** if a take is rolling or any take is
  unsaved.

Cues, ambience, theme, and message injection are *performance* controls —
they stay instant and unguarded, because that's what you fire mid-take.

---

## 3. Cueing the fiction live

The `CUES` row shows only what the current scene can respond to. Two
things make it usable under pressure:

- **Number keys 1-9 fire the cues in order.** The digit is printed on
  each button. No mousing through a dense panel next to destructive
  controls.
- **Mode cues light up when active.** `PERSECUCIÓN`, `PATRULLA`,
  `SEGUIR`, `RAYOS-X` and friends render as pressed when that mode is on,
  so you can see the scene's state without decoding the canvas.

The `ESTADO` row underneath spells out the current scene's live values
(mode, follow, city, zoom, page, dossier count, active metal layer…).

Also always available:

- `MENSAJE` → `REGISTRO` (log line), `ALERTA` (in danger red), `AVISO`
  (blinking status-bar directive).
- `AMBIENTE → RÁFAGA` — a momentary heavy glitch/tear burst for cuts and
  dramatic hits.
- `TIEMPO` — scene-clock timecode, play, pause, `+1F`, `+1S`, reset, and
  a speed slider. **Pause and speed now drive real footage too**, not
  just the fiction: `PAUSA` freezes the video in every scene, and the
  speed slider retimes it.

---

## 4. Takes, review, and delivery

Cutting a take puts it in the list under `TOMA` — it is **not** saved to
disk unless you say so (or you turned on `AUTO-GUARDA`).

Each row shows `T## · SCENE · duration · size`, and hovering shows the
filename, resolution and whether it has audio.

- **`VER`** plays the take inline in the panel. No new tab.
- **`◎ BUENA`** circles the take: downloads it and marks it a keeper.
  Circled takes are never auto-evicted from the list.
- **`NG`** discards it and frees the memory.

The list holds the 8 most recent takes (plus every circled one). It lives
in memory, so **save the ones you want before reloading** — the tab-close
warning will remind you, but it can't stop a crash.

### Filenames

```
<production>-<scene>-t<take>-<timestamp>.mp4
noche-cerrada-vigilancia-t03-2026-08-11-14-22-07.mp4
```

Stills from `FOTO` follow the same stem with `-foto`. Sorting a bin by
name now groups by production, then scene, then take.

---

## 5. Working with real footage

`MEDIA → VIDEO` pipes a file or your webcam into each camera slot the
current scene has; the `⨯A`/`⨯B` buttons clear one slot at a time.
`CARGADO` shows what's currently in each slot — no more guessing.

**Footage survives scene changes.** The session media bin remembers what
you pointed at each slot and re-attaches it automatically when you hop
scenes and come back. `MEDIA → MEDIA` (under `SISTEMA → RECARGA`) is the
explicit "forget everything and start clean".

`VISIÓN` (`Ctrl+I`) toggles real object detection and tracking on video
feeds — bracket lock-ons, track IDs, Spanish class labels, confidence,
motion trails, `FIJADO` stamps. It runs locally (MediaPipe, self-hosted,
works offline).

---

## 6. Scenes at a glance

| Scene | What's on screen | Signature cues |
|---|---|---|
| `BOOT` → `LOGIN` → `HYPERVIGILANCIA` | The opening: POST roll, credential typing, surveillance wall + title card | — |
| `VIGILANCIA` | Activity log, two camera feeds, telemetry, radar | `IDENTIFICAR`, `±SUJETO` |
| `MAPA` | Procedural tactical city map | `MOVER OBJETIVO`, `PERSECUCIÓN` |
| `GEO` | Real OpenStreetMap tiles, GPS pursuit | `INTERCEPTAR`, `SEGUIR`, `ZOOM±`, `CIUDAD`, plus `UBICAR` for exact lat/lon |
| `GALERÍA` | Dossier board from your own images | `SILENCIAR TODO`, `CAPTURAR TODO`, paging |
| `SENSORES` | Seismic/acoustic/RF scopes, SIGINT waterfall | `SISMO`, `TRANSMISIÓN`, `ALERTA QUÍMICA` |
| `LLAMADA` | Encrypted videoconference | `CAMBIAR VOZ`, `CAÍDA DE SEÑAL` |
| `CHIP` / `PLACA` | Silicon floorplan / board assembly | `TAPEOUT`, `RAYOS-X`, `FALLA` |
| `IMPLANTE` / `LEALTAD` / `ANÁLISIS` | Body telemetry, loyalty scoring, live camera judgement | `PÁNICO`, `DISIDENCIA`, `INDULTO` |
| `FX STUDIO` | Full-screen video effects rig | presets + 15 effect sliders |
| `SILENCE` | Full-screen target; click to freeze and mark `SILENCED` | — |

**GEO locations:** `CIUDAD` cycles the presets (Mexico City, Madrid,
Buenos Aires, Berlin, Tokyo). To shoot a specific real place, type
coordinates into `UBICAR` with an operation name and press `IR` — it's
added to the cycle for the rest of the session. Tiles stream from
OpenStreetMap, so that scene needs a network connection; offline it
degrades to a placeholder grid with a `SINCRONIZANDO` downlink readout
rather than breaking.

---

## 7. When something goes wrong

| Symptom | What it means | What to do |
|---|---|---|
| Red **LIENZO CONGELADO** banner | The p5 draw loop stopped. Anything recorded from now on is a dead frame. | Reload the page. Save any circled takes first if you can. |
| `SIN CODEC` in the TOMA row | The browser can't encode either container. | Use a Chromium browser (Edge/Chrome). |
| Webcam or mic button flashes a red note | Permission denied or no device. | Grant permission in the browser, then press it again. |
| GEO map shows only a grid + `SINCRONIZANDO` | No network, or tiles still downloading. | Wait, or check the connection. |
| Take list empty after a reload | The list is in-memory only. | Circle (`◎ BUENA`) takes you want before reloading. |

---

## 8. Shortcut reference

| Key | Action |
|---|---|
| `Ctrl+G` | Record / cut |
| `Ctrl+H` | Hide / show the panel |
| `Ctrl+I` | Vision (detection + tracking) on/off |
| `Ctrl+R` | Restart from BOOT — blocked while rolling |
| `Ctrl+1`…`5` | Color palette |
| `1`…`9` | Fire the current scene's cues |
| `?` | Shortcut + cue cheat sheet |
| `Esc` | Cancel a count-in · leave a text field |

Windows on the canvas drag by their title bar and raise on click; the
focused window draws a brighter frame. `SISTEMA → ORDENAR VENTANAS` puts
them back without discarding loaded footage.
