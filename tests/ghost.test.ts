import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { clone, defaultAircraft, presets } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { replaySimulation, cacheFlight, cacheRecording, seekReplay } from '../src/playback';
import { applyGhost, BAYER_4, captureGhost, ditherGhost, GhostBuffer, ghostOpacity, type GhostFragment } from '../src/ghost';
import { GhostPlayer } from '../src/ghost-player';
import { decodeGhostFrames, encodeGhostFrames } from '../src/ghost-track';

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
  const recording = source.getRecording(), replay = replaySimulation({ definition, challenge, recording });
  while (!replay.ended && !replay.replayFinished) replay.step(neutral);
  const frames = recording.ghostFrames!;
  expect(frames.length).toBeLessThanOrEqual(Math.ceil(source.elapsedTime * 10) + 2);
  expect(frames.at(-1)!.done).toBe(true);
  expect(frames.at(-1)!.time).toBe(source.elapsedTime);
  expect(captureGhost(replay)).toEqual({ ...captureGhost(source), done: true });

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

it('keeps a severed T-tail installation on its release frame after transport and backward seeking', async () => {
  const definition = clone(presets.find(d => !d.birdman && d.engine.count === 0)!);
  definition.assembly.tailOnFin = true;
  const source = new FlightSimulation(definition, 'downhill', 0), render = new FlightSimulation(definition, 'downhill', 0);
  const tail = source.structure.sections.find(s => s.wingInstance === 1 && s.spanStart === 0 && s.side === 1)!;
  expect(tail.attachmentAnchorId).toBeGreaterThanOrEqual(0);
  const fin = source.structure.sections[tail.attachmentAnchorId];
  fin.tip.position.add(new Vector3(0.02, 0.04, -0.03));
  fin.tip.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.08);
  const attached = captureGhost(source), point = tail.referenceRoot.clone().addScaledVector(tail.referenceChord, 0.1);
  source.structure.detach(tail, 1);
  const release = point.clone(); source.structure.deformPoint(tail, release, 0);
  fin.tip.position.add(new Vector3(0, 0.4, 0.3));
  fin.tip.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), 0.2);
  const detached = { ...captureGhost(source), time: 0.1, done: true };
  const frames = await decodeGhostFrames(await encodeGhostFrames([attached, detached]), 0.1, source.structure.sections.length, 1);
  const copy = render.structure.sections[tail.id], fragments: GhostFragment[] = [];
  applyGhost(render, frames[1], fragments);
  const frozen = point.clone(); render.structure.deformPoint(copy, frozen, 0);
  expect(frozen.distanceTo(release)).toBeLessThan(1e-10);
  applyGhost(render, frames[0], fragments);
  render.structure.sections[tail.attachmentAnchorId].tip.position.y += 0.2;
  const reattached = point.clone(); render.structure.deformPoint(copy, reattached, 0);
  expect(reattached.distanceTo(release)).toBeGreaterThan(0.1);
  applyGhost(render, frames[1], fragments);
  const restored = point.clone(); render.structure.deformPoint(copy, restored, 0);
  expect(restored.distanceTo(release)).toBeLessThan(1e-10);
});

it('samples the immutable track forward and backward without a producer or destructive eviction', () => {
  const base = captureGhost(new FlightSimulation(defaultAircraft, 'birdman', 0)), buffer = new GhostBuffer();
  buffer.push([0, 0.25, 0.5, 0.75, 1].map(time => ({ ...base, time, done: time === 1 })));
  expect(buffer.covers(1000)).toBe(true);
  expect(buffer.sample(0.625)!.alpha).toBe(0.5);
  expect(buffer.sample(1000)!.a.time).toBe(1);
  expect(buffer.sample(0)!.a.time).toBe(0);
  expect(buffer.sample(0.625)!.alpha).toBe(0.5);
  expect(buffer.frames.length).toBe(5);
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

it('loads once, resets locally and receives legacy split metadata without replacing its track', () => {
  class FakeWorker {
    static instance: FakeWorker; onmessage?: ((event: { data: unknown }) => void) | null; onerror?: () => void;
    postMessage = vi.fn(); terminate = vi.fn();
    constructor() { FakeWorker.instance = this; }
  }
  vi.stubGlobal('Worker', FakeWorker);
  const failed = vi.fn(), changed = vi.fn(), player = new GhostPlayer('{}', 'birdman', changed, failed), worker = FakeWorker.instance;
  const frame = captureGhost(new FlightSimulation(defaultAircraft, 'birdman', 0));
  worker.onmessage!({ data: { definition: defaultAircraft, checkpointTimes: [], timingReady: false, frames: [frame, { ...frame, time: 1, done: true }] } });
  expect(player.ready).toBe(true); expect(player.timingReady).toBe(false);
  player.reset(); expect(player.ready).toBe(true); expect(player.buffer.sample(0)!.a.time).toBe(0);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  worker.onmessage!({ data: { checkpointTimes: [12.345, null], timingReady: true } });
  expect(player.checkpointTimes).toEqual([12.345, null]); expect(player.timingReady).toBe(true);
  expect(player.buffer.frames.length).toBe(2);
  worker.onmessage!({ data: { error: 'bad map' } }); expect(failed).toHaveBeenCalledWith('bad map');
  player.dispose(); expect(worker.onmessage).toBeNull(); expect(worker.terminate).toHaveBeenCalledOnce();
});
