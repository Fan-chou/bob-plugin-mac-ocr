# bob-plugin-mac-ocr

[Bob](https://bobtranslate.com) 文字识别（OCR）插件，调用 [mac-ocr-http](https://github.com/Fan-chou/mac-ocr-http)（macOS Vision 的 HTTP 服务）。按行返回文字（表格单元格以制表符分隔），附带位置信息，可用于 Bob 的原图翻译。

A [Bob](https://bobtranslate.com) OCR plugin for [mac-ocr-http](https://github.com/Fan-chou/mac-ocr-http), an HTTP server around Apple Vision. One text per row (table cells tab-separated), with bounding boxes so Bob can use it for image translation.

## 安装 / Install

1. 先运行 mac-ocr-http（默认 `http://127.0.0.1:8741`），记下 Token。
   Run mac-ocr-http first (default `http://127.0.0.1:8741`) and note its token.
2. 从 [Releases](https://github.com/Fan-chou/bob-plugin-mac-ocr/releases/latest) 下载 `bob-plugin-mac-ocr_x.y.z.bobplugin`，双击安装。
   Download the `.bobplugin` from Releases and double-click it.
3. Bob → 偏好设置 → 服务 → 文本识别 → `+` → 选择 **Mac OCR HTTP**，填写服务地址和 Token，点「验证」。
   Bob → Preferences → Services → OCR → `+` → **Mac OCR HTTP**; fill in the URL and token, then click Validate.
4. 插件内置 appcast，之后可在 Bob 中检查更新。 / Updates are offered through Bob (appcast).

## 选项 / Options

| 选项 Option | 说明 Description |
| --- | --- |
| 服务地址 Server URL | 默认 `http://127.0.0.1:8741`；也可填局域网内另一台 Mac 的地址。 / Default local server; another Mac on your LAN works too. |
| Token | Bearer Token（密文输入）。服务未启用鉴权可留空。 / Bearer token (secure field); empty if auth is off. |
| 简繁 Script | 跟随语言（默认）：源语言为繁体中文/粤语时保留繁体，其他按服务端默认转简体；`hans` 强制转简体；`auto` 保留识别原文。 / Follow language (default): keep Traditional for zh-Hant/yue, otherwise server default (Simplified); `hans` forces Simplified; `auto` keeps text as recognized. |
| 版面 Layout | `rows` 按行（默认），`document` 文档版面。 / Row or document layout. |
| 碎片 Fragments | 服务端默认 / `drop` 丢弃孤立图标噪点 / `keep` 全部保留。 / Server default, drop isolated scraps, or keep all. |
| 超时 Timeout | 秒，默认 60（5–295）。大图或多图块时可调大。 / Seconds, default 60. |

## 语言 / Languages

Bob 源语言为 **auto**（或未给出 `from`）时，请求不带 `languages`。mac-ocr-http 关闭了 Vision 自动检测，省略该参数即使用服务端默认 `zh-Hans,en-US`，而不是把 Bob 的 `detectFrom` 锁给 Vision。Bob 常把中文界面猜成 `en`；若因此只发 `en-US`，汉字会被英文模型读成乱码。 / When Bob's source language is **auto** (or `from` is missing), the request omits `languages`. mac-ocr-http keeps Vision language detection off, so the server default `zh-Hans,en-US` applies instead of locking Vision to Bob's `detectFrom`. Bob often guesses `en` for Chinese UI; sending only `en-US` turns Chinese into garbage.

用户明确选择的语言仍会映射（繁体保留只在显式选择繁体中文/粤语时生效）： / An explicit choice still maps (Traditional is kept only when zh-Hant or yue is selected explicitly):

`zh-Hans`→zh-Hans,en-US · `zh-Hant`/`yue`→zh-Hant,en-US（保留繁体 / keeps Traditional） · `en`→en-US,zh-Hans · `ja`→ja-JP,en-US · `ko`→ko-KR,en-US · `fr`→fr-FR · `de`→de-DE · `es`→es-ES · `it`→it-IT · `pt`→pt-BR · `ru`→ru-RU · `uk`→uk-UA · `vi`→vi-VT · `th`→th-TH · `ar`→ar-SA。未列出的语言同样省略 `languages`。 / Unlisted languages also omit `languages`.

## 代理 / Proxy

Bob 插件的 `$http` 没有绕过代理的选项。如果使用 Surge / ClashX 等代理工具，请确保本机和局域网地址直连： / Bob's `$http` cannot bypass a proxy. With Surge/Clash, make sure local addresses go direct:

- Surge：`[General]` 的 `skip-proxy` 包含 `127.0.0.1, localhost, 192.168.0.0/16, 10.0.0.0/8`（默认通常已包含）；增强模式下再加规则 `IP-CIDR,127.0.0.0/8,DIRECT` 和 `IP-CIDR,192.168.0.0/16,DIRECT`。
  Surge: keep those ranges in `skip-proxy`; in enhanced mode also add `IP-CIDR,…,DIRECT` rules.
- Clash：`rules` 中加入 `IP-CIDR,127.0.0.0/8,DIRECT` 与 `IP-CIDR,192.168.0.0/16,DIRECT`。

## Troubleshooting

| 错误 Error | 处理 Fix |
| --- | --- |
| 无法连接 / Cannot connect | 服务未运行、端口或地址错误，或被代理拦截（见上）。 / Server not running, wrong URL, or proxied. |
| Token 错误（401） | 检查 Token；可直接粘贴，带不带 `Bearer ` 前缀都可以。 / Check the token (with or without `Bearer `). |
| 图片过大（413） | 截图超过服务端像素上限，缩小截图或调大 `OCR_HTTP_MAX_PIXELS`。 / Exceeds the server pixel limit. |
| 请求超时 / Timed out | 调大超时选项。 / Raise the timeout option. |
| 未识别到文字 | 图片中没有可识别文字。 / No text in the image. |
| 中文变成乱码（如「保存」→「1577」，或西里尔/拉丁字母） / Chinese comes back as garbage | 源语言用「自动」（不带 `languages`，走服务端默认 zh-Hans+en-US）。手动选 English 时会同时带上 zh-Hans。若仍乱码，确认服务端默认不是仅 `en-US`。 / Use Auto so `languages` is omitted. Explicit English also sends zh-Hans. If it persists, the server default must not be English-only. |

## 开发 / Development

```
src/            # 插件源码 / plugin source (info.json, main.js, icon.png)
test/unit.js    # 离线测试（模拟服务）/ offline tests against a fake server
test/harness.js # 对真实 mac-ocr-http 的测试 / tests against a real server
```

```
node test/unit.js
OCR_URL=http://127.0.0.1:8741 OCR_TOKEN_FILE=/path/to/token node test/harness.js /path/to/test-images
```

发布：修改 `src/info.json` 的 `version`，在下方更新日志加一行，提交后 `git tag vX.Y.Z && git push origin vX.Y.Z`。GitHub Actions 会打包 `.bobplugin`、创建 Release，并把 sha256/url 写入 `appcast.json`。
Release: bump `version` in `src/info.json`, add a changelog line below, commit, then push a `vX.Y.Z` tag. CI packages the `.bobplugin`, creates the Release and updates `appcast.json`.

## 更新日志 / Changelog

- **0.1.1**: 源语言为自动时不再把 Bob 的检测结果锁给 Vision（省略 `languages`，用服务端默认 zh-Hans+en-US）；英文同时带简体中文；越南语改为 Vision 的 `vi-VT`。 / Auto no longer locks Vision to Bob's detected language (omit `languages`, server default zh-Hans+en-US); English also includes zh-Hans; Vietnamese uses Vision's `vi-VT`.
- **0.1.0**: 首个版本：按行识别、表格制表符、位置信息（原图翻译）、繁体保留、验证、401/413/连接/超时错误提示。 / First release: row OCR, table tabs, bounding boxes, Traditional kept for zh-Hant, validate, clear errors.

## License

MIT
