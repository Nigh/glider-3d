import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { replaySimulation, cacheFlight, cacheRecording, seekReplay } from '../src/playback';
import { advanceGhost, applyGhost, BAYER_4, captureGhost, ditherGhost, GhostBuffer, ghostOpacity, type GhostFragment } from '../src/ghost';
import { GhostPlayer } from '../src/ghost-player';

const neutral = { weight: 0, elevator: 0, aileron: 0, rudder: 0 };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('retains exact seeking while copying live structures at 10 Hz instead of every tick', async () => {
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0), copies = vi.spyOn(sim, 'checkpoint');
  cacheFlight(sim);
  const states: number[][] = [];
  for (let i = 0; i < 120; i++) { sim.step(neutral); cacheFlight(sim); states.push(sim.position.toArray()); }
  expect(copies.mock.calls.length).toBe(21);
  const recording = sim.getRecording(), replay = { definition: clone(defaultAircraft), challenge: 'birdman' as const, recording };
  cacheRecording(sim, recording);
  let cancelled = false;
  try { expect((await seekReplay(replay, 113 / 60, () => cancelled))!.position.toArray()).toEqual(states[112]); }
  finally { cancelled = true; }
});

it.each(['birdman', 'downhill', 'low-altitude'] as const)('replays every %s input with variable dt, sampled on elapsed launch time', challenge => {
  const definition = challenge === 'birdman' ? defaultAircraft : presets.find(d => d.name === (challenge === 'downhill' ? '高性能滑翔型' : '基础单发型'))!;
  const source = new FlightSimulation(definition, challenge, 0.004);
  for (let i = 0; i < 90; i++) source.step({ ...neutral, weight: 0.2, elevator: 0.1, throttle: 0.7 }, i % 2 ? 1 / 120 : 1 / 240);
  const replay = replaySimulation({ definition, challenge, recording: source.getRecording() });
  const frames = advanceGhost(replay, 100);
  expect(frames.length).toBeLessThanOrEqual(35);
  expect(frames.at(-1)!.done).toBe(true);
  expect(frames.at(-1)!.time).toBe(source.elapsedTime);
  expect(captureGhost(replay)).toEqual({ ...captureGhost(source), done: true });
  expect(advanceGhost(replay, 101)).toEqual([]);
  const reset = replaySimulation({ definition, challenge, recording: source.getRecording() });
  expect(captureGhost(reset).time).toBe(0);
});

it('copies deformation, frozen control angles and fragment transforms without aliasing physics', () => {
  const sim = new FlightSimulation(defaultAircraft, 'birdman', 0), render = new FlightSimulation(defaultAircraft, 'birdman', 0);
  sim.step(neutral);
  const section = sim.structure.sections[2]; section.bodyId = 7; section.root.position.add(new Vector3(1, 2, 3)); section.controlDeflection = 0.24;
  const frame = captureGhost(sim);
  frame.fragments = new Float64Array([7, 2, 3, 4, ...new Quaternion().toArray(), 0.1, 0.2, 0.3]);
  const fragments: GhostFragment[] = [];
  applyGhost(render, frame, fragments);
  expect(captureGhost(render).sections).toEqual(frame.sections);
  expect(fragments[0].position.toArray()).toEqual([2, 3, 4]);
  expect(fragments[0].cg.toArray()).toEqual([0.1, 0.2, 0.3]);
  render.structure.sections[2].root.position.x++;
  expect(sim.structure.sections[2].root.position.x).not.toBe(render.structure.sections[2].root.position.x);
});

it('interpolates elapsed time, keeps a bounded streaming window and holds the final pose', () => {
  const base = captureGhost(new FlightSimulation(defaultAircraft, 'birdman', 0)), buffer = new GhostBuffer();
  buffer.push([0, 0.25, 0.5, 0.75, 1].map(time => ({ ...base, time })));
  expect(buffer.covers(1.1)).toBe(false);
  expect(buffer.sample(0.625)!.alpha).toBe(0.5);
  expect(buffer.frames.length).toBe(3);
  expect(buffer.sample(0.625)!.alpha).toBe(0.5); // Paused wall time does not advance the ghost.
  for (let second = 1; second < 600; second++) {
    buffer.sample(second);
    buffer.push(Array.from({ length: 60 }, (_, i) => ({ ...base, time: second + (i + 1) / 60 })));
    expect(buffer.frames.length).toBeLessThanOrEqual(62);
  }
  buffer.end!.done = true;
  expect(buffer.covers(1000)).toBe(true);
  expect(buffer.sample(1000)!.alpha).toBe(1);
});

it('uses 80% transparency inside R, zero beyond 4R and ordered Bayer coverage with depth writes', () => {
  expect([0, 5, 10, 25, 40, 100].map(d => ghostOpacity(d, 10))).toEqual([0.2, 0.2, 0.2, 0.6000000000000001, 1, 1]);
  expect(new Set(BAYER_4).size).toBe(16);
  expect(BAYER_4.filter(n => (n + 0.5) / 16 < 0.2).length).toBe(3);
  const material = new MeshStandardMaterial(), mesh = new Mesh(new BoxGeometry(), material), root = new Group(), opacity = { value: 0.2 };
  mesh.castShadow = true; root.add(mesh);
  const patched = new Set<typeof material>(); ditherGhost(root, opacity, patched);
  const shader = { uniforms: {}, fragmentShader: '#include <alphatest_fragment>' };
  material.onBeforeCompile(shader as never, {} as never);
  expect(shader.uniforms).toHaveProperty('ghostOpacity', opacity);
  expect(shader.fragmentShader).toContain('gl_FragCoord'); expect(shader.fragmentShader).toContain('discard');
  expect(material.transparent).toBe(false); expect(material.depthWrite).toBe(true); expect(mesh.castShadow).toBe(false);
  ditherGhost(root, opacity, patched); expect(patched.size).toBe(1);
});

it('ignores stale worker batches after restart, applies backpressure and terminates on removal', () => {
  class FakeWorker {
    static instance: FakeWorker; onmessage?: (event: { data: unknown }) => void; onerror?: () => void;
    postMessage = vi.fn(); terminate = vi.fn();
    constructor() { FakeWorker.instance = this; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const failed = vi.fn(), changed = vi.fn(), player = new GhostPlayer('{}', 'birdman', changed, failed), worker = FakeWorker.instance;
  const frame = captureGhost(new FlightSimulation(defaultAircraft, 'birdman', 0));
  worker.onmessage!({ data: { generation: 0, definition: defaultAircraft, frames: [frame, { ...frame, time: 1 / 60 }, { ...frame, time: 1 }] } });
  player.request(1 / 60);
  expect(player.buffer.sample(1 / 120)!.alpha).toBeCloseTo(0.5, 12);
  player.request(0); expect(worker.postMessage).toHaveBeenCalledTimes(1);
  player.request(0.6); player.request(0.7); expect(worker.postMessage).toHaveBeenCalledTimes(2);
  player.reset(); expect(player.ready).toBe(false); expect(player.buffer.frames.length).toBe(0);
  worker.onmessage!({ data: { generation: 0, frames: [frame] } }); expect(player.ready).toBe(false);
  worker.onmessage!({ data: { generation: 1, frames: [frame] } }); expect(player.ready).toBe(true);
  worker.onmessage!({ data: { generation: 1, error: 'bad map' } }); expect(failed).toHaveBeenCalledWith('bad map');
  player.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});
