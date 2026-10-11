import type * as THREE from "three";
import { buildGuangmingSchoolTier, campusesOfTier, type SchoolCampus } from "./guangming-school-kit";
import type { LandmarkContext } from "./_landmark-kit";

/**
 * 光明区高中地标（8 个校区）
 *
 * 口径见 public/sandbox/landmarks/guangming-schools.json 的 meta：
 * 含光明区高级中学、深圳外国语学校高中园（三所高中共用一园，按一个校区建模）、
 * 深圳实验学校光明部、深圳理工大学附属实验高级中学、深圳大学附属实验中学、光明中学（初高完全中学）、
 * 光明书院（民办完全中学）、杰仁高级中学（民办）。
 * 平面轮廓 = OSM 校园多边形，校舍 = 沙盘建筑底盘真实足迹，高度为底盘估算；跑道、校门、窗带为示意。
 * 合并后 13 个 Mesh、约 39k 三角面；单校中位 4.4k、最大 12.5k 面（预算是「单校」2 万面，不是全学段合计）。
 */
export function buildGuangmingHighSchools(ctx: LandmarkContext): THREE.Group {
  return buildGuangmingSchoolTier(ctx, "高中");
}

export function listGuangmingHighSchools(): SchoolCampus[] {
  return campusesOfTier("高中");
}
