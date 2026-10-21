// 仅用于浏览器验收存根，不改变生产API地址。两个页面共用精确来源匹配。
export function captureApiRoute(value = "http://127.0.0.1:8000") {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash)
    throw new Error("V14D_CAPTURE_API_ORIGIN必须是无路径、凭据或查询串的HTTP(S)来源");
  const origin = url.origin;
  return { origin, matches: requestUrl => requestUrl.origin === origin };
}
