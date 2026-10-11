import type * as THREE from "three";
import { buildGuangmingSchoolTier, campusesOfTier, type SchoolCampus } from "./guangming-school-kit";
import type { LandmarkContext } from "./_landmark-kit";

/**
 * 光明区小学地标（19 个校区）
 *
 * 口径见 public/sandbox/landmarks/guangming-schools.json 的 meta：
 * 只收官方划片名单 + 高德 POI 能确认的独立小学；九年一贯制（小学+初中）归入「初中」模块，不在这里重复出现。
 * 平面轮廓 = OSM 校园多边形，校舍 = 沙盘建筑底盘真实足迹，高度为底盘估算；跑道、校门、窗带为示意。
 * 合并后 11 个 Mesh、约 47k 三角面；单校中位 2.4k、最大 6.7k 面（预算是「单校」2 万面，不是全学段合计）。
 */
export function buildGuangmingPrimarySchools(ctx: LandmarkContext): THREE.Group {
  return buildGuangmingSchoolTier(ctx, "小学");
}

export function listGuangmingPrimarySchools(): SchoolCampus[] {
  return campusesOfTier("小学");
}
