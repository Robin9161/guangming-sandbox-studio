import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { landmarkKit, type LandmarkContext } from "../_landmark-kit";
import { glowColor } from "../../scene/atmosphere";

/**
 * 湾区之光 · 欢乐港湾（宝安滨海文化公园，沙盘 district=qianhai）。
 * 核实于 2026-10-11：
 * - 官方：28 个全天景轿厢，每舱净面积 16.8㎡、25 人。
 *   https://www.octohbay.net/home/index/happy/id/2.html
 * - 制造商：总高128m、转轮直径113.3m。
 *   https://www.jumarides.com/ferris-wheels/giant-ferris-wheel/
 * - 灯光供应商：约30分钟一圈，轮缘和辐条安装点光源。
 *   https://www.exc-led.com/uploadfiles/2021/09/20210928170231231.pdf
 * - 深圳晚报记者现场报道：五支柱鱼鳍状异形大立架（非普通对称双A架）。
 *   https://news.sina.cn/2021-04-06/detail-ikmxzfmk5330995.d.html
 * - 定位：qianhai/sandbox.json buildings[6856] 轮廓面积形心反投影；
 *   对应 data/districts/qianhai/overture/buildings.geojsonseq 的 OSM
 *   w914175455@3（湾区之光摩天轮），不采用其估算高度37.7m。
 *   https://www.openstreetmap.org/way/914175455
 * 估算：轮面朝向、五柱弯折/截面、轮圈厚度、辐条排布、座舱外形与尺寸、
 * 中心轴标高、站房/广场均为低多边形示意，不是施工图复原。
 * 地面以上含广场等比放大1.27×；128m视觉高度为162.56m。
 * 真实约1800秒/圈 ×24倍转速 => 沙盘75秒/圈；夜间流光为艺术演绎。
 * 静态件按kit合批；旋转轮圈/辐条独立，28座舱用实例矩阵反转保持竖直。
 */
type Ctx = LandmarkContext;
export const BAY_LIGHT_WHEEL_ANCHOR: [number, number] = [113.88307154261649, 22.544248737103928];
const SCALE = 1.27;
const CABINS = 28;
const RADIUS = 113.3 / 2;
const HUB_Y = 128 - RADIUS - 2.5;
const TAU = 2 * Math.PI;
const REAL_REVOLUTION_SECONDS = 30 * 60;
const SPEED_MULTIPLIER = 24;
const PERIOD = REAL_REVOLUTION_SECONDS / SPEED_MULTIPLIER;
const COLORS = { white: "#fdfcf8", silver: "#f3f0e8", glazing: "#a8bfcc", glazingLight: "#cfdde4" };

