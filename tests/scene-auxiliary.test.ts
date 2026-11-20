import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { aircraftWings, clone, defaultAircraft, presets, wing, type AircraftDefinition } from '../src/model';
import { compileAircraft } from '../src/compiled-geometry';
import { FlightSimulation } from '../src/physics';
import { SceneView } from '../src/scene';
import { captureGhost } from '../src/ghost';
import { t } from '../src/i18n';

function auxiliaryScene(configure?: (definition: AircraftDefinition) => void) {
  const definition = clone(defaultAircraft);
  definition.birdman = false;
  definition.assembly.tailOnFin = false;
  Object.assign(definition.verticalTail, { mirrored: true, cant: 30, lateralOffset: 0.7, controlSurface: 0.3 });
  definition.auxiliaryWings = [
    { kind: 'horizontalTail', wing: clone(definition.horizontalTail), position: 1.5, incidence: 9 },
    { kind: 'verticalTail', wing: clone(definition.verticalTail), position: -1.5, incidence: 8 },
  ];
  configure?.(definition);
  const simulation = new FlightSimulation(definition, 'wind-tunnel', 0);
  const compiled = compileAircraft(simulation.geometryDefinition);
  const view = Object.assign(Object.create(SceneView.prototype), {
    definition: simulation.geometryDefinition, geometryDefinition: simulation.geometryDefinition, simulation, compiledAircraft: compiled, compiledBodyParts: [], scene: new Scene(), body: new Group(),
    fragments: [], renderBlend: 1, aircraftOnly: true, metrics: {},
    wingSections: [], wingNormalGeometry: [], wingCoordinates: [], wingNeutral: [], wingHinges: [],
    wingMovable: [], wingAxes: [], wingAngles: [], wingMeshes: [], hingeLines: [], wingOriginalColors: [],
    physicsGeometry: [], wingDeformationFrames: [], deformationRevision: 0, deformationSource: null, deformationStructure: null,
    auxiliarySupports: [], supportFront: new Vector3(), supportBack: new Vector3(), supportNormal: new Vector3(),
    aircraftMaterials: { main: new MeshBasicMaterial(), ivory: new MeshBasicMaterial({ color: 0xf4f0dc }),
      canopy: new MeshBasicMaterial(), orange: new MeshBasicMaterial(), engine: new MeshBasicMaterial(), graphite: new MeshBasicMaterial(), intake: new MeshBasicMaterial() },
    deformationCenter: new Vector3(), controlRotation: new Quaternion(), deformationRotation: new Quaternion(),
    deformationPoint: new Vector3(), deformationReference: new Vector3(), deformationRootTangent: new Vector3(),
    deformationTipTangent: new Vector3(), deformationAxis: new Vector3(), deformationHinge: new Vector3(),
    neutralReference: new Vector3(), incidenceRotation: new Quaternion(), vector: new Vector3(),
    beam: new Mesh(), nose: new Mesh(), support: new Mesh(), cockpit: new Group(), fuelTank: new Group(), engines: [], engineSupports: [],
  });
  for (const instance of aircraftWings(simulation.definition)) {
    view.hingeLines.push(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
    view.wingMeshes.push(new Mesh(view.compiledWingGeometry(instance.id, compiled)));
  }
  view.syncWingPhysics();
  view.updateControlSurfaces();
  view.rebuildAuxiliarySupports();
  view.rebuildCompiledBody(); view.updateCompiledSupports();
  return view;
}

interface SceneResources {
  clearFragments(): void;
  wingMeshes: Mesh<BufferGeometry, MeshBasicMaterial>[];
  wingNormalGeometry: BufferGeometry[];
  hingeLines: Mesh<BufferGeometry, MeshBasicMaterial>[];
  auxiliarySupports: { mesh: Mesh }[];
  compiledBodyParts: { mesh: Mesh }[];
  aircraftMaterials: Record<string, MeshBasicMaterial>;
}

function disposeScene(view: SceneResources) {
  view.clearFragments();
  for (let index = 0; index < view.wingMeshes.length; index++) {
    view.wingMeshes[index].geometry.dispose();
    view.wingNormalGeometry[index].dispose();
    view.hingeLines[index].geometry.dispose();
    view.hingeLines[index].material.dispose();
    view.wingMeshes[index].material.dispose();
  }
  for (const support of view.auxiliarySupports) support.mesh.geometry.dispose();
  for (const part of view.compiledBodyParts) part.mesh.geometry.dispose();
  for (const material of Object.values(view.aircraftMaterials)) material.dispose();
}

it('布尔分区顶点完整进入真实蒙皮，显示切割仍绑定0.8m物理梁', () => {
  const view = auxiliaryScene(definition => {
    definition.mainWing = wing(6, 1.2, 0.6, 0.2); definition.mainWing.controlSurface = 0.3;
    definition.assembly.mainWingHeight = 0.5; definition.auxiliaryWings = [];
  });
  try {
    const compiled = compileAircraft(view.definition);
    for (const instance of aircraftWings(view.definition)) {
      const partitions = compiled.partitions.filter(part => part.wingInstance === instance.id);
      expect(Array.from(view.wingNeutral[instance.id])).toEqual(partitions.flatMap(part => Array.from(part.positions)));
      expect(view.wingSections[instance.id].length).toBe(partitions.length);
      for (const section of view.wingSections[instance.id]) {
        expect(section.physics).not.toBeNull();
        expect(section.spanStart).toBeGreaterThanOrEqual(section.physics.spanStart - 1e-6);
        expect(section.spanEnd).toBeLessThanOrEqual(section.physics.spanEnd + 1e-6);
        expect(section.physics.spanEnd - section.physics.spanStart).toBeLessThanOrEqual(0.8 + 1e-9);
      }
    }
    const section = view.wingSections[0].find((part: { movable: boolean; spanStart: number }) => !part.movable && part.spanStart >= 0.8)!;
    const physical = section.physics;
    physical.root.position.copy(physical.referenceRoot); physical.tip.position.copy(physical.referenceTip).add(new Vector3(0, 0.12, 0));
    physical.root.quaternion.identity(); physical.tip.quaternion.identity(); physical.controlDeflection = 0;
    view.updateControlSurfaces();
    const positions = view.wingMeshes[0].geometry.getAttribute('position'), coordinates = view.wingCoordinates[0];
    for (let vertex = section.vertexStart; vertex < section.vertexStart + section.vertexCount; vertex++) {
      const t = Math.max(0, Math.min(1, (coordinates[vertex * 4] - physical.spanStart) / (physical.spanEnd - physical.spanStart)));
      const expected = new Vector3().fromArray(view.wingNeutral[0], vertex * 3);
      view.simulation.structure.deformPoint(physical, expected, t, view.physicsGeometry);
      expect(new Vector3().fromBufferAttribute(positions, vertex).distanceTo(expected)).toBeLessThan(1e-6);
    }
  } finally { disposeScene(view); }
});

it('引擎开口壳体从内外均命中，尾部封口朝外，独立材质只释放一次', () => {
  const materials = Object.fromEntries(['engine', 'intake', 'graphite', 'orange', 'exhaust', 'exhaustInner', 'exhaustCore']
    .map(name => [name, new MeshBasicMaterial()]));
  const view = Object.assign(Object.create(SceneView.prototype), {
    aircraftMaterials: materials, body: new Group(), engines: [], engineSupports: [], exhausts: [], fuelTank: new Group(),
  });
  view.buildPropulsion();
  view.body.updateMatrixWorld(true);
  const [housing, nozzle, back] = view.engines[0].children as Mesh<BufferGeometry, MeshBasicMaterial>[];
  const ray = new Raycaster();
  const shells = [housing, nozzle];
  const dispose = shells.map(shell => vi.spyOn(shell.material, 'dispose'));
  try {
    for (const [index, shell] of shells.entries()) {
      const x = index === 0 ? 0.1 : -0.4;
      ray.set(new Vector3(x, 0, 0), new Vector3(0, 1, 0));
      expect(ray.intersectObject(shell)).not.toHaveLength(0);
      ray.set(new Vector3(x, 2, 0), new Vector3(0, -1, 0));
      expect(ray.intersectObject(shell)).not.toHaveLength(0);
      expect(shell.material.side).toBe(DoubleSide);
    }
    ray.set(new Vector3(-1, 0.3, 0), new Vector3(1, 0, 0));
    expect(ray.intersectObject(back)).not.toHaveLength(0);
    expect(materials.engine.side).toBe(FrontSide);
    expect(materials.graphite.side).toBe(FrontSide);
    expect(shells[0].material).toBe((view.engines[1].children[0] as Mesh).material);
  } finally {
    view.release(view.body);
  }
  for (const spy of dispose) expect(spy).toHaveBeenCalledTimes(1);
});

it('编译发动机按真实部件复用材质，不再把最前端三角形猜作进气口', () => {
  const preset = presets.find(definition => definition.engine.count === 1)!;
  const view = auxiliaryScene(definition => Object.assign(definition, clone(preset)));
  try {
    const expected = {
      housing: view.aircraftMaterials.engine, nozzle: view.aircraftMaterials.graphite,
      intake: view.aircraftMaterials.intake, 'exhaust-back': view.aircraftMaterials.intake,
      rim: view.aircraftMaterials.engine, hub: view.aircraftMaterials.graphite,
    };
    const parts = view.compiledBodyParts.filter((part: { partition: { kind: string } }) => part.partition.kind === 'engine');
    expect(new Set(parts.map((part: { partition: { enginePart: string } }) => part.partition.enginePart)))
      .toEqual(new Set(['housing', 'nozzle', 'intake', 'exhaust-back', 'rim', 'hub']));
    for (const { mesh, partition } of parts) {
      expect(mesh.material).toBe(expected[partition.enginePart as keyof typeof expected]);
      expect(mesh.material.side).toBe(FrontSide);
      expect(mesh.geometry.groups).toHaveLength(0);
    }
  } finally { disposeScene(view); }
});

it('共享机身接缝采用物理attachment映射，外侧翼面仍保留梁形变', () => {
  const view = auxiliaryScene(definition => {
    definition.auxiliaryWings = []; definition.mainWing.controlSurface = 0; definition.mainWing.dihedral = 0;
    definition.assembly.mainWingHeight = 0; definition.assembly.mainIncidence = 0;
  });
  try {
    const span = view.compiledAircraft.attachmentSpans?.find((attachment: { wingInstance: number; anchorWingInstance: number }) => attachment.wingInstance === 0 && attachment.anchorWingInstance === -1);
    expect(span).toBeDefined();
    for (const physical of view.simulation.structure.sections) if (physical.wingInstance === 0) {
      physical.root.position.copy(physical.referenceRoot).add(new Vector3(0, 0.2, 0));
      physical.tip.position.copy(physical.referenceTip).add(new Vector3(0, 0.2, 0));
      physical.root.quaternion.identity(); physical.tip.quaternion.identity();
    }
    view.updateControlSurfaces();
    const positions = view.wingMeshes[0].geometry.getAttribute('position'), coordinates = view.wingCoordinates[0];
    let fixed = 0, flexible = 0;
    for (const section of view.wingSections[0]) {
      if (section.side !== span.side) continue;
      for (let vertex = section.vertexStart; vertex < section.vertexStart + section.vertexCount; vertex++) {
        const localSpan = coordinates[vertex * 4], neutral = new Vector3().fromArray(view.wingNeutral[0], vertex * 3);
        const actual = new Vector3().fromBufferAttribute(positions, vertex);
        if (localSpan >= span.spanStart - 1e-6 && localSpan <= span.spanEnd + 1e-6) {
          expect(actual.distanceTo(neutral)).toBeLessThan(1e-6); fixed++;
        } else if (localSpan > span.spanEnd + 0.9) {
          expect(actual.y - neutral.y).toBeCloseTo(0.2, 5); flexible++;
        }
      }
    }
    expect(fixed).toBeGreaterThan(0); expect(flexible).toBeGreaterThan(0);
  } finally { disposeScene(view); }
});

it('Ghost跨断裂区间先插值连接几何，到事件时刻才采用冻结锚与新片体', () => {
  const preset = presets.find(definition => !definition.birdman && definition.engine.count === 0)!;
  const view = auxiliaryScene(definition => {
    Object.assign(definition, clone(preset)); definition.assembly.tailOnFin = true;
    definition.verticalTail.mirrored = false; definition.auxiliaryWings = [];
  });
  Object.assign(view, {
    aircraft: new Group(), driver: new Group(), ghostFragments: [], exhausts: [],
    previousPosition: new Vector3(), previousQuaternion: new Quaternion(), previousCG: new Vector3(), renderCG: new Vector3(),
  });
  Object.assign(view.aircraftMaterials, {
    exhaust: new MeshBasicMaterial(), exhaustInner: new MeshBasicMaterial(), exhaustCore: new MeshBasicMaterial(),
  });
  const source = new FlightSimulation(clone(view.definition), 'wind-tunnel', 0);
  const tail = source.structure.sections.find(section => section.wingInstance === 1 && section.side === 1 && section.spanStart === 0)!;
  expect(tail.attachmentAnchorId).toBeGreaterThanOrEqual(0);
  const fin = source.structure.sections[tail.attachmentAnchorId];
  fin.tip.position.y += 0.04;
  const a = captureGhost(source);
  source.structure.detach(tail, 1);
  fin.tip.position.y += 0.4;
  const b = { ...captureGhost(source), time: 0.1, done: true,
    fragments: new Float64Array([1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]) };
  const parent = Object.assign(Object.create(SceneView.prototype), { ghost: view, ghostTime: 0 });
  try {
    parent.renderGhost(a, b, 0.5);
    const copy = view.simulation.structure.sections[tail.id];
    expect(copy.bodyId).toBe(0); expect(copy.attachmentFrozen).toBe(false);
    expect(view.fragments).toHaveLength(0);
    const section = view.wingSections[1].find((candidate: { physics: { id: number } }) => candidate.physics.id === tail.id);
    const vertex = section.vertexStart, t = view.wingDeformationFrames[1][vertex].t;
    const expected = new Vector3().fromArray(view.wingNeutral[1], vertex * 3);
    view.simulation.structure.deformPoint(copy, expected, t, view.physicsGeometry);
    const actual = new Vector3().fromBufferAttribute(view.wingMeshes[1].geometry.getAttribute('position'), vertex);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    parent.renderGhost(a, b, 1);
    expect(copy.bodyId).toBe(1); expect(copy.attachmentFrozen).toBe(true);
    expect(view.fragments.some((fragment: { id: number }) => fragment.id === 1)).toBe(true);
    parent.renderGhost(a, b, 0);
    expect(copy.bodyId).toBe(0); expect(copy.attachmentFrozen).toBe(false);
    expect(view.fragments).toHaveLength(0);
  } finally { disposeScene(view); }
});

describe('编译辅助翼实例场景', () => {
  it('各翼控制面保持独立归属、铰链及真实活动顶点', () => {
    const view = auxiliaryScene();
    try {
      for (const physical of view.simulation.structure.sections) {
        physical.root.position.copy(physical.referenceRoot); physical.tip.position.copy(physical.referenceTip);
        physical.root.quaternion.identity(); physical.tip.quaternion.identity(); physical.controlDeflection = 0.15;
      }
      view.updateControlSurfaces();
      for (const index of [0, 1, 2, 3, 4]) {
        const positions = view.wingMeshes[index].geometry.getAttribute('position');
        for (const section of view.wingSections[index]) {
          expect(section.physics.wingInstance).toBe(index); expect(section.physics.side).toBe(section.side);
          const vertex = section.vertexStart, expected = new Vector3().fromArray(view.wingNeutral[index], vertex * 3);
          if (section.movable) {
            const certificate = view.compiledAircraft.controls.find((control: { wingInstance: number; side: number; spanStart: number }) =>
              control.wingInstance === index && control.side === section.side && Math.abs(control.spanStart - section.physics.spanStart) < 1e-6)!;
            const hinge = new Vector3().fromArray(certificate.hinge), axis = new Vector3().fromArray(certificate.axis);
            expect(new Vector3().fromArray(view.wingHinges[index], vertex * 3).distanceTo(hinge)).toBeLessThan(1e-6);
            const axes = view.wingAxes[index];
            expect(axes[section.side < 0 || axes.length === 1 ? 0 : 1].distanceTo(axis)).toBeLessThan(1e-10);
            expected.sub(hinge).applyAxisAngle(axis, 0.15).add(hinge);
          }
          expect(new Vector3().fromBufferAttribute(positions, vertex).distanceTo(expected)).toBeLessThan(1e-6);
        }
      }
      expect(view.hingeLines.some((line: Mesh) => line.geometry.drawRange.count > 0)).toBe(true);
      expect(view.compiledBodyParts.some((part: { mesh: Mesh }) => part.mesh.name.startsWith('compiled-wing-support'))).toBe(true);
      expect(view.auxiliarySupports.every((support: { mesh: Mesh }) => !support.mesh.visible)).toBe(true);
    } finally { disposeScene(view); }
  });

  it('断片仅使用所属封闭分区，恢复后释放片体索引而保留共享GPU顶点', () => {
    const view = auxiliaryScene();
    try {
      const index = 4, geometry = view.wingMeshes[index].geometry, total = geometry.drawRange.count;
      const fragment = { id: 71, position: new Vector3(10, 20, 30), quaternion: new Quaternion(), cg: new Vector3() };
      view.simulation.fragments.push(fragment);
      for (const physical of view.simulation.structure.sections) if (physical.wingInstance === index && physical.side < 0) physical.bodyId = fragment.id;
      view.updateControlSurfaces();
      expect(view.fragments.map((part: { id: number; wingIndex: number }) => [part.id, part.wingIndex])).toEqual([[71, index]]);
      const detached = view.fragments[0];
      expect(detached.mesh.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(geometry.drawRange.count + detached.mesh.geometry.drawRange.count).toBe(total);
      for (const section of view.wingSections[index]) {
        expect(section.skin.length % 3).toBe(0);
        expect(section.rootIndices).toHaveLength(0); expect(section.tipIndices).toHaveLength(0);
      }
      const dispose = vi.spyOn(detached.mesh.geometry, 'dispose'), ownerDispose = vi.spyOn(geometry, 'dispose');
      view.simulation.fragments.length = 0;
      for (const physical of view.simulation.structure.sections) physical.bodyId = 0;
      view.syncWingPhysics(); view.updateControlSurfaces();
      expect(view.fragments).toHaveLength(0); expect(dispose).toHaveBeenCalledOnce(); expect(ownerDispose).not.toHaveBeenCalled();
      expect(geometry.drawRange.count).toBe(total);
    } finally { disposeScene(view); }
  });

  it('局部重编译保留已脱离蒙皮，释放最后一个片体时归还独占GPU缓冲', () => {
    const view = auxiliaryScene();
    try {
      const index = 4, fragment = { id: 72, position: new Vector3(), quaternion: new Quaternion(), cg: new Vector3() };
      view.simulation.fragments.push(fragment);
      for (const physical of view.simulation.structure.sections) if (physical.wingInstance === index && physical.side < 0) physical.bodyId = fragment.id;
      view.updateControlSurfaces();
      const detached = view.fragments[0], oldPositions = detached.mesh.geometry.getAttribute('position');
      const oldIndices = Array.from(detached.mesh.geometry.index.array), oldVertices = Array.from(oldPositions.array);
      view.freezeFragments();
      view.wingMeshes[index].geometry.dispose();
      view.wingMeshes[index].geometry = view.compiledWingGeometry(index, compileAircraft(view.definition));
      view.syncWingPhysics(); view.updateControlSurfaces();
      expect(detached.frozen).toBe(true);
      expect(detached.mesh.geometry.getAttribute('position')).toBe(oldPositions);
      expect(Array.from(detached.mesh.geometry.index.array)).toEqual(oldIndices);
      expect(Array.from(oldPositions.array)).toEqual(oldVertices);
      expect(view.wingMeshes[index].geometry.getAttribute('position')).not.toBe(oldPositions);
      view.simulation.fragments.length = 0;
      const released = vi.fn();
      detached.hinge.geometry.addEventListener('dispose', () => released(detached.hinge.geometry.getAttribute('position')));
      view.updateControlSurfaces();
      expect(released).toHaveBeenCalledWith(oldPositions);
    } finally { disposeScene(view); }
  });

  it('设计态保留原始交叠翼面，不计算布尔或按包围盒禁用舵面', () => {
    const definition = clone(defaultAircraft); definition.birdman = false;
    definition.mainWing = wing(6, 1, 1); definition.horizontalTail = clone(definition.mainWing);
    definition.mainWing.controlSurface = definition.horizontalTail.controlSurface = 0.3;
    definition.assembly.mainWing = definition.assembly.horizontalTail = 0;
    definition.assembly.mainWingHeight = 0; definition.assembly.mainIncidence = definition.assembly.tailIncidence = 0;
    const view = Object.assign(Object.create(SceneView.prototype), { definition });
    const regions = view.designRegions(definition);
    expect(regions.filter((part: { wingInstance: number }) => part.wingInstance < 2).every((part: { movable: boolean }) => part.movable)).toBe(true);
    expect(regions.every((part: { spanStart: number; spanEnd: number }) => part.spanEnd - part.spanStart <= 0.8 + 1e-9)).toBe(true);
  });

  it.each([1, -1])('窄间距镜像投影%d的梢弦标签区分左右，并向两侧展开', mirror => {
    const svg = () => {
      const attributes = new Map<string, string>();
      const element = { style: { display: '' }, classList: { toggle() {} },
        setAttribute(name: string, value: string) { attributes.set(name, value); } };
      const text = { ...element, textContent: '' };
      return { ...element, attributes, children: [element, element, element], querySelector: () => text, querySelectorAll: () => [] };
    };
    const anchors = [
      { x: 500, y: 520 }, { x: 500 + mirror * 7, y: 200 }, { x: 500 + mirror * 7, y: 200 },
      { x: 500, y: 520 }, { x: 500 - mirror * 7, y: 200 }, { x: 500 - mirror * 7, y: 200 },
      { x: 500, y: 500 },
    ];
    const handles = anchors.map((_anchor, index) => ({
      index: index < 4 ? index : index - 3, side: index < 4 ? 1 : -1,
      x: 0, y: 0, ax: 0, ay: 0, group: svg(), leader: svg(),
    }));
    const segments = [0, 1, 2].map(index => ({
      index: index === 0 ? 0 : 1, side: index === 2 ? -1 : 1,
      x: 0, y: 0, ax: 0, ay: 0, x1: 0, y1: 0, x2: 0, y2: 0, group: svg(),
    }));
    const projection = new Vector3();
    projection.project = () => projection;
    const definition = clone(defaultAircraft); definition.verticalTail.mirrored = true;
    const view = Object.assign(Object.create(SceneView.prototype), {
      definition, editorTarget: 'verticalTail', simulation: null, editorDirty: true,
      width: 1000, height: 700, aircraft: new Group(), camera: new OrthographicCamera(),
      editorOverlay: svg(), editorHandles: handles, editorSegments: segments, editorPolygons: [svg(), svg()],
      editProjection: projection, body: { localToWorld: (point: Vector3) => point },
      wingEditorPoint(index: number, side: number, out: Vector3) {
        const anchor = anchors[side < 0 && index === 1 ? 4 : side < 0 && index === 2 ? 5 : index];
        return out.set(anchor.x / 500 - 1, 1 - anchor.y / 350, 0);
      },
      assemblyEditorPoint(_index: number, out: Vector3) { return out.set(0, 1 - anchors[6].y / 350, 0); },
    });
    view.updateEditorOverlay();
    expect(segments[1].group.attributes.get('aria-label')).not.toBe(segments[2].group.attributes.get('aria-label'));
    expect(segments[1].group.querySelector().textContent).toContain(t('右翼'));
    expect(segments[2].group.querySelector().textContent).toContain(t('左翼'));
    expect(segments[1].group.attributes.get('text-anchor')).toBe(mirror > 0 ? 'start' : 'end');
    expect(segments[2].group.attributes.get('text-anchor')).toBe(mirror > 0 ? 'end' : 'start');
    expect(Math.hypot(segments[1].x - segments[2].x, segments[1].y - segments[2].y)).toBeGreaterThanOrEqual(52 - 1e-6);
  });
});
