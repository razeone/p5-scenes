# UX Assessment — PANOPTICON OS as a filmmaking tool

> **Status: executed (2026-08-11).** Every P0–P2 finding below has been
> implemented, plus most of P3. See the per-item status markers, the
> summary in the README's "Filmmaker workflow pass", and
> [`director-guide.md`](director-guide.md) for the resulting workflow.
> `scripts/verify-director.mjs` guards the take-protection rules.
> This document is kept as the reasoning record, in the state it was
> written, with outcomes appended.

**Date:** 2026-08-10 · **Reviewer:** Claude (UX consultant pass)
**Scope:** the film creator's experience: staging scenes, directing cues,
recording takes, and getting usable footage into an edit. Grounded in the
current code (`ControlPanel.tsx`, `OSApp.ts`, `Recorder.ts`, `App.tsx`,
`App.css`, README walkthrough).

**Personas.** (1) *Solo operator* — one person is director, camera op and
actor; uses the count-in, hides the panel, performs on camera. (2)
*Director + actor* — director drives the panel off-camera while the actor
performs. Both work under take pressure: the cost of a mis-click while
rolling is a ruined performance, not just an annoyance.

The panel has already had a solid QA pass (focus rings, take list,
count-in, input routing — see README "UX QA audit"). This assessment is
the next layer: **protecting the take, fitting the film pipeline, and
reducing on-set cognitive load.**

---

## P0 — Protect the take (highest stakes, do first)

### 1. Nothing is guarded while recording
While REC is rolling, every destructive control stays live: any ESCENA
button instantly rebuilds the scene (`setPhase`), RECARGA disposes media,
Ctrl+R restarts to boot. One mis-click mid-performance destroys the take
with no warning. The ESCENA row sits directly under TOMA, so the miss
distance is ~20 px.
**Recommendation:** while `recording`, visually dim + require a second
click ("¿CORTAR Y CAMBIAR?") on scene/reload/restart controls. Keep cues,
ambience, message injection and theme live — those are *performance*
controls. (`ControlPanel.tsx`, gate on the existing `recording` prop.)

### 2. Window resize silently rebuilds the scene mid-take
`syncSize()` → `setPhase(scene.phase)` on any container size change
(`OSApp.ts:435`). A stray OS notification resize, dock/undock, or zoom
gesture wipes window drag positions, live feeds, and scene state (map
targets, GEO pursuit) — even while recording.
**Recommendation:** while recording, freeze canvas size (ignore resize,
letterbox). Off-record, debounce + preserve state where possible (see P1-5).

### 3. Takes are fragile: RAM-only list, silent loss on reload
The take list holds the last 5 takes as in-memory blob URLs
(`App.tsx MAX_TAKES=5`); a page reload (or the 6th take) silently discards
them. Auto-download mitigates but depends on the browser not prompting/
blocking, and nothing tells the user a take fell off the list.
**Recommendation:** persist takes to OPFS/IndexedDB for the session
(survives reload), surface "descartada por límite" when eviction happens,
and make the auto-download optional (see P1-1: review-then-keep flow).

### 4. Ctrl+R is a loaded gun
It's mapped to `controller.restart()` and `preventDefault()`s the
browser reload — good — but a user *intending* to reload the page
instead restarts the fiction; and if they then force-reload
(Ctrl+Shift+R), all undownloaded takes vanish (see #3).
**Recommendation:** add a `beforeunload` guard while takes exist or REC
is rolling; consider moving restart to a less reflexive chord.

---

## P1 — Fit the film pipeline (footage that edits well)

### 1. Take workflow is "record → auto-download", not "record → review → circle"
Filmmakers work in circled takes: roll several, mark keepers, discard NGs.
Today every CUT auto-downloads (`Recorder.ts onstop`), spamming Downloads
with files the director hasn't reviewed, while the review UI (VER/BAJAR)
arrives after the file already saved.
**Recommendation:** invert the flow — takes land in the session list
first (inline `<video>` preview, not a new tab), with KEEP (download) /
NG (discard) and a one-line note per take. Auto-download becomes a
setting.

### 2. Filenames and slate carry no scene identity
`os-toma-01-<timestamp>.webm`, `os-foto-<timestamp>.png` — no phase/scene,
no movie title. In an edit bin, twenty takes from five scenes are
indistinguishable without scrubbing. The burned-in slate shows take
number/OS/clock but not the scene either.
**Recommendation:** filename pattern
`<movieTitle>-<phase>-T<take>-<timestamp>.webm`; add phase + movie title
to the `Slate` burn-in. Tiny change, large editorial payoff.

### 3. Resolution/framerate are whatever the window happens to be
The canvas is container-sized, so takes vary in resolution between
sessions and even within one (resize). There's no way to lock 1920×1080
or 3840×2160 output for a consistent master.
**Recommendation:** a FORMATO control — render the canvas at a fixed
internal resolution (1080p/1440p/4K), letterboxed on screen, captured at
full res. This also fixes P0-2 for good.

### 4. WebM/VP9 only, no audio
`MIME_CANDIDATES` are all WebM; NLEs handle it but it's friction
(Resolve free tier notably). And takes are silent — any on-set audio
needs a separate recorder with only a visual slate to sync against.
**Recommendation:** offer H.264 MP4 where `MediaRecorder` supports it
(Edge/Chrome do); optional mic capture (`getUserMedia` audio track added
to the canvas stream) with a short beep at slate time for sync.

### 5. Media doesn't survive scene changes
`disposeSceneFeeds()` on every `setPhase` — jump VIGILANCIA → MAPA →
back and the loaded footage is gone; the director re-picks the file every
time. The `File` handles could be retained and re-fed.
**Recommendation:** a session media bin: remember the last source per
slot (file handle or "webcam") and re-attach on scene build. The panel
should also *show* what's loaded where (today only FX Studio shows its
media label; CAM-A/B state is invisible).

