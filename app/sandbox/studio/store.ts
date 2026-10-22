/** 本地存档（tools/store-server.mjs）：预设、镜头库、时间线存成工程里的 JSON 文件，跟着 git 给团队共享 */
export type StoreKind = "presets" | "shots" | "timelines";

const call = async <T>(kind: StoreKind, action: string, name?: string, body?: unknown): Promise<T> => {
  const url = `/__store/${kind}/${action}${name !== undefined ? `?name=${encodeURIComponent(name)}` : ""}`;
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
};

export const store = {
  list: (kind: StoreKind) => call<{ name: string; savedAt: string | null }[]>(kind, "list"),
  get: <T>(kind: StoreKind, name: string) => call<T>(kind, "get", name),
  save: (kind: StoreKind, name: string, data: unknown) => call<{ ok: true; name: string }>(kind, "save", name, data),
  remove: (kind: StoreKind, name: string) => call<{ ok: true }>(kind, "delete", name, {}),
};
