# Aero Formula · 翼构方程 · 翼の方程式

A static, browser-based 3D aircraft design and flight challenge game. Built with TypeScript, Svelte 5, Three.js and Vite, without a general-purpose physics engine. Supports English, Simplified Chinese and Japanese, desktop browsers, and portrait or landscape touch screens. The interface defaults to your browser language. Use the language selector to change it; manual selection is saved in the current browser.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal. For a production build:

```sh
npm run check
npm test
npm run build
npx vite preview --host 0.0.0.0
```

Deploy `dist/` to any static host. If the Chinese web font cannot load, the interface uses the local sans-serif font; play remains available.

## GitHub Pages deployment

Play [Aero Formula](https://nigh.github.io/glider-3d/).

`.github/workflows/deploy-pages.yml` deploys after a push or merge to `main`. You can also select **Run workflow** in GitHub Actions. The repository's Pages build source is **GitHub Actions**.

The workflow uses Node.js 24, runs `npm ci`, type checks, unit tests and the production build, then uploads and deploys `dist/` through the official Pages Actions. The build uses `base_path` from `configure-pages`, so the repository name is not hardcoded and local development paths remain unchanged. The build job has no deployment write permission; only the deployment job requests `pages: write` and `id-token: write`.

Action versions were checked against the official repositories' latest-release APIs on 2026-10-30 and pinned to their commit SHAs: `checkout` v7.0.1, `setup-node` v7.1.0, `configure-pages` v6.0.0, `upload-pages-artifact` v5.0.0 and `deploy-pages` v5.0.1. Update both the SHA and its version comment when upgrading.

Reproduce a project-subpath build locally:

```sh
npm run build -- --base /glider-3d/
npx vite preview --base /glider-3d/
```

## Challenges and aircraft

- Each home-screen challenge button opens its aircraft workshop. Returning to the menu and switching challenges preserve the current aircraft, saved selection and undo history.
- **Birdman:** entering with an ineligible aircraft restores the default unpowered Birdman design; an eligible design stays unchanged. Launch from the lakeside platform and compete for horizontal distance.
- **Mountain descent:** launch from an elevated mountaintop catapult, accelerating to 20 m/s over 20 m. Timing starts at the starting gate. Follow 30 checkpoints through a 5400 m course with winding valleys, a steep descent and plain ruins. Mountain and dive gates retain flat tops at their center reference height plus 125 m. Plain-ruin gates span the canyon and follow the terrain plus 62.5 m. Restrictions exist only on each unpassed gate plane, not between gates. Red-striped masks fade in within 90 m as you approach; passing a gate immediately removes its frame and masks, including when flying back. Touching a blocked part of an active gate plane ends the run. Terrain and ruins remain physical obstacles. Completed runs rank by time. Reset design explicitly loads the mountain-descent maneuvering preset.
- **Low-level flight:** start on a rail 2 m above a 400 m runway. The first 300 m stays level; the last 100 m curves smoothly upward to a 15° exit. Actual engine thrust drives the roll, with gravity and rolling resistance along the rail. Early release uses the upward free acceleration of the whole aircraft. Rail-end release preserves tangent velocity and attitude. The exit has 80 m of terrain clearance, followed by an 80 m transition into the valley. Timing and scoring start at the starting gate. Follow 30 checkpoints along a 4800 m river course. Flying lower and reaching the finish sooner increases the score. Above 25 m of clearance, the HUD warns and deducts points continuously, increasing the rate with uninterrupted time above the limit. Returning within 25 m resets that timer. Only finished runs enter the records. Reset design explicitly loads the jet-cruise preset with 100% throttle, adjustable before launch.
- Aircraft configuration follows the design, not mode switching; there is no separate Birdman toggle. Birdman designs use pilot movement for pitch and roll, with only the vertical tail having a control surface. Conventional designs use a streamlined cockpit, ailerons and a horizontal-tail elevator; the vertical tail is all-moving by default. Other challenges also accept Birdman designs without changing them. Aircraft explicitly loaded or imported in Birdman are converted to its unpowered configuration.
- `W/S` command nose-down/nose-up, `A/D` command left/right roll, and `Q/E` command left/right yaw. Birdman's first two axes move the pilot's center of mass; conventional aircraft use the elevator and ailerons. Touch controls provide all three axes. Control surfaces move gradually, including their return to neutral.
- The bottom-left circular stick shows actual pitch and roll input, with elevator and aileron trim beside it. `J/K` and `H/L` change trim by 5 percentage points. `T` toggles automatic elevator trim for conventional aircraft. `Y` toggles structure-adaptive control authority: current-direction full-stick loads are predicted with the actual aerodynamic and beam models, targeting at most 60% of the attached structure's failure limit. If neutral-control loads already exceed that target, commands go to zero without suppressing real overload or fracture.
- Each challenge keeps separate records. Records from different physics versions do not share a leaderboard. Replays retain the challenge, design, control inputs and launch disturbance. The former standard, assisted and experimental modes have been removed.
- Workshop tabs are Fuselage, Main wing, Horizontal tail, Vertical tail, Power and Assembly, with Assembly always last. Birdman hides the Power tab and removes engines and fuel.
- The upper-left HUD is challenge-specific. Mountain descent shows airspeed and sink rate. Low-level flight shows airspeed, ground clearance and remaining fuel. Birdman retains distance, altitude, time, angle of attack, lift-to-drag ratio and energy use. Other challenges do not show Birdman's energy instruments.
- Results use actual sampled data. Mountain descent shows airspeed and distance–altitude charts. Low-level flight adds a dashed scoring ceiling along the actual track: local terrain or river height plus 25 m. The airspeed chart uses simulation time since starting the flight, including the launch or runway roll. Scored distance accumulates only after the starting gate; earlier samples have zero distance. Pauses produce no samples, and replays resample the same flight. Birdman retains altitude, mechanical-energy and energy-use curves.
- The results panel fades in on the right over 650 ms; portrait phones use a scrollable bottom panel. The background is slightly transparent while text and charts remain opaque. The camera slowly orbits from the final flight view without jumping to a preset angle. Vertical dragging changes elevation; horizontal motion remains automatic, including while the mouse is held. Reduced-motion preferences stop automatic orbiting.
- Light lake or river skimming can continue into flight. Submerged parts experience simplified water drag and buoyancy, and the aircraft remains controllable. Water loads can slow, turn or break the actual beam structure. Nose immersion ends the run, as does body contact with water at a total speed below 1.5 m/s. Low speed in air does not trigger this rule. Riverbeds and banks remain solid terrain. Splashes begin at the actual contact point rather than waiting for results.

## Materials, deformation and wing failure

Choose Sitka spruce, 6061-T6 aluminum or finished carbon/epoxy laminate separately for the main wing, horizontal tail and vertical tail. Each surface has an independent material amount from 50% to 200%, defaulting to 100%. Material amount changes beam mass, bending and torsional stiffness, and section load capacity. Pilot, fuselage and fixed-density skin mass do not scale with it. Beams use preset sections; chordwise width, normal height and wall thickness are not exposed as controls. Density, elastic moduli and strengths come from the shared material catalog.

The default Birdman design uses an ultralight carbon/epoxy structure; descent and jet presets use reinforced sections. Materials and challenge configuration are independent: changing challenges retains current materials and amounts. Old designs without amounts load at 100%. Saving, importing, exporting and undo preserve each surface's amount. More mass does not guarantee higher speed: it reduces deceleration from a given drag force but increases wing loading and takeoff requirements.

Surfaces bend and break at the existing 0.8 m aerodynamic boundaries. Rendered sections are spaced at no more than 0.2 m and interpolate continuously. When overloaded, the continuous outboard section becomes an independent rigid body, retaining its position, orientation and velocity field. It continues to receive aerodynamic forces from its own local airflow and can break again. A detached wing does not itself end the run; a fragment landing does not end the main aircraft's run. Body contact, course boundaries and finish conditions still determine results. The attitude and structure panel shows ultimate-limit utilization separately for the main wing, horizontal tail and vertical tail, alongside deformation and fracture count. Utilization comes from the equivalent-beam model, not a certified flight envelope.

Returning to Design restores complete, neutral surfaces. Starting another flight removes fragments and establishes static sag under supported self-weight. The runway roll and catapult continuously evaluate real aerodynamic loads, constraint inertia and deformation; leaving the rail does not reset beam nodes. Launch height uses the full deformed collision shape to maintain clearance. Fragments share the wing's vertex buffers. Cleanup releases only fragment-owned indices and draw state, preserving GPU resources still used by the wing.

The structure is a quasi-static equivalent beam. It does not model full soft-body behavior, manufacturability, flutter, elastic vibration, plasticity, fatigue or wakes between fragments. The interface labels engineering-equivalent directional material values. Old designs receive default materials and sections; unknown materials are rejected on import. New records remain separate from earlier physics versions. See [formulas, parameters and sources](docs/physics.md#材料与分段弹性结构).

## Jet power and fuel

The Power tab offers one jet engine model, with unpowered, single-engine or twin-engine layouts. A single engine stays on the fuselage centerline; twins stay on either side. Lateral offset is fixed. Adjust fore-aft position and signed vertical offset from −0.5 to 1 m: negative is below, positive above. A single engine's valid height ranges can be discontinuous, automatically skipping overlap with the fuselage, cockpit, canopy and nose cone; the interface lists the current valid ranges. Mounts farther from the fuselage receive automatic supports. Engines and supports contribute to mass, center of mass, inertia and thrust moment. The isolated Power view hides the environment.

The fuel tank stays inside the fuselage. Adjust only its longitudinal position and capacity, from 0 to 40 L. Position bounds depend on capacity and cockpit space so the entire tank remains within the closed fuselage shell. Removing engines also removes the tank, including for imported and loaded designs. Flights start with a full tank at 0.8 kg/L. Design instruments and 3D endpoint markers show the actual full-to-empty center-of-mass range. Empty tanks retain their shell mass. Fuel use changes mass, center of mass and inertia; thrust stops when fuel runs out. Birdman automatically removes power and fuel.

Throttle starts at 100%. Hold `1` to increase it or `2` to decrease it at 35% per second, including before starting the flight. The slider provides the same control. Engine speed responds with a delay; actual thrust and fuel use follow engine speed. The HUD shows throttle, engine speed, thrust and remaining fuel. Replays record throttle inputs. Engine data lives in `src/engines.ts` as `engineCatalog`.

Each engine produces 360 N of static thrust at sea level, or 720 N for twins. Air density reduces thrust and fuel flow with altitude; forward inlet airspeed reduces net thrust through ram drag. Exhaust has three blue-flame layers, a bright core and four flame segments. Intensity follows actual thrust and pulses with simulation time. Pausing freezes it; zero thrust extinguishes it.

## Birdman walkthrough

1. Select Birdman on the home screen. Edit the fuselage endpoints and cockpit position. The pilot is fixed at 60 kg. Legal legacy pilot masses also normalize to 60 kg, so old files provide no weight advantage.
2. On the Main wing, Horizontal tail or Vertical tail tab, drag four control points directly on the 3D aircraft. Drag root chord 1–4 or tip chord 2–3 to move both endpoints together. Screen-vertical motion has light snapping; hold `Ctrl` to disable it. Numeric inputs do not snap. Left and right wings remain symmetric.
3. Use Design and Flight at the top of the workshop. Assembly is the final design tab. Assembly and wing editing hide the environment. Dragging the nose or tail changes that end without moving the other. The cockpit and all three wing mounting points remain supported by the fuselage. Tail root centers attach directly to the fuselage beam. There are no external main-wing struts.
4. Enter Flight, then select the large bottom-center Start flight button or press Space. Birdman's published rules supply the 10 m sloped runway length, 3.5° downward slope and 10 m front-edge height above water. The 5 m/s² acceleration and 10 m/s speed after two seconds are game launch settings, not official speed rules. Land joins the rear of the platform smoothly. A recessed central steam channel contains metal rails. A telescoping tow arm connects the launch carriage to the fuselage; the carriage accelerates with the aircraft, releases at the edge and remains at the rail end. Starting again resets it. Steam follows physics time and stops while paused. A random ±1° roll disturbance builds smoothly throughout acceleration, with no attitude jump at release. Replays restore the same disturbance. Solid signs below the runway sides display length and slope without facing the camera; distance labels lie flat over the water.
   Birdman and mountain-descent catapults eject dense steam to both sides along the launch rail. Steam expands and fades after release; simulation time controls emission and motion.
5. Use `W/S` or Up/Down to move the pilot fore-aft; `A/D` or Left/Right to move laterally; `Q/E` to use the rudder. On phones, hold a control button and release it to return to neutral. Space starts, pauses or resumes. `C` cycles through chase, offset chase, side, pilot and free cameras. Inputs, selects and editable content retain native keyboard behavior.
6. Platform contact changes linear and angular velocity through rigid-body collision without ending the run. Keep flying, then inspect distance, time, speed, altitude and the distance–altitude chart after water termination. Results overlay remaining mechanical energy and instantaneous energy use on the same distance axis. Altitude is a solid cyan line on the left axis in m; mechanical energy is a dashed orange line on the right axis at 0–100%; energy use is a dotted dark-cyan line on the outer-right axis in J/m. Energy use is dissipated power divided by horizontal speed; undefined values leave gaps. Results omit the former energy-allocation and flight-clue panels. Return to Design to improve the aircraft.
7. Bottom notifications dismiss after five seconds. New notifications restart the timer, and each can be closed manually.

Drag handles over the solid aircraft to edit; drag empty space to orbit. Every camera supports mouse inspection. Vertical dragging in flight follows the same direction as orbit controls. Three seconds after release, offsets decay at 0.35/s, removing about 95% over the following 8.6 seconds. Results allow vertical dragging only. Editing handles take priority over camera dragging. Design and free cameras retain wheel zoom, right-button pan and touch gestures. All cameras remain above ground and water. The default chase view sits directly behind and above the aircraft, stays level and does not follow roll; offset chase retains the diagonal rear view.

Every quality setting requests native browser antialiasing, subject to GPU support. Vertices use small terracotta circles, root chord 1–4 a large solid cyan circle, tip chord 2–3 a hollow purple circle, and mounting points blue diamonds. Root, tip and mounting handles have localized labels. Crowded vertices move outward with dashed guides to their actual positions. Valid layouts retain each handle's offset from its actual projected anchor rather than repeatedly resolving the 52 px spacing boundary. Guides and wing outlines still use actual geometry. Hit targets remain 44 px. Arrow-key editing, `Ctrl`, undo and numeric input remain available. Dragging an outward handle does not make the surface jump.

Physics runs at a fixed 60 Hz. Position, orientation and center of mass interpolate using the remaining accumulator time. Chase, side and pilot cameras use the same rendered pose, avoiding relative aircraft-camera jitter on high-refresh screens. Interpolation adds about one physics step of display latency, 16.67 ms, without changing collisions, scores or replays. Pause and page-visibility changes synchronize snapshots; termination shows the final physical state immediately. Each frame catches up at most five steps. Overload discards only whole-step backlog, keeping the fractional remainder.

Conventional aircraft use elevators and ailerons; Birdman uses pilot movement and the vertical tail. All challenges share the same physics rules. Debug force displays are available without an experimental mode.

Flight instruments show live angle of attack, actual lift-to-drag ratio, energy use, sink rate and distance–altitude data. Energy use is dissipated power divided by world-horizontal speed in J/m. During launch or at horizontal speed ≤0.05 m/s, it shows “—”; vertical airspeed does not count as horizontal travel. From release onward, the energy bars show potential energy, kinetic energy including rotation, and accumulated dissipation. Air drag, water drag and damping count as dissipation. Actual buoyancy work appears separately on the input side. External launch energy is excluded from the free-flight conservation baseline. The aircraft casts a shadow onto the lake at every quality level to help judge altitude.

Near the surface, induced drag decreases according to actual wing clearance and horizontally projected span; main-wing downwash on the horizontal tail also weakens. Dihedral and roll change this ground effect. Profile and separated-stall drag are not scaled; actual drag still dissipates energy. Design references remain in free air, without fixing performance to the original game's 42:1 or 50:1 ratios. See [formulas, sources and limits](docs/physics.md#水面地面效应).

The main wing and both tails are split every 0.8 m along the span, preserving the final partial segment. Each segment uses its deformed force point, normal, local airflow and clearance. Induced drag uses the aspect ratio of the connected wing section; downwash is area-weighted and does not multiply with segment count. The airfoil reference is the DAE-11-derived family used by Squalo, the 2017 Birdman gliding champion. The model uses multi-Reynolds-number XFOIL predictions for the original DAE-11, not TAKUMI-11 wind-tunnel measurements. Beam mass follows material density and actual equivalent sections. Skin and fuselage masses remain engineering allocations constrained by published empty weight, not measured component weights.

The main view continuously shows geometric performance, estimated stall speed, center of mass, static margin and aerodynamic data for all three surfaces. Main-wing and horizontal-tail incidence immediately change effective angle of attack, forces, moments and visible geometry. Stall speed uses sea-level total weight, main-wing area and the peak of the existing lift polar; it does not guarantee trim at the current incidence.

The main-wing root center can move from 0.5 m below to 1 m above the fuselage. Assembly offers a slider, exact input and 3D dragging. Dragging near zero snaps lightly to the fuselage; hold `Ctrl` to disable snapping. Zero height mounts directly. Nonzero height creates a central support plate as wide as the root chord. Its effective area density is approximately 0.833 kg/m², and it contributes to center of mass, inertia and stall speed. The main view shows its area and mass.

Center of mass uses a yellow-black sphere; center of lift uses a cyan-blue-black sphere and direction arrow; center of drag uses a red-black sphere and arrow. In Design, aircraft with engines also show an orange (#d58032) center-of-thrust marker at the mean of the equal-thrust engine mounts, with its arrow along body +X. Aircraft without engines hide it. Drag and thrust markers represent different forces. Markers have no 3D text. Their visual language references KSP; the drag marker is this project's extension. The GitHub icon beside the title opens the source repository.

The pilot lies prone. When not stalled, wingtip trails appear at all speeds, including launch. Opacity starts at zero at the tip, reaches one after 0.8 m, then fades over 18–60 m. Stall or flight termination clears trails immediately. The upper-left HUD updates every frame; charts and performance panels update independently at lower rates.

## Sound

The top speaker icon opens sound settings: master mute, music volume and effects volume. Preferences stay in the current browser. Audio starts after the first click or keypress. Browser autoplay restrictions do not block play. Pausing or moving the page to the background freezes sound and music position; resuming continues playback. Returning to Design restores background music without repeating launch events.

The BGM is Erik Satie's *Gymnopedie No. 1*, recorded by Kevin MacLeod: an approximately 3-minute-7-second soft piano recording, looped with a fade-in. Music volume drops further during flight. The recording uses CC BY 4.0. Attribution, official download source and transcoding notes are in [`public/audio/LICENSE.txt`](public/audio/LICENSE.txt), also linked in sound settings. Music ships with the site and does not depend on external hotlinks.

UI clicks, success and error notifications, two-layer wind, steam release and mechanical separation are synthesized with native Web Audio, without an audio dependency or third-party effects samples. Wind loudness and filter frequency follow actual speed smoothly. Steam starts only when a catapult begins accelerating. The transition from launch to release triggers one mechanical latch, low-frequency impact, metallic resonance and short steam burst. Low-level rail launches play neither steam nor catapult separation. The separation sound references the distinct impact of rocket staging without using KSP audio assets. Pause, replay and retry do not depend on wall-clock timers. Catapult physics retains the two-second constant-acceleration model, without steam-fluid or pressure simulation.

Crossing the starting gate, each checkpoint and the finish triggers an approximately 0.24-second two-layer tone. It remains audible without overpowering ambient sound; the finish tone has a slightly higher pitch. Actual timing state and checkpoint progress trigger playback. Frame synchronization and pause/resume do not repeat it, and results do not cut off the finish sound. Mute, effects volume and background freezing use the shared audio channels; resuming does not replay missed tones.

Jet audio uses dedicated oscillators and filtered noise. Pitch, loudness and spectrum follow physical engine speed rather than raw throttle. Shutdown fades smoothly. It uses the same mute, effects-volume, pause and background-freeze behavior, with no new dependency or third-party effects.

`tests/audio.spec.ts` measures native browser audio nodes for wind and engines, covering speed, engine speed, mute, pause and resume. AudioWorklet captures actual separation and gate audio to measure band energy, loudness, transients and decay. Coverage includes start and finish, repeated state, mute, zero volume, pause, background, replay and the absence of catapult audio in low-level flight. Run `npx playwright test tests/audio.spec.ts --project=desktop-chromium`. Audio-load failures leave flight available and appear in sound settings.

## Saving and replay

Design provides one Save action. A new name creates an aircraft; saving a name already in the hangar asks for confirmation before overwriting it. The hangar retains multiple aircraft, marks the current one, and provides each aircraft's load, rename, copy, delete and JSON export actions in its own menu. The hangar's top toolbar only imports JSON. Successful loading closes the hangar; a damaged record leaves the hangar open and preserves the current design. Deletion requires confirmation. Damaged records do not overwrite other valid records. Storage exhaustion and permission errors show a notification. Clearing browser site data deletes the hangar; export important designs as backups.

Birdman distance is measured horizontally from the platform front to the aircraft's rearmost body point, not its center of mass or accumulated path length. Lateral offsets use a radial measurement convention. New records remain separate from the old center-of-mass-distance records; old data is neither deleted nor mixed into the new ranking.

Undo and redo retain up to 60 snapshots. `Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` redoes. A parameter drag creates a snapshot when it ends. Saving after undo or redo follows the same name-confirmation rule, protecting other aircraft from silent replacement. The six presets are balanced, high aspect ratio, high stability, responsive, aft center of mass, and high wing loading.

Results can replay the latest flight. Recording stores the launch's random roll target and fixed-step control inputs, not a prebuilt trajectory. Replay runs the same flight core again.

## Checks

```sh
npm run check
npm test
npm run test:e2e
```

Extreme-surface and complete-flight regressions use a 15-second per-test timeout to accommodate structural and contact integration on shared CI CPUs. Energy and finite-state assertions remain intact. Vitest's default five-second timeout is not a performance metric.

Browser tests start the development server by default. To use an existing server when CI is enabled:

```sh
PLAYWRIGHT_NO_SERVER=1 npm run test:e2e
```

Install Playwright Chromium with `npx playwright install chromium`. Interaction tests cover design, assembly, flight, controls, water termination, scores, further editing, hangar and replay.

## Performance

```sh
# Start npm run dev first
npm run perf
```

Results go to `docs/performance-results.json`. The tool samples browser rAF intervals independently rather than treating target FPS as measured performance. Configure durations with `PERF_SAMPLE_MS`, `PERF_LONG_MS` and `PERF_RESET_MS`. `CDP_URL` connects to a real device browser; see the [mobile validation guide](docs/mobile-performance.md).

Select Performance to open the normally hidden panel. It shows mean/P95/P99 frame times, physics time, CPU render-submission time, geometry-update time, draw calls, triangles and estimated geometry/texture memory. Submission time is not GPU execution time.

**60 FPS on ordinary phones still requires real-device validation. Desktop and emulated phone viewports do not establish this target.** High/Medium/Low quality and automatic downshifting reduce pixel ratio, shadows and environment detail. Sampling and hysteresis prevent frequent switching.

Aircraft materials, pilot geometry and body meshes are reused. Continuous edits coalesce within each render frame, rebuilding only changed surfaces. Dragging does not repeatedly resize the canvas or traverse the whole scene to estimate memory. The aerodynamic core reuses math objects; flight inputs use preallocated TypedArrays. Auto starts conservatively at Low, then adapts to stable frame times.

## Code map

- `src/model.ts`: standalone aircraft definitions, bounds, quadrilateral geometry and presets.
- `src/materials.ts`: stable material catalog, default beam sections and closed-tube section formulas.
- `src/structure.ts`: segmented quasi-static beams, stress, fracture ownership and full inertia tensors.
- `src/physics.ts`: segmented aerodynamics, body and fragment integration, mass/inertia, contact, scoring and input replay.
- `src/scene.ts`: smoothly deformed thick airfoils, fracture faces and fragments, environment, cameras, resource cleanup, quality and performance monitoring.
- `src/App.svelte`: page state, fixed-60-Hz accumulator, controls and UI throttling.
- `src/WingEditor.svelte`, `src/Parameter.svelte`: exact coordinate and parameter editing. The scene layer handles 3D dragging.
- `src/storage.ts`: local hangar, import boundaries, grouped records and history snapshots.
- `tests/`: geometry, storage, physics and Playwright interaction checks.

## Model and scope

The aerodynamic model is simplified for a game. Design parameters change mass, inertia, lift, drag and moments. It has no CFD or vortex solver, random scores or fixed flight paths; it is not an engineering simulator.

- Original-game research: [docs/original-game-analysis.md](docs/original-game-analysis.md). Observed / Inferred / Unknown distinguish evidence from interpretation.
- Physics, coordinates, coefficients and limits: [docs/physics.md](docs/physics.md).
- Performance sampling and real-device reproduction: [docs/mobile-performance.md](docs/mobile-performance.md).
- Historical preset and trim measurements: [docs/flight-balance.md](docs/flight-balance.md).
- Real-device connection evidence: [docs/device-validation.md](docs/device-validation.md).
- Bottlenecks, before/after optimization and measured results: [docs/performance-analysis.md](docs/performance-analysis.md).

There are no accounts, servers, online leaderboards or complex water simulation. Structural failure occurs at aerodynamic segment boundaries, without arbitrary cracks or skin tearing. Main wing and tails use fixed lightweight airfoil representations; airfoil sections are not editable. Four-point editing keeps root and tip pairs at equal spanwise coordinates to prevent self-intersection. Mounts remain supported by the fuselage, but valid geometry does not guarantee aerodynamic stability. Test and trim the aircraft in flight.