### 6. Transport pause doesn't pause footage (except FX Studio)
`VideoEffectsStudio` syncs feed play/pause/seek/speed to the director
clock; `SurveillancePanel`/`CallWindow`/`SilenceScene` don't — PAUSA
freezes the OS while real video keeps rolling underneath, and VEL 2×
fast-forwards the fiction but not the footage. Confusing during rehearsal
("pause… why is the suspect still walking?").
**Recommendation:** generalize the FX-Studio clock-sync block into
`VideoFeed` (or a shared helper) so every feed obeys the transport.

---

## P2 — On-set ergonomics (speed + confidence under pressure)

### 1. Mode cues don't show state
PERSECUCIÓN/PATRULLA, SEGUIR, RAYOS-X, chase modes: all toggles/modes
rendered as plain buttons with no `.on` state (unlike PLAY/PAUSA or
VISIÓN which do it well). Mid-take the director can't tell which mode the
scene is in without reading the canvas HUD.
**Recommendation:** controller getters (or a `getSceneState()` snapshot)
so cue buttons can render active state; make one-shot cues flash on fire.

### 2. Cues have no keyboard access
Everything critical has a chord except the thing directors hit *during*
a take: cues. Calling "INTERCEPTAR" means mousing through a dense panel
next to destructive buttons.
**Recommendation:** number keys 1–9 fire the current scene's cue row
(when no DOM input is focused and phase ≠ login); show the digit on each
cue button. Add a `?` overlay listing all shortcuts — the current 9px
hint line at 0.45 opacity is the only documentation in-app.

### 3. Panel is one long 10-row stack
TOMA, ESCENA, CUES, TIEMPO, RECARGA, TEMA, VIDEO, AMBIENTE, MENSAJE,
VISIÓN — always all visible, 8–10px type, 52px sliders, tiny ⨯ targets.
High-frequency set dressing (TEMA/AMBIENTE) has equal visual weight with
high-stakes controls.
**Recommendation:** collapsible sections with remembered open/closed
state; default open = TOMA + ESCENA + CUES + TIEMPO ("shoot mode"), the
rest collapsed ("prep mode"). Slightly larger hit areas on ⨯ buttons.

### 4. No way back from layout/ambience experiments
Window drags, CRT slider changes, −UNIDAD etc. have no undo or reset
short of rebuilding the scene (which nukes feeds, P1-5).
**Recommendation:** "REINICIAR AMBIENTE" (restore `CONFIG.crt`) and
"ORDENAR VENTANAS" (re-run the phase layout without disposing feeds).

### 5. Nothing persists across reloads
Theme, CRT values, movie title, panel position, vision toggle all reset.
A shoot day includes reloads (P0-3 makes them costly *and* likely).
**Recommendation:** persist director prefs to `localStorage`; a
"preset" export/import (JSON of theme+crt+scene config) enables
repeatable looks across days — cheap DIY LUT.

### 6. Drag-drop always lands on CAM-A
Dropping footage on a specific window still feeds `cam-a` (or
studio/silence). Dropping onto CAM-B's window feeding CAM-B is what the
gesture implies.
**Recommendation:** hit-test the drop point against surveillance panels.

---

## P3 — Polish / nice-to-have

- **Draw-loop crash watchdog:** a p5 exception freezes the canvas
  silently (documented in the verify scripts). On set, overlay a DOM
  banner if `frameCount` stalls while not paused — saves a ruined
  session where takes record a frozen frame.
- **GEO scene director inputs:** cities only cycle (CIUDAD); a real
  shoot wants "set the op to *this* location" — a lat/lon or city-search
  input in the panel when phase === 'geo', plus cue-state readouts
  (current city, follow on/off). Zoom is ±1 steps only.
- **CRT slider readouts:** sliders show no numeric value; hard to
  reproduce a look by eye ("glow was at… 0.4?"). Pair with P2-5 presets.
- **Count-in flexibility:** fixed 3s; a 5/10s option helps when the
  operator must cross a room into frame.
