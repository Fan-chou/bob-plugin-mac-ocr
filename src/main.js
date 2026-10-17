// Bob OCR plugin for mac-ocr-http (Apple Vision over HTTP).
// Docs: https://bobtranslate.com/plugin/quickstart/ocr.html

// Bob language code -> Vision recognition languages.
var LANGS = {
  "zh-Hans": ["zh-Hans", "en-US"],
  "zh-Hant": ["zh-Hant", "en-US"],
  "yue": ["zh-Hant", "en-US"],
  "en": ["en-US"],
  "ja": ["ja-JP", "en-US"],
  "ko": ["ko-KR", "en-US"],
  "fr": ["fr-FR"],
  "de": ["de-DE"],
  "es": ["es-ES"],
  "it": ["it-IT"],
  "pt": ["pt-BR"],
  "pt-pt": ["pt-BR"],
  "pt-br": ["pt-BR"],
  "ru": ["ru-RU"],
  "uk": ["uk-UA"],
  "vi": ["vi-VN"],
  "th": ["th-TH"],
  "ar": ["ar-SA"]
};
var TRADITIONAL = { "zh-Hant": true, "yue": true };

function supportLanguages() {
  return ["auto"].concat(Object.keys(LANGS));
}

function supportBoundingBox() {
  return true;
}

function option(name, fallback) {
  var v = (typeof $option !== "undefined" && $option[name] !== undefined) ? String($option[name]) : "";
  v = v.trim();
  return v === "" ? fallback : v;
}

function timeoutSeconds() {
  var n = parseInt(option("timeout", "60"), 10);
  if (!(n > 0)) n = 60;
  return Math.min(Math.max(n, 5), 295);
}

function pluginTimeoutInterval() {
  return Math.min(Math.max(timeoutSeconds() + 5, 30), 300);
}

function baseUrl() {
  return option("url", "http://127.0.0.1:8741").replace(/\/+$/, "");
}

function authHeader(header) {
  var token = option("token", "").replace(/^Bearer\s+/i, "");
  if (token) header["Authorization"] = "Bearer " + token;
  return header;
}

// Language the user picked, else the one Bob detected.
function pickLanguage(query) {
  var from = query.from && query.from !== "auto" ? query.from : query.detectFrom;
  return from && LANGS[from] ? from : "";
}

function buildQuery(lang) {
  var params = [];
  var script = option("script", "");
  if (!script && TRADITIONAL[lang]) script = "auto";
  var langs = lang ? LANGS[lang] : [];
  // The server keeps Traditional whenever zh-Hant is listed; to convert,
  // read with the zh-Hans model (it reads Traditional text too).
  if (script === "hans" && TRADITIONAL[lang]) langs = LANGS["zh-Hans"];
  if (langs.length) params.push("languages=" + encodeURIComponent(langs.join(",")));
  if (script) params.push("script=" + script);
  params.push("layout=" + option("layout", "rows"));
  var fragments = option("fragments", "");
  if (fragments) params.push("fragments=" + fragments);
  return params.join("&");
}

// Normalised [0,1] corners (TL, TR, BL, BR) of a pixel bbox.
function box(b, w, h) {
  if (!b || !(w > 0) || !(h > 0)) return undefined;
  function c(v, d) { return Math.min(Math.max(v / d, 0), 1); }
  var x0 = c(b.x, w), y0 = c(b.y, h), x1 = c(b.x + b.width, w), y1 = c(b.y + b.height, h);
  return { points: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }] };
}

// One Bob text per server row; table cells stay tab-separated.
function toTexts(data) {
  var rows = Array.isArray(data.rows) ? data.rows : [];
  var texts = [];
  rows.forEach(function (row) {
    if (!row || typeof row.text !== "string" || !row.text.trim()) return;
    var t = { text: row.text };
    var bb = box(row.bbox, data.width, data.height);
    if (bb) t.boundingBox = bb;
    texts.push(t);
  });
  if (texts.length === 0 && typeof data.text === "string" && data.text.trim()) {
    data.text.split("\n").forEach(function (line) {
      if (line.trim()) texts.push({ text: line });
    });
  }
  return texts;
}

