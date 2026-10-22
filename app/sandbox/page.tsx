"use client";

import { useEffect, useRef, useState } from "react";
import type { SandboxHandle } from "./scene/createSandbox";
import type { LayerKey, ViewKey } from "./scene/types";
import { formatHour, MOODS } from "./scene/artPalette";
import { WEATHER_NAMES, WEATHER_ORDER, type WeatherKind } from "./scene/weather";
import styles from "./page.module.css";

const LAYERS: { key: LayerKey; label: string }[] = [
  { key: "buildings", label: "建筑" },
  { key: "landmarks", label: "精细地标" },
  { key: "planned", label: "规划示意" },
  { key: "fill", label: "示意补全" },
  { key: "trees", label: "树木" },
  { key: "water", label: "水系" },
  { key: "roads", label: "道路" },
  { key: "expressways", label: "高速" },
  { key: "metro", label: "地铁" },
  { key: "hsr", label: "高铁" },
  { key: "labels", label: "标签" },
  { key: "clouds", label: "云朵" },
];

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "overview", label: "全貌" },
  { key: "miniature", label: "微缩" },
  { key: "detail", label: "细节" },
  { key: "skyline", label: "天际线" },
];

export default function SandboxPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  // 做视频用的「运镜与时间线」「渲染成片」（app/sandbox/studio/）放在这里，由场景填充
  const studioRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SandboxHandle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [view, setView] = useState<ViewKey | null>("miniature");
  // "规划示意"默认关闭：规划效果图重建不能和现状混在一起显示
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => Object.fromEntries(LAYERS.map(({ key }) => [key, key !== "planned"])) as Record<LayerKey, boolean>);
  const [effects, setEffects] = useState(true);
  const [isNight, setIsNight] = useState(false);
  // 光影模式：连续的一天 + 日出日落氛围
  const [art, setArt] = useState(false);
  const [artHour, setArtHour] = useState(17.2);
  const [artPlaying, setArtPlaying] = useState(true);
  const [artMood, setArtMood] = useState<number | null>(null);
  const [artNight, setArtNight] = useState(false);
  const [weather, setWeather] = useState<{ mode: "auto" | WeatherKind; name: string }>({ mode: "auto", name: "晴" });
  const [stats, setStats] = useState<SandboxHandle["stats"] | null>(null);
  const [landmarks, setLandmarks] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [story, setStory] = useState<SandboxHandle["story"]>([]);
  const [storyStep, setStoryStep] = useState<number | null>(null);
  const layersBeforeStory = useRef<Record<LayerKey, boolean> | null>(null);
  const [autoplay, setAutoplay] = useState(false);
  const [arterial, setArterial] = useState<string | null>(null);
  const [terrainView, setTerrainView] = useState<false | "villages" | "west">(false);
  const [watershed, setWatershed] = useState(false);
  const toggleTerrainView = (mode: "villages" | "west" = "villages") => {
    const handle = handleRef.current;
    if (!handle) return;
    const next = terrainView === mode ? false : mode;
    // 和主干道一样：看地势时先收起建筑和树
    if (next && !layersBeforeArterial.current) {
      layersBeforeArterial.current = layers;
      const quiet = { ...layers, buildings: false, fill: false, trees: false, landmarks: false };
      (Object.keys(quiet) as LayerKey[]).forEach((key) => handle.setLayer(key, quiet[key]));
      setLayers(quiet);
    }
    if (!next && layersBeforeArterial.current) {
      const restore = layersBeforeArterial.current;
      (Object.keys(restore) as LayerKey[]).forEach((key) => handle.setLayer(key, restore[key]));
      setLayers(restore);
      layersBeforeArterial.current = null;
    }
    setTerrainView(next);
    handle.showTerrainView(false);
    handle.showWestTimeline(false);
    if (next === "villages") handle.showTerrainView(true);
    if (next === "west") handle.showWestTimeline(true);
  };
  // 看主干道时暂时隐藏建筑、示意补全和树木，让路面上的色带看得清；关闭时恢复
  const layersBeforeArterial = useRef<Record<LayerKey, boolean> | null>(null);
  const chooseArterial = (id: string | null) => {
    const next = arterial === id ? null : id;
    const handle = handleRef.current;
    if (!handle) return;
    if (next && !layersBeforeArterial.current) {
      layersBeforeArterial.current = layers;
      const quiet = { ...layers, buildings: false, fill: false, trees: false, roads: true };
      (Object.keys(quiet) as LayerKey[]).forEach((key) => handle.setLayer(key, quiet[key]));
      setLayers(quiet);
    }
    if (!next && layersBeforeArterial.current) {
      const restore = layersBeforeArterial.current;
      (Object.keys(restore) as LayerKey[]).forEach((key) => handle.setLayer(key, restore[key]));
      setLayers(restore);
      layersBeforeArterial.current = null;
    }
    setArterial(next);
    handle.showArterials(next);
  };
  const STEP_SECONDS = 9;
  const district = typeof window === "undefined" ? "guangming" : new URLSearchParams(window.location.search).get("district") ?? "guangming";
  // [id, 切换按钮上的简称, 标题里的中文名（以 shenzhen-context.json 的区名为准；前海是合作区、大鹏是新区）]
  const DISTRICTS = [
    ["guangming", "光明", "光明区"],
    ["nanshan", "南山", "南山区"],
    ["qianhai", "前海", "前海"],
    ["futian", "福田", "福田区"],
    ["luohu", "罗湖", "罗湖区"],
    ["yantian", "盐田", "盐田区"],
    ["baoan", "宝安", "宝安区"],
    ["longhua", "龙华", "龙华区"],
    ["longgang", "龙岗", "龙岗区"],
    ["pingshan", "坪山", "坪山区"],
    ["dapeng", "大鹏", "大鹏新区"],
  ] as const;
  // ?fps=1：左下角显示帧率
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("fps")) return;
    const el = document.createElement("div");
    Object.assign(el.style, { position: "fixed", left: "8px", bottom: "8px", zIndex: "99", padding: "4px 8px", borderRadius: "6px", background: "rgba(0,0,0,0.65)", color: "#fff", font: "12px/1.3 ui-monospace, monospace", pointerEvents: "none" });
    document.body.appendChild(el);
    let frames = 0, last = performance.now(), raf = 0;
    const tick = (now: number) => { frames += 1; if (now - last >= 1000) { el.textContent = `${Math.round((frames * 1000) / (now - last))} fps · ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`; frames = 0; last = now; } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.remove(); };
  }, []);
  const switchDistrict = (id: string) => { if (id !== district) window.location.search = id === "guangming" ? "" : `?district=${id}`; };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    import("./scene/createSandbox")
      .then(({ createSandbox }) => createSandbox(mount, { landmark: styles.landmarkLabel, station: styles.stationLabel, water: styles.waterLabel, poi: styles.poiLabel, story: styles.storyLabel, roadName: styles.roadName, roadEnd: styles.roadEnd, lit: styles.labelLit }, (name) => { setFocus(name); setView(null); }, district, studioRef.current ?? undefined))
      .then((handle) => {
        if (cancelled) { handle.dispose(); return; }
        handleRef.current = handle;
        setStats(handle.stats);
        setLandmarks(handle.landmarks);
        setStory(handle.story);
        setEffects(mount.clientWidth >= 768);
        setStatus("ready");
      })
      .catch((error) => { console.error(error); setStatus("error"); });
    return () => {
      cancelled = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  const toggleLayer = (key: LayerKey) => {
    const next = !layers[key];
    setLayers({ ...layers, [key]: next });
    handleRef.current?.setLayer(key, next);
  };
  const chooseView = (key: ViewKey) => {
    setView(key);
    setFocus(null);
    handleRef.current?.setView(key);
  };
  const flyTo = (name: string) => {
    setFocus(name);
    setView(null);
    handleRef.current?.flyToLandmark(name);
  };
  // ---------- 讲解 ----------
  const goToStep = (index: number | null) => {
    const handle = handleRef.current;
    if (!handle) return;
    if (index === null) {
      setAutoplay(false);
      handle.setAutoOrbit(false);
      // 退出讲解：恢复进入前的图层状态
      const before = layersBeforeStory.current;
      if (before) {
        (Object.keys(before) as LayerKey[]).forEach((key) => handle.setLayer(key, before[key]));
        setLayers(before);
      }
      layersBeforeStory.current = null;
      handle.setStoryStep(null);
      setStoryStep(null);
      return;
    }
    if (storyStep === null) layersBeforeStory.current = layers;
    handle.setStoryStep(index);
    setLayers((current) => ({ ...current, ...story[index].layers }) as Record<LayerKey, boolean>);
    setStoryStep(index);
    setView(null);
    setFocus(null);
  };
  useEffect(() => {
    if (storyStep === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" && storyStep < story.length - 1) goToStep(storyStep + 1);
      if (event.key === "ArrowLeft" && storyStep > 0) goToStep(storyStep - 1);
      if (event.key === "Escape") goToStep(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  // 自动演示：每步停留 STEP_SECONDS 秒，镜头缓慢环绕；最后一步停住
  useEffect(() => {
    handleRef.current?.setAutoOrbit(autoplay && storyStep !== null);
    if (!autoplay || storyStep === null) return;
    if (storyStep >= story.length - 1) { setAutoplay(false); return; }
    const timer = window.setTimeout(() => goToStep(storyStep + 1), (story[storyStep]?.seconds ?? STEP_SECONDS) * 1000);
    return () => window.clearTimeout(timer);
  });
  const startDemo = () => {
    goToStep(0);
    setAutoplay(true);
  };
  const current = storyStep === null ? null : story[storyStep];

  const toggleNight = () => {
    setIsNight(!isNight);
    handleRef.current?.setNight(!isNight);
  };
  const chooseLight = (mode: "day" | "night" | "art") => {
    const handle = handleRef.current;
    if (!handle) return;
    setArt(mode === "art");
    handle.setArt(mode === "art");
    if (mode !== "art") {
      setIsNight(mode === "night");
      handle.setNight(mode === "night");
    }
  };
  // 时间在场景里走，预设、时间线也会改画面模式和时刻：面板每 0.25 秒同步一次
  useEffect(() => {
    if (status !== "ready") return;
    const timer = window.setInterval(() => {
      const handle = handleRef.current;
      if (!handle) return;
      const look = handle.getLook();
      setArt(look.art);
      setIsNight(look.night);
      setArtPlaying(look.playing);
      setArtMood(look.moodChoice);
      setArtHour(look.hour);
      setArtNight(handle.isArtNight());
      setWeather(look.weather);
    }, 250);
    return () => window.clearInterval(timer);
  }, [status]);
  const toggleEffects = () => {
    setEffects(!effects);
    handleRef.current?.setEffects(!effects);
  };

  return (
    <main className={styles.page} data-night={(art ? artNight : isNight) ? "true" : "false"}>
      <div ref={mountRef} className={styles.canvas} aria-label="光明区微缩沙盘" data-sandbox-canvas />
      <header className={styles.header} data-studio-ui>
        <div>
          <p className={styles.kicker}>GUANGMING · MINIATURE CITY</p>
          <h1>{DISTRICTS.find(([id]) => id === district)?.[2] ?? "光明区"}微缩沙盘</h1>
          <div className={styles.districtSwitch}>{DISTRICTS.map(([id, name]) => <button key={id} type="button" className={id === district ? styles.districtActive : undefined} onClick={() => switchDistrict(id)}>{name}</button>)}</div>
        </div>
      </header>

      <aside className={styles.panel} data-studio-ui>
        <div className={styles.panelHeader}>
          <span>视角</span>
          <span className={styles.status} data-state={status}>{status === "loading" ? "搭建中…" : status === "ready" ? "已就绪" : "加载失败"}</span>
        </div>
        <button type="button" className={storyStep === null ? styles.storyStart : styles.storyStartActive} disabled={!story.length} onClick={() => goToStep(storyStep === null ? 0 : null)}>
          {storyStep === null ? "▶ 按剧本讲解光明" : "■ 退出讲解"}
        </button>
        {storyStep === null && (
          <button type="button" className={styles.demoStart} disabled={!story.length} onClick={startDemo}>⏵ 自动演示（约 {Math.round(story.reduce((sum, s) => sum + s.seconds, 0) / 60)} 分钟）</button>
        )}
        <div className={styles.segment}>
          {VIEWS.map(({ key, label }) => (
            <button key={key} type="button" className={view === key ? styles.active : ""} onClick={() => chooseView(key)}>{label}</button>
          ))}
        </div>

        <div className={styles.dayNight}>
          <button type="button" className={!art && !isNight ? styles.active : ""} onClick={() => chooseLight("day")}>☀ 白天</button>
          <button type="button" className={!art && isNight ? styles.active : ""} onClick={() => chooseLight("night")}>☾ 夜晚</button>
          <button type="button" className={art ? styles.active : ""} onClick={() => chooseLight("art")}>✦ 光影</button>
        </div>
        {art && (
          <div className={styles.artPanel}>
            <div className={styles.artClock}>
              <button type="button" onClick={() => { const next = !artPlaying; setArtPlaying(next); handleRef.current?.setPlaying(next); }}>{artPlaying ? "❚❚" : "▶"}</button>
              <b>{formatHour(artHour)}</b>
              <input type="range" min={0} max={24} step={0.05} value={artHour} aria-label="一天中的时间" onChange={(event) => { const value = Number(event.target.value); setArtHour(value); handleRef.current?.setHour(value); }} />
            </div>
            <div className={styles.chips}>
              {[["日出", 6.4], ["上午", 9], ["正午", 12.5], ["黄金时刻", 17.4], ["日落", 18.15], ["蓝调", 19.3], ["深夜", 23]].map(([label, h]) => (
                <button key={label} type="button" className={styles.chip} onClick={() => { setArtHour(h as number); handleRef.current?.setHour(h as number); }}>{label}</button>
              ))}
            </div>
            <div className={styles.artMoodLabel}>天气 · 现在：{weather.name}</div>
            <div className={styles.chips}>
              {(["auto", ...WEATHER_ORDER] as const).map((kind) => (
                <button key={kind} type="button" className={weather.mode === kind ? styles.chipActive : styles.chip} onClick={() => { handleRef.current?.setWeather(kind); setWeather({ ...weather, mode: kind }); }}>{kind === "auto" ? "自动" : WEATHER_NAMES[kind]}</button>
              ))}
            </div>
            <div className={styles.artMoodLabel}>日出日落氛围</div>
            <div className={styles.chips}>
              <button type="button" className={artMood === null ? styles.chipActive : styles.chip} onClick={() => { setArtMood(null); handleRef.current?.setMood(null); }}>每天随机</button>
              {MOODS.map((mood, i) => (
                <button key={mood.id} type="button" className={artMood === i ? styles.chipActive : styles.chip} onClick={() => { setArtMood(i); handleRef.current?.setMood(i); }}>{mood.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.sectionLabel}>片区</div>
        <div className={styles.chips}>
          {landmarks.map((name) => (
            <button key={name} type="button" className={focus === name ? styles.chipActive : styles.chip} onClick={() => flyTo(name)}>{name}</button>
          ))}
        </div>

        {!!handleRef.current?.arterials.length && (
          <>
            <div className={styles.sectionLabel}>主干道脉络</div>
            <div className={styles.chips}>
              <button type="button" className={arterial === "all" ? styles.chipActive : styles.chip} onClick={() => chooseArterial("all")}>全部</button>
              {handleRef.current.arterials.map((road) => (
                <button key={road.id} type="button" disabled={!road.found} title={road.found ? `${road.group} · 约 ${road.lengthKm} km` : "地图数据里暂时没有这条路"} className={arterial === road.id ? styles.chipActive : styles.chip} onClick={() => chooseArterial(road.id)}>
                  {road.name}{road.found ? "" : "（无数据）"}
                </button>
              ))}
            </div>
          </>
        )}

        {district === "guangming" && (<>
        <div className={styles.sectionLabel}>地势</div>
        <div className={styles.chips}>
          <button type="button" className={terrainView === "villages" ? styles.chipActive : styles.chip} onClick={() => toggleTerrainView("villages")}>老村落与海拔</button>
          <button type="button" className={terrainView === "west" ? styles.chipActive : styles.chip} onClick={() => toggleTerrainView("west")}>西岸 · 时间线</button>
          <button type="button" className={watershed ? styles.chipActive : styles.chip} onClick={() => { const next = !watershed; setWatershed(next); void handleRef.current?.showWatershed(next); }}>茅洲河流域</button>
        </div>
        </>)}

        <div className={styles.sectionLabel}>图层</div>
        <div className={styles.toggles}>
          {LAYERS.map(({ key, label }) => (
            <button key={key} type="button" className={layers[key] ? styles.toggleOn : styles.toggle} onClick={() => toggleLayer(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className={effects ? styles.effectsOn : styles.effects} onClick={toggleEffects}>
          {effects ? "画质：精致（AO + 移轴）" : "画质：流畅"}
        </button>

        <div ref={studioRef} />

        {stats && (
          <div className={styles.metroLegend}>
            <span><i className={styles.legendSolid} />高架（地上）</span>
            <span><i className={styles.legendDashed} />地下（虚线 · 半透明列车）</span>
            <small>{stats.trains} 列车运行中 · 高架约 {stats.elevatedKm}km · 地下约 {stats.undergroundKm}km</small>
          </div>
        )}
        {stats && (
          <p className={styles.note}>
            建筑 {stats.buildings.toLocaleString()} 栋真实轮廓（{Object.entries(stats.buildingSources).map(([name, count]) => `${name} ${count.toLocaleString()}`).join(" · ")}）。
            仅 {stats.buildingsWithHeight.toLocaleString()} 栋有真实高度，其余按用地和面积估算。
            示意补全 {stats.fillBuildings.toLocaleString()} 栋（浅色，非真实建筑）· 树木为示意 · 精细地标放大约 1.3 倍 · 地形分段夸张（城区约 1.6×，山体约 3×），城区地面已平滑
          </p>
        )}
      </aside>

      {current && storyStep !== null && (
        <section className={styles.caption} aria-live="polite" data-studio-ui>
          <p className={styles.captionKicker}>{current.act} · {current.title}</p>
          <h2>{current.question}</h2>
          <p className={styles.captionBody}>{current.body}</p>
          <p className={styles.captionSource}>依据：{current.source}</p>
          <div className={styles.captionNav}>
            <button type="button" disabled={storyStep === 0} onClick={() => { setAutoplay(false); goToStep(storyStep - 1); }}>← 上一步</button>
            <button type="button" onClick={() => setAutoplay(!autoplay)}>{autoplay ? "⏸ 暂停" : "⏵ 播放"}</button>
            <div className={styles.dots}>
              {story.map((step, i) => (
                <button key={step.id} type="button" aria-label={step.title} className={i === storyStep ? styles.dotActive : styles.dot} onClick={() => goToStep(i)} />
              ))}
            </div>
            {storyStep < story.length - 1
              ? <button type="button" onClick={() => goToStep(storyStep + 1)}>下一步 →</button>
              : <button type="button" onClick={() => goToStep(null)}>结束</button>}
          </div>
        </section>
      )}

      <div className={styles.tip} data-studio-ui>拖动平移 · 滚轮或双指捏合缩放 · 右键或 Shift+拖动转向 · 双击飞近 · N 回到北在上</div>
    </main>
  );
}
