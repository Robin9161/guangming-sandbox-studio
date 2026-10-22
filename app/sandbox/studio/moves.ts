import * as THREE from "three/webgpu";
import type { PathKey, Paths } from "./paths";

/**
 * 镜头装置：用"看哪里、离多远、从哪个方向、多高的角度"描述镜头，比直接写相机坐标好调、好做关键帧。
 * - 焦点 targetX / targetY / targetZ（米）
 * - 距离 distance（米）
 * - 方位 azimuth（度）：镜头在焦点的哪个方向，0 = 北，90 = 东，180 = 南，270 = 西
 * - 俯角 elevation（度）：0 = 平视，90 = 正上方往下看
 * - 视角 fov（度，竖直方向）
 */
export type RigValues = { targetX: number; targetY: number; targetZ: number; distance: number; azimuth: number; elevation: number; fov: number };

/**
 * 运镜模板：不需要打关键帧，选一种运动、填开始时间、时长、幅度就会在时间线上播放；
 * 和镜头装置上的关键帧叠加（例：装置上打了推近的关键帧，再叠一个环绕）。
 * - orbit 环绕：方位转 amount 度
 * - dolly 推拉：距离缩短 amount%（负数 = 拉远）
 * - crane 升降：俯角增加 amount 度（负数 = 降低）
 * - truck 平移：焦点向镜头右侧移动 amount 米（负数 = 向左）
 * - path 沿路径飞行：沿河 / 路 / 地铁飞，height 离地高度，lookAhead 往前看多远，offset 偏到路径右侧多少米
 */
export const MOVE_TYPES = { none: "无", orbit: "环绕", dolly: "推拉", crane: "升降", truck: "平移", path: "沿路径飞行" } as const;
export const EASES = { inOut: "缓入缓出", linear: "匀速", in: "缓入", out: "缓出" } as const;
export type MoveValues = {
  type: keyof typeof MOVE_TYPES;
  start: number;
  duration: number;
  amount: number;
  ease: keyof typeof EASES;
  path: PathKey;
  height: number;
  lookAhead: number;
  offset: number;
};

const ease = (kind: MoveValues["ease"], p: number) => {
  if (kind === "linear") return p;
  if (kind === "in") return p * p * p;
  if (kind === "out") return 1 - (1 - p) ** 3;
  return p * p * (3 - 2 * p);
};

const deg = THREE.MathUtils.degToRad;

/** 从相机现在的位置反推镜头装置的值（"把当前视角写入时间线"用） */
export function rigFromCamera(camera: THREE.PerspectiveCamera, target: THREE.Vector3): RigValues {
  const d = camera.position.clone().sub(target);
  const distance = Math.max(1, d.length());
  return {
    targetX: target.x, targetY: target.y, targetZ: target.z,
    distance,
    azimuth: (THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)) + 360) % 360,
    elevation: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y / distance, -1, 1))),
    fov: camera.fov,
  };
}

/** 时间 t（秒）时的镜头：装置的值 + 运镜模板，写进相机，返回焦点 */
export function applyRig(camera: THREE.PerspectiveCamera, rig: RigValues, move: MoveValues, t: number, paths: Paths, outTarget: THREE.Vector3) {
  const p = ease(move.ease, THREE.MathUtils.clamp((t - move.start) / Math.max(0.01, move.duration), 0, 1));
  let { targetX, targetY, targetZ, distance, azimuth, elevation } = rig;
  if (move.type === "orbit") azimuth += move.amount * p;
  if (move.type === "dolly") distance *= Math.max(0.05, 1 - (move.amount / 100) * p);
  if (move.type === "crane") elevation = THREE.MathUtils.clamp(elevation + move.amount * p, 1, 89.9);
  if (move.type === "truck") {
    // 镜头右侧（水平）：方位 0（镜头在北、朝南看）时右侧是西
    targetX += -Math.cos(deg(azimuth)) * move.amount * p;
    targetZ += -Math.sin(deg(azimuth)) * move.amount * p;
  }
  camera.fov = rig.fov;
  const curve = move.type === "path" ? paths.get(move.path) : null;
  if (curve) {
    // 沿路径：镜头在路径上方 height 米，看向前方 lookAhead 米处的地面
    const length = curve.getLength();
    const here = curve.getPointAt(p);
    const ahead = curve.getPointAt(Math.min(1, p + move.lookAhead / length));
    const dir = ahead.clone().sub(here).setY(0);
    if (dir.lengthSq() < 1e-6) curve.getTangentAt(p, dir).setY(0);
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    camera.position.copy(here).addScaledVector(right, move.offset).add(new THREE.Vector3(0, move.height, 0));
    outTarget.copy(ahead).addScaledVector(right, move.offset);
    if (p >= 1) outTarget.copy(here).addScaledVector(dir, move.lookAhead).addScaledVector(right, move.offset); // 终点处继续朝原方向看
  } else {
    const a = deg(azimuth), e = deg(elevation);
    outTarget.set(targetX, targetY, targetZ);
    camera.position.set(targetX + Math.sin(a) * Math.cos(e) * distance, targetY + Math.sin(e) * distance, targetZ - Math.cos(a) * Math.cos(e) * distance);
  }
  camera.lookAt(outTarget);
  camera.updateProjectionMatrix();
  return outTarget;
}
