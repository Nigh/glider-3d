import { describe, expect, it } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, ShaderMaterial, BoxGeometry, Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, SphereGeometry, Spherical, Vector3 } from 'three';
import { clone, defaultAircraft, DEG, engineMounts } from '../src/model';
import { SceneView } from '../src/scene';
import { FlightSimulation, LAUNCH } from '../src/physics';
import { challengeCheckpoints, challengeCollisionHeight, challengeGateCeiling, challengeGateProfile, DOWNHILL_PLAIN_START, challengeLaunch, challengeStartGate, type ChallengeMode } from '../src/challenges';

// Exercise SceneView's real layout without a WebGL context or browser timing.
function svgElement() {
  const attributes = new Map<string, string>();
  const text = { textContent: '', setAttribute() {} };
  return {
    style: { display: '' }, attributes,
    classList: { toggle() {} },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    querySelector() { return text; },
  };
}

describe('场景编辑与推力中心', () => {
  it('投影锚点反复跨过52px边界时复用避让位置，不在两处跳动', () => {
    const anchors = [{ x: 300, y: 300 }, { x: 351.99, y: 300 }];
    const projection = new Vector3();
    projection.project = () => projection;
    const handles = anchors.map((_anchor, index) => ({
      index, side: 1, x: 0, y: 0, ax: 0, ay: 0, group: svgElement(), leader: svgElement(),
    }));
    const view = Object.assign(Object.create(SceneView.prototype), {
      editorTarget: 'mainWing', simulation: null, editorDirty: true,
      width: 1000, height: 700, aircraft: new Group(), camera: new OrthographicCamera(),
      editorOverlay: svgElement(), editorHandles: handles, editorSegments: [], editorPolygons: [svgElement(), svgElement()],
      editProjection: projection, body: { localToWorld: (point: Vector3) => point },
      wingEditorPoint(index: number, _side: number, out: Vector3) {
        const anchor = anchors[index % anchors.length];
        return out.set(anchor.x / 500 - 1, 1 - anchor.y / 350, 0);
      },
    });
    view.updateEditorOverlay();
    const first = handles.map(handle => ({ x: handle.x, y: handle.y }));
    expect(handles[0].leader.style.display).not.toBe('none');
    for (const anchorX of [352.01, 351.99, 352.01, 351.99, 351.99]) {
      anchors[1].x = anchorX;
      view.editorDirty = true;
      view.updateEditorOverlay();
      expect(Math.hypot(handles[0].x - handles[1].x, handles[0].y - handles[1].y)).toBeGreaterThanOrEqual(52 - 1e-6);
      for (let index = 0; index < handles.length; index++) {
        const handle = handles[index];
        expect(handle.x - handle.ax).toBeCloseTo(first[index].x - (index === 0 ? 300 : 351.99), 10);
        expect(handle.y).toBeCloseTo(first[index].y, 10);
        expect(handle.ax).toBeCloseTo(anchors[index].x, 10);
        expect(handle.ay).toBeCloseTo(anchors[index].y, 10);
        expect(Number(handle.leader.attributes.get('x1'))).toBeCloseTo(anchors[index].x, 10);
        expect(Number(handle.leader.attributes.get('y1'))).toBeCloseTo(anchors[index].y, 10);
      }
    }
  });

  it('拖动编辑手柄时相机保持原投影，不套用飞行镜头极角限制', () => {
    const camera = new OrthographicCamera(-5, 5, 5, -5);
    camera.position.set(0, 10, 0.001);
    camera.up.set(1, 0, 0);
    camera.lookAt(0, 0, 0);
    const position = camera.position.clone(), rotation = camera.quaternion.clone();
    const view = Object.assign(Object.create(SceneView.prototype), {
      editorPointerId: 7, simulation: null, camera, target: new Vector3(),
      controls: { enabled: false }, cameraDragging: false, elapsed: 1, cameraReleasedAt: -Infinity,
      cameraYaw: 0, cameraPitch: 0, followPosition: new Vector3(), followTarget: new Vector3(),
      vector: new Vector3(), cameraAngles: new Spherical(), view: 'top', resultOrbit: false,
    });
    for (let frame = 0; frame < 8; frame++) view.updateCameraInteraction(1 / 60);
    expect(camera.position.distanceTo(position)).toBe(0);
    expect(camera.quaternion.toArray()).toEqual(rotation.toArray());
  });

  it('外伸位置不进入拖动几何计算，同一指针位置始终得到同一翼型', () => {
    const definition = clone(defaultAircraft);
    definition.assembly.mainIncidence = 12;
    const base = clone(definition);
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition, editDefinition: base, editorPointerId: 7, editorTarget: 'mainWing',
      editorSegmentDrag: -1, editorDrag: 0,
      editorHandles: [{ index: 1, side: 1, x: 300, y: 248 }],
      editorSnap: { active: false, kind: null, value: null, disabled: false },
      editStart: new Vector3(10, 0, 20), editPoint: new Vector3(10.2, 0, 20.3),
      intersectEditor() { return true; },
      editorChange(next: typeof definition) { this.definition = next; },
    });
    const event = { pointerId: 7, ctrlKey: true, preventDefault() {} };
    view.moveEditorDrag(event);
    expect(view.definition.mainWing.points[1].x).toBeCloseTo(base.mainWing.points[1].x - 0.2 / Math.cos(12 * DEG), 10);
    expect(view.definition.mainWing.points[1].y).toBeCloseTo(base.mainWing.points[1].y + 0.3, 10);
    expect(view.definition.mainWing.points[2].x).toBe(base.mainWing.points[2].x);
    const changed = clone(view.definition);
    view.editorHandles[0].x = 900;
    view.editorHandles[0].y = 500;
    view.moveEditorDrag(event);
    expect(view.definition).toEqual(changed);
  });

  it('单发和双发中心取实际安装点平均值，沿机体推力方向，无引擎隐藏', () => {
    const camera = new OrthographicCamera(-5, 5, 5, -5);
    const centers = [new Group(), new Group(), new Group(), new Group()];
    const tank = new Group();
    tank.add(new Group());
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition: clone(defaultAircraft), engines: [new Group(), new Group()],
      engineSupports: [new Mesh(), new Mesh()], propulsionBounds: new Box3(),
      fuelTank: tank, updateExhaust() {}, designThrustCenter: new Vector3(),
      vector: new Vector3(), vector2: new Vector3(), simulation: null, debug: false,
      aircraft: new Group(), cg: centers[0], liftCenter: centers[1], dragCenter: centers[2], thrustCenter: centers[3],
      centerMarkers: centers, designCG: new Vector3(1, 0.1, 0),
      designLiftVisible: false, designDragVisible: false,
      designLiftDirection: new Vector3(0, 1, 0), designDragDirection: new Vector3(-1, 0, 0),
      camera, orthographic: camera, height: 700,
    });
    view.aircraft.position.set(10, 20, 30);
    view.aircraft.rotation.z = Math.PI / 6;
    for (const count of [1, 2, 0] as const) {
      view.definition.engine.count = count;
      view.updatePropulsionGeometry();
      const mounts = engineMounts(view.definition);
      const center = new Vector3();
      for (const mount of mounts) center.add(new Vector3(mount.x, mount.y, mount.z));
      if (mounts.length) center.divideScalar(mounts.length);
      expect(view.designThrustCenter.distanceTo(center)).toBeLessThan(1e-12);
      view.updateCenters();
      expect(view.thrustCenter.visible).toBe(count > 0);
      expect(view.thrustCenter.position.distanceTo(center.sub(view.designCG).applyQuaternion(view.aircraft.quaternion).add(view.aircraft.position))).toBeLessThan(1e-12);
      const direction = new Vector3(0, 1, 0).applyQuaternion(view.thrustCenter.quaternion);
      expect(direction.distanceTo(new Vector3(1, 0, 0).applyQuaternion(view.aircraft.quaternion))).toBeLessThan(1e-12);
    }
  });
});

