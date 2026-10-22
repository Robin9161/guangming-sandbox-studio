import * as THREE from "three/webgpu";

/**
 * 地图式镜头控制（照高德 / Google 地图的习惯），鼠标和触控板都要顺手：
 *
 * | 操作 | 鼠标 | 触控板 | 触屏 |
 * |---|---|---|---|
 * | 平移 | 左键拖动（抓住的地面点始终在鼠标下） | 双指滑动 | 单指拖动 |
 * | 缩放（朝鼠标 / 手指所在的位置） | 滚轮 | 双指捏合 | 双指捏合 |
 * | 转向、调俯角 | 右键拖动，或按住 Ctrl / ⌘ / Shift 左键拖动 | 按住 Shift 双指滑动；Safari 下双指旋转也能转向 | 双指旋转、双指上下拖 |
 * | 飞近 | 双击 | 双击 | — |
 * | 键盘 | 方向键平移、+ / - 缩放、N 回到北在上 |
 *
 * 浏览器里触控板的双指滑动、捏合都变成 wheel 事件：带 Ctrl 的是捏合；有横向分量、带小数、连续的是双指滑动；
 * 一格一格的大整数是鼠标滚轮。见 wheelKind()。
 *
 * 平滑：输入不直接改镜头，而是攒成"还要缩放多少、还要转多少"，每帧追上一部分（指数缓动），既跟手又没有顿挫；
 * 拖动平移是直接跟手的，松手后只有很短的惯性。
 * 每帧先从镜头当前的位置反推，所以讲解飞行、时间线、写入视角等外部对镜头的改动都照常生效。
 *
 * 约束（规范：北在上、不大角度旋转）：转向只能在正北 ±35° 以内；俯角 10°–85°；焦点不能拖出 limits 范围。
 * 这些约束只限制用户输入，不限制讲解和时间线。
 *
 * 对外接口和 OrbitControls 用到的部分一致：target、enabled、autoRotate、autoRotateSpeed、update()、"start" 事件、dispose()。
 */

const DEG = Math.PI / 180;
const MAX_AZIMUTH = 35 * DEG;
const MIN_ELEVATION = 10 * DEG;
const MAX_ELEVATION = 85 * DEG;
/** 缩放、转向每秒追上的比例（越大越跟手） */
const EASE_RATE = 22;
/** 松手后惯性衰减的时间常数（秒）：短，停得快 */
const INERTIA_TAU = 0.1;

type WheelKind = "mouse" | "trackpad";

export class MapControls extends THREE.EventDispatcher<{ start: object; change: object }> {
  readonly target = new THREE.Vector3();
  enabled = true;
  minDistance = 500;
  maxDistance = 90000;
  autoRotate = false;
  autoRotateSpeed = 0.35;
  /** 焦点允许的范围（世界坐标 xz），null = 不限 */
  limits: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly dom: HTMLElement;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  // 攒着还没走完的缩放（对数）、转向、俯角，以及缩放的锚点
  private zoomLeft = 0;
  private readonly zoomAnchor = new THREE.Vector3();
  private azimuthLeft = 0;
  private elevationLeft = 0;
  // 平移惯性（米 / 秒）
  private readonly velocity = new THREE.Vector3();
  private lastTime = performance.now();
  // 指针
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: "none" | "pan" | "rotate" | "touch" = "none";
  private readonly panAnchor = new THREE.Vector3();
  private lastMove = 0;
  /** 最近一小段拖动的位移（算松手速度用） */
  private samples: { t: number; d: THREE.Vector3 }[] = [];
  private touchStart: { dist: number; angle: number; mid: { x: number; y: number } } | null = null;
  // 滚轮来源判断：触控板的事件是一串连着的，记住最近一次的判断
  private lastWheel = { kind: "mouse" as WheelKind, time: 0 };
  private gestureRotation = 0;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    super();
    this.camera = camera;
    this.dom = dom;
    dom.style.touchAction = "none";
    dom.addEventListener("pointerdown", this.onPointerDown);
    dom.addEventListener("pointermove", this.onPointerMove);
    dom.addEventListener("pointerup", this.onPointerUp);
    dom.addEventListener("pointercancel", this.onPointerUp);
    dom.addEventListener("wheel", this.onWheel, { passive: false });
    dom.addEventListener("dblclick", this.onDoubleClick);
    dom.addEventListener("contextmenu", this.onContextMenu);
    // Safari 的触控板手势（双指旋转）；其他浏览器没有这些事件，不影响
    dom.addEventListener("gesturestart", this.onGestureStart as EventListener);
    dom.addEventListener("gesturechange", this.onGestureChange as EventListener);
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** 正在被用户操作（拖动中，或缩放 / 转向 / 惯性还没走完） */
  isMoving() {
    return this.mode !== "none" || Math.abs(this.zoomLeft) > 1e-3 || Math.abs(this.azimuthLeft) > 1e-4 || Math.abs(this.elevationLeft) > 1e-4 || this.velocity.lengthSq() > 1;
  }