// Maps a transport error or HTTP status to a Bob service error.
function describeError(resp, url) {
  var status = resp && resp.response ? resp.response.statusCode : 0;
  var body = resp ? resp.data : undefined;
  var serverMsg = body && typeof body === "object" && body.error ? String(body.error) : "";
  if (resp && resp.error) {
    var e = resp.error;
    var text = [e.message, e.debugMessage, e.localizedDescription, e.code].join(" ");
    if (/-1001|timed out|超时/i.test(text)) {
      return { type: "network", message: "请求超时（" + timeoutSeconds() + " 秒），可调大超时或缩小截图 / Request timed out", addition: text };
    }
    if (/-1004|-1003|-1009|refused|could not connect|未能连接|无法连接/i.test(text)) {
      return { type: "network", message: "无法连接 mac-ocr-http（" + url + "）：服务未运行、地址错误或被代理拦截 / Cannot connect: server not running, wrong URL, or blocked by a proxy", addition: text };
    }
    return { type: "network", message: "网络错误 / Network error: " + (e.message || e.localizedDescription || "unknown"), addition: text };
  }
  if (status === 401) {
    return { type: "secretKey", message: "Token 错误或未填写（401）/ Invalid or missing token (401)", addition: serverMsg };
  }
  if (status === 413) {
    return { type: "param", message: "图片过大（413），请缩小截图 / Image too large (413)", addition: serverMsg };
  }
  if (status === 400) {
    return { type: "param", message: "请求无效（400）/ Bad request: " + serverMsg, addition: serverMsg };
  }
  if (status === 503 || status === 429) {
    return { type: "api", message: "服务繁忙（" + status + "），请稍后重试 / Server busy, retry later", addition: serverMsg };
  }
  return { type: "api", message: "服务返回 HTTP " + status + (serverMsg ? "：" + serverMsg : ""), addition: body };
}

function ocr(query, completion) {
  var lang = pickLanguage(query);
  var url = baseUrl() + "/ocr?" + buildQuery(lang);
  $http.request({
    method: "POST",
    url: url,
    header: authHeader({ "Content-Type": "application/octet-stream" }),
    body: query.image,
    timeout: timeoutSeconds(),
    handler: function (resp) {
      try {
        var status = resp.response ? resp.response.statusCode : 0;
        if (resp.error || status !== 200) {
          completion({ error: describeError(resp, baseUrl()) });
          return;
        }
        var data = resp.data;
        if (!data || typeof data !== "object") {
          completion({ error: { type: "api", message: "服务返回的不是 JSON / Response is not JSON", addition: String(data).slice(0, 500) } });
          return;
        }
        var texts = toTexts(data);
        if (texts.length === 0) {
          completion({ error: { type: "notFound", message: "未识别到文字 / No text found" } });
          return;
        }
        var raw = { width: data.width, height: data.height, tiles: data.tiles, elapsedMs: data.elapsedMs, languages: data.languages, script: data.script, layout: data.layout };
        completion({ result: { from: lang || undefined, texts: texts, raw: raw } });
      } catch (err) {
        completion({ error: { type: "unknown", message: "插件内部错误 / Plugin error: " + err, addition: String(err && err.stack) } });
      }
    }
  });
}

// Validate: /health is reachable, then /stats accepts the token.
function pluginValidate(completion) {
  var base = baseUrl();
  var link = "https://github.com/Fan-chou/bob-plugin-mac-ocr#troubleshooting";
  $http.request({
    method: "GET",
    url: base + "/health",
    timeout: 10,
    handler: function (resp) {
      var status = resp.response ? resp.response.statusCode : 0;
      if (resp.error || status !== 200) {
        var err = describeError(resp, base);
        err.troubleshootingLink = link;
        completion({ result: false, error: err });
        return;
      }
      $http.request({
        method: "GET",
        url: base + "/stats",
        header: authHeader({}),
        timeout: 10,
        handler: function (resp2) {
          var s = resp2.response ? resp2.response.statusCode : 0;
          if (!resp2.error && s === 200) {
            completion({ result: true });
            return;
          }
          var err2 = describeError(resp2, base);
          err2.troubleshootingLink = link;
          completion({ result: false, error: err2 });
        }
      });
    }
  });
}

if (typeof module !== "undefined") {
  module.exports = { supportLanguages: supportLanguages, ocr: ocr, pluginValidate: pluginValidate, pluginTimeoutInterval: pluginTimeoutInterval, buildQuery: buildQuery, toTexts: toTexts, describeError: describeError, pickLanguage: pickLanguage };
}
