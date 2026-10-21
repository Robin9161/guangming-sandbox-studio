import * as THREE from "three/webgpu";
import { clamp, color, dot, float, floor, fract, mix, normalWorld, positionWorld, sin, smoothstep, uniform, vec2, vec3 } from "three/tsl";

/**
 * 整帧共享的"天光"参数：由 look/driver.ts 每帧按时刻、氛围、天气写入，所有材质和天空读取。
 */
export function createLookUniforms() {
  return {
    /** 夜间系数 0–1：楼体剪影、窗户、地标夜光 */
    night: uniform(0),
    /** 亮灯比例（随时间：黄昏渐亮、深夜熄掉一部分） */
    lit: uniform(0.25),
    /** 积雪 0–1、地面湿度 0–1 */
    snow: uniform(0),
    wet: uniform(0),
    /** 天空三段 + 雾色 */
    top: uniform(color("#6cb0e6")),
    mid: uniform(color("#a6d3f0")),
    horizon: uniform(color("#e0eff4")),
    fog: uniform(color("#e0eff4")),
    /** 太阳颜色、方向；日出日落光晕强度；太阳是否在地平线上；星星亮度 */
    sun: uniform(color("#fff0d6")),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)),
    glow: uniform(0),
    sunUp: uniform(1),
    stars: uniform(0),
  };
}

export type LookUniforms = ReturnType<typeof createLookUniforms>;

/** 积雪：朝上的面慢慢变白，越平越先白；按 25 m 的格子斑驳一点。scale 为这种表面积雪的程度（路面少一些） */
export function makeWithSnow(U: LookUniforms) {
  return (base: THREE.Node, scale = 1) => {
    const up = smoothstep(float(0.85).sub(U.snow.mul(0.55)), float(0.95).sub(U.snow.mul(0.25)), normalWorld.y);
    const patchy = fract(sin(dot(floor(positionWorld.xz.div(25.0)), vec2(12.9898, 78.233))).mul(43758.5453)).mul(0.3).add(0.7);
    return mix(base as ReturnType<typeof vec3>, vec3(0.9, 0.93, 0.98), clamp(U.snow.mul(scale).mul(up).mul(patchy).mul(1.2), 0, 1));
  };
}

export type WithSnow = ReturnType<typeof makeWithSnow>;