  /** 每帧调用：把攒着的缩放、转向、惯性追上一部分，写进镜头 */
  update() {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    const k = 1 - Math.exp(-dt * EASE_RATE);

    // 缩放：以锚点为中心整体缩放镜头（锚点在画面上的位置不变）
    if (Math.abs(this.zoomLeft) > 1e-4) {
      const step = this.zoomLeft * k;
      this.zoomLeft -= step;
      const distance = this.camera.position.distanceTo(this.target);
      const f = THREE.MathUtils.clamp(distance * Math.exp(step), this.minDistance, this.maxDistance) / distance;
      if (Math.abs(f - 1) > 1e-6) {
        const before = this.target.clone();
        this.target.sub(this.zoomAnchor).multiplyScalar(f).add(this.zoomAnchor);
        this.camera.position.sub(this.zoomAnchor).multiplyScalar(f).add(this.zoomAnchor);
        this.clampTarget(before);
      } else this.zoomLeft = 0; // 到了最近 / 最远，剩下的不要了
    } else this.zoomLeft = 0;

    // 转向、俯角：绕焦点转
    let dAz = 0, dEl = 0;
    if (Math.abs(this.azimuthLeft) > 1e-5) { dAz = this.azimuthLeft * k; this.azimuthLeft -= dAz; } else this.azimuthLeft = 0;
    if (Math.abs(this.elevationLeft) > 1e-5) { dEl = this.elevationLeft * k; this.elevationLeft -= dEl; } else this.elevationLeft = 0;
    if (this.autoRotate) dAz += (this.autoRotateSpeed * 2 * Math.PI / 60) * dt; // 和 OrbitControls 的速度单位一致（讲解自动演示用，不受 ±35° 限制）
    if (dAz || dEl) this.orbit(dAz, dEl, !this.autoRotate);

    // 平移惯性（拖动中不算）
    if (this.mode === "none" && this.velocity.lengthSq() > 1) {
      this.shift(this.velocity.clone().multiplyScalar(dt));
      this.velocity.multiplyScalar(Math.exp(-dt / INERTIA_TAU));
    } else if (this.mode === "none") this.velocity.set(0, 0, 0);

    this.camera.lookAt(this.target);
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener("pointerdown", this.onPointerDown);
    d.removeEventListener("pointermove", this.onPointerMove);
    d.removeEventListener("pointerup", this.onPointerUp);
    d.removeEventListener("pointercancel", this.onPointerUp);
    d.removeEventListener("wheel", this.onWheel);
    d.removeEventListener("dblclick", this.onDoubleClick);
    d.removeEventListener("contextmenu", this.onContextMenu);
    d.removeEventListener("gesturestart", this.onGestureStart as EventListener);
    d.removeEventListener("gesturechange", this.onGestureChange as EventListener);
    window.removeEventListener("keydown", this.onKeyDown);
  }

  // ---------- 镜头运算 ----------

