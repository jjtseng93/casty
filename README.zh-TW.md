# casty

透過終端機操作瀏覽器與 Wayland 桌面。

**[English](README.md)** | **[日本語](README.ja.md)**

> **這是 [jjtseng93](https://github.com/jjtseng93) 從 [sanohiro/casty](https://github.com/sanohiro/casty) fork 出來的版本。** 保留上游的 Chrome 終端瀏覽器，並把同一套 CDP／Kitty 接層擴充到 [Buninu Browser](https://github.com/jjtseng93/buninu-browser) 與 [Buninu Land](https://github.com/jjtseng93/buninu-land)；顯示內容可以是 Wayland 桌面，不只網頁。
>
> - 用 `CASTY_BROWSER` 選擇引擎；`--no-shortcuts` 將頁面按鍵傳給應用，仍可點 `@` 進入本地命令列。
> - 協商 Kitty 鍵盤事件，包含 Super 與按鍵放開，並傳遞水平／垂直滾輪及修飾鍵。網址列的選取與剪貼板編輯仍在本地處理。
> - 探測終端機的檔案傳輸能力；相容引擎與終端可協商 Buninu RGBA／BGRA 原始檔案，省去該路徑的圖片編碼。其他組合維持 PNG／JPEG 擷取。擷取間隔可調，預設 16 ms，不代表保證的幀率。
>
> 比對基準為上游 [**v1.3.3（`f72ecdd`）**](https://github.com/sanohiro/casty/commit/f72ecdd)。Chrome 渲染、Kitty 圖片與網址列編輯原本就來自上游，上游最新也修正了長網址編輯；這些是共同基礎，不是 fork 獨有功能。

Casty 透過 CDP 接收已繪製的畫面，以 Kitty graphics protocol 顯示並送回輸入。仍可使用 Chrome；選擇 Buninu Browser 或 Land，改變的是繪圖引擎與可用功能，不是終端傳輸方式。

![在 Ghostty 上執行的 casty](docs/screenshot-ghostty.png)

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## 運作原理

```
┌──────────────────────────────────┐
│ 終端機（你）                     │
│ Kitty graphics 畫面顯示          │
│ 滑鼠 / 鍵盤                      │
└──────────────────────────────────┘
    ▲ 畫面              │ 輸入
    │                   ▼
┌──────────────────────────────────┐
│ casty                            │
│ Screencast + 高解析度擷取        │
│ 輸入橋接                         │
└──────────────────────────────────┘
    ▲ 畫面              │ 輸入
    │                   ▼
┌──────────────────────────────────┐
│ Chrome / Buninu Browser / Land   │
│ 引擎／合成器繪圖                 │
│ 網頁或 Wayland 應用              │
└──────────────────────────────────┘
```

渲染由選定的引擎負責。Casty 直接透過 CDP WebSocket 橋接終端圖形與輸入，不使用 Playwright 或 Puppeteer。

使用 Chrome 時，網頁渲染、Canvas 與 WebGL 由 Chrome 提供；Buninu Browser 有自己的相容範圍，Land 則顯示 Wayland 客戶端。Chrome 專用的 stealth、攝影機與麥克風整合，不代表其他引擎也具備相同支援。

## 為什麼要用它？

透過 SSH 在無頭伺服器上工作、又需要看一下網頁時，通常只能用 `curl`、`lynx` 或 X11 轉送。casty 讓你不離開終端機就能用真正的瀏覽器。Chrome 路徑不需要 X11、VNC 或 Wayland 桌面，只要支援 Kitty graphics 的終端機；選擇 Land 時，該終端則成為 Wayland 客戶端的顯示入口。

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
  - 這個 fork 只在 [Buninu Linux](https://github.com/jjtseng93/buninu-linux) 的 [bunterm](https://github.com/jjtseng93/buninu-linux/tree/main/initramfs/lib/bunterm) 以及 [jsgotty](https://github.com/jjtseng93/js-gotty) 裡實測過
- Bun（或執行 `npm install` 後使用 Node.js >= 18）
- `unzip`（自動安裝 Chrome 時需要）

### tmux

在 tmux 裡使用 casty 時，請啟用 passthrough，讓 Kitty graphics 的跳脫序列
能傳到你的終端機：

```tmux
set -g allow-passthrough on
```

## 使用方式

### 連接既有瀏覽器或桌面

```sh
casty --attach 9222
casty --attach http://127.0.0.1:9222
casty --attach ws://127.0.0.1:9222/devtools/page/TARGET_ID
casty --attach 9222 --readonly
# Land：頁面快捷鍵向下傳遞，點 @ 進入本地命令列
casty --attach 9222 --no-shortcuts
```

`--attach` 預設可操作。純 port 代表 localhost；HTTP(S) 查詢既有頁面，page WebSocket URL 則直接指定頁面（也接受 WSS）。有多個頁面時會列出各自的 WebSocket URL 並退出，讓你明確選擇。不啟動／下載瀏覽器、不建立頁面、不自動導航、不修改 viewport／DPR／UA，也不注入啟動腳本。既有畫面會縮放到終端機格子內；終端機 resize 只改本地顯示與滑鼠座標換算。attach 模式不提供 zoom 命令；退出只斷線，不關閉瀏覽器或頁面。

`--readonly` 可搭配 attach 或一般啟動，初始只觀看。用 **Ctrl-E → `readonly on`／`readonly off`** 切換；單打 `readonly` 顯示狀態。搭配 `--no-shortcuts` 時可點 **@** 輸入命令。唯讀會阻擋頁面按鍵、滑鼠、滾輪、貼上、導航、重新載入及修改頁面的命令；本地命令列／網址列編輯、複製網址與退出仍可用。這是前端防誤操作，不是伺服器權限隔離。attach 仍會啟用 CDP 頁面事件並啟停畫面串流，可能影響同一 target 的另一個觀看者。

圖片區固定保留終端最右側一欄，網址列仍使用全寬。一般模式依此區域設定 viewport，不縮短可用高度；attach 保持遠端比例，因此仍可能有額外留白。

attach 的遠端斷線時會保留最後畫面，並以紅色 **@** 標示。點它輸入 `q`，或使用原本的退出快捷鍵才會退出；期間停止截圖與遠端輸入。

attach 在沒有完成截圖 1 秒後會補拍一張，唯讀模式也適用。正常更新會重設計時器；截圖慢時不會堆積定期請求。

```bash
cd casty/bin
bun casty.js https://google.com
bun casty.js https://youtube.com
bun casty.js   # 開啟首頁
bun casty.js example.com -- --lang=ja   # -- 之後的參數會傳給瀏覽器
CASTY_BROWSER=/path/to/buninu-browser.js bun casty.js   # 指定瀏覽器
CASTY_ZOOM=1.5 bun casty.js   # 在自動縮放之上再放大 1.5 倍
```

瀏覽器依序使用 `CASTY_BROWSER`、`BUN_CHROME_PATH`，都沒有設定時才自動尋找。
副檔名是 `.js`、`.ts` 或類似的瀏覽器會用 Bun 執行（找不到 Bun 時用執行 casty 的 runtime），其他則直接執行。

### 頁面按鍵全部傳入

使用 `casty --no-shortcuts [網址]`，頁面上的 Ctrl+Q、Ctrl+E、Ctrl+V 等所有
按鍵都傳給瀏覽器／compositor。左側原本 loading 的三格區域固定顯示 **@**，
平時青藍色、載入中橘色。點擊該區會開啟**空白 `cmd>`**，輸入 `q`（或
`quit`／`exit`）再按 Enter 即可退出。點網址維持原本編輯行為；網址列與
命令列保留編輯快捷鍵，包括 Alt+C、Ctrl+V，以及 Ctrl+C 複製，以及 Esc 取消編輯。
未加此選項時，維持原本快捷鍵與 loading 動畫。

### 快捷鍵

| 按鍵 | 動作 |
|------|------|
| Alt+L | 網址列 |
| Ctrl+E | 指令列 |
| Alt+F / Ctrl+L | 提示模式（Vimium 風格） |
| Alt+Left / Right | 上一頁 / 下一頁 |
| Ctrl+U / Ctrl+K | 上一頁 / 下一頁（在網址列中則是剪下／還原游標前後的文字） |
| Alt+C | 複製選取的文字 |
| Ctrl+V | 貼上 |
| Ctrl+C | 傳給頁面；在網址列或指令列複製 |
| Ctrl+Q | 離開 |

可透過 `~/.casty/keys.json` 自訂。

### 滑鼠捲動

垂直、水平與斜向滾輪依各自軸向傳遞，每個終端滾輪回報對應 100 CDP 像素，保留 Shift、Alt、Ctrl。若外層終端將 Shift＋滾輪轉為水平捲動，Casty 不會再次交換軸向。目前使用的終端滑鼠協定無法編碼 Super。應用本身須有可捲動內容，事件作用於回報的游標位置。

### Kitty 鍵盤

Casty 會自動偵測 [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)，
要求 flags **1、2、8**，傳遞可區分的按鍵、按下／重複／放開及所有按鍵事件。
新版 jsgotty、bunterm 與其他相容終端可直接使用；Ctrl、Alt、Shift、Super
各自保留，Super 以 CDP Meta 傳入（`keys.json` 使用 `meta`）。不支援的終端
維持傳統輸入；退出 casty 時會彈出自己的鍵盤模式，恢復終端先前的設定。

編輯時按 **Tab** 可切換網址與 `cmd>` 模式，保留文字與游標位置。
網址列和指令列可用滑鼠左鍵拖曳、**Shift+方向鍵** 選字，Shift+Home／End
可選到行首／行尾。**Alt+C / Ctrl+C** 優先複製選取部分，沒有選取時複製整段文字。
**Ctrl+V** 透過 OSC 52 貼上：有選取就取代選取部分，否則從游標插入。放開事件不會重複觸發本機操作或漏送到底下頁面。
若組合鍵先被作業系統、瀏覽器或外層終端攔截，casty 仍無法收到。

### 提示模式

按 **Alt+F** 或 **Ctrl+L** 會在可點擊的元素上顯示標籤，輸入標籤即可點擊。標籤使用主鍵列按鍵（`a s d f j k l`）。

### 網址列

按 **Alt+L** 開啟。輸入網址或搜尋關鍵字。`/b 關鍵字` 可搜尋書籤。

### 指令列

**Ctrl+E** 會把網址列變成 `cmd>` 提示字元，Enter 執行，Esc 取消。

| 指令 | 動作 |
|---|---|
| `open <url\|query>` (`o`, `go`) | 開啟網址或搜尋 |
| `back` (`b`) / `forward` (`f`) | 上一頁 / 下一頁 |
| `reload` (`r`) | 重新載入 |
| `home` | 首頁 |
| `bookmark [query]` (`bm`) | 開啟第一個符合的書籤 |
| `links` (`hints`, `l`) | 提示模式 |
| `copy` (`c`) / `paste` (`p`) | 複製選取文字 / 貼上 |
| `copyurl` (`yank`, `y`) | 複製目前網址 |
| `pasteurl` (`pu`) | 把剪貼簿內容貼到網址列，可以修改或按 Enter 送出 |
| `download` (`dl`, `save`) | 把瀏覽器收到的頁面原始內容存到系統的「下載」資料夾 |
| `find [文字]` (`/文字`) | 在頁面中尋找；只打 `find` 跳到下一個 |
| `eruda` (`devtools`) | 在頁面裡顯示或隱藏 [eruda](https://github.com/liriliri/eruda) 主控台（從 CDN 載入，需要網路） |
| `zoom [n\|n%\|+\|-\|reset]` (`z`) | 顯示或設定縮放，1 是自動縮放 |
| `cdp [ws]` | 顯示 CDP addr:port、連線狀態、引擎、協定與待回覆數；`cdp ws` 顯示完整 WebSocket 接點 |
| `kitty [inline\|file]` | 顯示傳輸方式與協商後的截圖格式，或切換本次傳輸方式 |
| `pixelmouse [on\|off]` | 顯示滑鼠模式；查詢並啟用像素座標，或退回字元格座標 |
| `help` (`?`) | 列出指令 |
| `quit` (`q`) | 結束 |

Casty 啟動時會查詢模式 1016；收到支援回覆才啟用像素座標，不支援或 500 毫秒內無回覆就使用 SGR 1006 字元格座標（包含 Konsole 25.04.2）。在 Ctrl+E 輸入 `pixelmouse on` 可重新查詢，`pixelmouse off` 立即退回 1006，單獨輸入 `pixelmouse` 顯示目前模式。切換只影響本次執行；config.json 設定 `"mousePixels": false` 可預設使用字元格模式並略過查詢。

像素模式也需要成功取得終端像素尺寸（CSI 14t）。Casty 會依實際字元格尺寸（包含小數）將回報座標換算到影像範圍；尺寸不明時維持 1006。更新 jsgotty 後，請重啟伺服器、重新載入瀏覽器網頁以載入新版前端，再重啟 Casty。


網址列和指令列都可以：

- **上 / 下鍵**：翻這個模式的歷史，存在 `~/.casty/history.json`
- **點擊**提示字元（` > ` 或 `cmd>`）：在兩種模式間切換，已輸入的文字保留；點文字則移動游標
- **雙擊**網址列：左 1/3 是下一筆歷史，中間是上一筆，右 1/3 等同 Enter
- 文字比網址列長時會跟著游標**水平捲動**；**Home / End** 跳到最前／最後

`zoom 1.5`、`zoom 150%`、`zoom +`、`zoom -` 會立即生效；`CASTY_ZOOM` 設定啟動時的縮放。
`~/.casty/keys.json` 還可以綁定這些動作：`command`、`reload`、`home`、`copy_url`、`paste_url`、`download`、`eruda`、`zoom_in`、`zoom_out`、`zoom_reset`。

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
  "homeUrl": "https://github.com/jjtseng93/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| 鍵 | 說明 | 預設值 |
|----|------|--------|
| `homeUrl` | 首頁 | `https://github.com/jjtseng93/casty` |
| `searchUrl` | 搜尋引擎網址 | `https://www.google.com/search?q=` |
| `transport` | 影像傳輸方式：`auto`、`file`、`inline` | `auto`（查詢檔案存取；失敗或逾時使用 inline） |
| `format` | 擷取格式：`auto`、`png`、`jpeg` | `auto`（file → 自適應 JPEG，inline → PNG） |
| `mouseMode` | `1002`（按鍵事件）或 `1003`（所有事件） | 自動（Ghostty→1003，其他→1002） |
| `media` | 為 WebRTC 啟用攝影機/麥克風（實驗性，需要 `ffmpeg`） | `false` |

### 影像傳輸與截圖格式

按 `Ctrl-E`：`kitty` 顯示目前傳輸方式與協商後的截圖格式（例如 `Kitty: file · format=bgra`）；`kitty inline` 或 `kitty file` 切換本次執行的模式，不修改設定檔。自動模式先用 inline，查詢暫存圖片檔，只有收到對應的 OK 才使用 file；700 毫秒逾時則保留 inline。手動 file 不做探測，必須能共用路徑。`format: auto` 在檔案探測成功後選用自適應 JPEG，否則用 PNG。手動切換傳輸方式保留編碼格式（raw 切換成 inline 時則退回原設定）；inline JPEG 需要接收端的解碼器支援。

使用 file 傳輸時，Casty 先查詢終端偏好的原始像素格式，再以一次截圖確認 CDP 支援。只有精確的 `OK Buninu1 bgra` 或 `OK Buninu1 rgba` 回覆，加上有效的 CDP 原始像素檔案回應，才會啟用 raw；優先於所有設定格式，包括明確指定的 PNG/JPEG/WebP。這是 Buninu 私有擴充，可省去圖片編碼及像素的 base64 傳輸。不支援、逾時或執行中失敗會退回原設定策略：auto 在 file 使用 JPEG 並於靜止時精修 PNG，在 inline 使用 PNG。inline 不探測 raw；切換成 inline 後，本次連線停用 raw。

原始像素檔案以 Kitty `t=t` 轉送，由終端機讀取後刪除。Casty 接受產生端提供的路徑，不特判目錄或檔名，也不自行刪除這些檔案；未被消費的檔案由產生端兜底清理。仍會驗證格式、尺寸與檔案大小。

協商成功的 raw 截圖使用標準 CDP `clip`，固定 `scale: 1`，小數 CSS 尺寸保留到換算實體像素時才取整；透過 `Page.getLayoutMetrics` 取得頁面捲動位置。這讓非整數縮放仍精確對齊終端字元格（例如 1.75 倍時的 1918×1053），避免 bunterm 多做一次縮放。PNG／JPEG 路徑維持原行為，兼容小數 clip 取整方式不同的 Chromium 版本。

raw 協商成功後，導航中斷的截圖或已被移除的舊畫面會略過，不會因此永久停用 raw；不支援的格式或無效 raw 回應仍退回原本編碼。

變動偵測 screencast 同時帶標準 `maxWidth/maxHeight` 和私有 `clip` 擴充，使用相同寬高及 `scale: 1`。Browser／Land 保持原像素密度直接裁切、不縮放；Chromium 忽略 `clip` 並使用原本 max 限制。通知圖片不會顯示，導航時亦同。raw 串流另帶私有選項 `clip: {x: 0, y: 0, width: 0, height: 0, scale: 1}`。Browser／Land 以固定 1×1 PNG 佔位資料回覆更新，不讀取或渲染場景；Casty 忽略佔位資料，再擷取真正的 raw 畫面。其他引擎可忽略這個選項；退回編碼格式時便不再要求它。

### 截圖間隔

設定 `CASTY_CAPTURE_MIN_INTERVAL=16` 可將高解析度截圖開始之間的最短間隔改成 16 ms，預設為 16 ms。接受 0–60000 的整數毫秒；0 表示取消時間節流，但仍一次只處理一張截圖。無效值會提示並回退 16 ms。串流啟動時讀取設定，修改後請重啟 Casty。實際 FPS 仍受繪製、編碼與終端輸出速度限制；強制截圖仍可繞過節流。

```sh
CASTY_CAPTURE_MIN_INTERVAL=16 bun index.js
```

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

Casty 使用 JavaScript 實作。底層做的事情：

- 啟動 chrome-headless-shell，透過原生 CDP WebSocket 溝通
- 絕對不送 `Runtime.enable`（會讓 Google 登入壞掉，這是吃過苦頭才發現的）
- stealth 修補透過 `Page.addScriptToEvaluateOnNewDocument` 在頁面載入前注入
- 畫面擷取採混合方式：低解析度 Screencast 負責偵測變化，再用 `Page.captureScreenshot` 取得符合 DPR 的高解析度畫面
- 選用 JPEG 時，檔案傳輸模式使用自適應 JPEG→PNG：捲動或播放影片時用快速的 JPEG，畫面靜止後改用清晰的 PNG
- 透過 CSI 14t 偵測終端機像素尺寸，自動調整縮放

```
bin/casty.js       進入點（終端機、縮放、調整大小）
lib/browser.js     CDP 瀏覽器控制、畫面擷取
lib/cdp.js         輕量 CDP WebSocket 用戶端
lib/chrome.js      Chrome 偵測、啟動、設定檔清理
lib/install.js     安裝/更新 Chrome Headless Shell
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

CDP 逾時：查詢、可重送的設定與導航會在失敗後等一秒再試，等待期間仍接受遲到的回覆；逾時後延長期限，讓慢機器有機會完成。新導航會取代舊導航的重試，`javascript:` 網址不重送。截圖失敗使用單一恢復佇列，沒有新畫面事件也會重試。關閉會取消重試；後端斷線保留終端畫面，直到使用者退出。輸入、任意 JavaScript 與腳本註冊不盲目重送，避免重複執行副作用；建立分頁逾時會查詢分頁列表。瀏覽器啟動較慢時等待同一個程序，安裝後版本檢查逾時也不會刪除 binary。

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
