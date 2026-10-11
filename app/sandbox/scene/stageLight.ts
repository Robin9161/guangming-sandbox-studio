import * as THREE from "three/webgpu";
import { abs, cameraPosition, dot, float, normalize, normalWorld, positionWorld, pow, sin, smoothstep, uniform, uv } from "three/tsl";
import type { Terrain } from "./terrain";

/**
 * 舞台光（丁达尔效应的风格化表现）：几束光从高空斜射到要讲的板块周围；云层保持不动。
 * - 光柱：开口圆台 + 自定义着色器（两端渐隐、边缘柔化、沿光柱缓慢流动的条纹），加法混合，不写深度
 * - 地面光池：聚光灯照亮主体；同时压低太阳光和天空光，让主体之外暗下来
 * 不做真实体积散射（太贵），成本很低。
 */

const BEAM_COUNT = 3;
const CLOUD_HEIGHT = 2600;

export function createStageLight(scene: THREE.Scene, terrain: Terrain) {
  const group = new THREE.Group();
  group.name = "stage-light";
  group.visible = false;
  scene.add(group);

  const uniforms = { uTime: uniform(0), uOpacity: uniform(0), uColor: uniform(new THREE.Color("#fff1cf")) };
  const beams: THREE.Mesh[] = [];
  for (let i = 0; i < BEAM_COUNT; i += 1) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const along = uv().y; // 0 = 地面端，1 = 云层端
    // 下半段渐隐：光束在落到主体之前消失，只作为空气中的光，不遮挡主体
    const ends = smoothstep(0.25, 0.6, along).mul(float(1).sub(smoothstep(0.75, 1.0, along)));
    const facing = abs(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld))));
    const edge = pow(facing, 1.6); // 侧面柔化，看起来像一束体积光
    const streak = sin(uv().x.mul(37.0).add(i * 0.37 * 11.0).add(along.mul(5.0)).sub(uniforms.uTime.mul(0.35))).mul(0.28).add(0.72);
    material.colorNode = uniforms.uColor;
    material.opacityNode = uniforms.uOpacity.mul(ends).mul(edge).mul(streak).mul(0.22);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 1, 1, 24, 1, true), material); // 圆台：上窄下宽
    beam.frustumCulled = false;
    beam.renderOrder = 5;
    group.add(beam);
    beams.push(beam);
  }

  // 地面光池
  const spot = new THREE.SpotLight("#fff0d6", 0, 0, Math.PI / 10, 0.6, 0);
  const spotTarget = new THREE.Object3D();
  scene.add(spot, spotTarget);
  spot.target = spotTarget;

  let strength = 0;
  let target = 0;
  let night = 0;

  /**
   * @param away 从镜头指向主体的水平方向（单位向量）。舞台光从主体"后上方"斜射向观众，
   *             光柱才最明显，也不会让云层挡在镜头和主体之间。
   */
  const focus = (x: number, z: number, radius: number, away: { x: number; z: number }) => {
    const ground = terrain.heightAt(x, z);
    const dir = new THREE.Vector3(away.x * 0.55, 1, away.z * 0.55).normalize();
    const gap = new THREE.Vector3(x, ground, z).addScaledVector(dir, CLOUD_HEIGHT / Math.max(0.3, dir.y));
    // 光柱：从云洞出发，沿阳光方向落到板块内的几个点
    beams.forEach((beam, i) => {
      const a = (i / BEAM_COUNT) * Math.PI * 2 + 0.4;
      const r = radius * (0.55 + 0.25 * ((i * 53) % 7) / 7); // 光束落在主体外围，不压在主体上
      const groundPoint = new THREE.Vector3(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
      groundPoint.y = terrain.heightAt(groundPoint.x, groundPoint.z);
      const top = gap.clone().add(new THREE.Vector3(Math.cos(a) * radius * 0.12, 0, Math.sin(a) * radius * 0.12));
      const length = top.distanceTo(groundPoint);
      const width = radius * (0.1 + 0.05 * (i % 3));
      beam.scale.set(width, length, width);
      beam.position.copy(groundPoint).add(top).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(groundPoint).normalize());
    });
    // 聚光灯在主体正上方、略偏向镜头一侧，照亮镜头看得到的那一面（光束仍从主体背后来）
    spot.position.set(x - away.x * 900, ground + 3500, z - away.z * 900);
    spotTarget.position.set(x, ground, z);
    spot.angle = Math.min(Math.PI / 3, Math.atan(radius / spot.position.distanceTo(spotTarget.position)) * 1.1);
    group.visible = true;
    target = 1;
  };
  const clear = () => { target = 0; };

  return {
    group,
    focus,
    clear,
    setNight: (value: number) => { night = value; },
    /** 每帧调用；返回当前强度（0–1），用于整体压暗 */
    update: (delta: number, elapsed: number) => {
      strength += (target - strength) * Math.min(1, delta * 1.6);
      if (Math.abs(target - strength) < 0.002) strength = target;
      uniforms.uTime.value = elapsed;
      uniforms.uOpacity.value = strength * (1 - night * 0.45);
      uniforms.uColor.value.set(night > 0.5 ? "#cfe0ff" : "#fff1cf");
      spot.intensity = strength * (night > 0.5 ? 1.6 : 2.6);
      spot.color.set(night > 0.5 ? "#cfdcff" : "#ffe6b8");
      group.visible = strength > 0.01;
      return strength;
    },
  };
}