- **Contrast of dim text:** 9px at 0.45 opacity (hints, PRÓX takes) is
  below comfortable legibility on set lighting; bump to ~0.6.
- **LIMPIAR is global:** it clears all four slots at once; per-slot
  clear buttons would prevent "I only wanted to drop CAM-B".

---

## Suggested execution order

| Wave | Items | Rationale |
|------|-------|-----------|
| 1 | P0-1, P0-2, P0-4 | Cheap guards; eliminate take-destroying accidents |
| 2 | P1-2, P0-3, P1-1 | Editorial identity + take safety/review loop |
| 3 | P1-3, P1-4 | Fixed-format, MP4/audio — the "real pipeline" wave |
| 4 | P1-5, P1-6, P2-1, P2-2 | Media bin, transport truth, cue state + hotkeys |
| 5 | P2-3..P2-6, P3 | Panel IA, persistence, polish |

Waves 1–2 are small, self-contained edits in `ControlPanel.tsx`,
`OSApp.ts`, `Recorder.ts`, `Slate.ts`, `App.tsx`. Wave 3 touches the
render/capture path and deserves its own testing pass (extend
`verify-rec.mjs` to assert resolution + container).

---

## Execution record (2026-08-11)

All five waves shipped in one pass. What each finding became:

| Finding | Outcome |
|---|---|
| P0-1 nothing guarded while rolling | Scene / RECARGA / REINICIAR dim (`.ctrl-guarded`) and need a second confirming click while `recording`; armed state is amber and expires after 4 s. Cues, ambience, theme and message injection deliberately stay instant. |
| P0-2 resize rebuilds mid-take | `syncSize()` returns early while `recorder.recording`. Fixed formats are immune by construction. Asserted by `verify-director`. |
| P0-3 fragile takes | Review-first flow; list holds 8 takes and never evicts a circled one; `beforeunload` guard when rolling or takes are unsaved. *Not done:* OPFS/IndexedDB persistence — the unload guard covers the realistic loss case at a fraction of the complexity. |
| P0-4 Ctrl+R loaded gun | Refused while rolling (flashes a note); `beforeunload` covers the browser-reload path. |
| P1-1 record→auto-download | Inverted: takes land in the list, `VER` plays inline, `◎ BUENA` circles + saves, `NG` discards. `AUTO-GUARDA` restores the old behaviour as an opt-in. |
| P1-2 no scene identity | `PHASE_LABELS` + `slugify()` in SceneManager feed both the filename (`<production>-<scene>-t##-<timestamp>`) and the slate, which now shows production title and scene name. |
| P1-3 resolution varies | `CaptureFormat` (`window`/1080p/1440p/4K/9:16) pins the canvas; CSS letterboxes via a `fixed` class; `pixelDensity(1)` keeps the backing store exact. Panel shows real `w×h`. |
| P1-4 WebM only, no audio | MP4/H.264 preferred with WebM fallback (`canRecord`, `resolveContainer`); optional mic track muxed into the take. |
| P1-5 media dies on scene change | Session media bin (`slotSources`) + `restoreSlots()` on every phase build; `getSlots()` drives the `CARGADO` readout; per-slot clear replaces global LIMPIAR. |
| P1-6 transport ignored footage | `syncFeedsToClock()` runs centrally in the draw loop for every feed; the FX studio's private copy was removed. |
| P2-1 mode cues showed no state | `getSceneState()` snapshot + `Cue.active` predicates; plus an `ESTADO` readout row. |
| P2-2 cues mouse-only | Bare `1`–`9` fire the current scene's cues; digits printed on the buttons; `?` cheat sheet. |
| P2-3 one long stack | Five collapsible sections (CAPTURA / MEDIA / LOOK / INYECTAR / SISTEMA) with summaries when closed and persisted state. |
| P2-4 no undo | `RESET LOOK` (restores `CONFIG.crt`) and `ORDENAR VENTANAS` (`relayout()`, keeps footage). |
| P2-5 nothing persists | `localStorage` prefs: sections, format, container, auto-download, count-in, CRT, theme, title. *Not done:* preset export/import files. |
| P2-6 drops always hit CAM-A | `slotAtPoint()` hit-tests the drop against feed windows (topmost wins); image drops route to the gallery. |
| P3 watchdog | `getHealth()` + a 1.2 s poll in `App.tsx` → `LIENZO CONGELADO` banner. |
| P3 GEO inputs | `UBICAR` lat/lon + operation name (`setGeoLocation`), joins the CIUDAD cycle; zoom/city/follow surfaced in `ESTADO`. |
| P3 slider readouts, count-in, dim text, per-slot clear | All done (values on CRT sliders, 3/5/10 s count-in, hint opacity 0.45→0.6, `⨯A`/`⨯B`). |

Deliberately deferred: OPFS take persistence (P0-3), preset
export/import (P2-5). Both are additive and neither blocks a shoot.
