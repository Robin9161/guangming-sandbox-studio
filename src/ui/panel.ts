import { formatHour, MOODS } from "../style/artPalette";
import type { Weather, WeatherKind } from "../weather/weather";
import type { FogLevel, LookDriver } from "../look/driver";

/** 右侧面板：时间（播放 / 滑块 / 快捷时刻）、日出日落氛围、天气、体积雾档位。只读写 driver.state（阶段 2 会换成完整的参数面板） */
export function bindPanel(driver: LookDriver, weather: Weather) {
  const { state } = driver;
  const $ = (id: string) => document.getElementById(id)!;
  const weatherLabel = $("weather-name"), clockLabel = $("clock"), moodLabel = $("mood-name");
  const slider = $("time") as HTMLInputElement;
  const playButton = $("play") as HTMLButtonElement;
  const pick = (selector: string, active: Element) => document.querySelectorAll(selector).forEach((x) => x.classList.toggle("on", x === active));

  playButton.addEventListener("click", () => { state.playing = !state.playing; playButton.textContent = state.playing ? "❚❚" : "▶"; });
  slider.addEventListener("input", () => { state.hour = Number(slider.value); });
  document.querySelectorAll<HTMLButtonElement>("[data-hour]").forEach((b) => b.addEventListener("click", () => { state.hour = Number(b.dataset.hour); pick("[data-hour]", b); }));
  document.querySelectorAll<HTMLButtonElement>("[data-weather]").forEach((b) => b.addEventListener("click", () => { weather.set(b.dataset.weather as "auto" | WeatherKind); pick("[data-weather]", b); }));
  document.querySelectorAll<HTMLButtonElement>("[data-fog]").forEach((b) => b.addEventListener("click", () => { state.fogLevel = b.dataset.fog as FogLevel; pick("[data-fog]", b); }));

  const moodRow = $("moods");
  const moodButtons: HTMLButtonElement[] = [];
  [{ name: "每天随机", index: null as number | null }, ...MOODS.map((m, i) => ({ name: m.name, index: i as number | null }))].forEach(({ name, index }) => {
    const b = document.createElement("button");
    b.textContent = name;
    if (index === null) b.classList.add("on");
    b.addEventListener("click", () => { state.moodChoice = index; moodButtons.forEach((x) => x.classList.toggle("on", x === b)); });
    moodRow.appendChild(b);
    moodButtons.push(b);
  });

  /** 定时刷新显示（时钟、滑块、当前天气、今天的氛围） */
  const refresh = () => {
    weatherLabel.textContent = weather.name();
    clockLabel.textContent = formatHour(state.hour);
    slider.value = String(state.hour);
    moodLabel.textContent = driver.moodName();
  };
  return { refresh };
}
