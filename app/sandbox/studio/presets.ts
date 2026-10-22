import { store } from "./store";
import { assignParams, defaultParams, params, type ParamValues } from "./params";
import type { WeatherKind } from "../scene/weather";

/** 画面模式和时刻：白天 / 夜晚（经典配色）或光影模式（连续的一天） */
export type LookState = {
  /** 光影模式（连续的一天、天气）；false = 经典的白天 / 夜晚 */
  art: boolean;
  /** 经典模式下是不是夜晚 */
  night: boolean;
  hour: number;
  /** 光影模式下时间是否在走 */
  playing: boolean;
  /** 日出日落氛围：artPalette.MOODS 的下标，null = 每天随机 */
  moodChoice: number | null;
};

/** 场景提供给预设、时间线的接口：读写画面模式和时刻、天气 */
export type LookControl = {
  get: () => LookState;
  set: (s: Partial<LookState>) => void;
  getWeather: () => "auto" | WeatherKind;
  setWeather: (kind: "auto" | WeatherKind) => void;
};

/**
 * 预设：一套完整的"画面风格"——全部参数 + 画面模式、时刻、日出日落氛围、天气。
 * 不含镜头（镜头存在镜头库里）。存成工程里 presets/ 下的 JSON，团队共享。
 */
export type Preset = {
  name: string;
  savedAt: string;
  params: ParamValues;
  look: Omit<LookState, "playing">;
  /** 手动选的天气；"auto" = 自动 */
  weather: "auto" | WeatherKind;
};

export function createPresets(look: LookControl) {
  /** A/B 对比：载入预设前的画面记在这里，一键来回切换 */
  let other: Preset | null = null;

  const capture = (name: string): Preset => {
    const { art, night, hour, moodChoice } = look.get();
    return { name, savedAt: new Date().toISOString(), params: { ...params }, look: { art, night, hour, moodChoice }, weather: look.getWeather() };
  };
  const apply = (p: Preset) => {
    assignParams({ ...defaultParams(), ...p.params }); // 旧预设里没有的新参数按默认值
    look.set({ ...p.look, playing: false }); // 载入预设后时间停在预设的时刻
    if (p.weather !== look.getWeather()) look.setWeather(p.weather);
  };

  return {
    list: () => store.list("presets"),
    save: (name: string) => store.save("presets", name, capture(name)),
    remove: (name: string) => store.remove("presets", name),
    async load(name: string) {
      const p = await store.get<Preset>("presets", name);
      other = capture("载入前");
      apply(p);
      return p;
    },
    /** A/B：和载入前的画面互换；返回现在显示的是哪一个 */
    swap() {
      if (!other) return null;
      const now = capture(other.name === "载入前" ? "载入后" : "载入前");
      apply(other);
      const shown = other.name;
      other = now;
      return shown;
    },
    hasCompare: () => other !== null,
  };
}

export type Presets = ReturnType<typeof createPresets>;
