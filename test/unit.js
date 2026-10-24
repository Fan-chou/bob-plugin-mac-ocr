// Offline checks: runs src/main.js against a tiny fake mac-ocr-http server.
const http = require("http");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const TOKEN = "unit-test-token";
let last = null;
const server = http.createServer((req, res) => {
  let body = [];
  req.on("data", (c) => body.push(c));
  req.on("end", () => {
    body = Buffer.concat(body);
    last = { url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], size: body.length };
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url === "/health") return send(200, { ok: true });
    if (req.headers.authorization !== "Bearer " + TOKEN) return send(401, { ok: false, error: "unauthorized" });
    if (req.url === "/stats") return send(200, { ok: true });
    if (body.length === 0) return send(400, { ok: false, error: "empty image" });
    if (body.length > 1000) return send(413, { ok: false, error: "image too large" });
    const q = new URL(req.url, "http://x").searchParams;
    send(200, {
      ok: true, width: 1000, height: 500, script: q.get("script") || "hans", layout: q.get("layout"),
      languages: (q.get("languages") || "zh-Hans,en-US").split(","),
      text: "标题\nA\tB\tC",
      rows: [
        { text: "标题", bbox: { x: 100, y: 50, width: 300, height: 40 }, lineIndices: [0] },
        { text: "A\tB\tC", bbox: { x: 100, y: 120, width: 800, height: 40 }, lineIndices: [1, 2, 3] },
      ],
    });
  });
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const vm = require("vm");
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "info.json"), "utf8"));
  const $http = { request(o) {
    fetch(o.url, { method: o.method, headers: o.header, body: o.body && o.body.__data })
      .then(async (r) => { const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } o.handler({ data: d, response: { statusCode: r.status } }); })
      .catch((e) => o.handler({ error: { message: "Could not connect to the server.", debugMessage: String(e) } }));
  } };
  const load = (opt) => { const d = {}; info.options.forEach((x) => (d[x.identifier] = x.defaultValue || "")); const c = { $http, $option: Object.assign(d, opt) }; vm.createContext(c); vm.runInContext(src, c); return c; };
  const run = (c, fn, ...a) => new Promise((r) => c[fn](...a, r));
  let fail = 0; const check = (ok, name, x) => { console.log((ok ? "PASS " : "FAIL ") + name + (x ? " | " + x : "")); if (!ok) fail++; };
  const url = "http://127.0.0.1:" + port;
  const img = { __data: Buffer.alloc(100, 1) };
  const c = load({ url: url + "/", token: "Bearer " + TOKEN });

  check((await run(c, "pluginValidate")).result === true, "validate ok");
  let r = await run(load({ url, token: "x" }), "pluginValidate");
  check(r.error && r.error.type === "secretKey", "validate 401");
  r = await run(c, "ocr", { image: img, from: "auto", detectFrom: "zh-Hans" });
  check(r.result && r.result.texts.length === 2 && r.result.texts[1].text === "A\tB\tC", "rows -> texts, tabs kept");
  check(last.type === "application/octet-stream" && last.auth === "Bearer " + TOKEN && last.size === 100, "raw body + bearer");
  check(!/languages=/.test(last.url) && !/script=/.test(last.url) && /layout=rows/.test(last.url) && r.result.from === undefined, "auto omits languages", last.url);
  const p = r.result.texts[0].boundingBox.points;
  check(p[0].x === 0.1 && p[0].y === 0.1 && p[3].x === 0.4 && p[3].y === 0.18, "bbox normalised");
  check(c.pickLanguage({ from: "auto", detectFrom: "en" }) === "" && c.pickLanguage({ detectFrom: "zh-Hans" }) === "" && c.pickLanguage({}) === "", "pickLanguage ignores detectFrom on auto");
  check(c.pickLanguage({ from: "en", detectFrom: "zh-Hans" }) === "en" && c.pickLanguage({ from: "zh-Hant" }) === "zh-Hant" && c.pickLanguage({ from: "xx" }) === "", "pickLanguage explicit only");
  check(c.buildQuery("") === "layout=rows", "buildQuery auto omits languages");
  check(c.buildQuery("en") === "languages=en-US%2Czh-Hans&layout=rows", "buildQuery en includes zh-Hans");
  check(c.buildQuery("zh-Hans") === "languages=zh-Hans%2Cen-US&layout=rows", "buildQuery zh-Hans");
  check(c.buildQuery("zh-Hant") === "languages=zh-Hant%2Cen-US&script=auto&layout=rows", "buildQuery zh-Hant");
  check(c.buildQuery("vi") === "languages=vi-VT&layout=rows", "buildQuery vi-VT");
  r = await run(c, "ocr", { image: img, from: "zh-Hans", detectFrom: "en" });
  check(/languages=zh-Hans%2Cen-US/.test(last.url) && !/script=/.test(last.url) && r.result.from === "zh-Hans", "explicit zh-Hans query", last.url);
  r = await run(c, "ocr", { image: img, from: "zh-Hant", detectFrom: "zh-Hans" });
  check(/languages=zh-Hant%2Cen-US/.test(last.url) && /script=auto/.test(last.url), "zh-Hant -> script=auto", last.url);
  r = await run(c, "ocr", { image: img, from: "yue", detectFrom: "en" });
  check(/languages=zh-Hant%2Cen-US/.test(last.url) && /script=auto/.test(last.url), "explicit yue -> zh-Hant", last.url);
  r = await run(c, "ocr", { image: img, from: "auto", detectFrom: "yue" });
  check(!/languages=/.test(last.url) && !/script=/.test(last.url), "auto ignores detected yue", last.url);
  r = await run(c, "ocr", { image: img, from: "auto", detectFrom: "en" });
  check(!/languages=/.test(last.url), "auto ignores detected en", last.url);
  r = await run(c, "ocr", { image: img });
  check(!/languages=/.test(last.url) && r.result.from === undefined, "missing from omits languages", last.url);
  r = await run(c, "ocr", { image: img, from: "en", detectFrom: "zh-Hans" });
  check(/languages=en-US%2Czh-Hans/.test(last.url) && !/script=/.test(last.url), "explicit en sends zh-Hans too", last.url);
  r = await run(c, "ocr", { image: img, from: "vi" });
  check(/languages=vi-VT/.test(last.url) && !/vi-VN/.test(decodeURIComponent(last.url)), "vi -> vi-VT", last.url);
  r = await run(load({ url, token: TOKEN, script: "hans" }), "ocr", { image: img, from: "zh-Hant", detectFrom: "zh-Hant" });
  check(/languages=zh-Hans%2Cen-US/.test(last.url) && /script=hans/.test(last.url), "explicit hans with zh-Hant", last.url);
  r = await run(load({ url, token: TOKEN, fragments: "drop", layout: "document" }), "ocr", { image: img, from: "ja", detectFrom: "ja" });
  check(/languages=ja-JP%2Cen-US/.test(last.url) && /fragments=drop/.test(last.url) && /layout=document/.test(last.url), "ja + options", last.url);
  r = await run(c, "ocr", { image: img, from: "auto", detectFrom: "xx" });
  check(!/languages=/.test(last.url) && r.result.from === undefined, "auto unknown detectFrom -> server default");
  r = await run(c, "ocr", { image: { __data: Buffer.alloc(2000, 1) }, from: "auto", detectFrom: "en" });
  check(r.error && r.error.type === "param" && /413/.test(r.error.message), "413 -> param");
  r = await run(c, "ocr", { image: { __data: Buffer.alloc(0) }, from: "auto", detectFrom: "en" });
  check(r.error && r.error.type === "param" && /empty image/.test(r.error.message), "400 -> param");
  r = await run(load({ url: "http://127.0.0.1:1", token: TOKEN }), "ocr", { image: img, from: "auto", detectFrom: "en" });
  check(r.error && r.error.type === "network" && /无法连接/.test(r.error.message), "refused -> network");
  check(load({ timeout: "200" }).pluginTimeoutInterval() === 205 && load({ timeout: "abc" }).pluginTimeoutInterval() === 65, "timeout option");
  server.close();
  console.log(fail ? fail + " failed" : "all passed");
  process.exit(fail ? 1 : 0);
});