it('气动图层在透明背景之后绘制，禁用深度读写和雾化',()=>{
 const group=new Group(),marker=new Mesh(new BoxGeometry(),new MeshBasicMaterial());group.add(marker);
 const view=Object.assign(Object.create(SceneView.prototype),{debugGroup:group,cg:{},liftCenter:{},simulation:{},updateEnvironment(){},updateCenters(){}});
 view.setDebug(true);
 expect(marker.renderOrder).toBe(100);expect(marker.material.transparent).toBe(true);
 expect(marker.material.depthTest).toBe(false);expect(marker.material.depthWrite).toBe(false);expect(marker.material.fog).toBe(false);
 marker.geometry.dispose();marker.material.dispose();
});

it('追尾在竖直爬升、俯冲及滚转时保持机体后上方，鼠标回正不受世界极角限制',()=>{
 for(const pitch of [0,Math.PI/2,-Math.PI/2,Math.PI*0.44])for(const roll of [0,Math.PI/2,Math.PI]){
  const aircraft=new Group();aircraft.position.set(100,500,30);
  aircraft.quaternion.setFromAxisAngle(new Vector3(0,0,1),pitch).multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),roll));
  const camera=new PerspectiveCamera();
  const view=Object.assign(Object.create(SceneView.prototype),{
   aircraft,camera,definition:defaultAircraft,simulation:{ended:false},controls:{enabled:false},view:'chase',
   desiredPosition:new Vector3(),desiredTarget:new Vector3(),target:new Vector3(),vector:new Vector3(),vector2:new Vector3(),
   width:1440,height:900,followInitialized:false,editorPointerId:-1,elapsed:10,cameraReleasedAt:-Infinity,cameraDragging:false,
   followPosition:new Vector3(),followTarget:new Vector3(),cameraYaw:0,cameraPitch:0,resultOrbit:false,
  });
  view.followCamera(1/60,true);
  const local=camera.position.clone().sub(aircraft.position).applyQuaternion(aircraft.quaternion.clone().invert());
  expect(local.x).toBeLessThan(-20);expect(local.y).toBeCloseTo(-local.x*0.065,8);expect(local.z).toBeCloseTo(0,8);
  const position=camera.position.clone(),orientation=camera.quaternion.clone();
  view.updateCameraInteraction(1/60);
  expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
  expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
  expect(camera.getWorldDirection(new Vector3()).dot(new Vector3(1,0,0).applyQuaternion(aircraft.quaternion))).toBeGreaterThan(0.95);
  aircraft.position.x+=12;
  view.followCamera(1/60,false);
  expect(camera.position.x-position.x).toBeGreaterThan(0);
  expect(camera.position.x-position.x).toBeLessThan(12);
  for(let frame=0;frame<240;frame++){view.updateCameraInteraction(1/60);view.followCamera(1/60,false);}
  expect(camera.position.distanceTo(view.desiredPosition)).toBeLessThan(0.001);
 }
});

