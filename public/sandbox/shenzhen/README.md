# 深圳全图 · 光明开场上下文

独立预览：`/sandbox/context/preview`，倾斜视角：`/sandbox/context/preview?view=tilt`。
本次仅新增 context 目录中的模块和预览，不修改原有沙盘文件。

## 重建与离线使用

```sh
node scripts/sandbox/build-shenzhen-context.mjs
# 主动更新所有来源缓存
node scripts/sandbox/build-shenzhen-context.mjs --refresh
```

构建依赖 Node 22、curl、Python 3.9+。首次构建在 `data/sandbox/shenzhen-cache/venv` 安装固定版本 Shapely 2.0.7，不修改项目依赖。几何处理入口为同目录 `shenzhen-context-geometry.py`。原始响应、来源时间和查询哈希保存在 `data/sandbox/shenzhen-cache/`；相同查询自动复用缓存。Overpass 请求最多重试 9 次，在 kumi、private.coffee 和官方主站之间轮换，失败不会覆盖既有缓存。`--only=water` 等参数可单独获取一种来源，随后正常重建。

运行时只需 `shenzhen-context.json`，无外部地图、字体、DEM 或瓦片请求。不使用贴图，不增加逐帧动画。未加入可选地形。

## 数据结构与坐标

顶层为 `districts`, `cityOutline`, `neighbors`, `water`, `places`, `routes`, `meta`。
每个要素有 `id`、`name`、`status`、WGS84 `geometry` 及同构 `localGeometry`（GeoJSON geometry 结构，坐标对为 `[x,z]`）。来源保存在要素 `source`；缺失数据为 `status: "unknown"`、空几何，不补造坐标。

区/周边另有 `landGeometry`：本地米制的实际陆地填色范围，由行政面与 OSM 海岸线生成的陆地取交集。`geometry` 保留行政口径，不把海岸线当作行政界。`label` 包含代表点的经纬度及本地坐标。`meta.displayBbox` 是画幅裁切框，不是行政边界。

严格读取 `public/sandbox/sandbox.json` 中 `meta.projection.origin` 和 `k`，不重新估算：

```
R = 6378137
mx(lng) = R * lng * PI / 180
my(lat) = R * ln(tan(PI/4 + lat * PI/360))
x = (mx(lng) - mx(lng0)) * k
z = -(my(lat) - my(lat0)) * k
```

x 向东、z 向南、y 向上，单位米。经纬度保留 7 位小数，本地坐标保留 2 位小数。

## 来源、简化与精度

- [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)，[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)。区界、市界、邻市边界、水库、海岸线、点位和交通走向均来自 OSM；具体下载日期、接口、OSM 库时间、查询哈希见 `meta.sources`。
- 九个行政区采用 `admin_level=6`。**大鹏新区在 OSM 实际为 `admin_level=7`**，relation [3536166](https://www.openstreetmap.org/relation/3536166)。不能如实交付“十个全部 level 6”。展示用龙岗范围扣除了大鹏，避免重复着色；保留原始 relation 来源。香港 relation [913110](https://www.openstreetmap.org/relation/913110)。这两项通过 OSM API 获取完整关系及成员。
- 海岸线使用 `natural=coastline` 原始方向（左侧为陆地），与画幅边界构成平面分区；海面是画幅内陆地补集。覆盖深圳湾、伶仃洋、大鹏湾、大亚湾。海湾名称文字的排版锚点不作为测量点位。
- Douglas–Peucker 简化在投影后的米制平面执行，容差 **40 m**，使用 GEOS 保持各单体几何拓扑；完整环和孔洞保留。面边界简化前后的最大 Hausdorff 距离写入 `meta.simplification`。此容差是几何简化量，不代表 OSM 的实测定位精度；测绘精度为 unknown。
- 源数据的 OSM 库时间为不同查询返回的 2026 年 5—7 月快照（OSM API / Nominatim 未提供库时间者为 unknown）；2026-10-05 是下载日期，不能声称全部为当天测绘。
- 独立简化的相邻行政边界可能产生细小缝隙或重叠，区界描边用于视觉覆盖，不能作为地籍数据。
- 水面筛选为 0.15 km² 以上的有名水体/水库，微小水塘和河道不纳入。
- 走廊为 OSM 对应道路/轨道的简化示意，`schematic: true`，仅保留光明以外的部分；不代表运营状态、精确线位或工程设计。平行车道、双线轨道可能合并显示。
- 点位通过 OSM Nominatim 检索并人工核对类别：福田中心区取市民中心建筑代表点，南山后海取后海站，前海取前海合作区地名点，深圳湾口岸取口岸同名巴士站（不是通关柜台坐标），松山湖取水库代表点。其余车站取 railway=station，机场取 aerodrome。不是片区精确几何中心。检索缓存使用查询哈希，并遵守约 1 秒请求间隔。
- 深圳市界和邻市裁切到本地画幅，排除远离深圳本部的深汕特别合作区。邻市仅提供靠近深圳部分。

## 接入

```ts
import { buildShenzhenContext } from './context/shenzhenContext';
const { group, setOpacity } = buildShenzhenContext(data);
scene.add(group);
setOpacity(1); // 开场
setOpacity(0); // 飞入完成；整体隐藏
// 卸载时
scene.remove(group);
group.userData.dispose();
```

正式模块的光明区**仅有珊瑚色粗轮廓 + 白色细轮廓，不填面**，地面 y = -250，水面略低、道路略高。光明沙盘放在原点附近，不再平移、缩放此图层。预览页单独调用 `buildGuangmingPreviewFill()` 补珊瑚色填面，接入现有沙盘时不要添加该辅助组。

文字是 `CSS2DObject`，不使用 CanvasTexture；宿主需添加 `CSS2DRenderer`，与 WebGL 共用 camera 并在镜头/尺寸/透明度改变后重绘，文字层 `pointer-events: none`。`setOpacity` 同步影响所有网格和 DOM 标签；0 时隐藏整个 group。无需模块内动画循环。

主体使用 MeshStandardMaterial，roughness 0.8。面按色合并，走廊和描边为平面三角网格，以保证 WebGL 下线宽一致。`group.userData.triangles` 可读取总三角面数。预览的透明度滑块可检查淡出。


## 本次验收（2026-10-05）

- 数据 1,969,848 字节（小于十进制 2 MB）；10 个区、3 个邻市、9 个地点、6 条走廊，unknown 要素为 0。
- 场景约 4.04 万三角面、13 个合并网格；光明预览填面另外约百余面，仍远低于 20 万预算。
- 自动核验所有 35,992 对坐标，投影配对误差最大 0.0108 m（舍入误差）；简化前后边界离散 Hausdorff 最大约 39.998 m。该检查使用边界顶点到对侧线段距离，与 GEOS 默认离散 Hausdorff 同一口径，不是实测精度。
- 透明度 0、0.5、1 与越界输入通过；正式模块无光明填面，光明内部水面亦在渲染副本中扣除。
- 验证命令：`node scripts/sandbox/validate-shenzhen-context.mjs`，结果见 `reports/shenzhen-context/validation.json`。
- 完整项目 TypeScript 检查仍有原有 `app/region/foundation/page.tsx:93` 的 TerrainManifest 类型错误；本次新增 context 文件未报告类型错误，未修改该无关文件。
- 截图见 `reports/shenzhen-context/top.jpg` 和 `tilt.jpg`。
