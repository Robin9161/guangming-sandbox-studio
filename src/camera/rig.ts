import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Region } from "../core/region";

/**
 * 镜头：透视相机 + 鼠标环绕控制。
 * 切块：从北往南看碧湖、红桥（傍晚迎着太阳）；全区：和原版"微缩"视角一样的斜俯视。
 * （阶段 3 会换成可做关键帧的镜头装置）
 */
export function createCameraRig(canvas: HTMLElement, region: Region) {
  const { full, cx, cz, baseY, HMAX } = region;
  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 20, 150000);
  const target = full ? new THREE.Vector3(cx, baseY, cz + 900) : new THREE.Vector3(cx, baseY + 40, cz + 300);
  const el = THREE.MathUtils.degToRad(full ? 33 : 14), az = THREE.MathUtils.degToRad(full ? 28 : 200), dist = full ? HMAX * 2.1 : 3600;
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.45;
  controls.minDistance = 300;
  controls.maxDistance = full ? 60000 : 12000;
  return { camera, controls };
}