function flightCameraView() {
  const aircraft = new Group(), camera = new PerspectiveCamera(43, 1.6, 0.1, 3000);
  aircraft.position.set(100, 500, 30);
  return Object.assign(Object.create(SceneView.prototype), {
    aircraft, camera, perspective: camera, orthographic: new OrthographicCamera(), definition: defaultAircraft,
    simulation: { ended: false }, controls: { enabled: false, target: new Vector3(), update() {} },
    desiredPosition: new Vector3(), desiredTarget: new Vector3(), target: new Vector3(),
    vector: new Vector3(), vector2: new Vector3(), cameraHome: new Vector3(), targetHome: new Vector3(),
    followPosition: new Vector3(), followTarget: new Vector3(), followInitialized: false,
    cameraYaw: 0, cameraPitch: 0, cameraPointer: -1, cameraDragging: false, cameraReleasedAt: -Infinity,
    view: 'chase', width: 1440, height: 900, editorPointerId: -1, elapsed: 10, resultOrbit: false,
    resize() {}, surfaceHeight() { return 0; },
  });
}

it('锁定与追尾初始位置相同，平移、竖直俯仰和滚转均严格跟随，不响应拖动或地表回避', () => {
  const view = flightCameraView();
  view.cameraView('追尾');
  const position = view.camera.position.clone(), rotation = view.camera.quaternion.clone();
  view.cameraView('锁定');
  expect(view.view).toBe('locked');
  expect(view.controls.enabled).toBe(false);
  expect(view.controls.enableDamping).toBe(false);
  expect(view.camera.position.toArray()).toEqual(position.toArray());
  expect(view.camera.quaternion.toArray()).toEqual(rotation.toArray());
  for (const pitch of [0, Math.PI / 2, -Math.PI / 2]) for (const roll of [0, Math.PI / 2, Math.PI]) {
    view.aircraft.position.add(new Vector3(12, -3, 8));
    view.aircraft.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), pitch)
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll));
    view.followCamera(1 / 240, false);
    expect(view.camera.position.distanceTo(view.desiredPosition)).toBeLessThan(1e-10);
    expect(view.target.distanceTo(view.desiredTarget)).toBeLessThan(1e-10);
    expect(view.camera.up.distanceTo(new Vector3(0, 1, 0).applyQuaternion(view.aircraft.quaternion))).toBeLessThan(1e-10);
    const lockedPosition = view.camera.position.clone(), lockedRotation = view.camera.quaternion.clone();
    view.cameraYaw = 0.8; view.cameraPitch = 0.4;
    view.updateCameraInteraction(1);
    view.surfaceHeight = () => 1000;
    view.constrainCamera();
    expect(view.camera.position.toArray()).toEqual(lockedPosition.toArray());
    expect(view.camera.quaternion.toArray()).toEqual(lockedRotation.toArray());
  }
  view.surfaceHeight = () => 0;
  view.cameraView('自由');
  expect(view.controls.enabled).toBe(true);
  expect(view.controls.enableDamping).toBe(true);
});

