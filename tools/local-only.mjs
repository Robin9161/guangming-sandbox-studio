// 局域网分享时的只读限制：保存、删除、渲染只接受来自本机（沙盘所在的电脑）的请求。
// 同事从其他电脑打开页面只能看和临时调参数，不会改动这台电脑上的时间线、预设、镜头库，也不会在这里渲染成片。
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export const isLocalRequest = (req) => LOOPBACK.has(req.socket?.remoteAddress ?? "");

export const READ_ONLY_MESSAGE = "只读：从其他电脑打开时不能保存或渲染（只有沙盘所在的电脑可以）";
