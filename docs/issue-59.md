# Issue #59: flight cadence and ghost replays

Live flight and playing replays now save nearby simulation checkpoints at 10 Hz rather than copying the complete mutable aircraft graph every 60 Hz tick. Recording inputs, persistent keyframes and dense neighboring-frame prefetch for interactive seeking are unchanged. Follow cameras carry the interpolated aircraft translation exactly, while retaining damping for changes in orientation and camera offset. Uneven frame durations therefore no longer change the translation lag between the camera and aircraft.

## Ghost behavior

- Birdman, downhill and low-altitude flights offer a JSON replay file selector before departure. Loading disables both the start button and keyboard start. Invalid files report the existing replay validation error; the challenge, physics version and actual map hash must match.
- Validation and forward replay run in a Worker. Only compact visual states reach the main thread, with approximately one second of lookahead and producer backpressure. Decoded seek keyframes are discarded after validation. The main thread reuses the aircraft geometry and deformation renderer without another WebGL renderer or map.
- Ghosts use their recorded aircraft, launch roll, controls, wing deformation and detached fragments. Synchronization uses elapsed simulation time including departure; variable recording step sizes do not change playback speed. Pause freezes both aircraft. Restart resets the ghost; removal or leaving the flight terminates its Worker and disposes its render resources. A finished ghost holds its final pose. If the Worker falls behind, a buffering notice accompanies a temporary pause of simulation time.
- Materials use a screen-space 4×4 Bayer discard pattern, depth tests and depth writes, without alpha blending or solid ghost shadows. Logical opacity is `0.2 + 0.8 × clamp((distance / R - 1) / 3, 0, 1)`. Thus transparency is 80% at or inside R and decreases linearly to 0% at 4R. Pixel coverage is quantized to the 16 Bayer thresholds.
- R uses the same helper as the wind-tunnel moment arrows: 1.2 times the maximum drawn-vertex distance from the aircraft CG, including current deformation and excluding detached geometry. Ghost distance is measured between the two interpolated CG positions.

## Reproducing validation

```sh
npm run check
npm run build
npx vitest run --maxWorkers=1 --no-file-parallelism
npx playwright test tests/ghost.spec.ts
node scripts/issue59-performance.mjs
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
- The downhill HUD displays `FlightSimulation.time` to two decimals, zero before the start gate. This is the effective result time, excluding departure. At each accepted checkpoint, the HUD retains the player's time minus the ghost's time at that same gate: negative means ahead, positive means behind. A missing ghost gate time is explicitly unavailable.
- Gate times are captured at the fractional crossing inside each accepted physics segment. On ghost import, the Worker derives future splits by integrating only persistent-keyframe intervals whose progress changes. This allows an immediate comparison even when the player reaches a checkpoint first. These derived readings are outside the serialized physics graph, so existing keyframe bindings and the physics version stay compatible.
- Downhill DNF results show `未完赛` instead of a time, and omit total time and personal-best time. Completed downhill results retain their time; the existing flight analysis remains available.

Validation for this follow-up: `npm run check`, `npm run build`, 86 unit cases across the challenge/playback/ghost/translation/replay suites, and 12 browser cases across `tests/pr60-feedback.spec.ts` (5) and `tests/ghost.spec.ts` (7), run in separate invocations. The latter covers blocked import interaction, success/failure recovery, a replay exported by commit `5fe2e71`, narrow-screen controls, paused timing, split signs and unavailable splits, live language changes, restart state, and completed/DNF result rendering. The compatibility fixture is intentionally kept from before these changes. Browser checks use desktop Chromium and a mobile-size viewport, not physical mobile hardware.