it('自由视角只跟随飞机平移，保留环绕角度、平移偏置和缩放距离，空闲不回中', () => {
  const view = flightCameraView();
  view.cameraView('自由');
  view.camera.position.set(80, 510, 50);
  view.controls.target.copy(view.aircraft.position).add(new Vector3(0, 2, 3));
  view.camera.lookAt(view.controls.target);
  const offset = view.camera.position.clone().sub(view.aircraft.position);
  const targetOffset = view.controls.target.clone().sub(view.aircraft.position);
  const rotation = view.camera.quaternion.clone();
  for (let frame = 0; frame < 240; frame++) {
    view.aircraft.position.add(new Vector3(0.5, -0.1, 0.2));
    view.aircraft.rotation.set(frame * 0.01, frame * 0.02, frame * 0.03);
    view.elapsed += 1 / 60;
    view.followCamera(1 / 60, false);
    view.updateCameraInteraction(1 / 60);
  }
  expect(view.camera.position.clone().sub(view.aircraft.position).distanceTo(offset)).toBeLessThan(1e-10);
  expect(view.controls.target.clone().sub(view.aircraft.position).distanceTo(targetOffset)).toBeLessThan(1e-10);
  expect(view.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  // OrbitControls owns wheel zoom; follow must preserve its new radius.
  view.camera.position.lerp(view.controls.target, 0.5);
  const zoomedDistance = view.camera.position.distanceTo(view.controls.target);
  view.aircraft.position.x += 20;
  view.followCamera(1 / 60, false);
  view.updateCameraInteraction(10);
  expect(view.camera.position.distanceTo(view.controls.target)).toBeCloseTo(zoomedDistance, 10);
});

it('翼尖涡流使用更细条带且最高不透明度95%，保持距离渐变及失速清除', () => {
  const geometry = new BufferGeometry(), positions = new Float32Array(192 * 36), colors = new Float32Array(192 * 48);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  const camera = new PerspectiveCamera(43, 1.6); camera.position.set(20, 5, 10);
  const view = Object.assign(Object.create(SceneView.prototype), {
    simulation: { time: 0, telemetry: { speed: 21, stall: false } }, aircraft: new Group(),
    camera, perspective: camera, orthographic: new OrthographicCamera(), height: 10000,
    wingTrailGeometry: geometry, wingTrailArray: positions, wingTrailColors: colors,
    wingTrail: new Mesh(geometry, new MeshBasicMaterial()), wingTrailHistory: new Float32Array(193 * 6),
    wingTrailDistances: new Float64Array(2), wingTrailLengths: new Float64Array(2),
    wingTrailPoint: new Vector3(), wingTrailOlder: new Vector3(), wingTrailWidth: new Vector3(),
    wingTrailCount: 0, wingTrailIndex: 0, wingTrailTime: -1,
    vector: new Vector3(), vector2: new Vector3(),
    wingTipWorld(side: number, out: Vector3) { return out.set(this.aircraft.position.x, 5, side * 6); },
  });
  for (let index = 0; index < 180; index++) {
    view.simulation.time += 1 / 60;
    view.aircraft.position.x += 0.5;
    view.recordWingTrail();
  }
  expect(geometry.drawRange.count).toBeGreaterThan(0);
  const widths: number[] = [], alpha: number[] = [];
  for (let vertex = 0; vertex < geometry.drawRange.count; vertex += 6) {
    const a = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex);
    const b = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), vertex + 1);
    widths.push(a.distanceTo(b));
  }
  for (let vertex = 0; vertex < geometry.drawRange.count; vertex++) alpha.push(colors[vertex * 4 + 3]);
  expect(Math.max(...widths)).toBeGreaterThan(0.05);
  expect(Math.max(...widths)).toBeLessThanOrEqual(0.06801);
  expect(alpha[0]).toBe(0);
  expect(Math.max(...alpha)).toBeGreaterThan(0.9);
  expect(Math.max(...alpha) * view.wingTrail.material.opacity).toBeLessThanOrEqual(0.95);
  expect(view.wingTrail.material.opacity).toBe(0.95);
  view.simulation.telemetry.stall = true;
  view.recordWingTrail();
  expect(geometry.drawRange.count).toBe(0);
  expect(view.wingTrail.visible).toBe(false);
  geometry.dispose(); view.wingTrail.material.dispose();
});

