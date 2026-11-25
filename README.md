# Aero Formula · 翼构方程 · 翼の方程式

Design an aircraft, take it into the air and refine it after each flight. Aero Formula is a 3D aircraft design and flight challenge game for desktop browsers.

**[Play Aero Formula](https://nigh.github.io/glider-3d/)**

The game is available in English, Simplified Chinese and Japanese. It follows your browser language by default; use the language selector to choose another. Mobile devices are not currently supported.

## Choose a challenge

- **Birdman:** Build an unpowered aircraft and launch from a lakeside platform. Fly as far as you can before landing on the water.
- **Mountain descent:** Launch from a mountaintop and follow 30 checkpoints through valleys and ruins. Complete the course in the shortest time.
- **Low-level flight:** Take off along a runway and follow 30 checkpoints through a river valley. Fly low and reach the finish quickly to increase your score.

Birdman uses unpowered Birdman aircraft. Mountain descent and low-level flight use conventional aircraft. Switching to a challenge that does not accept your current aircraft loads that challenge's default design.

Want to experiment? **Test space** lets you adjust launch height and catapult settings before flying. **Wind tunnel** lets you change airflow and aircraft attitude while inspecting forces and structural loads. Both accept Birdman and conventional aircraft.

## Design and fly

1. Choose a challenge to open its workshop. Start with a system aircraft or load a saved design from the hangar.
2. Select a component in the sidebar or click it on the aircraft. Adjust the fuselage, main wing, horizontal auxiliary wing and vertical auxiliary wing with the controls or by dragging handles in the 3D view. Conventional aircraft also have a Power tab.
3. Choose wing materials and adjust their amounts. Changes affect weight and strength: wings can bend or break under load. Check the displayed mass, wing loading and other performance estimates as you work.
4. Select **Flight**, then start the flight with the on-screen button or `Space`. Use the flight instruments and structure display to follow your aircraft.
5. Review your results, return to Design and try another configuration.

Drag empty space to orbit the aircraft, use the mouse wheel to zoom, and drag with the right mouse button to pan. You can also enter exact values in the workshop. Hold `Ctrl` while dragging to bypass snapping.

The flight model is simplified for a game, not an engineering simulator. A valid design is not necessarily stable: test and trim it in flight.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | Pitch down / up |
| `A` / `D` | Roll left / right |
| `Q` / `E` | Yaw left / right |
| `1` / `2` | Increase / decrease throttle |
| `J` / `K` | Adjust elevator trim |
| `H` / `L` | Adjust aileron trim |
| `T` | Toggle automatic elevator trim for conventional aircraft |
| `Y` | Toggle adaptive control authority |
| `U` | Toggle smart mixing |
| `Space` | Start, pause or resume flight |
| `C` | Cycle flight cameras |
| `R` | Restart while paused or on the results screen |
| `Ctrl/Cmd+Z` | Undo a design change |
| `Ctrl/Cmd+Shift+Z` | Redo a design change |

Birdman aircraft use pilot movement for pitch and roll; conventional aircraft use control surfaces. In the workshop, `Space` enters the selected challenge or test, and `W` opens the wind tunnel. In the wind tunnel, `Space` starts or stops airflow.

Open **Input settings** to change keyboard bindings or configure a gamepad or flight stick. If your controller does not appear, press one of its buttons. Check its axis assignments and calibration before flying. Gamepad input requires a compatible browser and HTTPS or localhost.

## Save and replay

Save designs to the browser's hangar, or export them as JSON to keep a backup or share them. System aircraft cannot be overwritten, renamed or deleted; save a copy to keep your changes. Clearing site data deletes your saved designs, so export any you want to keep.

After a challenge, replay the latest flight or export its recording as JSON. Import recordings from the home screen or workshop. You can also select a compatible Ghost replay before a challenge to fly alongside a recorded run. Replays from older physics versions cannot be loaded, and records from different physics versions remain separate.

## Sound

Use the speaker icon to adjust music and effects or mute the game. Background music is Erik Satie's *Gymnopedie No. 1*, recorded by Kevin MacLeod under CC BY 4.0. See [audio attribution](public/audio/LICENSE.txt).

## Run locally

Install Node.js and npm, then run:

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. To create a production build in `dist/`:

```sh
npm run build
```

For the physics model and its sources, see [docs/physics.md](docs/physics.md).
