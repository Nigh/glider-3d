import { describe, expect, it } from 'vitest';
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Quaternion, Scene, Vector3 } from 'three';
import { aircraftWings, clone, defaultAircraft, wingInstancePoint, wingSupports } from '../src/model';
import { FlightSimulation } from '../src/physics';
import { SceneView } from '../src/scene';
import { t } from '../src/i18n';

function auxiliaryScene() {
  const definition = clone(defaultAircraft);
  definition.birdman = false;
  definition.assembly.tailOnFin = false;
  Object.assign(definition.verticalTail, { mirrored: true, cant: 30, lateralOffset: 0.7, controlSurface: 0.3 });
  definition.auxiliaryWings = [
    { kind: 'horizontalTail', wing: clone(definition.horizontalTail), position: 1.5, incidence: 9 },
    { kind: 'verticalTail', wing: clone(definition.verticalTail), position: -1.5, incidence: 8 },
  ];
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
        const expected = neutral.sub(hinge).applyAxisAngle(axis, 0.18).add(hinge);
        const physical = section.physics;
        expected.sub(physical.referenceRoot).applyQuaternion(physical.root.quaternion).add(physical.root.position);
        const actual = new Vector3().fromBufferAttribute(view.wingMeshes[index].geometry.getAttribute('position'), vertex);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
      }
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
        expect(support.mesh.geometry.index.count).toBe(48);
        const points = support.mesh.geometry.getAttribute('position');
        const shared = wingSupports(view.definition).find(web => web.wingInstance === support.wingIndex && web.side === support.side)!;
        for (const [triangle, corners] of [[0, 1, 2], [0, 2, 3]].entries()) {
          const a = new Vector3().copy(shared.points[corners[0]]), b = new Vector3().copy(shared.points[corners[1]]);
          const c = new Vector3().copy(shared.points[corners[2]]);
          const thickness = b.sub(a).cross(c.sub(a)).normalize().multiplyScalar(0.06);
          for (let corner = 0; corner < 3; corner++) {
            const lower = new Vector3().fromBufferAttribute(points, triangle * 6 + corner);
            const upper = new Vector3().fromBufferAttribute(points, triangle * 6 + corner + 3);
            expect(upper.clone().sub(lower).distanceTo(thickness)).toBeLessThan(1e-6);
            expect(lower.add(upper).multiplyScalar(0.5).distanceTo(shared.points[corners[corner]])).toBeLessThan(1e-6);
          }
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