function steamView(challenge: ChallengeMode) {
  const geometry = new SphereGeometry(1, 7, 5);
  const opacity = new InstancedBufferAttribute(new Float32Array(384), 1);
  geometry.setAttribute('steamOpacity', opacity);
  return Object.assign(Object.create(SceneView.prototype), {
    environmentChallenge: challenge, simulation: null,
    steam: new InstancedMesh(geometry, new MeshBasicMaterial({ opacity: 0.38 }), 384),
    steamParticle: new Object3D(), steamOpacity: opacity, steamTime: 0, steamEmitting: false,
  });
}

describe('弹射蒸汽与门框边界', () => {
  it('鸟人和高山沿轨迹持续双侧喷发，释放后扩散淡出，结束和重飞清空同一实例池', () => {
    for (const challenge of ['birdman', 'downhill'] as const) {
      const view = steamView(challenge);
      const simulation = { elapsedTime: 0, launching: true, ended: false, replayFinished: false };
      view.simulation = simulation;
      const matrices = view.steam.instanceMatrix.array, opacity = view.steamOpacity.array;
      view.updateSteam();
      expect(view.steamDiagnostics().count).toBe(0);
      simulation.elapsedTime = 1;
      view.updateSteam();
      const early = view.steamDiagnostics();
      expect(early.emitting).toBe(true);
      expect(early.count).toBe(240);
      expect(early.leftCount).toBe(120);
      expect(early.rightCount).toBe(120);
      for (let index = 0; index < early.particles.length; index += 2) {
        const left = early.particles[index], right = early.particles[index + 1];
        expect(left.side).toBe('left'); expect(right.side).toBe('right');
        expect(left.position.z).toBeLessThan(-0.37);
        expect(right.position.z).toBeGreaterThan(0.37);
        expect(left.position.x).toBe(right.position.x);
        expect(left.position.y).toBe(right.position.y);
      }
      const launch = challengeLaunch(challenge), speed = launch?.speed ?? LAUNCH.speed;
      const acceleration = launch?.acceleration ?? LAUNCH.acceleration, startX = launch?.startX ?? LAUNCH.startX;
      const newest = early.particles[early.count - 2];
      expect(newest.position.x).toBeCloseTo(startX + 0.5 * acceleration * Math.cos(launch?.slope ?? LAUNCH.slope), 5);
      simulation.elapsedTime = speed / acceleration;
      simulation.launching = false;
      view.updateSteam();
      const released = view.steamDiagnostics();
      expect(released.count).toBe(384);
      expect(released.emitting).toBe(false);
      simulation.elapsedTime += 0.8;
      view.updateSteam();
      const dissipating = view.steamDiagnostics();
      expect(dissipating.count).toBeGreaterThan(0);
      expect(dissipating.count).toBeLessThan(released.count);
      expect(dissipating.particles.at(-1).radius).toBeGreaterThan(released.particles.at(-1).radius);
      expect(dissipating.particles.at(-1).opacity).toBeLessThan(released.particles.at(-1).opacity);
      const snapshot = view.steamDiagnostics();
      snapshot.particles[0].position.x = 1e6;
      expect(view.steamDiagnostics().particles[0].position.x).not.toBe(1e6);
      simulation.elapsedTime += 1;
      view.updateSteam();
      expect(view.steamDiagnostics()).toMatchObject({ visible: false, count: 0 });
      simulation.elapsedTime = 0.6; simulation.launching = true;
      view.updateSteam();
      expect(view.steam.count).toBeGreaterThan(0);
      simulation.ended = true;
      view.updateSteam();
      expect(view.steam.count).toBe(0);
      simulation.ended = false; simulation.elapsedTime = 0;
      view.updateSteam();
      expect(view.steam.count).toBe(0);
      expect(view.steam.instanceMatrix.array).toBe(matrices);
      expect(view.steamOpacity.array).toBe(opacity);
      view.steam.geometry.dispose(); view.steam.material.dispose(); view.steam.dispose();
    }
  });

  it('低空导轨不喷蒸汽，鸟人和高山回放在相同物理时刻生成相同实例', () => {
    const low = steamView('low-altitude');
    low.simulation = { elapsedTime: 1, launching: true, ended: false, replayFinished: false };
    low.updateSteam();
    expect(low.steamDiagnostics()).toMatchObject({ visible: false, emitting: false, count: 0 });
    low.steam.geometry.dispose(); low.steam.material.dispose(); low.steam.dispose();
    const neutral = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
    for (const challenge of ['birdman', 'downhill'] as const) {
      const definition = clone(defaultAircraft);
      definition.birdman = challenge === 'birdman';
      const simulation = new FlightSimulation(definition, challenge, 0), view = steamView(challenge);
      view.simulation = simulation;
      for (let step = 0; step < 48; step++) simulation.step(neutral);
      view.updateSteam();
      const live = view.steamDiagnostics(), matrix = new Matrix4();
      view.steam.getMatrixAt(0, matrix);
      const liveMatrix = matrix.clone();
      for (let step = 0; step < 48; step++) simulation.step(neutral);
      const replay = new FlightSimulation(definition, challenge, 0);
      replay.loadReplay(simulation.getRecording());
      view.simulation = replay;
      // 只更新回放末帧的场景，证明发射序列不依赖渲染频率。
      for (let step = 0; step < 48; step++) replay.step(neutral);
      view.updateSteam();
      expect(view.steamDiagnostics()).toEqual(live);
      view.steam.getMatrixAt(0, matrix);
      expect(matrix.elements).toEqual(liveMatrix.elements);
      while (!replay.replayFinished) replay.step(neutral);
      view.updateSteam();
      expect(view.steam.count).toBe(0);
      view.steam.geometry.dispose(); view.steam.material.dispose(); view.steam.dispose();
    }
  });

  it('山谷横门和平原地形门共享警戒轮廓，三角形内任意位置等于物理门顶', () => {
    for (const challenge of ['downhill', 'low-altitude'] as const) {
      for (const gate of [challengeStartGate(challenge)!, ...challengeCheckpoints(challenge)]) {
        const profile = challengeGateProfile(challenge, gate);
        if (challenge === 'downhill' && gate.x < DOWNHILL_PLAIN_START) expect(new Set(profile.map(point => point.top)).size).toBe(1);
        expect(profile[0].z).toBe(-gate.halfWidth);
        expect(profile.at(-1).z).toBe(gate.halfWidth);
        for (let index = 1; index < profile.length; index++) {
          const a = profile[index - 1], b = profile[index], z = (a.z + b.z) / 2;
          expect(gate.y + (a.top + b.top) / 2).toBeCloseTo(challengeGateCeiling(challenge, gate, gate.z + z), 8);
          if (challenge === 'downhill') {
            expect(gate.y + (a.bottom + b.bottom) / 2).toBeCloseTo(challengeCollisionHeight(challenge, gate.x, gate.z + z), 8);
          }
        }
      }
    }
  });

  it('门外高空、地底和两侧完整覆盖红纹，不留下80m红带之外的透明拒绝区域', () => {
    const view = Object.create(SceneView.prototype);
    for (const gate of [challengeStartGate('downhill')!, ...challengeCheckpoints('downhill')]) {
      const regions = view.gateWarningRegions('downhill', gate, false) as { name: string; vertices: number[] }[];
      const covered = (y: number, z: number) => regions.some(region => {
        const vertices = region.vertices;
        for (let index = 0; index < vertices.length; index += 9) {
          const ay = vertices[index + 1], az = vertices[index + 2], by = vertices[index + 4], bz = vertices[index + 5], cy = vertices[index + 7], cz = vertices[index + 8];
          const denominator = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
          if (denominator === 0) continue;
          const a = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / denominator;
          const b = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / denominator;
          if (a >= -1e-10 && b >= -1e-10 && a + b <= 1 + 1e-10) return true;
        }
        return false;
      });
      for (const point of challengeGateProfile('downhill', gate)) {
        expect(covered(point.top + 1000, point.z)).toBe(true);
        expect(covered(point.bottom - 1000, point.z)).toBe(true);
        if (point.top - point.bottom > 4 && Math.abs(point.z) < gate.halfWidth) {
          expect(covered((point.top + point.bottom) / 2, point.z)).toBe(false);
        }
      }
      expect(covered(0, -gate.halfWidth - 1000)).toBe(true);
      expect(covered(0, gate.halfWidth + 1000)).toBe(true);
    }
  });

  it('速降禁止区仅在门平面，靠近渐显，通过后整门消失且回头不会复现，重飞恢复', () => {
    const view = Object.create(SceneView.prototype);
    view.mountainEnvironment = new Group();
    const gates = [challengeStartGate('downhill')!, ...challengeCheckpoints('downhill')];
    for (const [index, gate] of gates.entries()) {
      const group = new Group();
      group.position.set(gate.x, gate.y, gate.z);
      group.userData.gate = { checkpointIndex: index };
      const material = new ShaderMaterial({ uniforms: { opacity: { value: 0 } } });
      const warning = new Mesh(new BoxGeometry(), material);
      warning.userData.warning = true;
      group.add(warning, new Object3D());
      view.mountainEnvironment.add(group);
      for (const region of view.gateWarningRegions('downhill', gate, false)) {
        for (let vertex = 0; vertex < region.vertices.length; vertex += 3) expect(region.vertices[vertex]).toBe(0);
      }
    }
    const simulation = { challenge: 'downhill', position: new Vector3(), telemetry: { timingStarted: false, challengeProgress: 0 } };
    view.simulation = simulation;
    const start = view.mountainEnvironment.children[0];
    const opacity = (start.children[0] as Mesh<BoxGeometry, ShaderMaterial>).material.uniforms.opacity;
    simulation.position.x = gates[0].x - 100;
    view.updateChallengeGates(); expect(start.visible).toBe(true); expect(opacity.value).toBe(0);
    simulation.position.x = gates[0].x - 45;
    view.updateChallengeGates(); expect(opacity.value).toBe(0.5);
    simulation.position.x = gates[0].x - 1;
    view.updateChallengeGates(); expect(opacity.value).toBeGreaterThan(0.98);
    simulation.position.x = gates[0].x;
    simulation.telemetry.timingStarted = true;
    view.updateChallengeGates(); expect(start.visible).toBe(false); expect(opacity.value).toBe(0);
    for (let index = 1; index < gates.length; index++) {
      simulation.position.x = gates[index].x;
      simulation.telemetry.challengeProgress = index / challengeCheckpoints('downhill').length;
      view.updateChallengeGates();
      expect(view.mountainEnvironment.children[index].visible).toBe(false);
      if (index + 1 < gates.length) expect(view.mountainEnvironment.children[index + 1].visible).toBe(true);
    }
    simulation.position.x = gates[0].x - 1;
    view.updateChallengeGates();
    expect(view.mountainEnvironment.children.every((gate: Object3D) => !gate.visible)).toBe(true);
    simulation.telemetry.timingStarted = false; simulation.telemetry.challengeProgress = 0;
    view.updateChallengeGates();
    expect(view.mountainEnvironment.children.every((gate: Object3D) => gate.visible)).toBe(true);
    view.simulation = null; view.updateChallengeGates();
    expect(opacity.value).toBe(0);
    for (const gate of view.mountainEnvironment.children) {
      const warning = gate.children[0] as Mesh<BoxGeometry, ShaderMaterial>;
      warning.geometry.dispose(); warning.material.dispose();
    }
  });
});