  /** 屏幕上一点（相对画布的像素）对应的地面点（焦点高度的水平面）；看向天空时返回 null */
  private groundAt(x: number, y: number, out = new THREE.Vector3()) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    // 镜头刚被挪过（拖动中每次移动都会挪），矩阵要先更新，否则按上一帧的位置算，拖着拖着就漂了
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, this.camera);
    this.plane.constant = -this.target.y;
    const hit = this.raycaster.ray.intersectPlane(this.plane, out);
    // 太远（接近地平线）的交点不可靠：限制在镜头距离的 6 倍以内
    if (!hit || hit.distanceTo(this.camera.position) > this.camera.position.distanceTo(this.target) * 6) return null;
    return hit;
  }

  /** 平移焦点和镜头（只在水平面上） */
  private shift(delta: THREE.Vector3) {
    delta.y = 0;
    const before = this.target.clone();
    this.target.add(delta);
    this.camera.position.add(delta);
    this.clampTarget(before); // 超出范围时，焦点和镜头一起退回
  }

  /** 焦点不出 limits；讲解飞到全深圳时焦点本来就在外面，这时只是不许再往外走（不会把镜头拽回来） */
  private clampTarget(before: THREE.Vector3) {
    const l = this.limits;
    if (!l) return;
    const axis = (v: number, was: number, lo: number, hi: number) => (v > hi ? Math.min(v, Math.max(was, hi)) : v < lo ? Math.max(v, Math.min(was, lo)) : v);
    const x = axis(this.target.x, before.x, l.minX, l.maxX), z = axis(this.target.z, before.z, l.minZ, l.maxZ);
    if (x === this.target.x && z === this.target.z) return;
    this.camera.position.x += x - this.target.x;
    this.camera.position.z += z - this.target.z;
    this.target.x = x;
    this.target.z = z;
    this.velocity.set(0, 0, 0);
  }

  /** 绕焦点转：方位 0 = 镜头在焦点南边、朝北看（北在上）。limit：只在 ±35° 以内（已经在外面时只许往回转） */
  private orbit(dAz: number, dEl: number, limit: boolean) {
    const offset = this.camera.position.clone().sub(this.target);
    const distance = offset.length();
    let az = Math.atan2(offset.x, offset.z);
    let el = Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    if (limit) {
      const next = az + dAz;
      if (Math.abs(next) <= MAX_AZIMUTH || Math.abs(next) < Math.abs(az)) az = Math.abs(next) > MAX_AZIMUTH && Math.abs(az) <= MAX_AZIMUTH ? Math.sign(next) * MAX_AZIMUTH : next;
      const nextEl = el + dEl;
      el = nextEl > MAX_ELEVATION ? Math.max(el, MAX_ELEVATION) : nextEl < MIN_ELEVATION ? Math.min(el, MIN_ELEVATION) : nextEl;
    } else { az += dAz; el += dEl; }
    this.camera.position.set(
      this.target.x + Math.sin(az) * Math.cos(el) * distance,
      this.target.y + Math.sin(el) * distance,
      this.target.z + Math.cos(az) * Math.cos(el) * distance,
    );
  }

  /** 朝屏幕上的某点缩放：amount 为对数（负数 = 拉近） */
  private zoomAt(x: number, y: number, amount: number) {
    const hit = this.groundAt(x, y);
    this.zoomAnchor.copy(hit ?? this.target);
    this.zoomLeft += amount;
  }

  private local(e: { clientX: number; clientY: number }) {
    const rect = this.dom.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private begin() {
    this.dispatchEvent({ type: "start" });
  }

  // ---------- 指针（鼠标、触屏） ----------

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    try { this.dom.setPointerCapture(e.pointerId); } catch { /* 合成事件等情况下拿不到，不影响拖动 */ }
    this.pointers.set(e.pointerId, this.local(e));
    this.velocity.set(0, 0, 0);
    this.begin();
    if (e.pointerType === "touch" && this.pointers.size === 2) { this.mode = "touch"; this.touchStart = this.touchState(); return; }
    if (this.pointers.size > 1) return;
    const rotate = e.button === 2 || e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey;
    this.mode = rotate ? "rotate" : "pan";
    if (this.mode === "pan") {
      const p = this.local(e);
      const hit = this.groundAt(p.x, p.y);
      if (hit) this.panAnchor.copy(hit); else this.mode = "rotate"; // 点在天空上：拖不动地面，改成转向
    }
    this.lastMove = performance.now();
  };

  private onPointerMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.enabled) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const now = performance.now();
    this.lastMove = now;
    if (this.mode === "pan") {
      // 抓住的地面点始终在鼠标下：把镜头挪过去，让 panAnchor 回到现在鼠标下的位置
      const hit = this.groundAt(p.x, p.y);
      if (!hit) return;
      const delta = this.panAnchor.clone().sub(hit).setY(0);
      this.shift(delta.clone());
      this.samples.push({ t: now, d: delta });
      this.camera.lookAt(this.target);
    } else if (this.mode === "rotate") {
      const h = this.dom.clientHeight || 1;
      this.azimuthLeft -= ((p.x - prev.x) / h) * Math.PI * 0.9;
      this.elevationLeft += ((p.y - prev.y) / h) * Math.PI * 0.6;
    } else if (this.mode === "touch" && this.touchStart) {
      const now2 = this.touchState();
      if (!now2) return;
      // 捏合缩放、双指旋转转向、双指一起上下拖调俯角、双指一起挪动平移
      this.zoomAt(now2.mid.x, now2.mid.y, Math.log(this.touchStart.dist / now2.dist));
      this.azimuthLeft -= now2.angle - this.touchStart.angle;
      const h = this.dom.clientHeight || 1;
      this.elevationLeft += ((now2.mid.y - this.touchStart.mid.y) / h) * Math.PI * 0.4;
      this.touchStart = now2;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    try { if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId); } catch { /* 同上 */ }
    // 松手速度 = 最后 60 毫秒的平均位移速度（事件可能挤在同一毫秒，不能逐个相除）；停顿一会儿再松手的不带惯性
    const now = performance.now();
    if (this.mode === "pan" && now - this.lastMove < 80) {
      const recent = this.samples.filter((x) => now - x.t < 60);
      const span = Math.max(0.03, recent.length ? (now - recent[0].t) / 1000 : 0.03);
      this.velocity.set(0, 0, 0);
      for (const x of recent) this.velocity.add(x.d);
      this.velocity.divideScalar(span);
      // 速度上限 = 每秒 0.6 个镜头距离：松手后最多再滑约 6% 的镜头距离，一甩不会甩出好几公里
      const max = this.camera.position.distanceTo(this.target) * 0.6;
      if (this.velocity.length() > max) this.velocity.setLength(max);
    } else this.velocity.set(0, 0, 0);
    this.samples = [];
    if (this.pointers.size === 0) { this.mode = "none"; this.touchStart = null; }
    else if (this.mode === "touch") {
      // 两指剩一指：接着平移
      const [p] = [...this.pointers.values()];
      const hit = this.groundAt(p.x, p.y);
      this.mode = hit ? "pan" : "none";
      if (hit) this.panAnchor.copy(hit);
      this.velocity.set(0, 0, 0);
    }
  };

  private touchState() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  // ---------- 滚轮 / 触控板 ----------

  /** 判断这次滚轮事件来自鼠标还是触控板（见文件开头） */
  private wheelKind(e: WheelEvent): WheelKind {
    const now = performance.now();
    let kind: WheelKind;
    const recent = now - this.lastWheel.time < 120;
    // 非标准的 wheelDeltaY（Chrome、Safari 有）：鼠标滚轮一格是 120 的整数倍；Mac 上有的鼠标 deltaY 带小数，单看 deltaY 会误判成触控板
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0;
    if (e.deltaMode !== 0) kind = "mouse"; // 按行 / 页滚动的只有鼠标（Firefox）
    else if (e.deltaX !== 0) kind = "trackpad"; // 鼠标滚轮没有横向分量
    else if (recent && this.lastWheel.kind === "trackpad") kind = "trackpad"; // 触控板的事件一来一串，中间不换
    else if (legacy !== 0 && legacy % 120 === 0) kind = "mouse";
    else if (!Number.isInteger(e.deltaY)) kind = "trackpad";
    else if (Math.abs(e.deltaY) >= 50) kind = "mouse";
    else kind = recent ? this.lastWheel.kind : "trackpad";
    this.lastWheel = { kind, time: now };
    return kind;
  }

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.begin();
    this.velocity.set(0, 0, 0);
    const p = this.local(e);
    const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1; // 行 / 页换算成像素
    const dx = e.deltaX * scale, dy = e.deltaY * scale;
    if (e.ctrlKey) {
      // 触控板捏合（浏览器把它报成带 Ctrl 的滚轮）：连续、按比例缩放
      this.zoomAt(p.x, p.y, dy * 0.022);
      return;
    }
    const kind = this.wheelKind(e);
    if (kind === "mouse") {
      // 鼠标滚轮：一格约缩放 22%，平滑过渡。格数优先按 wheelDeltaY（一格 120）算，各种鼠标手感一致；没有时按约 100 像素一格
      const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0;
      const ticks = legacy !== 0 && legacy % 120 === 0 ? Math.abs(legacy) / 120 : Math.min(Math.abs(dy), 300) / 100;
      this.zoomAt(p.x, p.y, Math.sign(dy) * Math.min(ticks, 3) * 0.25);
      return;
    }
    if (e.shiftKey || e.altKey) {
      // 按住 Shift / Option 双指滑动：转向、调俯角（Shift 时有的浏览器把竖向滚动换成横向，两个分量一起用）
      const h = this.dom.clientHeight || 1;
      this.azimuthLeft -= (dx / h) * Math.PI * 0.6;
      this.elevationLeft -= (dy / h) * Math.PI * 0.4;
      return;
    }
    // 触控板双指滑动：平移地图（地图跟着手指走），直接跟手
    const from = this.groundAt(p.x, p.y);
    const to = this.groundAt(p.x - dx, p.y - dy);
    if (from && to) this.shift(from.sub(to)); // 让原来手指下的地面点移到手指滑过去的位置
    else {
      // 鼠标指在天边：按镜头距离估一个换算
      const mpp = (2 * this.camera.position.distanceTo(this.target) * Math.tan((this.camera.fov * DEG) / 2)) / (this.dom.clientHeight || 1);
      const az = Math.atan2(this.camera.position.x - this.target.x, this.camera.position.z - this.target.z);
      const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), forward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
      this.shift(right.multiplyScalar(dx * mpp).add(forward.multiplyScalar(-dy * mpp)));
    }
    this.camera.lookAt(this.target);
  };

  // ---------- 其他 ----------

  private onDoubleClick = (e: MouseEvent) => {
    if (!this.enabled) return;
    this.begin();
    const p = this.local(e);
    this.zoomAt(p.x, p.y, Math.log(0.55)); // 飞近：朝双击的位置拉近到约一半距离
  };

  private onContextMenu = (e: Event) => e.preventDefault(); // 右键用来转向，不弹菜单

  private onGestureStart = (e: Event) => { e.preventDefault(); this.gestureRotation = 0; };
  private onGestureChange = (e: Event & { rotation?: number }) => {
    if (!this.enabled) return;
    e.preventDefault();
    const r = e.rotation ?? 0;
    this.azimuthLeft -= (r - this.gestureRotation) * DEG;
    this.gestureRotation = r;
    this.begin();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    const distance = this.camera.position.distanceTo(this.target);
    const az = Math.atan2(this.camera.position.x - this.target.x, this.camera.position.z - this.target.z);
    const step = distance * 0.15;
    const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)), forward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const moves: Record<string, () => void> = {
      ArrowLeft: () => this.velocity.copy(right).multiplyScalar(-step / INERTIA_TAU),
      ArrowRight: () => this.velocity.copy(right).multiplyScalar(step / INERTIA_TAU),
      ArrowUp: () => this.velocity.copy(forward).multiplyScalar(step / INERTIA_TAU),
      ArrowDown: () => this.velocity.copy(forward).multiplyScalar(-step / INERTIA_TAU),
      "=": () => { this.zoomAnchor.copy(this.target); this.zoomLeft += Math.log(0.6); },
      "+": () => { this.zoomAnchor.copy(this.target); this.zoomLeft += Math.log(0.6); },
      "-": () => { this.zoomAnchor.copy(this.target); this.zoomLeft += Math.log(1 / 0.6); },
      n: () => { this.azimuthLeft = -az; },
      N: () => { this.azimuthLeft = -az; },
    };
    const run = moves[e.key];
    if (!run) return;
    // 讲解时左右方向键是上一拍 / 下一拍，交给页面
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && document.querySelector("[aria-live]")) return;
    e.preventDefault();
    this.begin();
    run();
  };
}
