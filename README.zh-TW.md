# casty

在終端機裡執行真正的 Chrome 瀏覽器。

**[English](README.md)** | **[日本語](README.ja.md)**

> **這是 [jjtseng93](https://github.com/jjtseng93) 從 [sanohiro/casty](https://github.com/sanohiro/casty) fork 出來的版本。** 主要改動：
>
> - 修復點擊連結：點按有時候點不到，或點到錯的元素（見[實作筆記](#實作筆記)）
> - 適配 [Buninu Linux](https://github.com/jjtseng93/buninu-linux) 的 kernel VT：在那裡無法使用 Alt+Left / Alt+Right 導航快捷鍵，改用 **Ctrl+U / Ctrl+K** 上一頁 / 下一頁

casty 不是 w3m 或 lynx 那種文字模式瀏覽器。它會啟動無頭（headless）Chrome，透過 CDP 取得渲染好的畫面，再用 Kitty graphics protocol 畫到終端機上。可以把它想成一個塞進終端機視窗的 Chrome 遠端桌面。

![在 Ghostty 上執行的 casty](docs/screenshot-ghostty.png)

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## 運作原理

```
終端機（你）             casty               Chrome（無頭）
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Kitty       │ ←──  │  Screencast  │ ←──  │  完整網頁     │
│  graphics    │      │  + 高解析度   │      │  渲染         │
│  畫面顯示     │      │  擷取         │      │  JS, CSS,    │
│              │ ──→  │  輸入         │ ──→  │  Canvas,     │
│  滑鼠/鍵盤    │      │  橋接         │      │  WebGL       │
└──────────────┘      └──────────────┘      └──────────────┘
```

所有渲染都由 Chrome 負責。casty 只是一座橋（約 2300 行），把畫面串流到終端機、再把輸入送回去。不用 Playwright，也不用 puppeteer，直接透過 WebSocket 使用原生 CDP。

因為是真正的 Chrome，JavaScript、CSS、Canvas、WebGL 全都能用，Google 登入也沒問題（stealth 修補可以繞過機器人偵測）。滑鼠點擊、捲動、拖曳、打字，都跟一般瀏覽器一樣。

## 為什麼要用它？

透過 SSH 在無頭伺服器上工作、又需要看一下網頁時，通常只能用 `curl`、`lynx` 或 X11 轉送。casty 讓你不離開終端機就能用真正的瀏覽器。不需要 X11、VNC 或 Wayland，只要一個支援 Kitty graphics 的終端機。

### Google Meet 搭配攝影機與麥克風（實驗性）

![在 casty 上使用 Google Meet](docs/screenshot-meet.png)

攝影機和麥克風可以透過 ffmpeg 串流到 Google Meet、Zoom 等 WebRTC 網站，需要先安裝 `ffmpeg`。因為影像直接從裝置擷取，所以無法使用背景特效。啟用方式請見[設定](#設定)。

## 安裝

```bash
git clone https://github.com/jjtseng93/casty
cd casty/bin
bun casty.js https://google.com
```

如果系統有安裝 `chromium-headless-shell`，會優先使用它；否則第一次執行時，Chrome Headless Shell 會自動安裝到 `~/.casty/browsers/`。

### 在空的 Debian 上安裝依賴

精簡的 Debian（例如新建立的容器或 chroot）缺少 casty 需要的套件，請先安裝：

```bash
apt update
apt install --no-install-recommends ca-certificates curl unzip chromium-headless-shell fonts-noto-cjk fonts-noto-color-emoji git
curl -fsSL https://bun.sh/install | bash
```

### 在 Buninu Linux 上的完整啟動方法

在 Buninu Linux 的 shell 裡，用 [js-udocker](https://github.com/jjtseng93/js-udocker) 下載 x64 Debian rootfs 並進入，安裝依賴後啟動 casty：

```bash
# 請先在 bunterm 裡執行（例如 bunterm --font-size 13）
bun x bunproot --git --yes clone https://github.com/jjtseng93/js-udocker
cd js-udocker
bun udocker.js pull --platform=linux/amd64 debian:13
bun udocker.js create --name db debian:13
cd ~/.udocker/containers/db/ROOT
chroot . /bin/bash
apt update
apt install --no-install-recommends ca-certificates curl unzip chromium-headless-shell fonts-noto-cjk fonts-noto-color-emoji git
curl -fsSL https://bun.sh/install | bash
bun x bunmsh
cd
git clone https://github.com/jjtseng93/casty
cd casty/bin
bun casty.js buninu.org
```

### 系統需求

- 支援 **Kitty graphics protocol** 的終端機（已在 Ghostty、kitty、bcon 上測試）
- Bun（或執行 `npm install` 後使用 Node.js >= 18）
- `unzip`（自動安裝 Chrome 時需要）

### tmux

在 tmux 裡使用 casty 時，請啟用 passthrough，讓 Kitty graphics 的跳脫序列
能傳到你的終端機：

```tmux
set -g allow-passthrough on
```

## 使用方式

```bash
cd casty/bin
bun casty.js https://google.com
bun casty.js https://youtube.com
bun casty.js   # 開啟首頁
```

### 快捷鍵

| 按鍵 | 動作 |
|------|------|
| Alt+L | 網址列 |
| Alt+F / Ctrl+L | 提示模式（Vimium 風格） |
| Alt+Left / Right | 上一頁 / 下一頁 |
| Ctrl+U / Ctrl+K | 上一頁 / 下一頁（在網址列中則是剪下／還原游標前後的文字） |
| Alt+C | 複製選取的文字 |
| Ctrl+V | 貼上 |
| Ctrl+Q | 離開 |

可透過 `~/.casty/keys.json` 自訂。

### 提示模式

按 **Alt+F** 或 **Ctrl+L** 會在可點擊的元素上顯示標籤，輸入標籤即可點擊。標籤使用主鍵列按鍵（`a s d f j k l`）。

### 網址列

按 **Alt+L** 開啟。輸入網址或搜尋關鍵字。`/b 關鍵字` 可搜尋書籤。

### 書籤

建立 `~/.casty/bookmarks.json`：

```json
{
  "GitHub": "https://github.com",
  "YouTube": "https://youtube.com"
}
```

### 設定

`~/.casty/config.json`：

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| 鍵 | 說明 | 預設值 |
|----|------|--------|
| `homeUrl` | 首頁 | `https://github.com/sanohiro/casty` |
| `searchUrl` | 搜尋引擎網址 | `https://www.google.com/search?q=` |
| `transport` | 影像傳輸方式：`auto`、`file`、`inline` | `auto`（bcon/kitty→file，其他→inline） |
| `format` | 擷取格式：`auto`、`png`、`jpeg` | `auto`（file→jpeg 自適應，inline→png） |
| `mouseMode` | `1002`（按鍵事件）或 `1003`（所有事件） | 自動（Ghostty→1003，其他→1002） |
| `media` | 為 WebRTC 啟用攝影機/麥克風（實驗性，需要 `ffmpeg`） | `false` |

## 比較

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| 引擎 | Chrome | Firefox | 自製解析器 |
| 渲染 | 像素完全一致 | 文字近似 | 純文字 |
| JavaScript | 支援 | 支援 | 不支援 |
| 顯示方式 | Kitty graphics | 字元格 | 字元格 |
| 相依套件 | Node.js + Chrome | Go + Firefox | 獨立執行 |

<details>
<summary>技術細節</summary>

整個程式約 2300 行 JavaScript。底層做的事情：

- 啟動 chrome-headless-shell，透過原生 CDP WebSocket 溝通
- 絕對不送 `Runtime.enable`（會讓 Google 登入壞掉，這是吃過苦頭才發現的）
- stealth 修補透過 `Page.addScriptToEvaluateOnNewDocument` 在頁面載入前注入
- 畫面擷取採混合方式：低解析度 Screencast 負責偵測變化，再用 `Page.captureScreenshot` 取得符合 DPR 的高解析度畫面
- 檔案傳輸模式使用自適應 JPEG→PNG：捲動或播放影片時用快速的 JPEG，畫面靜止後改用清晰的 PNG
- 透過 CSI 14t 偵測終端機像素尺寸，自動調整縮放

```
bin/casty          Shell 包裝腳本（安裝/更新 Chrome）
bin/casty.js       進入點（終端機、縮放、調整大小）
lib/browser.js     CDP 瀏覽器控制、畫面擷取
lib/cdp.js         輕量 CDP WebSocket 用戶端
lib/chrome.js      Chrome 偵測、啟動、設定檔清理
lib/kitty.js       Kitty graphics protocol（file/inline）
lib/input.js       滑鼠/鍵盤處理
lib/hints.js       Vimium 風格提示模式
lib/urlbar.js      網址/搜尋列
lib/config.js      使用者設定
lib/keys.js        快捷鍵設定
lib/bookmarks.js   書籤搜尋
```

</details>

## 疑難排解

### YouTube 沒有聲音（Ubuntu Server）

Chrome 直接透過系統音訊伺服器播放聲音。如果沒有聲音：

```bash
sudo apt install pulseaudio
sudo usermod -aG audio $USER
# 登出後重新登入，然後：
pulseaudio --start
```

### Chrome 當掉

如果 casty 無法啟動或 Chrome 當掉：

- 有安裝系統的 `chromium-headless-shell` 時，casty 一律使用它，不會下載 Chrome。請改為重新安裝套件：

  ```bash
  apt install --reinstall chromium-headless-shell
  ```

- 沒有安裝時，casty 使用下載到 `~/.casty/browsers/` 的 Chrome。刪除後，下次啟動會重新下載：

  ```bash
  rm -rf ~/.casty/browsers
  bun casty.js
  ```

要重設所有設定和設定檔資料：

```bash
rm -rf ~/.casty
```

## 實作筆記

### 輸入座標與裝置縮放比例

CDP 的 `Input.dispatchMouseEvent` 一律使用 **CSS 像素**，
絕對不要乘上縮放比例或裝置縮放比例（device scale factor, DSF）。

casty 透過 `Emulation.setDeviceMetricsOverride` 模擬 `deviceScaleFactor = zoom`
來取得高解析度畫面。在裝置模擬期間執行 `Page.captureScreenshot` 時，Chromium
為了截出實體解析度的點陣圖，會暫時把模擬的畫面放大「模擬 DSF ÷ 實際 DSF」倍，
截完再還原（見 `content/browser/devtools/protocol/page_handler.cc` 的
`PageHandler::CaptureScreenshot`）。輸入處理不會考慮模擬設定，所以在截圖期間
送達的點擊會被當成裝置像素，落在 `(x / zoom, y / zoom)`。畫面每秒大約擷取
12 次，症狀就是點按「有時候」點不到，或點到左上方的其他元素；而以 CSS 像素
繪製的點擊標記，位置看起來卻是正確的。

解法：啟動 Chrome 時加上 `--force-device-scale-factor=<zoom>`，讓實際 DSF 與
模擬 DSF 一致。放大倍率變成 1，即使在截圖途中，輸入也維持以 CSS 像素解讀，
畫面解析度不受影響。先前「headless-shell 吃的是裝置像素」的錯誤結論，也是因為
取樣大多剛好碰上這個截圖競爭。

已知限制：如果執行中縮放比例改變（調整終端機字體大小），實際 DSF 會維持
啟動時的值，直到重新啟動 casty。

## 授權

MIT
