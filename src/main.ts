import * as THREE from "three/webgpu";
import { createWeather, weatherState } from "./weather/weather";
import { createRenderer } from "./core/renderer";
import { buildRegion, loadData } from "./core/region";
import { createLookUniforms, makeWithSnow } from "./look/uniforms";
import { createLookDriver } from "./look/driver";
import { applySky } from "./world/sky";
import { buildTerrainMesh } from "./world/terrain";
import { buildCity } from "./world/city";
import { buildRoadLayer } from "./world/roads";
import { buildBridge } from "./world/bridge";
import { buildTreeLayer } from "./world/trees";
import { createClouds } from "./world/clouds";
import { createLights } from "./world/lights";
import { buildWaterLayer } from "./world/water";
import { createNoise3D } from "./fx/noise";
import { createFog } from "./fx/fog";
import { createPrecipitation } from "./fx/precipitation";
import { createPipeline } from "./post/pipeline";
import { createCameraRig } from "./camera/rig";
import { bindPanel } from "./ui/panel";

/**
 * 光明沙盘 Studio：做视频用的三维沙盘（WebGPU）。
 * ?full=1：全区；不加参数：虹桥公园一带约 3.2 km 见方的切块。
 */
const FULL = new URLSearchParams(location.search).has("full");
const status = document.getElementById("status")!;
const hud = document.getElementById("hud")!;

async function main() {
  const { renderer, backend } = await createRenderer(document.body);

  status.textContent = "加载数据…";
  const project = await loadData();
  status.textContent = "搭建场景…";
  const region = buildRegion(project, FULL);
  const scene = new THREE.Scene();

  // 天光参数（所有材质共享）和天空
  const U = createLookUniforms();
  const withSnow = makeWithSnow(U);
  applySky(scene, U);

  // 场景内容：几何体在 geo/，材质都是 WebGPU 节点材质（world/）
  const noise3D = createNoise3D();
  scene.add(buildTerrainMesh(region, withSnow));
  const city = buildCity(region, U, withSnow);
  scene.add(city.group);
  scene.add(buildRoadLayer(region, U, withSnow));
  const bridge = buildBridge(project, region);
  scene.add(bridge.group);
  scene.add(buildTreeLayer(region, city.footprint, withSnow));
  const clouds = createClouds(region);
  scene.add(clouds.group);
  const { hemi, sun } = createLights(scene, region);

  // 大气、天气、水
  const fog = createFog(scene, region, noise3D, hemi);
  const rain = createPrecipitation(scene);
  const water = buildWaterLayer(region, U, noise3D, rain.U.rainLevel);
  scene.add(water.group, water.reflectionTarget);
  const weather = createWeather(); // 天气状态机：雨雪、积雪、湿润、雾都读 weatherState

  // 镜头和后期
  const { camera, controls } = createCameraRig(renderer.domElement, region);
  const post = createPipeline(renderer, scene, camera, fog);

  // 一天的光影驱动 + 面板
  const driver = createLookDriver({ renderer, scene, camera, focus: controls.target, region, U, sun, hemi, fog, rain, water, post, cloudMaterial: clouds.material, bridgeGlow: bridge.glowMaterials });
  driver.apply();
  const panel = bindPanel(driver, weather);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  status.textContent = "";
  let frames = 0, last = performance.now(), fps = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1);
    driver.advance(delta);
    controls.update();
    // 每帧：先推进天气状态机，再按"当天配色 + 天气"更新灯光、雾、材质
    weather.update(delta, driver.look.night);
    rain.follow(camera, controls.target);
    driver.apply();
    clouds.update(delta, driver.cloudCover());
    post.pipeline.render();
    frames += 1;
    const now = performance.now();
    if (now - last > 500) {
      fps = (frames * 1000) / (now - last);
      frames = 0;
      last = now;
      hud.textContent = `${backend} · ${fps.toFixed(0)} fps · ${renderer.domElement.width}×${renderer.domElement.height}`;
      panel.refresh();
    }
  });
  // 调试用：在浏览器控制台里访问 window.__studio
  (window as unknown as { __studio: unknown }).__studio = { renderer, scene, camera, controls, region, driver, weather, weatherState, post, fog, water, fps: () => fps };
}

main().catch((error) => { console.error(error); status.textContent = `出错了：${(error as Error).message}`; });
