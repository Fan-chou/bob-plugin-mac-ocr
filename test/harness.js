// Node harness: loads src/main.js with mocked Bob globals ($http, $option, $data)
// and runs it against a real mac-ocr-http server. Usage:
//   OCR_URL=http://127.0.0.1:18741 OCR_TOKEN_FILE=/path/to/token node test/harness.js <images dir>
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "src", "main.js"), "utf8");
const info = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "info.json"), "utf8"));
const token = process.env.OCR_TOKEN_FILE ? fs.readFileSync(process.env.OCR_TOKEN_FILE, "utf8").trim() : "";
const URL0 = process.env.OCR_URL || "http://127.0.0.1:8741";
const dir = process.argv[2] || ".";

// Bob-like $http.request on top of fetch; errors mimic NSURLError texts.
const $http = {
  request(o) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), (o.timeout || 60) * 1000);
    const body = o.body && o.body.__data ? o.body.__data : undefined;
    fetch(o.url, { method: o.method, headers: o.header || {}, body, signal: ctl.signal })
      .then(async (r) => {
        clearTimeout(timer);
        const buf = Buffer.from(await r.arrayBuffer());
        let data;
        try { data = JSON.parse(buf.toString("utf8")); } catch { data = buf.toString("utf8"); }
        o.handler({ data, response: { statusCode: r.status, headers: Object.fromEntries(r.headers) } });
      })
      .catch((e) => {
        clearTimeout(timer);
        const refused = /ECONNREFUSED/.test(String(e.cause && e.cause.code));
        const msg = e.name === "AbortError" ? "The request timed out." : refused ? "Could not connect to the server." : String(e);
        const code = e.name === "AbortError" ? -1001 : refused ? -1004 : -1;
        o.handler({ error: { message: msg, debugMessage: msg + " (NSURLErrorDomain " + code + ")" } });
      });
  },
};

function load(options) {
  const defaults = {};
  info.options.forEach((op) => (defaults[op.identifier] = op.defaultValue || ""));
  const ctx = { $http, $option: Object.assign(defaults, options), console, module: undefined };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}
const img = (f) => ({ __data: fs.readFileSync(path.join(dir, f)) });
const run = (ctx, fn, ...a) => new Promise((res) => ctx[fn](...a, res));

let pass = 0, fail = 0;
function check(ok, name, info) { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  | " + info : "")); }

(async () => {
  const good = { url: URL0, token };
  let c = load(good);
  check(c.supportLanguages().includes("zh-Hant") && c.supportLanguages()[0] === "auto", "supportLanguages");
  check(c.pluginTimeoutInterval() === 65, "timeout interval 60+5");

  let r = await run(c, "pluginValidate");
  check(r.result === true, "validate ok");
  r = await run(load({ url: URL0, token: "wrong" }), "pluginValidate");
  check(r.result === false && r.error.type === "secretKey", "validate wrong token -> secretKey", r.error && r.error.message);
  r = await run(load({ url: "http://127.0.0.1:18799", token }), "pluginValidate");
  check(r.result === false && r.error.type === "network" && /无法连接/.test(r.error.message) && r.error.troubleshootingLink, "validate refused -> network", r.error && r.error.message);

  r = await run(c, "ocr", { image: img("04-mixed-zh-en.png"), from: "auto", detectFrom: "zh-Hans" });
  check(r.result && r.result.texts.length >= 2 && r.result.raw.script === "hans", "ocr zh-Hans", r.result && r.result.texts.length + " rows, first: " + r.result.texts[0].text.slice(0, 30));
  const bb = r.result.texts[0].boundingBox;
  check(bb && bb.points.length === 4 && bb.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), "bounding boxes normalised");

  r = await run(c, "ocr", { image: img("09-traditional-zh.png"), from: "zh-Hant", detectFrom: "zh-Hant" });
  const t9 = r.result ? r.result.texts.map((t) => t.text).join("\n") : "";
  check(r.result && r.result.raw.script === "auto" && /[們這為與說體來]/.test(t9), "zh-Hant keeps Traditional", t9.slice(0, 30));
  r = await run(load(Object.assign({ script: "hans" }, good)), "ocr", { image: img("09-traditional-zh.png"), from: "zh-Hant", detectFrom: "zh-Hant" });
  check(r.result && r.result.raw.script === "hans" && /体/.test(r.result.texts[0].text), "explicit script=hans wins (Simplified)", r.result && r.result.texts[0].text.slice(0, 20));
  r = await run(c, "ocr", { image: img("09-traditional-zh.png"), from: "auto", detectFrom: "zh-Hans" });
  check(r.result && r.result.raw.script === "hans", "auto/zh-Hans -> server default (hans)");

  r = await run(c, "ocr", { image: img("10-table.png"), from: "auto", detectFrom: "zh-Hans" });
  check(r.result && r.result.texts.some((t) => t.text.includes("\t")), "table rows keep tabs", r.result && r.result.texts.length + " rows");

  r = await run(load(Object.assign({ fragments: "keep", layout: "document" }, good)), "ocr", { image: img("02-ui-icons.png"), from: "en", detectFrom: "en" });
  check(r.result && r.result.raw.layout === "document" && /^en/.test(r.result.raw.languages.join()), "layout/fragments/languages passed", JSON.stringify(r.result && r.result.raw.languages));

  r = await run(load({ url: URL0, token: "wrong" }), "ocr", { image: img("01-ui-small-zh.png"), from: "auto", detectFrom: "zh-Hans" });
  check(r.error && r.error.type === "secretKey" && /401/.test(r.error.message), "ocr 401 -> secretKey", r.error && r.error.message);
  r = await run(load({ url: "http://127.0.0.1:18799", token }), "ocr", { image: img("01-ui-small-zh.png"), from: "auto", detectFrom: "zh-Hans" });
  check(r.error && r.error.type === "network" && /无法连接/.test(r.error.message), "ocr refused -> network", r.error && r.error.message);
  if (process.env.BIG) {
    r = await run(c, "ocr", { image: { __data: fs.readFileSync(process.env.BIG) }, from: "auto", detectFrom: "en" });
    check(r.error && r.error.type === "param" && /413/.test(r.error.message), "ocr 413 -> param", r.error && r.error.message);
  }
  if (process.env.SLOW) {
    r = await run(load(Object.assign({}, good, { timeout: "1" })), "ocr", { image: { __data: fs.readFileSync(process.env.SLOW) }, from: "auto", detectFrom: "en" });
    check(r.error && r.error.type === "network" && /超时/.test(r.error.message), "ocr timeout -> network", r.error && r.error.message);
  }
  r = await run(c, "ocr", { image: { __data: Buffer.alloc(0) }, from: "auto", detectFrom: "en" });
  check(r.error && r.error.type === "param", "empty image -> param (400)", r.error && r.error.message);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
