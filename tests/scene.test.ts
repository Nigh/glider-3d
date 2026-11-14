import { describe, expect, it, vi } from 'vitest';
import { Box3, Box3Helper, BufferAttribute, BufferGeometry, Color, DirectionalLight, FogExp2, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, ShaderMaterial, BoxGeometry, Object3D, OrthographicCamera, PerspectiveCamera, Quaternion, Raycaster, Scene, SphereGeometry, Spherical, Vector2, Vector3 } from 'three';
import type { Material, MeshStandardMaterial } from 'three';
import { clone, defaultAircraft, DEG, engineMounts, wingLocalPoint, wingOrigin, normalizeAircraftGeometry, resizeFuselage, fuselageEnds, editWingPoint, presets } from '../src/model';
import { SceneView } from '../src/scene';
import { Plane } from 'three';
import { FlightSimulation, LAUNCH } from '../src/physics';
import { challengeCheckpoints, challengeCollisionHeight, challengeGateCeiling, challengeGateProfile, DOWNHILL_PLAIN_START, challengeLaunch, challengeStartGate, downhillRuins, type ChallengeMode } from '../src/challenges';
import { TEST_SPACE, testCatapultSample, testSpaceTerrainHeight } from '../src/laboratory';

it('废墟窗带完整位于所属墙面外，倾斜建筑也不与墙面相交', () => {
  const view = Object.assign(Object.create(SceneView.prototype), {
    mountainEnvironment: new Group(), renderer: { capabilities: { getMaxAnisotropy: () => 1 } },
  });
  view.buildDownhillRuins();
  const bodies = view.mountainEnvironment.getObjectByName('fallen-highrises') as InstancedMesh;
  const bands = view.mountainEnvironment.getObjectByName('ruin-window-bands') as InstancedMesh;
  const bodyMatrix = new Matrix4(), bandMatrix = new Matrix4(), relative = new Matrix4();
  const position = new Vector3(), rotation = new Quaternion(), dimensions = new Vector3();
  const cube = new Box3(new Vector3(-0.5,-0.5,-0.5),new Vector3(0.5,0.5,0.5));
  let index = 0;
  for (const [bodyIndex, ruin] of downhillRuins.entries()) {
    bodies.getMatrixAt(bodyIndex,bodyMatrix);
    bodyMatrix.decompose(position,rotation,dimensions);
    bodyMatrix.compose(position,rotation,new Vector3(1,1,1)).invert();
    const windowCount = Math.ceil((ruin.length-6)/6)*2+1;
    for (let window = 0; window < windowCount; window++) {
      bands.getMatrixAt(index++,bandMatrix);
      const bounds = cube.clone().applyMatrix4(relative.multiplyMatrices(bodyMatrix,bandMatrix));
      const clearance = Math.max(bounds.min.x-dimensions.x/2,-dimensions.x/2-bounds.max.x,bounds.min.z-dimensions.z/2);
      expect(clearance).toBeGreaterThan(0.01);
    }
  }
  expect(index).toBe(bands.count);
});

it('renders every wing of a combined fin/tail fragment and removes only parts whose owner changed', () => {
  const geometry = () => new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3)).setIndex([0, 1, 2]);
  const body = { id: 1, position: new Vector3(10, 20, 30), quaternion: new Quaternion(), cg: new Vector3() };
  const view = Object.assign(Object.create(SceneView.prototype), {
    simulation: { fragments: [body] }, fragments: [], scene: new Scene(),
    wingSections: [[], [{ physics: { bodyId: 1 } }], [{ physics: { bodyId: 1 } }]],
    wingMeshes: [0, 1, 2].map(() => new Mesh(geometry())),
    hingeLines: [0, 1, 2].map(() => new Mesh(geometry(), new MeshBasicMaterial())),
    aircraftMaterials: { main: new MeshBasicMaterial() },
  });
  expect(view.ensureFragments()).toBe(true);
  expect(view.fragments.map((f: any) => [f.id, f.wingIndex])).toEqual([[1, 1], [1, 2]]);
  expect(view.ensureFragments()).toBe(false);
  view.wingSections[1][0].physics.bodyId = 2;
  view.simulation.fragments.push({ ...body, id: 2 });
  expect(view.ensureFragments()).toBe(true);
  expect(view.fragments.map((f: any) => [f.id, f.wingIndex])).toEqual([[1, 2], [2, 1]]);
  expect(view.wingMeshes[1].geometry.getAttribute('position').count).toBe(3);
  view.simulation.fragments.length = 0; expect(view.ensureFragments()).toBe(true);
  expect(view.fragments).toHaveLength(0);
});

// Exercise SceneView's real layout without a WebGL context or browser timing.
describe('camera clearance', () => {
  it.each(['design', 'birdman', 'result'])('bounds push and restores the original camera in %s', screen => {
    const camera = new PerspectiveCamera(), target = new Vector3(7, 3, -4);
    let ground = 1000;
    const view = Object.assign(Object.create(SceneView.prototype), {
      camera, controls: { enabled: true, target: target.clone() }, target: target.clone(), editorTarget: null,
      simulation: screen === 'menu' || screen === 'design' ? null : { ended: screen === 'result' },
      view: 'free', surfaceHeight: () => ground,
      cameraClearanceOffset: new Vector3(), cameraClearanceOrigin: new Vector3(), cameraClearancePoint: new Vector3(),
    });
    const original = new Vector3(-10, 10, 12);
    camera.position.copy(original);
    for (let frame = 0; frame < 30; frame++) {
      view.restoreCameraClearance();
      view.constrainCamera();
      expect(camera.position.distanceTo(original)).toBeLessThanOrEqual(8 + 1e-12);
      expect(camera.position.y).toBe(original.y + 8);
      expect(view.controls.target.equals(target)).toBe(true);
      expect(view.target.equals(target)).toBe(true);
    }
    ground = 0;
    view.restoreCameraClearance();
    view.constrainCamera();
    expect(camera.position.distanceTo(original)).toBeLessThan(1e-12);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(target.clone().sub(camera.position).normalize())).toBeLessThan(1e-12);
  });

  it.each(['chase', 'locked', 'pilot', 'legacy-chase', 'flight-side', 'free', 'orbit'])('shortens before pushing upward in %s and restores original distance', mode => {
    const view = flightCameraView();
    view.view = mode;
    view.controls.enabled = mode === 'free' || mode === 'orbit';
    view.target.set(0, 10, 0); view.controls.target.copy(view.target);
    view.camera.position.set(500, 10, 0);
    let obstacle = true;
    view.surfaceHeight = (x: number) => obstacle && x > 496 ? 20 : 0;
    view.constrainCamera();
    expect(view.camera.position.x).toBeLessThanOrEqual(496);
    expect(view.camera.position.x).toBeGreaterThanOrEqual(492);
    expect(view.camera.position.y).toBe(10);
    obstacle = false;
    view.restoreCameraClearance();
    view.constrainCamera();
    expect(view.camera.position.toArray()).toEqual([500, 10, 0]);
  });
});

