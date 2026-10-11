// sandbox.json 的结构（由 scripts/sandbox/build-sandbox-data.mjs 生成）
// 所有坐标都是展平的 [x, z, x, z, ...]，单位米，x 向东，z 向南，原点为光明区中心。

export type Flat = number[];

export type SandboxData = {
  meta: {
    projection: { origin: [number, number]; k: number };
    dem: { file: string; x0: number; z0: number; nx: number; nz: number; spacing: number; scale: number };
    lineColors: Record<string, string>;
    accuracy: string;
    stats: Record<string, unknown> & { buildings: number; buildingsWithHeight: number; fillBuildings?: number; buildingSources?: Record<string, number> };
  };
  boundary: Flat;
  buildings: { t: string; h: number; e: number; f?: number; p: Flat }[];
  roads: { c: string; n?: string | null; b: number; l?: number; p: Flat }[];
  water: {
    areas: { c: string; name: string | null; area: number; level?: number; p: Flat; h: Flat[] }[];
    lines: { c: string; n?: string | null; p: Flat }[];
  };
  parks: { c: string; name: string | null; p: Flat }[];
  landuse: { c: string; p: Flat }[];
  rail: { line: string; name: string; mode: "elevated" | "surface" | "tunnel"; p: Flat }[];
  metroRoutes: { line: string; relation: number; from: string | null; to: string | null; p: Flat; m: number[]; stops: { name: string | null; i: number }[] }[];
  stations: { name: string; mode: string; lines: string[]; p: Flat }[];
  landmarks: { name: string; p: Flat }[];
};

export type LayerKey = "buildings" | "landmarks" | "planned" | "fill" | "trees" | "water" | "roads" | "expressways" | "metro" | "hsr" | "labels" | "clouds";

export type ViewKey = "overview" | "miniature" | "detail" | "skyline";

export const pairs = (flat: Flat): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
};