export function buildBayLightWheel(ctx: Ctx): THREE.Group {
  const k = landmarkKit(ctx, BAY_LIGHT_WHEEL_ANCHOR, "湾区之光", "#c9ae7a", COLORS);
  // 所有局部几何体用米；最后只缩放根组，不放大地理定位。
  k.cylinder("stone", 0, 0, 0, 39, .35, 39, 56);
  k.cylinder("white", 0, 0, .35, 34, .18, 34, 56);
  k.box("glazing", 0, .53, 5, 30, 5, 13);
  k.box("silver", 0, 5.53, 5, 33, .65, 16);
  k.box("stone", 0, .53, -7, 31, 1.8, 7);
  for (let i = 0; i < 5; i++) k.box("white", 0, .53, -12 - i * 1.1, 30, 1.5 - i * .28, 1.12);
  for (let x = -14; x <= 14; x += 3.5) k.box("white", x, .53, -1.6, .16, 5, .18);
  for (const x of [-29, 29]) {
    k.box("white", x, .53, 5, 4, .75, 15);
    k.box("green", x, 1.28, 5, 3.6, .25, 14.5);
  }
  // 五柱向轮面后方收束，弯折曲线提示鱼鳍；保留中心轴悬臂。
  const feet: [number, number][] = [[-25, 13], [-14, 23], [0, 29], [14, 23], [25, 13]];
  for (let i = 0; i < feet.length; i++) {
    const [x, z] = feet[i];
    k.box("stone", x, .53, z, 5.5, 1.2, 6);
    const a = new THREE.Vector3(x, 1.73, z);
    const b = new THREE.Vector3(x * .5, 32, z * .68 + 4);
    const c = new THREE.Vector3(x * .13, 57, 12);
    const d = new THREE.Vector3(0, HUB_Y, 6);
    k.beam("white", a, b, 2.8, 3.4);
    k.beam("white", b, c, 2.25, 2.8);
    k.beam("silver", c, d, 1.7, 2.1);
  }
  k.add("silver", new THREE.CylinderGeometry(2.7, 3.2, 18, 16).rotateX(Math.PI / 2).translate(0, HUB_Y, 4));
  const root = k.finish();
  root.scale.setScalar(SCALE);
  root.rotation.y = -.30; // 轮面方位估算，待实测方位角可独立调整。

  const rotor = new THREE.Group();
  rotor.name = "湾区之光/旋转轮圈辐条座舱";
  rotor.position.y = HUB_Y;
  root.add(rotor);
  const dummyContext: Ctx = { project: () => new THREE.Vector3(), groundAt: () => 0 };
  const wheel = landmarkKit(dummyContext, [0, 0], "湾区之光/轮架", undefined, COLORS);
  for (const z of [-1.8, 1.8]) {
    wheel.add("white", new THREE.TorusGeometry(RADIUS, .55, 4, 112).translate(0, 0, z));
    wheel.add("silver", new THREE.TorusGeometry(RADIUS - 2, .24, 3, 112).translate(0, 0, z));
    for (let i = 0; i < CABINS; i++) {
      const a = i * TAU / CABINS;
      wheel.beam("silver", new THREE.Vector3(0, 0, z * 1.8), new THREE.Vector3(Math.cos(a) * (RADIUS - 2), Math.sin(a) * (RADIUS - 2), z), .17);
      if (z < 0) wheel.beam("white", new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, -1.8), new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 1.8), .30);
    }
    wheel.add("white", new THREE.CylinderGeometry(3.5, 3.5, .8, 20).rotateX(Math.PI / 2).translate(0, 0, z * 1.8));
  }
  rotor.add(wheel.finish());

  const lightTime = { value: 0 };
  const rimMaterial = new THREE.MeshStandardMaterial({ color: "#fff0d5", roughness: .4 });
  glowColor(rimMaterial, "#ffe0a4", .9);
  const previous = rimMaterial.onBeforeCompile;
  rimMaterial.onBeforeCompile = (shader, renderer) => {
    previous.call(rimMaterial, shader, renderer);
    shader.uniforms.uWheelTime = lightTime;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWheelXY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWheelXY = position.xy;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uWheelTime; varying vec2 vWheelXY;")
      .replace("#include <opaque_fragment>", `
        float wave = pow(0.5 + 0.5 * cos(atan(vWheelXY.y, vWheelXY.x) * 3.0 - uWheelTime), 6.0);
        outgoingLight += uNight * wave * vec3(0.8, 0.35, 0.08);
        #include <opaque_fragment>`);
  };
  rimMaterial.customProgramCacheKey = () => "bay-light-wheel-flow-v1";
  for (const z of [-2.03, 2.03]) {
    const lamp = new THREE.Mesh(new THREE.TorusGeometry(RADIUS - .1, .17, 4, 112), rimMaterial);
    lamp.position.z = z;
    rotor.add(lamp);
  }

  // 椭球玻璃舱 + 白色弧形框架/顶底盘，三组实例共28舱；无透明排序。
  const glass = new THREE.MeshStandardMaterial({ color: COLORS.glazing, roughness: .32, metalness: .22 });
  glowColor(glass, "#ffe2b0", .4);
  glass.customProgramCacheKey = () => "bay-light-wheel-cabin-glow-04";
  const shell = new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: .65 });
  const trim = new THREE.MeshStandardMaterial({ color: "#fff0d5", roughness: .4 });
  glowColor(trim, "#ffe2b0", .65);
  trim.customProgramCacheKey = () => "bay-light-wheel-trim-glow-065";
  const frames: THREE.BufferGeometry[] = [];
  for (const a of [0, Math.PI / 2]) frames.push(new THREE.TorusGeometry(1, .045, 4, 10).scale(a === 0 ? 3.05 : 2.25, 2.38, 1).rotateY(a));
  frames.push(new THREE.CylinderGeometry(2.1, 2.55, .32, 12).scale(1.18, 1, 1).translate(0, -1.7, 0));
  frames.push(new THREE.CylinderGeometry(2.1, 2.45, .30, 12).scale(1.18, 1, 1).translate(0, 1.7, 0));
  const frameGeometry = mergeGeometries(frames)!;
  for (const g of frames) g.dispose();
  const cabinMeshes = [
    new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 6).scale(3.1, 2.5, 2.3), glass, CABINS),
    new THREE.InstancedMesh(frameGeometry, shell, CABINS),
    new THREE.InstancedMesh(new THREE.TorusGeometry(1, .045, 4, 8).rotateX(Math.PI / 2).scale(3.12, 1, 2.32), trim, CABINS),
  ];
  for (let j = 0; j < cabinMeshes.length; j++) {
    const m = cabinMeshes[j];
    m.name = `湾区之光/座舱/${j}`;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 保守包围球一次设定，避免转动后使用初始矩阵的过时包围盒。
    m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS + 5);
    m.castShadow = true;
    rotor.add(m);
  }
  const matrix = new THREE.Matrix4();
  const positions = new Float64Array(CABINS * 2);
  for (let i = 0; i < CABINS; i++) {
    positions[i * 2] = Math.cos(i * TAU / CABINS) * RADIUS;
    positions[i * 2 + 1] = Math.sin(i * TAU / CABINS) * RADIUS;
  }
  // tick热路径：仅数值运算与复用矩阵；不new、不map、不创建数组/闭包。
  rotor.userData.tick = (_delta: number, elapsed: number): void => {
    const angle = (elapsed % PERIOD) * TAU / PERIOD;
    rotor.rotation.z = angle;
    lightTime.value = (elapsed % 12) * TAU / 12;
    matrix.makeRotationZ(-angle);
    const e = matrix.elements;
    for (let i = 0; i < CABINS; i++) {
      e[12] = positions[i * 2]; e[13] = positions[i * 2 + 1];
      for (let j = 0; j < cabinMeshes.length; j++) cabinMeshes[j].setMatrixAt(i, matrix);
    }
    for (let j = 0; j < cabinMeshes.length; j++) cabinMeshes[j].instanceMatrix.needsUpdate = true;
  };
  rotor.userData.tick(0, 0);
  root.userData.landmark = { district: "qianhai", realPeriodSeconds: REAL_REVOLUTION_SECONDS, speedMultiplier: SPEED_MULTIPLIER, periodSeconds: PERIOD, scale: SCALE };
  return root;
}
