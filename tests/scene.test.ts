import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, MeshBasicMaterial, BoxGeometry, OrthographicCamera, Spherical, Vector3 } from 'three';
import { clone, defaultAircraft, DEG, engineMounts } from '../src/model';
import { SceneView } from '../src/scene';

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
