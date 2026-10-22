import { uniform } from "three/tsl";

/**
 * 模拟时钟和随机数：画面里一切随时间变化的东西都只读这里，不读真实时间、不用 Math.random()。
 * 这样同一个起始状态、同样的步长推进，每一帧都完全一样（渲染成片可以逐帧复现、重渲）。
 *
 * - 实时预览：每帧按真实经过的时间推进
 * - 渲染成片：每帧固定推进 1/60 秒，与电脑快慢无关
 */

/** 模拟时间（秒）。着色器里用它代替 three/tsl 的 time（那个是真实时间） */
export const simTime = uniform(0);

/** 可复现的随机数（mulberry32）：同一个种子得到同一串随机数 */
let rngState = 20261020;
export const rng = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const getRngState = () => rngState;
export const setRngState = (state: number) => { rngState = state | 0; };
