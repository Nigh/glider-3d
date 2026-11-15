# Issue #59: flight cadence and ghost replays

Live flight and playing replays now save nearby simulation checkpoints at 10 Hz rather than copying the complete mutable aircraft graph every 60 Hz tick. Recording inputs, persistent keyframes and dense neighboring-frame prefetch for interactive seeking are unchanged. Follow cameras carry the interpolated aircraft translation exactly, while retaining damping for changes in orientation and camera offset. Uneven frame durations therefore no longer change the translation lag between the camera and aircraft.

## Ghost behavior

- Birdman, downhill and low-altitude flights offer a JSON replay file selector before departure. Loading disables both the start button and keyboard start. Invalid files report the existing replay validation error; the challenge, physics version and actual map hash must match.
- Ghost loading runs in a Worker. New recordings include a gzip-compressed binary visual track sampled at 10 Hz, plus actual fracture events and the final state. Import validates that track without decoding the unrelated physics seek graph. Playback binary-searches recorded elapsed time and interpolates render state; it does not integrate a second aircraft. The main thread reuses aircraft geometry and deformation rendering without another WebGL renderer or map.
- Ghosts use their recorded aircraft, launch roll, controls, wing deformation and detached fragments. Synchronization uses elapsed simulation time including departure; variable recording step sizes do not change playback speed. Pause freezes both aircraft. Restart resets the ghost; removal or leaving the flight terminates its Worker and disposes its render resources. A finished ghost holds its final pose. Restart reuses the loaded track locally. There is no flight-time producer or buffering pause. The Worker closes after loading and any legacy split calculation.
- Materials use a screen-space 4×4 Bayer discard pattern, depth tests and depth writes, without alpha blending or solid ghost shadows. Logical opacity is `0.2 + 0.8 × clamp((distance / R - 1) / 3, 0, 1)`. Thus transparency is 80% at or inside R and decreases linearly to 0% at 4R. Pixel coverage is quantized to the 16 Bayer thresholds.
- R uses the same helper as the wind-tunnel moment arrows: 1.2 times the maximum drawn-vertex distance from the aircraft CG, including current deformation and excluding detached geometry. Ghost distance is measured between the two interpolated CG positions.

## Reproducing validation

```sh
npm run check
npm run build
npx vitest run --maxWorkers=1 --no-file-parallelism
npx playwright test tests/ghost.spec.ts tests/pr60-feedback.spec.ts
node scripts/issue59-performance.mjs
node scripts/pr60-performance.mjs
```

The browser tests exercise all three selectors, rejection, cancellation, pause, restart and removal. They also read actual GPU pixels at opacity 0.2/0.6/1, compare ghost and live deformed/fractured meshes, verify distance endpoints against the drawn-geometry radius and check resource disposal. The camera regression varies render cadence while translating the aircraft and checks that its relative position remains fixed.

The profiling script separates physics integration from live-cache work, using a neutral Birdman flight with the default aircraft and a 24 m wing (0.9 m root, 0.6 m tip). Baseline is main commit `a210591`; each run includes cold-start work and stops after 240 steps or flight termination. The following local Node/Windows measurements are CPU timings, not GPU timings or frame-rate guarantees:

| Aircraft | Cache mean before | Cache mean after | Cache p95 before | Cache p95 after |
| --- | ---: | ---: | ---: | ---: |
| Default, 240 steps | 2.02 ms | 0.33 ms | 5.89 ms | 1.80 ms |
| 24 m wing, 202 steps | 3.07 ms | 0.53 ms | 9.13 ms | 3.06 ms |

The combined profile's deep-copy samples fell from 939 ms to 168 ms and garbage-collection samples from 324 ms to 84 ms. Physics results and the replay physics version remain unchanged. The browser test attaches separate frame-interval and physics/cache measurements for the 24 m flight; software-rendered desktop Chromium measurements do not establish mobile-device performance.