function testSpaceView() {
  const scene = new Scene(), mountainEnvironment = new Group(), environment = new Group();
  scene.background = new Color(); scene.add(environment, mountainEnvironment);
  const view = Object.assign(Object.create(SceneView.prototype), {
    scene, mountainEnvironment, environment, definition: clone(defaultAircraft), simulation: null,
    environmentChallenge: 'birdman', environmentFog: new FogExp2(), metrics: {},
    perspective: new PerspectiveCamera(), orthographic: new OrthographicCamera(), controls: {},
    renderer: { capabilities: { getMaxAnisotropy: () => 4 } }, waterTime: { value: 0 },
  });
  view.setEnvironmentChallenge('test-space');
  scene.updateMatrixWorld(true);
  return view;
}

describe('测试空间渲染', () => {
  it('渲染地形与实际碰撞高度一致', () => {
    const view = testSpaceView();
    try {
      const terrain = view.mountainEnvironment.getObjectByName('test-space-terrain') as Mesh<BufferGeometry, MeshStandardMaterial>;
      const ray = new Raycaster();
      for (const [x, z] of [[-1993.2, -1017.7], [326.7, -3612.3], [195.3, 73.2]]) {
        ray.set(new Vector3(x, 6000, z), new Vector3(0, -1, 0));
        const hit = ray.intersectObject(terrain)[0];
        expect(hit.point.y).toBeCloseTo(testSpaceTerrainHeight(x, z), 3);
      }
    } finally { view.release(view.scene); }
  });

  it('0m平台仅调整渲染深度，海岸前后保持正确遮挡和物理水线', () => {
    const view = testSpaceView();
    try {
      const sim = new FlightSimulation(defaultAircraft, 'test-space', 0, { height: 0, catapult: true, speed: 50 });
      view.laboratoryScene.update(sim); view.scene.updateMatrixWorld(true);
      const deck = view.mountainEnvironment.getObjectByName('test-platform-deck') as Mesh<BufferGeometry, MeshStandardMaterial>;
      const ocean = view.mountainEnvironment.getObjectByName('test-space-ocean') as Mesh<BufferGeometry, MeshStandardMaterial>;
      const terrain = view.mountainEnvironment.getObjectByName('test-space-terrain') as Mesh;
      expect(view.laboratoryScene.platform.position.y).toBe(0);
      expect(new Box3().setFromObject(deck).max.y).toBeCloseTo(0, 7);
      expect(testSpaceTerrainHeight(TEST_SPACE.platformX, 0)).toBe(0);
      expect(deck.castShadow && deck.receiveShadow).toBe(true);
      for (const surface of [deck, ocean]) {
        expect(surface.material.polygonOffset).toBe(true);
        expect(surface.material.polygonOffsetFactor).toBeLessThan(0);
        expect(surface.material.polygonOffsetUnits).toBeLessThan(0);
      }
      expect(ocean.material.transparent).toBe(false);
      const ray = new Raycaster();
      for (const [z, visible] of [[TEST_SPACE.beachHalfWidth + 0.1, terrain], [TEST_SPACE.beachHalfWidth + 1, ocean]] as const) {
        ray.set(new Vector3(0, 100, z), new Vector3(0, -1, 0));
        expect(ray.intersectObjects([terrain, ocean])[0].object).toBe(visible);
        expect(challengeCollisionHeight('test-space', 0, z)).toBe(0);
      }
      expect(sim.testSpace.height).toBe(0);
    } finally { view.release(view.scene); }
  });

  it('绿地树木用两组实例绘制，贴合地形并投射阴影', () => {
    const view = testSpaceView();
    try {
      const trunks = view.mountainEnvironment.getObjectByName('tree-trunks') as InstancedMesh;
      const trees = view.mountainEnvironment.getObjectByName('tree-canopies') as InstancedMesh;
      expect(trunks).toBeInstanceOf(InstancedMesh); expect(trees).toBeInstanceOf(InstancedMesh);
      expect(trunks.count).toBe(48); expect(trees.count).toBe(trunks.count);
      expect(trunks.castShadow && trunks.receiveShadow && trees.castShadow && trees.receiveShadow).toBe(true);
      const matrix = new Matrix4(), position = new Vector3();
      for (let i = 0; i < trunks.count; i++) {
        trunks.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
        const ground = testSpaceTerrainHeight(position.x, position.z);
        expect(position.y - 2.4).toBeCloseTo(ground, 3);
        expect(position.z).toBeLessThan(-TEST_SPACE.beachHalfWidth);
        expect(ground).toBeLessThan(1800);
      }
      trunks.getMatrixAt(0, matrix); position.setFromMatrixPosition(matrix);
      expect(Math.hypot(position.x - TEST_SPACE.platformX, position.z)).toBeLessThan(500);
    } finally { view.release(view.scene); }
  });

  it('阴影随飞机覆盖高空投向地面的位置，不跟随自由镜头且保持米制深度偏移', () => {
    const light = new DirectionalLight(), aircraft = new Group();
    const view = Object.assign(Object.create(SceneView.prototype), {
      light, aircraft, vector: new Vector3(), environmentChallenge: 'test-space', camera: new PerspectiveCamera(),
    });
    for (const height of [0, 100, 5000]) {
      aircraft.position.set(-2000, height, 0); view.camera.position.set(2000, 6000, -4000);
      view.updateLight(); light.updateMatrixWorld(true); light.target.updateMatrixWorld(true); light.shadow.updateMatrices(light);
      const receiver = new Vector3(-2000 + height * 55 / 110, 0, -height * 65 / 110).project(light.shadow.camera);
      expect(Math.abs(receiver.x)).toBeLessThan(1e-8); expect(Math.abs(receiver.y)).toBeLessThan(1e-8);
      expect(Math.abs(receiver.z)).toBeLessThan(1);
      expect(light.target.position.equals(aircraft.position)).toBe(true);
      expect(light.shadow.bias * light.shadow.camera.far).toBeCloseTo(-0.0805, 10);
    }
    view.environmentChallenge = 'birdman'; view.updateLight();
    expect(light.shadow.camera.far).toBe(230); expect(light.shadow.bias).toBeCloseTo(-0.00035, 10);
    light.shadow.dispose();
  });

  it('重建测试空间释放各自纹理，不释放常驻湖面或复用已释放纹理', () => {
    const view = testSpaceView();
    const lake = new Mesh(new BoxGeometry(), view.waterMaterial(0x7bada6, 2400, 2000));
    view.environment.add(lake);
    const terrain = view.mountainEnvironment.getObjectByName('test-space-terrain') as Mesh<BufferGeometry, MeshStandardMaterial>;
    const ocean = view.mountainEnvironment.getObjectByName('test-space-ocean') as Mesh<BufferGeometry, MeshStandardMaterial>;
    const groundTexture = terrain.material.map!, waterTexture = ocean.material.map!;
    let groundDisposed = 0, waterDisposed = 0, lakeDisposed = 0;
    groundTexture.addEventListener('dispose', () => groundDisposed++);
    waterTexture.addEventListener('dispose', () => waterDisposed++);
    lake.material.map!.addEventListener('dispose', () => lakeDisposed++);
    try {
      view.setEnvironmentChallenge('test-space');
      expect(groundDisposed).toBe(1); expect(waterDisposed).toBe(1); expect(lakeDisposed).toBe(0);
      const next = view.mountainEnvironment.getObjectByName('test-space-ocean') as Mesh<BufferGeometry, MeshStandardMaterial>;
      expect(next.material.map).not.toBe(waterTexture); expect(next.material.map).not.toBe(lake.material.map);
    } finally { view.release(view.scene); }
    expect(groundDisposed).toBe(1); expect(waterDisposed).toBe(1); expect(lakeDisposed).toBe(1);
  });
});

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
  it('根弦与梢弦共用圆形手柄，安装点为带十字菱形，顶点连线紧随手柄以共享hover/focus', () => {
    type TestSvg = {
      style: { display: string }; attributes: Map<string, string>;
      setAttribute(name: string, value: string): void;
      querySelector(): { textContent: string; setAttribute(): void };
      tagName: string; children: TestSvg[]; classes: Set<string>;
      classList: { add(...names: string[]): void };
      addEventListener(): void; append(...children: TestSvg[]): void; appendChild(child: TestSvg): void;
      removeAttribute(name: string): void; cloneNode(): TestSvg;
    };
    const create = (tagName: string): TestSvg => {
      const classes = new Set<string>();
      const node: TestSvg = {
        ...svgElement(), tagName, children: [], classes,
        classList: { add(...names: string[]) { for (const name of names) classes.add(name); } },
        addEventListener() {},
        append(...children: TestSvg[]) { node.children.push(...children); },
        appendChild(child: TestSvg) { node.children.push(child); },
        removeAttribute(name: string) { node.attributes.delete(name); },
        cloneNode() {
          const copy = create(tagName);
          for (const [name, value] of node.attributes) copy.setAttribute(name, value);
          return copy;
        },
      };
      return node;
    };
    vi.stubGlobal('document', { createElementNS: (_namespace: string, tag: string) => create(tag) });
    try {
      const overlay = create('svg');
      const segments: { group: TestSvg }[] = [];
      const handles: { group: TestSvg; leader: TestSvg }[] = [];
      const view = Object.assign(Object.create(SceneView.prototype), {
        editorOverlay: overlay, editorHandles: handles, editorSegments: segments, editorPolygons: [],
        host: { appendChild() {} },
      });
      view.buildEditorOverlay();
      const knobs = segments.map(segment => segment.group.children.find(node => node.classes.has('editor-knob'))!);
      expect(knobs.map(knob => knob.attributes.get('r'))).toEqual(['10', '10', '10']);
      for (const segment of segments) {
        expect(segment.group.children[1].classes.has('editor-chord-line')).toBe(true);
        expect(segment.group.children[2].classes.has('editor-leader')).toBe(true);
      }
      for (const handle of handles) {
        const index = overlay.children.indexOf(handle.group);
        expect(overlay.children[index + 1]).toBe(handle.leader);
        const mark = handle.group.children.find(node => node.classes.has('editor-mount-mark'))!;
        expect(mark.attributes.get('d')).toContain('M -5 0 H 5 M 0 -5 V 5');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a visible vertex handle over a chord never selects the chord underneath', () => {
    const group=()=>({style:{display:'',cursor:''},focus(){}});
    const view=Object.assign(Object.create(SceneView.prototype),{
      definition:clone(defaultAircraft),editorTarget:'mainWing',simulation:null,editorPointerId:-1,
      renderer:{domElement:{getBoundingClientRect:()=>({left:0,top:0})}},
      editorHandles:[{index:0,side:1,x:108,y:100,group:group()}],
      editorSegments:[{x:200,y:200,x1:0,y1:100,x2:200,y2:100,group:group()}],
      body:new Group(),editOrigin:new Vector3(),vector:new Vector3(),editPlane:new Plane(),editPoint:new Vector3(),editStart:new Vector3(),
      camera:new PerspectiveCamera(),vector2:new Vector3(),deformationRotation:new Quaternion(),
      intersectEditor:()=>true,resetSnap(){},controls:{enabled:true},editorOverlay:{setPointerCapture(){}},
    });
    view.beginEditorDrag({button:0,pointerId:7,clientX:100,clientY:100,ctrlKey:false,preventDefault(){},stopPropagation(){}},0);
    expect(view.editorDrag).toBe(0);
    expect(view.editorSegmentDrag).toBe(-1);
  });
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
    anchors[1].x = 500;
    view.editorDirty = true;
    view.updateEditorOverlay();
    for (const handle of handles) {
      expect(handle.x).toBeCloseTo(handle.ax, 10);
      expect(handle.y).toBeCloseTo(handle.ay, 10);
      expect(handle.leader.style.display).toBe('none');
    }
  });

  it.each([1, -1])('镜像视角%d中弦手柄始终朝投影翼面外侧，安装点保留真实位置', mirror => {
    const anchors = [
      { x: 400, y: 260 }, { x: 400 + mirror * 220, y: 260 },
      { x: 400 + mirror * 220, y: 400 }, { x: 400, y: 400 },
      { x: 400 - mirror * 220, y: 260 }, { x: 400 - mirror * 220, y: 400 },
      { x: 400, y: 330 },
    ];
    const projection = new Vector3();
    projection.project = () => projection;
    const handles = anchors.map((_anchor, index) => ({
      index: index < 4 ? index : index - 3, side: index < 4 ? 1 : -1,
      x: 0, y: 0, ax: 0, ay: 0, group: svgElement(), leader: svgElement(),
    }));
    const segments = [0, 1, 2].map(index => ({
      index: index === 0 ? 0 : 1, side: index === 2 ? -1 : 1,
      x: 0, y: 0, ax: 0, ay: 0, x1: 0, y1: 0, x2: 0, y2: 0,
      group: Object.assign(svgElement(), {
        children: [svgElement(), svgElement(), svgElement()], querySelectorAll: () => [],
      }),
    }));
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition: clone(defaultAircraft), editorTarget: 'mainWing', simulation: null, editorDirty: true,
      width: 1000, height: 700, aircraft: new Group(), camera: new OrthographicCamera(),
      editorOverlay: svgElement(), editorHandles: handles, editorSegments: segments, editorPolygons: [svgElement(), svgElement()],
      editProjection: projection, body: { localToWorld: (point: Vector3) => point },
      wingEditorPoint(index: number, side: number, out: Vector3) {
        const anchor = anchors[side < 0 ? index === 1 ? 4 : index === 2 ? 5 : index : index];
        return out.set(anchor.x / 500 - 1, 1 - anchor.y / 350, 0);
      },
      assemblyEditorPoint(_index: number, out: Vector3) {
        return out.set(anchors[6].x / 500 - 1, 1 - anchors[6].y / 350, 0);
      },
    });
    view.updateEditorOverlay();
    expect((segments[0].x - 400) * mirror).toBeCloseTo(-52, 10);
    expect((segments[1].x - anchors[1].x) * mirror).toBeCloseTo(52, 10);
    expect((segments[2].x - anchors[4].x) * mirror).toBeCloseTo(-52, 10);
    expect(handles[6].x).toBeCloseTo(400, 10);
    expect(handles[6].y).toBeCloseTo(330, 10);
    const firstLayout = segments.map(segment => ({ x: segment.x, y: segment.y }));
    segments[1].x += 104; // Old collision offsets must not survive a now-clear preferred position.
    view.editorDirty = true;
    view.updateEditorOverlay();
    expect(segments.map(segment => ({ x: segment.x, y: segment.y }))).toEqual(firstLayout);
    anchors[1].y = anchors[2].y = 330; // Edge-on chord projections still extend along the visible span.
    view.editorDirty = true;
    view.updateEditorOverlay();
    expect((segments[1].x - anchors[1].x) * mirror).toBeCloseTo(52, 10);
    anchors[6].x = -10; anchors[6].y = 40;
    view.editorDirty = true;
    view.updateEditorOverlay();
    expect(handles[6].x).toBe(24);
    expect(handles[6].y).toBe(64);
    expect(handles[6].leader.style.display).not.toBe('none');
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
      editStart: new Vector3(10, 0, 20),
      editPoint: wingLocalPoint(base.mainWing, 12 * DEG, 1, 0.2, 0, 0.3, new Vector3()).add(new Vector3(10, 0, 20)),
      intersectEditor() { return true; },
      editorChange(next: typeof definition) { this.definition = next; },
    });
    const event = { pointerId: 7, ctrlKey: true, preventDefault() {} };
    view.moveEditorDrag(event);
    expect(view.definition.mainWing.points[1].x).toBeCloseTo(base.mainWing.points[1].x - 0.2, 10);
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
    simulation: { ended: false, elapsedTime: 0, mass: 100, telemetry: { force: new Vector3(0, 981, 0) } }, controls: { enabled: false, target: new Vector3(), update() {} },
    desiredPosition: new Vector3(), desiredTarget: new Vector3(), target: new Vector3(),
    vector: new Vector3(), vector2: new Vector3(), cameraHome: new Vector3(), targetHome: new Vector3(),
    followPosition: new Vector3(), followTarget: new Vector3(), followInitialized: false,
    cameraYaw: 0, cameraPitch: 0, cameraPointer: -1, cameraDragging: false, cameraReleasedAt: -Infinity,
    view: 'chase', width: 1440, height: 900, editorPointerId: -1, elapsed: 10, resultOrbit: false,
    cameraClearanceOffset: new Vector3(), cameraClearanceOrigin: new Vector3(), cameraClearancePoint: new Vector3(),
    designOrbitRotation: new Quaternion(), renderCG: new Vector3(), headOffset: new Vector3(), headInverse: new Quaternion(), headTime: 0,
    resize() {}, refreshControlsUp() {}, surfaceHeight() { return 0; },
  });
}

