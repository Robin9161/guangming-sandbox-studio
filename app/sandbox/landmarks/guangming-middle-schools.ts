import type * as THREE from "three";
import { buildGuangmingSchoolTier, campusesOfTier, type SchoolCampus } from "./guangming-school-kit";
import type { LandmarkContext } from "./_landmark-kit";

/**
 * 光明区初中地标（41 个校区）
 *
 * 口径见 public/sandbox/landmarks/guangming-schools.json 的 meta：
 * tier 取校区承担的最高学段，因此九年一贯制与完全中学（含初中）都在这里，stages 字段保留了各自的全部学段。
 * 平面轮廓 = OSM 校园多边形，校舍 = 沙盘建筑底盘真实足迹，高度为底盘估算；跑道、校门、窗带为示意。
 * 合并后 12 个 Mesh、约 111k 三角面；单校中位 2.5k、最大 6.3k 面（预算是「单校」2 万面，不是全学段合计）。
 */
export function buildGuangmingMiddleSchools(ctx: LandmarkContext): THREE.Group {
  return buildGuangmingSchoolTier(ctx, "初中");
}

export function listGuangmingMiddleSchools(): SchoolCampus[] {
  return campusesOfTier("初中");
}
