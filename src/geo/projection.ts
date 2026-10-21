import type { SandboxData } from "./types";

/**
 * 经纬度 → 沙盘坐标（米）：Web 墨卡托，原点和比例取自 sandbox.json 的 meta.projection。
 * x 向东，z 向南。
 */
export function projectLngLat(data: SandboxData, lng: number, lat: number): [number, number] {
  const R = 6378137;
  const [lng0, lat0] = data.meta.projection.origin;
  const k = data.meta.projection.k;
  const mx = (value: number) => (R * value * Math.PI) / 180;
  const my = (value: number) => R * Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360));
  return [(mx(lng) - mx(lng0)) * k, -(my(lat) - my(lat0)) * k];
}