it('锁定与追尾初始位置相同，短暂迟滞后收敛并允许小幅拖动，碰撞推挤仍有界', () => {
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
    expect(view.camera.position.distanceTo(view.desiredPosition)).toBeGreaterThan(0.001);
    view.cameraYaw = view.cameraPitch = 0;
    for (let frame = 0; frame < 240; frame++) { view.updateCameraInteraction(1 / 240); view.followCamera(1 / 240, false); }
    expect(view.camera.position.distanceTo(view.desiredPosition)).toBeLessThan(0.001);
    expect(view.target.distanceTo(view.desiredTarget)).toBeLessThan(0.001);
    expect(view.camera.up.distanceTo(new Vector3(0, 1, 0).applyQuaternion(view.aircraft.quaternion))).toBeLessThan(0.001);
    const lockedPosition = view.camera.position.clone();
    view.lookInput(0.1, 0.1, 1);
    view.updateCameraInteraction(1);
    expect(view.camera.position.distanceTo(lockedPosition)).toBeGreaterThan(0.1);
    const dragged = view.camera.position.clone();
    view.surfaceHeight = () => 1000;
    view.constrainCamera();
    expect(view.camera.position.distanceTo(dragged)).toBeCloseTo(8, 10);
    view.restoreCameraClearance();
    expect(view.camera.position.distanceTo(dragged)).toBeLessThan(1e-10);
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
    steamReleaseTime: 0, steamFirstEmission: 1, steamBurstPairs: 0,
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
      expect(released.burstCount).toBe(192);
      const burst = released.particles.filter(particle => particle.burst);
      expect(Math.min(...burst.map(particle => particle.radius))).toBeGreaterThan(0.6);
      expect(Math.max(...burst.map(particle => particle.opacity))).toBeGreaterThan(0.8);
      simulation.elapsedTime += 0.2;
      view.updateSteam();
      const expanded = view.steamDiagnostics().particles.filter(particle => particle.burst);
      expect(expanded[0].radius).toBeGreaterThan(burst[0].radius);
      expect(expanded[0].opacity).toBeLessThan(burst[0].opacity);
      expect(Math.abs(expanded[0].position.z)).toBeGreaterThan(Math.abs(burst[0].position.z));
      simulation.elapsedTime += 0.6;
      view.updateSteam();
      const dissipating = view.steamDiagnostics();
      expect(dissipating.count).toBeGreaterThan(0);
      expect(dissipating.count).toBeLessThan(released.count);
      expect(dissipating.burstCount).toBe(0);
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

  it('真实弹射分离时刻同步泄压，测试空间低速滑行不提前触发，暂停与跳转保持确定性', () => {
    const neutral = { weight: 0, rudder: 0, elevator: 0, aileron: 0 };
    for (const challenge of ['birdman', 'downhill', 'test-space'] as const) {
      const settings = { height: 100, catapult: true, speed: 10 };
      const sim = new FlightSimulation(defaultAircraft, challenge, 0, settings), view = steamView(challenge);
      view.simulation = sim;
      const matrices = view.steam.instanceMatrix.array;
      while (sim.launching && !sim.ended) {
        view.updateSteam();
        expect(view.steamDiagnostics().burstCount).toBe(0);
        sim.step(neutral);
      }
      expect(sim.ended).toBe(false);
      view.updateSteam();
      const separated = view.steamDiagnostics();
      expect(separated.burstCount).toBe(192);
      const launch = sim.launch;
      const burst = separated.particles.filter(particle => particle.burst);
      expect(burst.every(particle => Math.abs(particle.position.x - (launch?.endX ?? LAUNCH.endX)) < 1)).toBe(true);
      if (challenge === 'test-space') expect(sim.elapsedTime).toBeGreaterThan(testCatapultSample(0, settings).duration - 1e-9);
      view.updateSteam();
      expect(view.steamDiagnostics()).toEqual(separated);
      for (let step = 0; step < 120; step++) sim.step(neutral);
      view.updateSteam();
      expect(view.steam.count).toBe(0);
      // Direct time reconstruction gives identical clouds without replaying render frames.
      view.simulation = { launch: sim.launch, challenge, testSpace: settings, elapsedTime: separated.time, launching: false, ended: false, replayFinished: false };
      view.updateSteam();
      expect(view.steamDiagnostics()).toEqual(separated);
      expect(view.steam.instanceMatrix.array).toBe(matrices);
      view.steam.geometry.dispose(); view.steam.material.dispose(); view.steam.dispose();
    }
    for (const challenge of ['test-space', 'wind-tunnel'] as const) {
      const view = steamView(challenge);
      view.simulation = new FlightSimulation(defaultAircraft, challenge, 0, { height: 100, speed: 10, catapult: false });
      view.updateSteam();
      expect(view.steamDiagnostics()).toMatchObject({ count: 0, burstCount: 0, emitting: false });
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

function designSceneView() {
  const view = flightCameraView();
  const body = new Group();
  view.aircraft.add(body);
  Object.assign(view, {
    simulation: null, editorTarget: 'mainWing', body, scene: new Scene(), designCG: new Vector3(),
    editorHandles: [], editorSegments: [], editorPolygons: [svgElement(), svgElement()], editorOverlay: svgElement(),
    workshop: new Group(), environment: new Group(), mountainEnvironment: new Group(),
    environmentChallenge: 'birdman', environmentFog: null, debugGroup: new Group(), debug: false,
    hoverBox: new Box3(), hoverOutline: new Box3Helper(new Box3()), hoverTarget: null,
    renderer: { domElement: { style: { cursor: '' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 700 }) } },
    partRay: new Raycaster(), partHits: [], partPointer: new Vector2(),
    selectionPointer: -1, selectionTarget: null, selectionMoved: false,
    editProjection: new Vector3(), propulsionBounds: new Box3(new Vector3(-3, -1, -1), new Vector3(3, 1, 1)),
    updateEditorOverlay() {},
  });
  view.cameraView('orbit');
  return view;
}

describe('工坊场景与直接选取', () => {
  it('切换编辑目标时显示工坊，退出后恢复环境并释放资源', () => {
    const view = designSceneView();
    view.label = () => new Mesh(new BoxGeometry(1, 1, 0.01), new MeshBasicMaterial());
    view.buildWorkshop();
    for (const target of ['fuselage', 'mainWing', 'horizontalTail', 'verticalTail', 'propulsion']) {
      view.editorTarget = target;
      view.updateEnvironment();
      expect(view.workshop.visible).toBe(true);
      expect(view.environment.visible).toBe(false);
    }
    view.editorTarget = null;
    view.updateEnvironment();
    expect(view.workshop.visible).toBe(false);
    expect(view.environment.visible).toBe(true);
    const resources = new Set<BufferGeometry | Material>();
    view.workshop.traverse((object: Object3D) => {
      const mesh = object as Mesh;
      if (mesh.geometry) resources.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material);
    });
    let disposed = 0;
    for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
    view.release(view.workshop);
    expect(disposed).toBe(resources.size);
  });

  it('默认透视，切编辑目标保留用户镜头，所有设计视角空闲后不回中', () => {
    const view = designSceneView();
    expect(view.camera).toBe(view.perspective);
    for (const name of ['orbit', 'top', 'side', 'front', 'rear']) {
      view.cameraView(name);
      view.camera.position.add(new Vector3(2, 3, 4));
      view.controls.target.add(new Vector3(1, 2, 3));
      const position = view.camera.position.clone(), target = view.controls.target.clone();
      view.cameraReleasedAt = -Infinity;
      for (const editor of ['fuselage', 'propulsion', 'mainWing', 'horizontalTail', 'verticalTail']) {
        view.setEditor(editor, () => {}, () => {});
        view.updateCameraInteraction(10);
        expect(view.camera.position.distanceTo(position)).toBe(0);
        expect(view.controls.target.distanceTo(target)).toBe(0);
        expect(view.view).toBe(name);
      }
    }
  });

  it.each(['top', 'side', 'front', 'rear'])('正交%s平移缩放不切投影，旋转自动透视且保留取景与目标', name => {
    const view = designSceneView(), changed: string[] = [];
    view.onDesignViewChange = (value: string) => changed.push(value);
    view.cameraView(name);
    view.cameraDragging = true;
    view.orthographic.zoom = 2;
    view.orthographic.position.add(new Vector3(1, 2, 3));
    view.controls.target.add(new Vector3(1, 2, 3));
    view.promoteDesignPerspective();
    expect(view.camera).toBe(view.orthographic);
    view.orthographic.rotateY(0.1);
    const rotation = view.orthographic.quaternion.clone(), target = view.controls.target.clone();
    const height = (view.orthographic.top - view.orthographic.bottom) / view.orthographic.zoom;
    view.promoteDesignPerspective();
    expect(view.camera).toBe(view.perspective);
    expect(view.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    expect(view.controls.target.distanceTo(target)).toBe(0);
    expect(2 * view.camera.position.distanceTo(target) * Math.tan(view.perspective.fov * DEG / 2)).toBeCloseTo(height, 10);
    expect(changed).toEqual([name, 'orbit']);
  });

  it('拾取实际可见部件，hover强反馈，点击与菜单双向同步；旋转和取消不误选', () => {
    const view = designSceneView(), selected: string[] = [];
    view.body.userData.editorTarget = 'fuselage';
    const wing = new Mesh(new BoxGeometry(2, 1, 1), new MeshBasicMaterial());
    wing.userData.editorTarget = 'horizontalTail';
    view.body.add(wing);
    const hidden = new Mesh(new BoxGeometry(3, 3, 1), new MeshBasicMaterial());
    hidden.position.z = 2; hidden.visible = false; hidden.userData.editorTarget = 'propulsion';
    view.body.add(hidden);
    view.aircraft.position.set(0, 0, 0);
    view.camera.position.set(0, 0, 10); view.camera.lookAt(0, 0, 0);
    view.onEditorSelect = (target: string) => selected.push(target);
    view.editorChange = () => {}; view.editorCommit = () => {};
    const event = { button: 0, pointerId: 1, clientX: 500, clientY: 350 };
    expect(view.pickPart(event)).toBe('horizontalTail');
    view.movePartSelection(event);
    expect(view.hoverOutline.visible).toBe(true);
    expect(view.hoverBox.containsPoint(new Vector3(1, 0.5, 0.5))).toBe(true);
    expect(view.renderer.domElement.style.cursor).toBe('pointer');
    view.beginPartSelection(event); view.endPartSelection(event);
    expect(view.editorTarget).toBe('horizontalTail');
    expect(selected).toEqual(['horizontalTail']);
    view.setEditor('fuselage', () => {}, () => {});
    view.beginPartSelection(event);
    view.movePartSelection({ ...event, clientX: 506 });
    view.endPartSelection(event);
    expect(view.editorTarget).toBe('fuselage');
    view.beginPartSelection(event); view.cancelPartSelection(event); view.endPartSelection(event);
    expect(selected).toHaveLength(1);
    view.editorPointerId = 9;
    expect(view.pickPart(event)).toBeNull();
    view.leavePartSelection();
    expect(view.hoverOutline.visible).toBe(false);
    view.release(view.body);
  });

  it('机身仅提供驾驶舱与端点，动力仅提供引擎和油箱，各翼保留安装拖动', () => {
    const view = designSceneView();
    view.definition = clone(defaultAircraft);
    view.definition.engine.count = 1; view.definition.fuelTank.capacity = 1;
    view.editorHandles = Array.from({ length: 8 }, (_, index) => ({
      group: svgElement(), leader: svgElement(), index: index < 4 ? index : index - 3,
      side: index < 4 ? 1 : -1, x: 0, y: 0, ax: 0, ay: 0,
    }));
    delete view.updateEditorOverlay;
    const shown = () => view.editorHandles.flatMap((handle: { group: { style: { display: string } } }, index: number) => handle.group.style.display === 'none' ? [] : [index]);
    view.editorTarget = 'fuselage'; view.editorDirty = true; view.updateEditorOverlay();
    expect(shown()).toEqual([3, 4, 5]);
    view.editorTarget = 'propulsion'; view.editorDirty = true; view.updateEditorOverlay();
    expect(shown()).toEqual([6, 7]);
    for (const [key, index] of [['mainWing', 0], ['horizontalTail', 1], ['verticalTail', 2]]) {
      view.editorTarget = key; view.editorDirty = true; view.updateEditorOverlay();
      expect(shown()).toContain(6);
      expect(view.editorAssemblyIndex(6)).toBe(index);
    }
    view.definition.engine.count = 0;
    view.editorTarget = 'propulsion'; view.editorDirty = true; view.updateEditorOverlay();
    expect(shown()).toEqual([]);
  });

  it.each([
    ['fuselage', 3], ['fuselage', 4], ['fuselage', 5],
    ['mainWing', 6], ['horizontalTail', 6], ['verticalTail', 6], ['propulsion', 6], ['propulsion', 7],
  ])('%s手柄%d实际拖动更新对应部件，取消恢复原设计且不提交', (target, index) => {
    const view = designSceneView(), original = clone(defaultAircraft);
    original.engine.count = 1; original.fuelTank.capacity = 1;
    let commits = 0;
    const group = { style: { cursor: 'grabbing' } };
    const dragX = target === 'fuselage' && index === 5 ? -0.2 : 0.2;
    Object.assign(view, {
      definition: clone(original), editDefinition: clone(original), editorTarget: target,
      editorPointerId: 7, editorDrag: index, editorSegmentDrag: -1, editorChanged: false,
      editorHandles: Array.from({ length: 8 }, () => ({ group })),
      editStart: new Vector3(), editPoint: new Vector3(dragX, 0.1, 0),
      editorSnap: { active: false, kind: null, value: null, disabled: false },
      intersectEditor: () => true,
      editorChange(next: typeof original) { this.definition = next; },
      editorCommit() { commits++; },
      editorOverlay: { hasPointerCapture: () => true, releasePointerCapture() {} },
    });
    view.moveEditorDrag({ pointerId: 7, ctrlKey: true, preventDefault() {} });
    expect(view.definition).not.toEqual(original);
    if (target === 'fuselage' && (index === 4 || index === 5)) {
      const before = fuselageEnds(original), after = fuselageEnds(view.definition);
      const end = index === 4 ? 'nose' : 'tail', fixed = index === 4 ? 'tail' : 'nose';
      expect(after[end]).toBeCloseTo(before[end] + dragX, 12);
      expect(after[fixed]).toBeCloseTo(before[fixed], 12);
    }
    expect(view.editorChanged).toBe(true);
    view.endEditorDrag(true);
    expect(view.definition).toEqual(original);
    expect(commits).toBe(0);
    expect(view.editorPointerId).toBe(-1);
    expect(group.style.cursor).toBe('grab');
  });

  it('上反角与安装角使用同一刚体旋转，真实翼长、渲染锚点和结构参考点一致', () => {
    const definition = clone(defaultAircraft);
    definition.mainWing.dihedral = 25; definition.assembly.mainIncidence = 12;
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition, editorTarget: 'mainWing', wingSections: [[], [], []], wingNormalGeometry: [],
      wingCoordinates: [], wingNeutral: [], wingHinges: [], wingMovable: [], wingAxes: [],
      hingeLines: [{ geometry: new BufferGeometry() }],
    });
    const origin = wingOrigin(definition, 'mainWing'), wing = definition.mainWing;
    const geometry = view.wingGeometry(wing, origin.x, origin.y, 12, 0) as BufferGeometry;
    for (const side of [-1, 1]) {
      const point = view.wingEditorPoint(1, side, new Vector3());
      const expected = wingLocalPoint(wing, 12 * DEG, side, -wing.points[1].x, 0, wing.points[1].y, new Vector3());
      expected.x += origin.x; expected.y += origin.y;
      expect(point.distanceTo(expected)).toBeLessThan(1e-12);
      const sections = view.wingSections[0].filter((section: { side: number }) => section.side === side);
      const first = sections[0], last = sections[sections.length - 1];
      const rendered = new Vector3().fromBufferAttribute(geometry.getAttribute('position'), last.vertexStart + last.rows * 32);
      expect(rendered.distanceTo(expected)).toBeLessThan(1e-6);
      const rootQuarter = wing.points[0].x + (wing.points[3].x - wing.points[0].x) / 4;
      const tipQuarter = wing.points[1].x + (wing.points[2].x - wing.points[1].x) / 4;
      expect(last.referenceTip.distanceTo(first.referenceRoot)).toBeCloseTo(Math.hypot(wing.points[1].y, tipQuarter - rootQuarter), 10);
    }
    geometry.dispose(); view.wingNormalGeometry[0].dispose(); view.hingeLines[0].geometry.dispose();
  });
  it('负垂尾网格、手柄和结构梁共用正跨度与负高度', () => {
    const definition=clone(defaultAircraft);editWingPoint(definition,'verticalTail',1,0.3,-0.48);
    const view=Object.assign(Object.create(SceneView.prototype),{
      definition,editorTarget:'verticalTail',wingSections:[[],[],[]],wingNormalGeometry:[],
      wingCoordinates:[],wingNeutral:[],wingHinges:[],wingMovable:[],wingAxes:[],
      hingeLines:Array.from({length:3},()=>({geometry:new BufferGeometry()})),
    });
    const origin=wingOrigin(definition,'verticalTail');
    const geometry=view.wingGeometry(definition.verticalTail,origin.x,origin.y,0,2) as BufferGeometry;
    const tip=view.wingEditorPoint(1,1,new Vector3()),sections=view.wingSections[2];
    const last=sections.at(-1),rendered=new Vector3().fromBufferAttribute(geometry.getAttribute('position'),last.vertexStart+last.rows*32);
    expect(rendered.distanceTo(tip)).toBeLessThan(1e-6);expect(tip.y).toBe(-0.48);
    expect(last.spanEnd).toBe(0.48);expect(last.referenceTip.y).toBe(-0.48);
    const simulation=new FlightSimulation(definition,'birdman',0);
    expect(simulation.structure.sections.filter(section=>section.wingKey==='verticalTail').at(-1)!.referenceTip.y).toBe(-0.48);
    geometry.dispose();view.wingNormalGeometry[2].dispose();for(const hinge of view.hingeLines)hinge.geometry.dispose();
  });
  it('副翼安装在较大范围内吸附垂尾并保留安装角，拖远脱离，Ctrl跳过吸附',()=>{
    const view=designSceneView(),base=clone(defaultAircraft);
    Object.assign(view,{
      definition:base,editDefinition:clone(base),editorTarget:'horizontalTail',
      editorSnap:{active:false,kind:null,value:null,disabled:false},editorPointerId:7,
      editorChange(next:typeof base){this.definition=next;},
    });
    const origin=wingOrigin(base,'verticalTail'),p=base.verticalTail.points;
    const x=origin.x-(p[1].x+p[2].x)/2-base.assembly.horizontalTail,y=p[1].y;
    view.changeAssembly(1,x+0.2,y+0.05);
    expect(view.definition.assembly.tailOnFin).toBe(true);expect(view.editorSnap.kind).toBe('mount');
    expect(wingOrigin(view.definition,'horizontalTail').y).toBe(y);
    const mount=view.assemblyEditorPoint(1,new Vector3());
    const middle=(p[1].x+p[2].x)/2,angle=base.assembly.tailIncidence*DEG;
    expect(view.definition.assembly.tailIncidence).toBe(base.assembly.tailIncidence);
    expect(mount.x).toBeCloseTo(origin.x-middle*Math.cos(angle),12);expect(mount.y).toBeCloseTo(y-middle*Math.sin(angle),12);
    view.editDefinition=clone(view.definition);view.changeAssembly(1,0.6,0);
    expect(view.definition.assembly.tailOnFin).toBe(false);
    view.editDefinition=clone(base);view.editorSnap.disabled=true;view.changeAssembly(1,x,y);
    expect(view.definition.assembly.tailOnFin).toBe(false);
  });
  it('改变两端和重心不移动工坊中的机身原点或镜头',()=>{
    const view=designSceneView();view.definition=clone(defaultAircraft);view.editorTarget='fuselage';
    view.designCG.set(0.2,0.1,0);view.body.position.copy(view.designCG).negate();view.positionAtLaunch();
    view.aircraft.updateMatrixWorld(true);
    const origin=view.body.localToWorld(new Vector3()),camera=view.camera.position.clone(),target=view.controls.target.clone();
    resizeFuselage(view.definition,'nose',4.19);resizeFuselage(view.definition,'tail',-4.17);
    normalizeAircraftGeometry(view.definition);view.designCG.set(0.37,0.16,0);
    view.body.position.copy(view.designCG).negate();view.positionAtLaunch();view.aircraft.updateMatrixWorld(true);
    expect(view.body.localToWorld(new Vector3()).distanceTo(origin)).toBeLessThan(1e-10);
    expect(view.camera.position.distanceTo(camera)).toBe(0);expect(view.controls.target.distanceTo(target)).toBe(0);
  });
  it('驾驶舱仅拉伸后半，前半全部顶点和舱盖不变，往返编辑不累积误差',()=>{
    const definition=clone(defaultAircraft),cockpit=new Group();
    const shell=new Mesh(new SphereGeometry(1,24,12),new MeshBasicMaterial());shell.name='streamlined-cockpit-shell';
    const canopy=new Mesh(new SphereGeometry(1,12,6),new MeshBasicMaterial());canopy.position.set(0.12,0.2,0);
    cockpit.add(shell,canopy);
    const view=Object.assign(Object.create(SceneView.prototype),{definition,cockpit});
    view.updateCockpitShell();
    const positions=shell.geometry.getAttribute('position'),original=new Float32Array(positions.array);
    const glass=new Float32Array(canopy.geometry.getAttribute('position').array),glassPosition=canopy.position.clone();
    for(const rearLength of [0.2,2.71,1.45]){
      definition.cockpit.rearLength=rearLength;view.updateCockpitShell();
      for(let i=0;i<positions.count;i++){
        const x=original[i*3];expect(positions.getX(i)).toBeCloseTo(x<0?x*rearLength/1.45:x,6);
        if(x>=0)expect(positions.getX(i)).toBe(x);
        expect(positions.getY(i)).toBe(original[i*3+1]);expect(positions.getZ(i)).toBe(original[i*3+2]);
      }
      expect(canopy.geometry.getAttribute('position').array).toEqual(glass);expect(canopy.position).toEqual(glassPosition);
    }
    expect(positions.array).toEqual(original);shell.geometry.dispose();canopy.geometry.dispose();
  });
});

it.each([0.3, 1])('live installation angle matches freshly built skin, hinges and controls (control fraction %s)', fraction => {
  const definition = clone(presets.find(plane => !plane.birdman && plane.engine.count === 0)!);
  definition.assembly.tailOnFin = false;
  definition.mainWing.controlSurface = definition.horizontalTail.controlSurface = fraction;
  const simulation = new FlightSimulation(definition, 'wind-tunnel', 0);
  const build = () => {
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition: simulation.definition, simulation, fragments: [], renderBlend: 1,
      wingSections: [[], [], []], wingNormalGeometry: [], wingCoordinates: [], wingNeutral: [], wingHinges: [],
      wingMovable: [], wingAxes: [], wingAngles: new Float64Array(3), wingMeshes: [],
      hingeLines: Array.from({ length: 3 }, () => ({ geometry: new BufferGeometry() })),
      deformationCenter: new Vector3(), controlRotation: new Quaternion(), deformationRotation: new Quaternion(),
      deformationPoint: new Vector3(), deformationReference: new Vector3(), deformationRootTangent: new Vector3(),
      deformationTipTangent: new Vector3(), deformationAxis: new Vector3(), deformationHinge: new Vector3(),
      neutralReference: new Vector3(), incidenceRotation: new Quaternion(), vector: new Vector3(),
    });
    for (const [index, key] of (['mainWing', 'horizontalTail', 'verticalTail'] as const).entries()) {
      const origin = wingOrigin(simulation.definition, key);
      const incidence = index === 0 ? simulation.definition.assembly.mainIncidence : index === 1 ? simulation.definition.assembly.tailIncidence : 0;
      view.wingMeshes.push(new Mesh(view.wingGeometry(simulation.definition[key], origin.x, origin.y, incidence, index)));
    }
    view.syncWingPhysics();
    return view;
  };
  const dispose = (view: any) => {
    for (let index = 0; index < 3; index++) {
      view.wingMeshes[index].geometry.dispose(); view.wingNormalGeometry[index].dispose();
      view.hingeLines[index].geometry.dispose(); view.wingMeshes[index].material.dispose();
    }
  };
  const live = build(), originalGeometry = live.wingMeshes.map((mesh: Mesh) => mesh.geometry);
  for (const [mainIncidence, tailIncidence] of [[18,-12], [-10,12], [4,0]]) {
    simulation.setWindTunnel({ ...simulation.windTunnel, speed: 10, mainIncidence, tailIncidence, elevator: 0.2, aileron: -0.3 });
    for (let frame = 0; frame < 60; frame++) simulation.step({ weight: 0, lateral: 0, elevator: 0, aileron: 0, rudder: 0 });
    live.updateControlSurfaces();
    const fresh = build(); fresh.updateControlSurfaces();
    for (let index = 0; index < 3; index++) {
      expect(live.wingMeshes[index].geometry).toBe(originalGeometry[index]);
      for (const attribute of ['position', 'normal']) {
        const actual = live.wingMeshes[index].geometry.getAttribute(attribute).array;
        const expected = fresh.wingMeshes[index].geometry.getAttribute(attribute).array;
        let maximumError = 0;
        for (let value = 0; value < actual.length; value++) maximumError = Math.max(maximumError, Math.abs(actual[value] - expected[value]));
        // Float32 skin coordinates feed thin cap/hinge triangle normals:
        // require micron geometry and <0.1-degree normal agreement.
        expect(maximumError, attribute).toBeLessThan(attribute === 'position' ? 3e-6 : 1.5e-3);
      }
    }
    dispose(fresh);
  }
  dispose(live);
});

