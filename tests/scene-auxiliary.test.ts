import { describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Color, DoubleSide, FrontSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { aircraftWings, clone, controlSurfaceRegions, defaultAircraft, wing, wingInstancePoint, wingSupports, type AircraftDefinition } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { SceneView } from '../src/scene';
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
  const view = Object.assign(Object.create(SceneView.prototype), {
    definition: simulation.definition, simulation, scene: new Scene(), body: new Group(),
    fragments: [], renderBlend: 1, aircraftOnly: true, metrics: {},
    wingSections: [], wingNormalGeometry: [], wingCoordinates: [], wingNeutral: [], wingHinges: [],
    wingMovable: [], wingAxes: [], wingAngles: [], wingMeshes: [], hingeLines: [],
    auxiliarySupports: [], supportFront: new Vector3(), supportBack: new Vector3(), supportNormal: new Vector3(),
    aircraftMaterials: { main: new MeshBasicMaterial(), ivory: new MeshBasicMaterial({ color: 0xf4f0dc }) },
    deformationCenter: new Vector3(), controlRotation: new Quaternion(), deformationRotation: new Quaternion(),
    deformationPoint: new Vector3(), deformationReference: new Vector3(), deformationRootTangent: new Vector3(),
    deformationTipTangent: new Vector3(), deformationAxis: new Vector3(), deformationHinge: new Vector3(),
    neutralReference: new Vector3(), incidenceRotation: new Quaternion(), vector: new Vector3(),
  });
  for (const instance of aircraftWings(simulation.definition)) {
    view.hingeLines.push(new Mesh(new BufferGeometry(), new MeshBasicMaterial()));
    view.wingMeshes.push(new Mesh(view.wingGeometry(instance.wing, 0, 0, instance.incidence, instance.id)));
  }
  view.syncWingPhysics();
  view.updateControlSurfaces();
  view.rebuildAuxiliarySupports();
  return view;
}

interface SceneResources {
  clearFragments(): void;
  wingMeshes: Mesh<BufferGeometry, MeshBasicMaterial>[];
  wingNormalGeometry: BufferGeometry[];
  hingeLines: Mesh<BufferGeometry, MeshBasicMaterial>[];
  auxiliarySupports: { mesh: Mesh }[];
  aircraftMaterials: { main: MeshBasicMaterial; ivory: MeshBasicMaterial };
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
  view.aircraftMaterials.main.dispose();
  view.aircraftMaterials.ivory.dispose();
}

