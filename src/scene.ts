import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, clone, DEG, defaultAircraft, type AircraftDefinition, type Wing } from './model';
import { LAUNCH, launchHeight, derive, type FlightSimulation } from './physics';

type Quality = 'Auto' | 'High' | 'Medium' | 'Low';
const UP = new THREE.Vector3(0, 1, 0);
const TRAIL_CAPACITY = 8192;
const PARTICLES = 64;
type EditorTarget = 'mainWing' | 'horizontalTail' | 'verticalTail' | 'assembly' | null;
const DOWN = new THREE.Vector3(0, -1, 0);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 湖区只构建一次；设计变更只替换飞机，所有动态缓冲区重复使用。 */
export class SceneView {
  readonly metrics = { fps: 60, mean: 16.7, p95: 16.7, p99: 16.7, renderMs: 0, geometryMs: 0, drawCalls: 0, triangles: 0, memory: 0, quality: 'Medium', geometries: 0, textures: 0, programs: 0 };
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly perspective = new THREE.PerspectiveCamera(43, 1, 0.1, 3000);
  private readonly orthographic = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 3000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly aircraft = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly pilot = new THREE.Group();
  private readonly driver = new THREE.Group();
  private readonly aircraftMaterials = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xf4f0dc, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    main: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd97343, roughness: 0.7, flatShading: true, side: THREE.DoubleSide }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x344740, roughness: 0.67, metalness: 0.2, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd2a07e, roughness: 1, flatShading: true }),
    suit: new THREE.MeshStandardMaterial({ color: 0x53675e, roughness: 1, flatShading: true }),
  };
  private readonly strutGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  private readonly wingMeshes: THREE.Mesh[] = [];
  private readonly braces: THREE.Mesh[] = [];
  private readonly wingParameters = new Float64Array(36).fill(NaN);
  private readonly wingBaseColor = new THREE.Color(0xf4f0dc);
  private readonly wingTipColor = new THREE.Color(0xd97343);
  private beam!: THREE.Mesh;
  private nose!: THREE.Mesh;
  private aircraftPending = false;
  private readonly detail = new THREE.Group();
  private readonly debugGroup = new THREE.Group();
  private readonly light = new THREE.DirectionalLight(0xffedcf, 3.3);
  private readonly cg = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xf15554, depthTest: false }));
  private readonly liftCenter = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0x168c85, depthTest: false }));
  private readonly designLiftCenter = new THREE.Vector3();
  private readonly terrain: THREE.Object3D[] = [];
  private readonly groundRay = new THREE.Raycaster();
  private readonly groundHits: THREE.Intersection[] = [];
  private readonly editRay = new THREE.Raycaster();
  private readonly editPlane = new THREE.Plane();
  private readonly editPointer = new THREE.Vector2();
  private readonly editPoint = new THREE.Vector3();
  private readonly editOrigin = new THREE.Vector3();
  private readonly editStart = new THREE.Vector3();
  private readonly editProjection = new THREE.Vector3();
  private readonly editorOverlay = document.createElementNS(SVG_NS, 'svg');
  private readonly editorPolygons: SVGPolygonElement[] = [];
  private readonly editorHandles: { group: SVGGElement; index: number; side: number; x: number; y: number }[] = [];
  private editorTarget: EditorTarget = null;
  private editorChange: ((definition: AircraftDefinition) => void) | null = null;
  private editorCommit: (() => void) | null = null;
  private editorDrag = -1;
  private editorPointerId = -1;
  private editorChanged = false;
  private editDefinition: AircraftDefinition | null = null;
  private editorDirty = true;
  private readonly trailArray = new Float32Array(TRAIL_CAPACITY * 6);
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trail: THREE.LineSegments;
  private readonly arrows: THREE.ArrowHelper[] = [];
  private readonly applicationMarkers: THREE.Mesh[] = [];
  private readonly splashPositions = new Float32Array(PARTICLES * 3);
  private readonly splashVelocities = new Float32Array(PARTICLES * 3);
  private readonly splashGeometry = new THREE.BufferGeometry();
  private readonly splash: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly waterTime = { value: 0 };
  private readonly frameTimes = new Float32Array(180);
  private readonly sortedTimes = new Float32Array(180);
  private readonly target = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly vector = new THREE.Vector3();
  private readonly vector2 = new THREE.Vector3();
  private readonly lastTrail = new THREE.Vector3();
  private readonly designCG = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly layoutObserver: MutationObserver;
  private simulation: FlightSimulation | null = null;
  private definition: AircraftDefinition = defaultAircraft;
  private view = 'orbit';
  private quality: Quality = 'Auto';
  private level = 1;
  private width = 1;
  private height = 1;
  private debug = false;
  private elapsed = 0;
  private sampleCount = 0;
  private sampleIndex = 0;
  private statisticsClock = 0;
  private qualityClock = 0;
  private slowTime = 0;
  private fastTime = 0;
  private trailClock = 0;
  private trailIndex = 0;
  private trailCount = 0;
  private splashAge = -1;
  private wasInWater = false;
  private disposed = false;
  private readonly coarsePointer = matchMedia('(pointer: coarse)').matches;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0xd4e3e4);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。');
    this.host.appendChild(this.renderer.domElement);
    this.buildEditorOverlay();
    this.scene.background = new THREE.Color(0xd4e3e4);
    this.scene.fog = new THREE.FogExp2(0xd4e3e4, 0.00165);
    this.scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x6c7860, 2.6));
    this.light.position.set(-55, 110, 65);
    this.light.castShadow = true;
    this.light.shadow.camera.left = -35;
    this.light.shadow.camera.right = 35;
    this.light.shadow.camera.top = 35;
    this.light.shadow.camera.bottom = -35;
    this.light.shadow.camera.near = 1;
    this.light.shadow.camera.far = 230;
    this.light.shadow.bias = -0.00035;
    this.light.shadow.normalBias = 0.06;
    this.scene.add(this.light, this.light.target, this.aircraft, this.detail, this.debugGroup);
    this.cg.renderOrder = 20;
    this.liftCenter.renderOrder = 20;
    for (const [marker, text, color] of [[this.cg, '重心 CG', '#91332f'], [this.liftCenter, '主翼升力参考点', '#12655f']] as const) {
      const label = this.label(text, color, '#fafbf6', 256, 64);
      label.position.set(0, marker === this.cg ? 0.45 : -0.45, 0);
      label.scale.set(1.8, 0.45, 1);
      label.material.depthTest = false;
      label.renderOrder = 21;
      marker.add(label);
    }
    this.buildEnvironment();
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.LineSegments(this.trailGeometry, new THREE.LineBasicMaterial({ color: 0xf0b553, transparent: true, opacity: 0.85, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.debugGroup.add(this.trail);
    const arrowColors = [0x3bada1, 0xf08b5b, 0xa493c3, 0x3686bd, 0x3bada1, 0x3bada1, 0x3bada1, 0x3bada1, 0xf08b5b];
    for (const color of arrowColors) {
      const arrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, color, 0.35, 0.18);
      (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
      (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
      arrow.visible = false;
      this.arrows.push(arrow);
      this.debugGroup.add(arrow);
    }
    const markerGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd777, depthTest: false });
    for (let i = 0; i < 12; i++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.visible = false;
      this.applicationMarkers.push(marker);
      this.debugGroup.add(marker);
    }
    this.splashGeometry.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.splash = new THREE.Points(this.splashGeometry, new THREE.PointsMaterial({ color: 0xeafafa, size: 0.2, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
    this.splash.frustumCulled = false;
    this.splash.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xe0f4eb, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.splash, this.ring);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 700;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.minZoom = 0.1;
    this.controls.maxZoom = 10;
    this.controls.addEventListener('change', () => { this.editorDirty = true; });
    this.level = 0;
    this.applyQuality();
    this.buildAircraft();
    this.updateAircraft(defaultAircraft);
    this.applyAircraft();
    this.cameraView('orbit');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.layoutObserver = new MutationObserver(() => this.resize());
    if (host.parentElement) this.layoutObserver.observe(host.parentElement, { childList: true });
    this.resize();
    this.metrics.memory = this.geometryMemory();
    this.debugGroup.visible = false;
  }

  setEditor(target: EditorTarget, onchange: (definition: AircraftDefinition) => void, oncommit: () => void): void {
    this.editorChange = onchange;
    this.editorCommit = oncommit;
    if (this.editorTarget === target) return;
    this.endEditorDrag();
    this.editorTarget = target;
    this.editorDirty = true;
    if (!this.simulation) this.cameraView(target ? target === 'mainWing' || target === 'horizontalTail' ? 'top' : 'side' : 'orbit');
    this.updateEditorOverlay();
  }

  getDiagnostics() {
    const position = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    return {
      view: this.view, orthographic: this.camera === this.orthographic,
      camera: position(this.camera.position), target: position(this.controls.enabled ? this.controls.target : this.target),
      groundHeight: this.surfaceHeight(this.camera.position.x, this.camera.position.z),
      editing: this.editorTarget, shadowVisible: this.renderer.shadowMap.enabled,
      editor: { target: this.editorTarget, dragging: this.editorDrag, handles: this.editorTarget && !this.simulation ? this.editorHandles.filter(h => h.group.style.display !== 'none').map(h => ({ index: h.index, side: h.side, x: h.x, y: h.y })) : [] },
      aircraft: position(this.aircraft.position),
      centers: { cg: position(this.cg.position), lift: position(this.liftCenter.position) },
    };
  }

  private positionAtLaunch(): void {
    this.aircraft.position.set(LAUNCH.startX, launchHeight(this.definition, this.designCG), 0);
  }

  private updateCenters(): void {
    this.cg.visible = this.liftCenter.visible = !this.simulation || this.debug;
    this.cg.position.copy(this.aircraft.position);
    this.liftCenter.position.copy(this.designLiftCenter).sub(this.simulation?.telemetry.cg ?? this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
  }

  private surfaceHeight(x: number, z: number): number {
    this.groundRay.set(this.vector.set(x, 1000, z), DOWN);
    this.groundHits.length = 0;
    this.groundRay.intersectObjects(this.terrain, false, this.groundHits);
    return Math.max(0, this.groundHits[0]?.point.y ?? 0);
  }

  private constrainCamera(): void {
    const minimum = this.surfaceHeight(this.camera.position.x, this.camera.position.z) + 0.55;
    if (this.camera.position.y >= minimum) return;
    const correction = minimum - this.camera.position.y;
    this.camera.position.y = minimum;
    if (this.controls.enabled) this.controls.target.y += correction;
    this.camera.lookAt(this.controls.enabled ? this.controls.target : this.target);
  }

  private buildEditorOverlay(): void {
    const overlay = this.editorOverlay;
    overlay.classList.add('scene-editor');
    overlay.setAttribute('aria-label', '真实翼面与部件位置编辑');
    overlay.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;touch-action:none';
    for (let i = 0; i < 2; i++) {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('fill', '#b84a2b');
      polygon.setAttribute('fill-opacity', '0.12');
      polygon.setAttribute('stroke', '#a33f24');
      polygon.setAttribute('stroke-width', '1.5');
      overlay.appendChild(polygon);
      this.editorPolygons.push(polygon);
    }
    for (let i = 0; i < 6; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.style.cssText = 'pointer-events:all;cursor:grab;outline:none';
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('r', '22');
      hit.setAttribute('fill', 'transparent');
      const point = document.createElementNS(SVG_NS, 'circle');
      point.setAttribute('r', '6');
      point.setAttribute('fill', '#fafbf6');
      point.setAttribute('stroke', '#a33f24');
      point.setAttribute('stroke-width', '2');
      point.style.pointerEvents = 'none';
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '11'); text.setAttribute('y', '-10');
      text.setAttribute('fill', '#173e43'); text.setAttribute('font-size', '12');
      text.setAttribute('paint-order', 'stroke'); text.setAttribute('stroke', '#fafbf6');
      text.setAttribute('stroke-width', '3');
      text.style.pointerEvents = 'none';
      group.append(hit, point, text);
      const handle = { group, index: i < 4 ? i : i - 3, side: i < 4 ? 1 : -1, x: 0, y: 0 };
      this.editorHandles.push(handle);
      group.addEventListener('pointerdown', e => this.beginEditorDrag(e, i));
      group.addEventListener('focus', () => { point.setAttribute('r', '9'); });
      group.addEventListener('blur', () => { point.setAttribute('r', '6'); });
      group.addEventListener('keydown', e => {
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || !this.editorTarget || this.simulation) return;
        e.preventDefault(); e.stopPropagation();
        this.editDefinition = clone(this.definition);
        const amount = e.shiftKey ? 0.1 : 0.025;
        const horizontal = e.key === 'ArrowRight' ? amount : e.key === 'ArrowLeft' ? -amount : 0;
        const vertical = e.key === 'ArrowUp' ? amount : e.key === 'ArrowDown' ? -amount : 0;
        if (this.editorTarget === 'assembly') this.changeAssembly(i, horizontal, vertical);
        else {
          const p = this.definition[this.editorTarget].points[handle.index];
          this.changeWing(handle.index, p.x - (this.editorTarget === 'verticalTail' ? horizontal : vertical), p.y + (this.editorTarget === 'verticalTail' ? vertical : horizontal * handle.side));
        }
        this.editorCommit?.();
        this.editDefinition = null;
      });
      overlay.appendChild(group);
    }
    overlay.addEventListener('pointermove', e => this.moveEditorDrag(e));
    overlay.addEventListener('pointerup', () => this.endEditorDrag());
    overlay.addEventListener('pointercancel', () => this.endEditorDrag());
    overlay.addEventListener('lostpointercapture', () => this.endEditorDrag());
    this.host.appendChild(overlay);
  }

  private editorRoot(): number {
    return this.editorTarget && this.editorTarget !== 'assembly' ? this.definition.assembly[this.editorTarget] : 0;
  }

  private wingEditorPoint(index: number, side: number, out: THREE.Vector3): THREE.Vector3 {
    const key = this.editorTarget;
    if (!key || key === 'assembly') return out.set(0, 0, 0);
    const wing = this.definition[key], point = wing.points[index];
    const vertical = key === 'verticalTail';
    const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
    if (vertical) out.set(this.editorRoot() - point.x, 0.35 + point.y, 0);
    else out.set(this.editorRoot() - point.x * Math.cos(incidence),
      (key === 'mainWing' ? this.definition.assembly.mainWingHeight : 0.35) - point.x * Math.sin(incidence) + point.y * Math.tan(wing.dihedral * DEG), point.y * side);
    return out;
  }

  private assemblyEditorPoint(index: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.definition;
    if (index === 0) return out.set(d.assembly.mainWing - (d.mainWing.points[0].x + d.mainWing.points[3].x) / 2, d.assembly.mainWingHeight, 0);
    if (index === 1) return out.set(d.assembly.horizontalTail - (d.horizontalTail.points[0].x + d.horizontalTail.points[3].x) / 2, 0.35, 0);
    if (index === 2) return out.set(d.assembly.verticalTail - (d.verticalTail.points[0].x + d.verticalTail.points[3].x) / 2, 0.35 + d.verticalTail.points[1].y * 0.65, 0);
    return out.set(d.cockpit.position, 0.55, 0);
  }

  private updateEditorOverlay(): void {
    const key = this.editorTarget, visible = !!key && !this.simulation;
    this.editorOverlay.style.display = visible ? 'block' : 'none';
    if (!visible || !key || !this.editorDirty) return;
    this.editorDirty = false;
    this.editorOverlay.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.aircraft.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const label = key === 'mainWing' ? '主翼' : key === 'horizontalTail' ? '水平尾翼' : '垂直尾翼';
    for (let i = 0; i < this.editorHandles.length; i++) {
      const handle = this.editorHandles[i];
      const show = i < 4 || key !== 'assembly' && key !== 'verticalTail';
      handle.group.style.display = show ? '' : 'none';
      if (!show) continue;
      if (key === 'assembly') this.assemblyEditorPoint(i, this.editProjection);
      else this.wingEditorPoint(handle.index, handle.side, this.editProjection);
      this.body.localToWorld(this.editProjection).project(this.camera);
      handle.x = (this.editProjection.x + 1) * this.width / 2;
      handle.y = (1 - this.editProjection.y) * this.height / 2;
      handle.group.setAttribute('transform', `translate(${handle.x} ${handle.y})`);
      const name = key === 'assembly' ? ['主翼位置', '水平尾翼位置', '垂直尾翼位置', '驾驶舱位置'][i] : `${label}${handle.side < 0 ? '左翼' : ''}顶点${handle.index + 1}`;
      handle.group.setAttribute('aria-label', name);
      handle.group.setAttribute('data-handle', String(i));
      handle.group.querySelector('text')!.textContent = key === 'assembly' ? ['主翼', '平尾', '垂尾', '驾驶舱'][i] : String(handle.index + 1);
    }
    for (let side = 0; side < 2; side++) {
      const polygon = this.editorPolygons[side];
      polygon.style.display = key === 'assembly' || side === 1 && key === 'verticalTail' ? 'none' : '';
      if (polygon.style.display === 'none') continue;
      let points = '';
      for (let i = 0; i < 4; i++) {
        this.wingEditorPoint(i, side === 0 ? 1 : -1, this.editProjection);
        this.body.localToWorld(this.editProjection).project(this.camera);
        points += `${(this.editProjection.x + 1) * this.width / 2},${(1 - this.editProjection.y) * this.height / 2} `;
      }
      polygon.setAttribute('points', points);
    }
  }

  private intersectEditor(event: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.editPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.editRay.setFromCamera(this.editPointer, this.camera);
    return this.editRay.ray.intersectPlane(this.editPlane, this.editPoint) !== null;
  }

  private beginEditorDrag(event: PointerEvent, index: number): void {
    if (event.button !== 0 || !this.editorTarget || this.simulation) return;
    event.preventDefault(); event.stopPropagation();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    let nearest = Infinity;
    for (let i = 0; i < this.editorHandles.length; i++) {
      const handle = this.editorHandles[i];
      if (handle.group.style.display === 'none') continue;
      const distance = (handle.x - x) ** 2 + (handle.y - y) ** 2;
      if (distance < nearest) { nearest = distance; index = i; }
    }
    this.editDefinition = clone(this.definition);
    this.body.getWorldPosition(this.editOrigin);
    const sideView = this.editorTarget === 'assembly' || this.editorTarget === 'verticalTail';
    this.editPlane.setFromNormalAndCoplanarPoint(sideView ? this.vector.set(0, 0, 1) : UP, this.editOrigin);
    if (!this.intersectEditor(event)) return;
    this.editStart.copy(this.editPoint);
    this.editorDrag = index;
    this.editorPointerId = event.pointerId;
    this.editorChanged = false;
    this.controls.enabled = false;
    this.editorOverlay.setPointerCapture(event.pointerId);
    this.editorHandles[index].group.style.cursor = 'grabbing';
  }

  private moveEditorDrag(event: PointerEvent): void {
    if (this.editorDrag < 0 || !this.editorTarget || event.pointerId !== this.editorPointerId || !this.intersectEditor(event)) return;
    event.preventDefault();
    const key = this.editorTarget, handle = this.editorHandles[this.editorDrag];
    if (key === 'assembly') this.changeAssembly(this.editorDrag, this.editPoint.x - this.editStart.x, this.editPoint.y - this.editStart.y);
    else {
      const base = this.editDefinition!;
      const incidence = (key === 'mainWing' ? base.assembly.mainIncidence : key === 'horizontalTail' ? base.assembly.tailIncidence : 0) * DEG;
      const point = base[key].points[handle.index];
      const x = point.x - (this.editPoint.x - this.editStart.x) / Math.cos(incidence);
      const spanDelta = key === 'verticalTail' ? this.editPoint.y - this.editStart.y : (this.editPoint.z - this.editStart.z) * handle.side;
      this.changeWing(handle.index, x, point.y + spanDelta);
    }
    this.editorChanged = true;
  }

  private changeWing(index: number, x: number, span: number): void {
    const key = this.editorTarget;
    if (!key || key === 'assembly') return;
    const next = clone(this.editDefinition ?? this.definition), wing = next[key], p = wing.points;
    p[index].x = clamp(x, -3, 6);
    if (index === 0 || index === 1) p[index].x = Math.min(p[index].x, p[index === 0 ? 3 : 2].x - 0.15);
    else p[index].x = Math.max(p[index].x, p[index === 3 ? 0 : 1].x + 0.15);
    if (index === 1 || index === 2) p[1].y = p[2].y = clamp(span, 0.25, 12);
    this.editorChange?.(next);
  }

  private changeAssembly(index: number, x: number, y: number): void {
    const next = clone(this.editDefinition ?? this.definition);
    if (index === 0) {
      next.assembly.mainWing = clamp(next.assembly.mainWing + x, -6, 5);
      next.assembly.mainWingHeight = clamp(next.assembly.mainWingHeight + y, 0, 2);
    } else if (index === 1) next.assembly.horizontalTail = clamp(next.assembly.horizontalTail + x, -6, 5);
    else if (index === 2) next.assembly.verticalTail = clamp(next.assembly.verticalTail + x, -6, 5);
    else next.cockpit.position = clamp(next.cockpit.position + x, -3, 4);
    this.editorChange?.(next);
  }

  private endEditorDrag(): void {
    if (this.editorDrag < 0) return;
    const pointer = this.editorPointerId;
    this.editorHandles[this.editorDrag].group.style.cursor = 'grab';
    this.editorDrag = this.editorPointerId = -1;
    this.editDefinition = null;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit';
    if (this.editorOverlay.hasPointerCapture(pointer)) this.editorOverlay.releasePointerCapture(pointer);
    if (this.editorChanged) this.editorCommit?.();
    this.editorChanged = false;
  }

  private orthographicSpan(): number {
    const aspect = this.width / this.height;
    const key = this.editorTarget;
    if (!key || key === 'assembly') return Math.max(6, this.definition.fuselage.length) / Math.min(1, aspect);
    const wing = this.definition[key], p = wing.points;
    const chord = Math.max(p[2].x, p[3].x) - Math.min(p[0].x, p[1].x);
    const horizontal = key === 'verticalTail' ? chord / 2 : p[1].y;
    const vertical = key === 'verticalTail' ? p[1].y / 2 : chord / 2;
    return Math.max(2.3, horizontal / (aspect * (this.width <= 700 ? 0.72 : 0.62)), vertical / (this.width <= 700 ? 0.32 : 0.62));
  }

  updateAircraft(d: AircraftDefinition): void {
    this.definition = d;
    this.aircraftPending = true;
  }

  private applyAircraft(): void {
    if (!this.aircraftPending) return;
    const start = performance.now();
    const d = this.definition;
    this.aircraftPending = false;
    this.editorDirty = true;
    const properties = derive(d);
    this.designCG.copy(properties.cg);
    this.designLiftCenter.copy(properties.liftCenter);
    this.body.position.copy(this.simulation?.telemetry.cg ?? this.designCG).negate();
    for (let i = 0; i < 3; i++) {
      const wing = i === 0 ? d.mainWing : i === 1 ? d.horizontalTail : d.verticalTail;
      const root = i === 0 ? d.assembly.mainWing : i === 1 ? d.assembly.horizontalTail : d.assembly.verticalTail;
      const height = i === 0 ? d.assembly.mainWingHeight : 0.35;
      const incidence = i === 0 ? d.assembly.mainIncidence : i === 1 ? d.assembly.tailIncidence : 0;
      if (!this.wingChanged(i, wing, root, height, incidence)) continue;
      const geometry = this.wingGeometry(wing, root, height, incidence, i === 2);
      if (i === 0) {
        const position = geometry.getAttribute('position');
        const colors = new Float32Array(position.count * 3);
        const span = Math.max(wing.points[1].y, 0.1);
        for (let vertex = 0; vertex < position.count; vertex++) {
          const color = Math.abs(position.getZ(vertex)) > span * 0.82 ? this.wingTipColor : this.wingBaseColor;
          color.toArray(colors, vertex * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      this.metrics.memory += (this.geometryBytes(geometry) - this.geometryBytes(this.wingMeshes[i].geometry)) / 1048576;
      this.wingMeshes[i].geometry.dispose();
      this.wingMeshes[i].geometry = geometry;
    }
    this.beam.scale.y = d.fuselage.length;
    this.nose.position.x = d.fuselage.length / 2 - 0.1;
    this.pilot.position.x = d.cockpit.position;
    const span = Math.max(d.mainWing.points[1].y, 0.1);
    for (let i = 0; i < this.braces.length; i++) {
      this.placeStrut(this.braces[i], this.vector.set(0.1, -0.05, 0),
        this.vector2.set(d.assembly.mainWing - 0.5, d.assembly.mainWingHeight + Math.sin(d.mainWing.dihedral * DEG) * span * 0.44, (i === 0 ? -1 : 1) * span * 0.44), 0.025);
    }
    this.cg.visible = !this.simulation || this.debug;
    if (!this.simulation) {
      this.positionAtLaunch();
      this.aircraft.quaternion.identity();
      this.driver.position.x = 0;
    }
    this.updateCenters();
    const cameraSpan = this.orthographicSpan();
    if (this.editorDrag < 0 && this.orthographic.top !== cameraSpan) {
      const halfWidth = cameraSpan * this.width / this.height;
      this.orthographic.left = -halfWidth;
      this.orthographic.right = halfWidth;
      this.orthographic.top = cameraSpan;
      this.orthographic.bottom = -cameraSpan;
      this.orthographic.updateProjectionMatrix();
    }
    this.metrics.geometryMs = performance.now() - start;
  }

  private wingChanged(index: number, wing: Wing, root: number, height: number, incidence: number): boolean {
    const offset = index * 12;
    let changed = false;
    for (let i = 0; i < 12; i++) {
      const value = i < 8 ? (i % 2 === 0 ? wing.points[i >> 1].x : wing.points[i >> 1].y)
        : i === 8 ? wing.dihedral : i === 9 ? root : i === 10 ? height : incidence;
      if (this.wingParameters[offset + i] !== value) changed = true;
      this.wingParameters[offset + i] = value;
    }
    return changed;
  }

  private buildAircraft(): void {
    const { ivory, main, orange, graphite, skin, suit } = this.aircraftMaterials;
    this.aircraft.add(this.body);
    this.body.add(this.pilot);
    this.pilot.add(this.driver);
    this.wingMeshes.push(this.mesh(new THREE.BufferGeometry(), main, this.body),
      this.mesh(new THREE.BufferGeometry(), ivory, this.body),
      this.mesh(new THREE.BufferGeometry(), orange, this.body));
    this.beam = this.mesh(new THREE.CylinderGeometry(0.085, 0.12, 1, 8), graphite, this.body);
    this.beam.rotation.z = Math.PI / 2;
    this.nose = this.mesh(new THREE.SphereGeometry(0.22, 10, 7), ivory, this.body);
    this.nose.position.set(0, 0.02, 0);
    this.nose.scale.set(1.6, 0.8, 0.75);
    const seat = this.mesh(new THREE.BoxGeometry(0.8, 0.13, 0.52), graphite, this.pilot);
    seat.position.set(-0.08, -0.13, 0);
    const torso = this.mesh(new THREE.CapsuleGeometry(0.2, 0.38, 3, 7), suit, this.driver);
    torso.position.set(-0.1, 0.36, 0);
    torso.rotation.z = 0.22;
    const head = this.mesh(new THREE.SphereGeometry(0.17, 9, 7), skin, this.driver);
    head.position.set(-0.18, 0.86, 0);
    const helmet = this.mesh(new THREE.SphereGeometry(0.18, 9, 7, 0, Math.PI * 2, 0, Math.PI / 2), orange, this.driver);
    helmet.position.copy(head.position);
    for (const side of [-1, 1]) {
      this.placeStrut(this.mesh(this.strutGeometry, suit, this.driver), new THREE.Vector3(0, 0.48, side * 0.18), new THREE.Vector3(0.47, 0.13, side * 0.22), 0.065);
      this.placeStrut(this.mesh(this.strutGeometry, suit, this.driver), new THREE.Vector3(0, 0.03, side * 0.14), new THREE.Vector3(0.62, -0.29, side * 0.16), 0.085);
      this.braces.push(this.mesh(this.strutGeometry, graphite, this.body));
    }
    const skid = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 7), graphite, this.pilot);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(0, -0.45, 0);
  }

  setFlight(sim: FlightSimulation | null): void {
    this.endEditorDrag();
    this.editorDirty = true;
    this.applyAircraft();
    this.simulation = sim;
    this.trailCount = this.trailIndex = 0;
    this.trailClock = 0;
    this.trailGeometry.setDrawRange(0, 0);
    this.splashAge = -1;
    this.wasInWater = false;
    this.splash.visible = this.ring.visible = false;
    this.cg.visible = !sim || this.debug;
    if (sim) {
      this.aircraft.position.copy(sim.position);
      this.aircraft.quaternion.copy(sim.quaternion);
      this.body.position.copy(sim.telemetry.cg).negate();
      this.lastTrail.copy(sim.position);
      this.cameraView('chase');
    } else {
      this.positionAtLaunch();
      this.aircraft.quaternion.identity();
      this.driver.position.x = 0;
      this.body.position.copy(this.designCG).negate();
      for (const arrow of this.arrows) arrow.visible = false;
      for (const marker of this.applicationMarkers) marker.visible = false;
      this.cameraView('orbit');
    }
    this.updateCenters();
  }

  cameraView(name: string): void {
    const names: Record<string, string> = { '俯视': 'top', '侧视': 'side', '正视': 'front', '后视': 'rear', '追尾': 'chase', '侧面': 'flight-side', '驾驶员': 'pilot', '自由': 'free', '自由镜头': 'free', '轨道': 'orbit', '三维': 'orbit', 'perspective': 'orbit', 'cockpit': 'pilot', 'follow': 'chase', 'back': 'rear' };
    this.view = names[name] ?? name;
    if (!this.simulation && this.editorTarget) this.view = this.editorTarget === 'verticalTail' || this.editorTarget === 'assembly' ? 'side' : 'top';
    const orthographic = ['top', 'side', 'front', 'rear'].includes(this.view);
    this.camera = orthographic ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit' || orthographic;
    this.controls.enableRotate = !orthographic;
    this.target.copy(this.aircraft.position);
    if (this.editorTarget && this.editorTarget !== 'assembly' && !this.simulation) {
      const wing = this.definition[this.editorTarget];
      const root = this.definition.assembly[this.editorTarget];
      const centerX = root - (wing.points[0].x + wing.points[1].x + wing.points[2].x + wing.points[3].x) / 4;
      this.target.x += centerX - this.designCG.x;
      this.target.y += this.editorTarget === 'verticalTail' ? 0.35 + wing.points[1].y / 2 - this.designCG.y : 0;
    }
    this.controls.target.copy(this.target);
    const distance = Math.max(17, this.definition.mainWing.points[1].y * 2.4);
    if (this.view === 'top') this.vector.set(0, distance, 0.001);
    else if (this.view === 'side') this.vector.set(0, 0, distance);
    else if (this.view === 'front') this.vector.set(distance, 0, 0);
    else if (this.view === 'rear') this.vector.set(-distance, 0, 0);
    else this.vector.set(19, 12, 22).multiplyScalar(this.width <= 700 ? 1.28 : 1);
    this.camera.up.set(this.view === 'top' ? 1 : 0, this.view === 'top' ? 0 : 1, 0);
    this.camera.position.copy(this.target).add(this.vector);
    this.camera.lookAt(this.target);
    this.orthographic.zoom = 1;
    this.resize();
    this.editorDirty = true;
    this.controls.update();
    this.constrainCamera();
    if (this.simulation && !this.controls.enabled) this.followCamera(1, true);
  }

  setQuality(name: Quality): void {
    this.quality = name;
    if (name !== 'Auto') this.level = name === 'High' ? 2 : name === 'Medium' ? 1 : 0;
    this.slowTime = this.fastTime = this.qualityClock = 0;
    this.applyQuality();
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.debugGroup.visible = enabled;
    this.cg.visible = !this.simulation || enabled;
    this.liftCenter.visible = !this.simulation || enabled;
  }

  render(dt: number): void {
    if (this.disposed) return;
    const start = performance.now();
    this.applyAircraft();
    const seconds = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.elapsed += seconds;
    this.waterTime.value = this.reducedMotion ? 0 : this.elapsed;
    const sim = this.simulation;
    if (sim) {
      this.aircraft.position.copy(sim.position);
      this.aircraft.quaternion.copy(sim.quaternion);
      this.body.position.copy(sim.telemetry.cg).negate();
      this.driver.position.x = (sim.telemetry.cg.x - this.designCG.x) * sim.telemetry.mass / this.definition.pilot.mass;
      this.followCamera(seconds, false);
      this.recordTrail(seconds);
      this.updateDebug();
      const inWater = sim.result?.landing === 'water';
      if (inWater && !this.wasInWater) this.beginSplash(sim.position);
      this.wasInWater = inWater;
    }
    if (this.splashAge >= 0) this.updateSplash(seconds);
    if (this.controls.enabled) this.controls.update();
    this.constrainCamera();
    this.updateCenters();
    this.updateEditorOverlay();
    this.light.target.position.copy(this.aircraft.position);
    this.light.position.copy(this.aircraft.position).add(this.vector.set(-55, 110, 65));
    this.renderer.render(this.scene, this.camera);
    this.metrics.renderMs = performance.now() - start;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.triangles = this.renderer.info.render.triangles;
    this.metrics.geometries = this.renderer.info.memory.geometries;
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.programs = this.renderer.info.programs?.length ?? 0;
    if (dt > 0 && dt < 0.5) {
      this.frameTimes[this.sampleIndex] = dt * 1000;
      this.sampleIndex = (this.sampleIndex + 1) % this.frameTimes.length;
      this.sampleCount = Math.min(this.sampleCount + 1, this.frameTimes.length);
      this.statisticsClock += seconds;
      this.qualityClock += seconds;
      if (this.statisticsClock >= 0.5) this.updateStatistics();
      if (this.quality === 'Auto' && this.qualityClock > 3) this.autoQuality(seconds);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.layoutObserver.disconnect();
    this.controls.dispose();
    this.editorOverlay.remove();
    this.release(this.scene);
    this.light.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.scene.clear();
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private placeStrut(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const length = a.distanceTo(b);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.setFromUnitVectors(UP, this.desiredPosition.copy(b).sub(a).normalize());
  }

  /** 四点平面形沿展向插值；NACA 厚度封口，正安装角使前缘相对后缘抬高。 */
  private wingGeometry(wing: Wing, rootX: number, height: number, incidence: number, vertical: boolean): THREE.BufferGeometry {
    const vertices: number[] = [], indices: number[] = [];
    const chordSteps = 16, spanSteps = 5;
    const profileCount = chordSteps * 2;
    const c = Math.cos(incidence * DEG), s = Math.sin(incidence * DEG);
    const dihedral = Math.tan(wing.dihedral * DEG);
    const sides = vertical ? [1] : [-1, 1];
    for (const side of sides) {
      const offset = vertices.length / 3;
      for (let row = 0; row <= spanSteps; row++) {
        const t = row / spanSteps;
        const leading = THREE.MathUtils.lerp(wing.points[0].x, wing.points[1].x, t);
        const trailing = THREE.MathUtils.lerp(wing.points[3].x, wing.points[2].x, t);
        const span = THREE.MathUtils.lerp(wing.points[0].y, wing.points[1].y, t);
        const chord = trailing - leading;
        for (let k = 0; k < profileCount; k++) {
          const upper = k <= chordSteps;
          const j = upper ? k : profileCount - k;
          const u = (1 - Math.cos(j / chordSteps * Math.PI)) / 2;
          const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
          const camber = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u);
          const x = -leading - u * chord;
          const y = camber + (upper ? thickness : -thickness);
          if (vertical) vertices.push(rootX + x, height + span, y);
          else vertices.push(rootX + x * c - y * s, height + x * s + y * c + span * dihedral, span * side);
        }
      }
      for (let row = 0; row < spanSteps; row++) {
        for (let k = 0; k < profileCount; k++) {
          const a = offset + row * profileCount + k, b = offset + row * profileCount + (k + 1) % profileCount;
          if (vertical || side < 0) indices.push(a, b + profileCount, b, a, a + profileCount, b + profileCount);
          else indices.push(a, b, b + profileCount, a, b + profileCount, a + profileCount);
        }
      }
      for (const row of [0, spanSteps]) {
        const base = offset + row * profileCount;
        for (let k = 1; k < profileCount - 1; k++) {
          const reverse = (row === 0) !== (vertical || side < 0);
          if (reverse) indices.push(base, base + k, base + k + 1);
          else indices.push(base, base + k + 1, base + k);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private buildEnvironment(): void {
    const water = new THREE.MeshStandardMaterial({ color: 0x7bada6, roughness: 0.35, metalness: 0.24, flatShading: true });
    water.onBeforeCompile = shader => {
      shader.uniforms.lakeTime = this.waterTime;
      shader.vertexShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nlakePosition = position;');
      shader.fragmentShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat wave = sin(lakePosition.x * 0.2 + lakePosition.y * 0.48 + lakeTime * 0.42) * sin(lakePosition.y * 0.17 - lakeTime * 0.3);\ndiffuseColor.rgb *= 1.0 + wave * 0.045;');
    };
    const lake = this.mesh(new THREE.PlaneGeometry(2400, 2000), water, this.scene);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(700, -0.035, 0);
    lake.castShadow = false;
    this.terrain.push(lake);
    const ground = new THREE.MeshStandardMaterial({ color: 0x9caa81, roughness: 1, flatShading: true });
    const bank = this.mesh(new THREE.BoxGeometry(115, 10, 180), ground, this.scene);
    bank.position.set(-75, 3, 0);
    this.terrain.push(bank);
    const cliff = new THREE.MeshStandardMaterial({ color: 0xb7b59b, roughness: 1, flatShading: true });
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const z = -100 + i * 6.7;
      const edge = -18 + Math.sin(i * 1.8) * 3;
      vertices.push(edge, 8, z, edge + 9 + Math.sin(i * 2.1) * 2, 0, z);
      if (i < 30) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const cliffGeometry = new THREE.BufferGeometry();
    cliffGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    cliffGeometry.setIndex(indices);
    cliffGeometry.computeVertexNormals();
    const cliffMaterial = cliff.clone(); cliffMaterial.side = THREE.DoubleSide;
    this.terrain.push(this.mesh(cliffGeometry, cliffMaterial, this.scene));
    const concrete = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.95, flatShading: true });
    const platform = this.mesh(new THREE.BoxGeometry(20, 0.6, 13), concrete, this.scene);
    platform.position.set(-10, 9.7, 0);
    this.terrain.push(platform);
    const supportGeometry = new THREE.BoxGeometry(0.5, 9.2, 0.5);
    for (const x of [-2, -9, -16]) for (const z of [-5.4, 5.4]) {
      const support = this.mesh(supportGeometry, cliff, this.scene);
      support.position.set(x, 4.6, z);
    }
    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf8edce });
    const stripeGeometry = new THREE.PlaneGeometry(0.6, 0.12);
    for (let x = -19; x < 0; x += 1.6) {
      const stripe = this.mesh(stripeGeometry, stripeMaterial, this.scene);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 10.015, 0);
    }
    const edgeGeometry = new THREE.BoxGeometry(20, 0.08, 0.09);
    for (const z of [-6.2, 6.2]) {
      const edge = this.mesh(edgeGeometry, stripeMaterial, this.scene);
      edge.position.set(-10, 10.05, z);
    }
    const sign = this.label('起飞平台 · 10 m', '#37483e', '#f5eedb', 384, 80);
    sign.position.set(-7, 8.7, 6.65);
    sign.scale.set(7.2, 1.5, 1);
    this.scene.add(sign);
    const mountainMaterials = [0xa4b7a7, 0x8ba89c, 0xb2bfae, 0x7f9e92].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
    const mountainGeometry = new THREE.ConeGeometry(1, 1, 5, 1);
    for (let i = 0; i < 38; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = -220 + Math.floor(i / 2) * 87;
      const height = 45 + (Math.sin(i * 9.31) * 0.5 + 0.5) * 115;
      const mountain = this.mesh(mountainGeometry, mountainMaterials[i % 4], this.scene);
      mountain.position.set(x, height / 2 - 5, side * (370 + Math.sin(i * 2.7) * 65));
      mountain.scale.set(95 + (i % 4) * 18, height, 90 + (i % 3) * 24);
      mountain.rotation.y = i * 1.7;
      mountain.castShadow = false;
      this.terrain.push(mountain);
    }
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6d7960, roughness: 1 });
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x617c62, roughness: 1, flatShading: true });
    const treeGeometry = new THREE.ConeGeometry(1, 3.4, 5);
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 2, 5);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 48);
    const trees = new THREE.InstancedMesh(treeGeometry, leavesMaterial, 48);
    trunks.castShadow = trees.castShadow = true;
    trunks.receiveShadow = trees.receiveShadow = true;
    this.detail.add(trunks, trees);
    const instance = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const x = -27 - (i % 8) * 11 + Math.sin(i * 7.2) * 3;
      const z = (i < 24 ? -1 : 1) * (15 + Math.floor((i % 24) / 8) * 22 + Math.sin(i * 2.2) * 8);
      const scale = 0.8 + (Math.sin(i * 8.2) + 1) * 0.8;
      instance.position.set(x, 8.8, z);
      instance.scale.setScalar(1);
      instance.updateMatrix();
      trunks.setMatrixAt(i, instance.matrix);
      instance.position.set(x, 10 + scale * 1.1, z);
      instance.scale.setScalar(scale);
      instance.updateMatrix();
      trees.setMatrixAt(i, instance.matrix);
    }
    const buoyMaterial = new THREE.MeshStandardMaterial({ color: 0xe6aa65, roughness: 0.7, flatShading: true });
    const buoyGeometry = new THREE.ConeGeometry(0.48, 1.3, 6);
    for (let distance = 50; distance <= 700; distance += 50) {
      const buoy = this.mesh(buoyGeometry, buoyMaterial, this.scene);
      buoy.position.set(distance, 0.45, -15);
      buoy.castShadow = false;
      const label = this.label(`${distance} m`, '#f7f1dc', '#49665c', 192, 80);
      label.position.set(distance, 3, -15);
      label.scale.set(5.2, 2.15, 1);
      this.scene.add(label);
    }
    this.scene.add(this.cg, this.liftCenter);
    this.scene.updateMatrixWorld(true);
  }

  private label(text: string, color: string, background: string, width: number, height: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = '500 36px system-ui, sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2, width - 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: false, depthWrite: false }));
  }

  private resize(): void {
    const previousWidth = this.width, previousHeight = this.height;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    const aspect = this.width / this.height;
    this.editorDirty = true;
    this.perspective.aspect = aspect;
    const span = this.orthographicSpan();
    this.orthographic.left = -span * aspect;
    this.orthographic.right = span * aspect;
    this.orthographic.top = span;
    this.orthographic.bottom = -span;
    this.perspective.clearViewOffset();
    this.orthographic.clearViewOffset();
    if (!this.simulation) {
      const parent = this.host.parentElement;
      const editor = parent?.querySelector('.editor');
      const welcome = parent?.querySelector('.welcome');
      // 非对称视锥让飞机避开面板，不改变轨道中心或物理坐标。
      const offsetX = this.width > 700 && (editor || welcome) ? -Math.min(welcome ? 225 : 190, this.width * 0.19) : 0;
      const offsetY = this.width <= 700 ? editor ? this.height * 0.23 : welcome ? -this.height * 0.17 : 0 : 0;
      this.perspective.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
      this.orthographic.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
    }
    this.perspective.updateProjectionMatrix();
    this.orthographic.updateProjectionMatrix();
    if (this.width !== previousWidth || this.height !== previousHeight) this.renderer.setSize(this.width, this.height, false);
  }

  private followCamera(dt: number, immediate: boolean): void {
    if (this.controls.enabled) return;
    const sim = this.simulation;
    if (!sim) return;
    const pilot = this.view === 'pilot';
    if (pilot) {
      this.desiredPosition.set(this.definition.cockpit.position + this.driver.position.x + 0.15, 0.95, 0);
      this.desiredTarget.set(35, 0.6, 0);
    } else if (this.view === 'flight-side' || this.view === 'side-flight') {
      this.desiredPosition.set(-3, 4, 23);
      this.desiredTarget.set(3, 0.3, 0);
    } else {
      this.desiredPosition.set(-19, 7, 5);
      this.desiredTarget.set(7, 0.8, 0);
    }
    this.desiredPosition.sub(sim.telemetry.cg);
    this.desiredTarget.sub(sim.telemetry.cg);
    this.desiredPosition.applyQuaternion(sim.quaternion).add(sim.position);
    this.desiredTarget.applyQuaternion(sim.quaternion).add(sim.position);
    this.desiredPosition.y = Math.max(0.45, this.desiredPosition.y);
    const blend = immediate || pilot || this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.target.lerp(this.desiredTarget, blend);
    this.camera.up.copy(pilot ? this.vector.copy(UP).applyQuaternion(sim.quaternion) : UP);
    this.camera.lookAt(this.target);
  }

  private recordTrail(dt: number): void {
    const sim = this.simulation;
    if (!sim) return;
    this.trailClock += dt;
    if (this.trailClock < 0.1 || this.lastTrail.distanceToSquared(sim.position) < 0.025) return;
    this.trailClock = 0;
    const i = this.trailIndex * 6;
    this.lastTrail.toArray(this.trailArray, i);
    sim.position.toArray(this.trailArray, i + 3);
    this.lastTrail.copy(sim.position);
    this.trailIndex = (this.trailIndex + 1) % TRAIL_CAPACITY;
    this.trailCount = Math.min(TRAIL_CAPACITY, this.trailCount + 1);
    this.trailGeometry.setDrawRange(0, this.trailCount * 2);
    const attribute = this.trailGeometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.clearUpdateRanges(); attribute.addUpdateRange(i, 6); attribute.needsUpdate = true;
  }

  private updateDebug(): void {
    this.cg.visible = this.debug;
    if (!this.debug || !this.simulation) return;
    const sim = this.simulation;
    this.cg.position.copy(sim.position);
    this.vector.copy(sim.telemetry.force).sub(sim.telemetry.drag);
    this.setArrow(this.arrows[0], sim.position, this.vector, 0.005);
    this.setArrow(this.arrows[1], sim.position, sim.telemetry.drag, 0.008);
    this.vector.set(0, -9.81 * sim.telemetry.mass, 0);
    this.setArrow(this.arrows[2], sim.position, this.vector, 0.005);
    this.setArrow(this.arrows[3], sim.position, sim.velocity, 0.3);
    for (let i = 0; i < this.applicationMarkers.length; i++) {
      const surface = sim.surfaces[i];
      const marker = this.applicationMarkers[i];
      marker.visible = !!surface;
      if (surface) {
        marker.position.copy(surface.point).sub(sim.telemetry.cg).applyQuaternion(sim.quaternion).add(sim.position);
        if (i + 4 < this.arrows.length) this.setArrow(this.arrows[i + 4], marker.position, surface.force, 0.007);
      }
    }
  }

  private setArrow(arrow: THREE.ArrowHelper, origin: THREE.Vector3, force: THREE.Vector3, scale: number): void {
    const length = force.length() * scale;
    arrow.visible = length > 0.001;
    if (!arrow.visible) return;
    arrow.position.copy(origin);
    arrow.setDirection(this.vector2.copy(force).normalize());
    const visibleLength = Math.min(18, length);
    arrow.setLength(visibleLength, Math.min(0.5, visibleLength * 0.22), Math.min(0.25, visibleLength * 0.1));
  }

  private beginSplash(position: THREE.Vector3): void {
    this.splashAge = 0;
    this.splash.visible = this.ring.visible = true;
    this.ring.position.set(position.x, 0.035, position.z);
    for (let i = 0; i < PARTICLES; i++) {
      const index = i * 3, angle = i * 2.399963;
      const speed = 1.4 + (i % 7) * 0.4;
      this.splashPositions[index] = position.x;
      this.splashPositions[index + 1] = 0.08;
      this.splashPositions[index + 2] = position.z;
      this.splashVelocities[index] = Math.cos(angle) * speed;
      this.splashVelocities[index + 1] = 2 + (i % 9) * 0.5;
      this.splashVelocities[index + 2] = Math.sin(angle) * speed;
    }
    this.splashGeometry.getAttribute('position').needsUpdate = true;
  }

  private updateSplash(dt: number): void {
    this.splashAge += dt;
    if (this.splashAge > 2.5) {
      this.splashAge = -1;
      this.splash.visible = this.ring.visible = false;
      return;
    }
    const fade = Math.max(0, 1 - this.splashAge / 2.5);
    this.splash.material.opacity = fade * 0.85;
    this.ring.material.opacity = fade * 0.55;
    this.ring.scale.setScalar(1 + this.splashAge * 3.7);
    for (let i = 0; i < PARTICLES; i++) {
      const index = i * 3;
      this.splashVelocities[index + 1] -= 9.81 * dt;
      this.splashPositions[index] += this.splashVelocities[index] * dt;
      this.splashPositions[index + 1] = Math.max(0.015, this.splashPositions[index + 1] + this.splashVelocities[index + 1] * dt);
      this.splashPositions[index + 2] += this.splashVelocities[index + 2] * dt;
    }
    this.splashGeometry.getAttribute('position').needsUpdate = true;
  }

  private updateStatistics(): void {
    this.statisticsClock = 0;
    let sum = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      const value = this.frameTimes[i];
      sum += value; this.sortedTimes[i] = value;
    }
    // 原地插入排序，固定 180 帧窗口，不创建临时数组或每帧排序。
    for (let i = 1; i < this.sampleCount; i++) {
      const value = this.sortedTimes[i]; let j = i - 1;
      while (j >= 0 && this.sortedTimes[j] > value) { this.sortedTimes[j + 1] = this.sortedTimes[j]; j--; }
      this.sortedTimes[j + 1] = value;
    }
    this.metrics.mean = sum / this.sampleCount;
    this.metrics.fps = 1000 / this.metrics.mean;
    this.metrics.p95 = this.sortedTimes[Math.max(0, Math.ceil(this.sampleCount * 0.95) - 1)];
    this.metrics.p99 = this.sortedTimes[Math.max(0, Math.ceil(this.sampleCount * 0.99) - 1)];
  }

  private autoQuality(dt: number): void {
    const slow = this.metrics.p95 > 27 || this.metrics.mean > 23;
    const fast = this.metrics.p95 < 18.7 && this.metrics.mean < 17.6;
    this.slowTime = slow ? this.slowTime + dt : 0;
    this.fastTime = fast ? this.fastTime + dt : 0;
    const maximum = this.coarsePointer ? 1 : 2;
    if ((this.slowTime > 2.5 && this.level > 0) || (this.fastTime > 10 && this.level < maximum)) {
      this.level += this.slowTime > 2.5 ? -1 : 1;
      this.slowTime = this.fastTime = this.qualityClock = 0;
      this.applyQuality();
    }
  }

  private applyQuality(): void {
    const ratios = [1, 1.5, 2];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, ratios[this.level]);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    // 所有画质都保留飞机投影；自动档不切换阴影着色器。
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.enabled = true;
    const shadowSize = this.quality === 'Auto' ? 1024 : this.level === 2 ? 2048 : this.level === 1 ? 1024 : 512;
    if (this.light.shadow.mapSize.x !== shadowSize) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(shadowSize, shadowSize);
    }
    this.detail.visible = this.level > 0;
    this.metrics.quality = ['Low', 'Medium', 'High'][this.level];
  }

  private geometryBytes(geometry: THREE.BufferGeometry): number {
    let bytes = geometry.index?.array.byteLength ?? 0;
    for (const name in geometry.attributes) bytes += geometry.attributes[name].array.byteLength;
    return bytes;
  }

  private geometryMemory(): number {
    let bytes = 0;
    // 顶点、索引、实例矩阵和纹理的 MiB 估算；不冒充浏览器进程或驱动总内存。
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.InstancedMesh) bytes += object.instanceMatrix.array.byteLength;
      if (mesh.geometry && !geometries.has(mesh.geometry)) {
        geometries.add(mesh.geometry);
        for (const attribute of Object.values(mesh.geometry.attributes)) bytes += attribute.array.byteLength;
        bytes += mesh.geometry.index?.array.byteLength ?? 0;
      }
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const texture = (material as THREE.MeshBasicMaterial).map;
          if (texture && !textures.has(texture)) { textures.add(texture); bytes += (texture.image?.width ?? 0) * (texture.image?.height ?? 0) * 4; }
        }
      }
    });
    return bytes / 1048576;
  }

  private release(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          const map = (material as THREE.MeshBasicMaterial).map;
          if (map) textures.add(map);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }
}