it.each([false, true])('renders per-strip control directions for front/rear tails and downward fin %s', downward => {
  const movement: number[][] = [];
  for (const mount of [-3, 2.5]) {
    const definition = clone(presets.find(plane => !plane.birdman && plane.engine.count === 0)!);
    definition.assembly.tailOnFin = false;
    definition.assembly.horizontalTail = definition.assembly.verticalTail = mount;
    if (downward) {
      definition.verticalTail.points[1].y = definition.verticalTail.points[2].y = -0.48;
      definition.verticalTail.controlSurface = 1;
    }
    const simulation = new FlightSimulation(definition, 'test-space', 0, { height: 2000, catapult: false, speed: 20 });
    simulation.launching = false; simulation.position.set(100, 2000, 0);
    simulation.quaternion.identity(); simulation.velocity.set(20, 0, 0);
    simulation.step({ weight: 0, elevator: 0.3, aileron: 0.3, rudder: 0.3 }, 0.05);
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition: simulation.definition, simulation, fragments: [], renderBlend: 1,
      wingSections: [[], [], []], wingNormalGeometry: [], wingCoordinates: [], wingNeutral: [], wingHinges: [],
      wingMovable: [], wingAxes: [], wingAngles: new Float64Array(3), wingMeshes: [],
      hingeLines: Array.from({ length: 3 }, () => ({ geometry: new BufferGeometry() })),
      deformationCenter: new Vector3(), controlRotation: new Quaternion(), deformationRotation: new Quaternion(),
      deformationPoint: new Vector3(), deformationReference: new Vector3(), deformationRootTangent: new Vector3(),
      deformationTipTangent: new Vector3(), deformationAxis: new Vector3(), deformationHinge: new Vector3(),
      neutralReference: new Vector3(), incidenceRotation: new Quaternion(), vector: new Vector3(),
    });
    const keys = ['mainWing', 'horizontalTail', 'verticalTail'] as const;
    for (let index = 0; index < 3; index++) {
      const key = keys[index], origin = wingOrigin(simulation.definition, key);
      const incidence = index === 0 ? definition.assembly.mainIncidence : index === 1 ? definition.assembly.tailIncidence : 0;
      view.wingMeshes.push(new Mesh(view.wingGeometry(simulation.definition[key], origin.x, origin.y, incidence, index)));
    }
    view.syncWingPhysics();
    // Isolate control geometry from elastic bending; use the real per-strip physical deflections.
    for (const section of simulation.structure.sections) {
      section.root.position.copy(section.referenceRoot); section.tip.position.copy(section.referenceTip);
      section.root.quaternion.identity(); section.tip.quaternion.identity();
    }
    view.updateControlSurfaces();
    const tailMovement: number[] = [];
    for (let index = 0; index < 3; index++) {
      for (const section of view.wingSections[index]) {
        // Pitch and roll share these actuators, so main-wing strips need not move
        // in opposite vertical directions. Check each local hinge rotation instead.
        const rowStart = section.vertexStart + Math.floor(section.rows / 2) * 32;
        for (const chordVertex of [0, 12, 16, 20]) {
          const vertex = rowStart + chordVertex;
          const neutral = new Vector3().fromArray(view.wingNeutral[index], vertex * 3);
          const hinge = new Vector3().fromArray(view.wingHinges[index], vertex * 3);
          const axis = view.wingAxes[index][index === 2 || section.side < 0 ? 0 : 1];
          const expected = neutral.clone();
          if (view.wingMovable[index][vertex]) {
            expected.sub(hinge).applyAxisAngle(axis, section.physics.controlDeflection).add(hinge);
          }
          const rendered = new Vector3().fromBufferAttribute(view.wingMeshes[index].geometry.getAttribute('position'), vertex);
          expect(rendered.distanceTo(expected)).toBeLessThan(1e-6);
          if (chordVertex === 16 && index > 0 && section.side === 1 && section.spanStart === 0) {
            tailMovement.push(index === 1 ? rendered.y - neutral.y : rendered.z - neutral.z);
          }
        }
      }
    }
    movement.push(tailMovement);
    for (let index = 0; index < 3; index++) {
      view.wingMeshes[index].geometry.dispose(); view.wingNormalGeometry[index].dispose();
      view.hingeLines[index].geometry.dispose(); view.wingMeshes[index].material.dispose();
    }
  }
  expect(movement[0][0]).toBeLessThan(0); expect(movement[1][0]).toBeGreaterThan(0);
  expect(movement[0][1]).toBeGreaterThan(0); expect(movement[1][1]).toBeLessThan(0);
});