it('非均匀遮蔽边界按真实展向位置插值弹性形变', () => {
  const view = auxiliaryScene(definition => {
    definition.auxiliaryWings = [];
    definition.engine.count = 0; definition.fuelTank.capacity = 0;
    definition.mainWing = wing(6, 1.2, 0.6, 0.2);
    definition.mainWing.controlSurface = 0.3;
    definition.horizontalTail = wing(2.4, 0.8, 0.4, 0.1);
    definition.horizontalTail.controlSurface = 0.3;
    definition.verticalTail.mirrored = false;
    definition.assembly.mainWingHeight = 0.5;
    definition.assembly.horizontalTail = -2.5;
  });
  try {
    const index = 1, coordinates = view.wingCoordinates[index];
    const section = view.wingSections[index].find((candidate: { rows: number; vertexStart: number; spanStart: number; spanEnd: number }) => {
      if (candidate.rows < 2) return false;
      const span = coordinates[(candidate.vertexStart + 32) * 4];
      return Math.abs((span - candidate.spanStart) / (candidate.spanEnd - candidate.spanStart) - 1 / candidate.rows) > 0.001;
    });
    expect(section).toBeDefined();
    const physical = section!.physics;
    physical.root.position.copy(physical.referenceRoot);
    physical.tip.position.copy(physical.referenceTip).add(new Vector3(0, 0.12, 0));
    physical.root.quaternion.identity(); physical.tip.quaternion.identity();
    physical.controlDeflection = 0;
    view.updateControlSurfaces();
    const positions = view.wingMeshes[index].geometry.getAttribute('position');
    for (let row = 0; row <= section!.rows; row++) {
      const vertex = section!.vertexStart + row * 32;
      const span = coordinates[vertex * 4];
      const t = Math.max(0, Math.min(1, (span - section!.spanStart) / (section!.spanEnd - section!.spanStart)));
      const expected = new Vector3().fromArray(view.wingNeutral[index], vertex * 3);
      expected.y += 0.12 * t * t * (3 - 2 * t);
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

it.each([-25, 25])('主翼上反角%d°在反向横滚和结构弯曲时仍共用封闭中央接缝', dihedral => {
  const view = auxiliaryScene(definition => {
    definition.mainWing.dihedral = dihedral;
    definition.mainWing.controlSurface = 0.3;
    definition.assembly.mainIncidence = 12;
  });
  try {
    for (const section of view.wingSections[0]) {
      section.physics.controlDeflection = section.side * 0.3;
      if (!section.previous) {
        section.physics.root.position.copy(section.physics.referenceRoot);
        section.physics.root.quaternion.identity();
        section.physics.tip.position.y += 0.05;
        section.physics.tip.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), section.side * 0.08);
      }
    }
    view.updateControlSurfaces();
    const roots = view.wingSections[0].filter((section: { previous: unknown }) => !section.previous);
    const positions = view.wingMeshes[0].geometry.getAttribute('position');
    for (let k = 0; k < 32; k++) {
      const left = roots[0].vertexStart + k, right = roots[1].vertexStart + k;
      expect(view.wingMovable[0][left]).toBe(0);
      expect(view.wingMovable[0][right]).toBe(0);
      expect(positions.getZ(left)).toBeCloseTo(0, 7);
      expect(new Vector3().fromBufferAttribute(positions, left).distanceTo(new Vector3().fromBufferAttribute(positions, right))).toBeLessThan(1e-6);
    }
  } finally { disposeScene(view); }
});

it('跨翼位置变化重建遮蔽，固定段保留翼色、无旋转、无铰链，恢复后重新可动', () => {
  const view = auxiliaryScene(definition => {
    definition.mainWing = wing(6, 1, 1);
    definition.horizontalTail = wing(6, 1, 1);
    definition.horizontalTail.controlSurface = 0.3;
    definition.verticalTail = { ...wing(2, 1, 1), mirrored: true, lateralOffset: 1, cant: 0, controlSurface: 0.3 };
    Object.assign(definition.assembly, { mainWing: 1, mainWingHeight: 1, mainIncidence: 0, horizontalTail: -2, tailIncidence: 0, verticalTail: -2 });
    definition.auxiliaryWings = [];
  });
  Object.assign(view, {
    simulation: null, aircraftPending: true, wingShapeKeys: [], wingParameters: [], surfaceParameters: [], wingOriginalColors: [],
    wingBaseColor: new Color(0xf4f0dc), wingTipColor: new Color(0xd97343), metrics: { memory: 0 },
    designCG: new Vector3(), fuelCgFullPosition: new Vector3(), fuelCgEmptyPosition: new Vector3(),
    designLiftCenter: new Vector3(), designDragCenter: new Vector3(), designLiftDirection: new Vector3(), designDragDirection: new Vector3(),
    support: new Group(), beam: new Group(), nose: new Group(), pilot: new Group(), cockpit: new Group(),
    aircraft: new Group(), driver: new Group(), cg: new Group(), updateCockpitShell() {}, updatePropulsionGeometry() {},
    positionAtLaunch() {}, updateCenters() {},
  });
  try {
    view.applyAircraft();
    const original = view.wingMeshes[1].geometry;
    const before = view.wingSections[1].reduce((span: number, section: { movable: boolean; spanStart: number; spanEnd: number }) => span + (section.movable ? section.spanEnd - section.spanStart : 0), 0);
    const regions = controlSurfaceRegions(view.definition);
    const hinges = view.hingeLines[1].geometry;
    const lineVertices = Array.from(hinges.index.array).slice(0, hinges.drawRange.count);
    const colors = original.getAttribute('color');
    const positions = original.getAttribute('position');
    for (const section of view.wingSections[1]) {
      expect(section.movable).toBe(regions.find(region => region.wingInstance === 1 && region.side === section.side && region.spanStart === section.spanStart)!.movable);
      if (section.movable) continue;
      for (let vertex = section.vertexStart; vertex < section.vertexStart + (section.rows + 1) * 32; vertex++) {
        expect(view.wingMovable[1][vertex]).toBe(0);
        expect(lineVertices).not.toContain(vertex);
        expect(new Vector3().fromBufferAttribute(colors, vertex).distanceTo(new Vector3(view.wingBaseColor.r, view.wingBaseColor.g, view.wingBaseColor.b))).toBeLessThan(1e-6);
        expect(new Vector3().fromBufferAttribute(positions, vertex).distanceTo(new Vector3().fromArray(view.wingNeutral[1], vertex * 3))).toBeLessThan(1e-6);
      }
    }
    view.definition.verticalTail.lateralOffset = 0.9;
    const shifted = controlSurfaceRegions(view.definition).filter(region => region.wingInstance === 1);
    expect(shifted.map(region => region.movable)).toEqual(regions.filter(region => region.wingInstance === 1).map(region => region.movable));
    view.aircraftPending = true;
    view.applyAircraft();
    expect(view.wingMeshes[1].geometry).not.toBe(original);
    expect(view.wingSections[1].map((section: { spanStart: number; spanEnd: number }) => [section.spanStart, section.spanEnd]))
      .toEqual(shifted.map(region => [region.spanStart, region.spanEnd]));
    view.definition.assembly.verticalTail = 2;
    view.aircraftPending = true;
    view.applyAircraft();
    expect(view.wingMeshes[1].geometry).not.toBe(original);
    const after = view.wingSections[1].reduce((span: number, section: { movable: boolean; spanStart: number; spanEnd: number }) => span + (section.movable ? section.spanEnd - section.spanStart : 0), 0);
    expect(after).toBeGreaterThan(before);
    expect(view.hingeLines[1].geometry.drawRange.count).toBeGreaterThan(0);
  } finally { disposeScene(view); }
});

describe('辅助翼实例场景', () => {
  it('镜像两侧蒙皮、手柄、结构参考及铰链使用真实变换，没有中央垂翼', () => {
    const view = auxiliaryScene();
    try {
      expect(view.wingMeshes).toHaveLength(5);
      for (const instance of aircraftWings(view.definition)) {
        for (const section of view.wingSections[instance.id]) {
          expect(section.physics.wingInstance).toBe(instance.id);
          expect(section.physics.side).toBe(section.side);
          const expected = wingInstancePoint(view.definition, instance.id, section.side, section.spanStart, 0.25, 0, new Vector3());
          expect(section.referenceRoot.distanceTo(expected)).toBeLessThan(1e-10);
          if (instance.key !== 'verticalTail') continue;
          const points = view.wingMeshes[instance.id].geometry.getAttribute('position');
          for (let vertex = section.vertexStart; vertex < section.vertexStart + (section.rows + 1) * 32; vertex++) {
            expect(points.getZ(vertex) * section.side).toBeGreaterThan(0.55);
          }
          const hinge = new Vector3().fromArray(view.wingHinges[instance.id], section.vertexStart * 3);
          expect(hinge.distanceTo(wingInstancePoint(view.definition, instance.id, section.side, section.spanStart, 0.7, 0, new Vector3()))).toBeLessThan(1e-6);
          if (instance.id === 2) {
            view.editorTarget = 'verticalTail';
            const tipSection = view.wingSections[2].filter((part: { side: number }) => part.side === section.side).at(-1);
            const tip = view.wingEditorPoint(1, section.side, new Vector3());
            const vertex = tipSection.vertexStart + tipSection.rows * 32;
            const neutral = new Vector3().fromArray(view.wingNeutral[2], vertex * 3);
            expect(neutral.distanceTo(tip)).toBeLessThan(1e-6);
            // Reset includes self-weight sag; editor anchors retain unloaded geometry.
            const physical = tipSection.physics;
            const loaded = tip.clone().sub(physical.referenceTip).applyQuaternion(physical.tip.quaternion).add(physical.tip.position);
            const rendered = new Vector3().fromBufferAttribute(points, vertex);
            expect(rendered.distanceTo(loaded)).toBeLessThan(1e-6);
          }
        }
      }
    } finally { disposeScene(view); }
  });

  it('各实例两侧舵面使用各自铰链轴，断裂只移除实际归属并隐藏对应支撑', () => {
    const view = auxiliaryScene();
    try {
      for (const section of view.simulation.structure.sections) section.controlDeflection = 0.18;
      view.updateControlSurfaces();
      for (const index of [2, 3, 4]) for (const section of view.wingSections[index]) {
        const vertex = section.vertexStart + 16;
        const neutral = new Vector3().fromArray(view.wingNeutral[index], vertex * 3);
        const hinge = new Vector3().fromArray(view.wingHinges[index], vertex * 3);
        const axis = view.wingAxes[index][section.side < 0 ? 0 : 1];
        const expected = neutral.sub(hinge).applyAxisAngle(axis, section.movable ? 0.18 : 0).add(hinge);
        const physical = section.physics;
        expected.sub(physical.referenceRoot).applyQuaternion(physical.root.quaternion).add(physical.root.position);
        const actual = new Vector3().fromBufferAttribute(view.wingMeshes[index].geometry.getAttribute('position'), vertex);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
      }
      const section = view.wingSections.flat().find((part: { movable: boolean }) => part.movable)!;
      const index = section.wingIndex, vertex = section.vertexStart + 16;
      const effectiveness = section.physics.surface.controlEffectiveness;
      const geometry = view.wingMeshes[index].geometry;
      section.physics.surface.controlEffectiveness = 0;
      view.updateControlSurfaces();
      expect(section.movable).toBe(false);
      expect(view.wingMovable[index][vertex]).toBe(0);
      const lines = view.hingeLines[index].geometry;
      expect(Array.from(lines.index.array).slice(0, lines.drawRange.count)).not.toContain(section.vertexStart + 12);
      section.physics.surface.controlEffectiveness = effectiveness;
      view.updateControlSurfaces();
      expect(view.wingMovable[index][vertex]).toBe(1);
      expect(view.wingMeshes[index].geometry).toBe(geometry);
      const fragment = { id: 71, position: new Vector3(10, 20, 30), quaternion: new Quaternion(), cg: new Vector3() };
      view.simulation.fragments.push(fragment);
      for (const section of view.simulation.structure.sections) {
        if (section.wingInstance === 4 && section.side < 0) section.bodyId = fragment.id;
      }
      view.updateControlSurfaces();
      expect(view.fragments.map((part: { id: number; wingIndex: number }) => [part.id, part.wingIndex])).toEqual([[71, 4]]);
      expect(view.wingSections[2].every((section: { bodyId: number }) => section.bodyId === 0)).toBe(true);
      expect(view.auxiliarySupports.filter((support: { mesh: Mesh }) => support.mesh.visible)).toHaveLength(3);
      const attached = view.wingMeshes[4].geometry;
      for (let offset = 0; offset < attached.drawRange.count; offset++) {
        expect(attached.getAttribute('position').getZ(attached.index.getX(offset))).toBeGreaterThan(0.55);
      }
    } finally { disposeScene(view); }
  });

  it('悬空根弦有同色实体板，镜像启用时水平翼拖到顶端也不吸附', () => {
    const view = auxiliaryScene();
    try {
      expect(view.auxiliarySupports).toHaveLength(4);
      for (const support of view.auxiliarySupports) {
        expect(support.mesh.material).toBe(view.aircraftMaterials.ivory);
        const shared = wingSupports(view.definition).find(web => web.wingInstance === support.wingIndex && web.side === support.side)!;
        expect(Array.from(support.mesh.geometry.index.array)).toEqual(shared.indices);
        const points = support.mesh.geometry.getAttribute('position');
        const normals = support.mesh.geometry.getAttribute('normal');
        const section = view.wingSections[support.wingIndex].find((part: { side: number; previous: unknown }) => part.side === support.side && !part.previous);
        for (let vertex = 0; vertex < shared.points.length; vertex++) {
          const expected = new Vector3().copy(shared.points[vertex]);
          view.deformPoint(section, expected, 0);
          expected.lerp(shared.points[vertex], 1 - shared.vertexWeights[vertex]);
          expect(new Vector3().fromBufferAttribute(points, vertex).distanceTo(expected)).toBeLessThan(1e-6);
          expect(Number.isFinite(normals.getX(vertex) + normals.getY(vertex) + normals.getZ(vertex))).toBe(true);
        }
      }
      view.editorTarget = 'horizontalTail'; view.editDefinition = clone(view.definition);
      view.editorSnap = { active: false, kind: null, value: null, disabled: false };
      view.mountSnapTolerance = () => 0.06;
      view.editorChange = (next: typeof view.definition) => { view.definition = next; };
      const fin = wingInstancePoint(view.definition, 2, 1, Math.abs(view.definition.verticalTail.points[1].y), 0.5, 0, new Vector3());
      view.changeAssembly(1, fin.x - view.definition.assembly.horizontalTail, fin.y);
      expect(view.definition.assembly.tailOnFin).toBe(false);
      expect(view.editorSnap.kind).not.toBe('mount');
      view.definition.verticalTail.mirrored = false;
      view.editDefinition = clone(view.definition);
      view.changeAssembly(1, fin.x - view.definition.assembly.horizontalTail, fin.y);
      expect(view.definition.assembly.tailOnFin).toBe(false);
      expect(view.editorSnap.kind).not.toBe('mount');
    } finally { disposeScene(view); }
  });
  it('关闭镜像保留参数，但恢复单片居中直立并移除横向支撑', () => {
    const view = auxiliaryScene();
    try {
      for (const index of [2, 4]) {
        const wing = index === 2 ? view.definition.verticalTail : view.definition.auxiliaryWings[1].wing;
        wing.mirrored = false;
        if (index === 4) view.definition.auxiliaryWings[1].incidence = 0;
        view.wingMeshes[index].geometry.dispose();
        view.wingMeshes[index].geometry = view.wingGeometry(wing, 0, 0, 0, index);
        const sections = view.wingSections[index];
        expect(new Set(sections.map((section: { side: number }) => section.side))).toEqual(new Set([1]));
        const tip = sections.at(-1).referenceTip;
        expect(tip.z).toBeCloseTo(0, 12);
        expect(tip.y).toBeCloseTo(wing.points[1].y, 12);
        expect(wing.cant).toBe(30); expect(wing.lateralOffset).toBe(0.7);
      }
      view.rebuildAuxiliarySupports();
      expect(view.auxiliarySupports).toHaveLength(0);
    } finally { disposeScene(view); }
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