## PR #60 review follow-up

- Replay import in the menu/workshop opens a native modal with a full-screen translucent backdrop and an import status. Pointer input, Escape, game shortcuts and controller actions cannot reach the game until the import succeeds or fails. Both paths clear pending controls and restore interaction.
- Ghost selection uses the existing button/panel palette and spacing, a hidden file input, replacement/removal actions and a wrapping filename/status. The 390 px layout is covered by a browser screenshot.
- A separate, top-center downhill panel displays `FlightSimulation.time` to two decimals, zero before the start gate. This is the effective result time, excluding departure. At each accepted checkpoint, the HUD retains the player's time minus the ghost's time at that same gate: negative means ahead, positive means behind. A missing ghost gate time is explicitly unavailable.
- Gate times are captured at the fractional crossing inside each accepted physics segment. New files persist those exact splits, so comparing a leading player requires no replay integration. For older files, the Worker derives splits from progress-changing intervals after the visual track becomes available, and a pending split label avoids reporting unknown times as missed gates. These derived readings are outside the serialized physics graph, so existing keyframe bindings and the physics version stay compatible.
- Downhill DNF results show `未完赛` instead of a time, and omit total time and personal-best time. Completed downhill results retain their time; the existing flight analysis remains available.

## Import and playback performance follow-up

- Visual recording lives outside the serialized physics graph, preserving existing keyframe bindings and the physics version. A 32 MiB raw-track budget triggers downsampling of long/complex recordings while retaining endpoints and fracture transitions. Normal input recording and exact seek replay remain unchanged. Binary payloads have bounded decompression, finite-value, timestamp, size, topology-ID and endpoint validation.
- Older files remain supported. Their existing physics keyframes are validated once and streamed as compact visual states; the first two states enable playback before the rest finish reading. Ghost motion is interpolated between those original samples (currently 1 s apart), so its intermediate motion is coarser than a new 10 Hz track. Exact legacy gate splits are calculated separately. Input-only files without any keyframes must first undergo one conversion because they contain no stored positions.
- The timer and split no longer participate in the left sidebar grid. Desktop, portrait and landscape layouts center a standalone panel below navigation; the mobile sidebar starts beneath it. Three-language checks include horizontal overflow assertions.

The performance script uses a real 30 s low-altitude recording of the single-engine preset with its engine removed, remaining on the rail. It records the same inputs and aircraft as the pre-change baseline. These local Node/Windows CPU timings exclude renderer creation and GPU work; a stationary fixture does not establish file-size or timing guarantees for every flight.

| Path | First visual states ready | Complete read | Physics steps for visual playback | Samples / raw track |
| --- | ---: | ---: | ---: | --- |
| Before this follow-up | 1,209 ms (945 import + 264 first second) | streamed during flight | 60 per simulated second | rolling window |
| Existing keyframes | 383 ms | 899 ms, background | 0 | 31 / 110 KiB |
| New visual track | 247 ms | 247 ms | 0 | 301 / 1.04 MiB |

New-file size for this fixture is 793,540 bytes versus 780,722 for the legacy form. Six thousand time lookups take about 1.65 ms in the new path. These measurements demonstrate the removed physics workload, not mobile-device frame rates.

Final validation: `npm run check` reports zero errors/warnings; the production build passes. The complete unit run passes 509/509 tests in 34 files, serially without concurrent browser load. All twelve browser cases pass in one run. They cover exact recorded knots, lossless visual encoding, bounded/malformed payload rejection, memory downsampling and fracture retention, incremental legacy loading, zero-step Ghost import, local restart, old replay compatibility, three challenge flows, GPU transparency/fragments/disposal, import overlay recovery, top-center layout across three languages/viewports, signed/missing splits, and completed/DNF results. Pending split metadata is covered by the Ghost player unit test. Desktop Chromium and mobile-size viewports were used; physical mobile hardware was not tested.
