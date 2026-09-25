# casty

ターミナルで本物の Chrome ブラウザを動かす。

**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

casty は w3m や lynx のようなテキストブラウザではありません。ヘッドレス Chrome を起動し、CDP でレンダリング結果を取得して、Kitty graphics protocol でターミナルに描画します。Chrome のリモートデスクトップがターミナルに収まった感じです。

![Ghostty 上で動作する casty](docs/screenshot-ghostty.png)

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## 仕組み

```
ターミナル（あなた）     casty               Chrome（ヘッドレス）
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Kitty       │ ←──  │  Screencast  │ ←──  │  完全な Web   │
│  graphics    │      │  + 高解像度   │      │  レンダリング  │
│  画面表示     │      │  キャプチャ   │      │  JS, CSS,    │
│              │ ──→  │  入力        │ ──→  │  Canvas,     │
│  マウス/KB    │      │  ブリッジ     │      │  WebGL       │
└──────────────┘      └──────────────┘      └──────────────┘
```

レンダリングはすべて Chrome がやります。casty はフレームをターミナルに流して入力を返すだけのブリッジ（約2300行）。Playwright も puppeteer も使わず、WebSocket で生 CDP を叩いています。

本物の Chrome なので JavaScript, CSS, Canvas, WebGL 全部動きます。ステルスパッチで Google ログインも通ります。マウスのクリック、スクロール、ドラッグ、キーボード入力 — 普通のブラウザと同じ操作ができます。

## どういうときに使う？

SSH でヘッドレスサーバーに入っていて Web ページを確認したいとき、普通は `curl` か `lynx` か X11 転送しかない。casty ならターミナルを離れずに本物のブラウザが使えます。X11 も VNC も Wayland もいらない。Kitty 対応ターミナルさえあれば OK。

### Google Meet でカメラ＆マイク（実験的）

![casty で Google Meet](docs/screenshot-meet.png)

ffmpeg 経由でカメラとマイクをキャプチャし、Google Meet や Zoom 等の WebRTC サイトで使えます。`ffmpeg` のインストールが必要です。映像はデバイスから直接取得するため、背景エフェクトは使えません。有効にするには[設定](#設定)を参照。

## インストール

```bash
npm install -g @sanohiro/casty
casty
```

ソースから:

```bash
git clone https://github.com/sanohiro/casty.git
cd casty && npm install
./bin/casty
```

初回起動時に Chrome Headless Shell が `~/.casty/browsers/` に自動インストールされます。

### 必要環境

- **Kitty graphics protocol** 対応ターミナル（動作確認済み: Ghostty, kitty, bcon）
- Node.js >= 18
- `unzip`（Chrome 自動インストールに必要）

### tmux

tmux 内で casty を使う場合は、Kitty graphics のエスケープシーケンスを
ターミナルまで通すために passthrough を有効にしてください:

```tmux
set -g allow-passthrough on
```

## 使い方

```bash
casty https://google.com
casty https://youtube.com
casty   # ホームページを開く
```

### キーバインド

| キー | アクション |
|------|-----------|
| Alt+L | アドレスバー |
| Alt+F / Ctrl+L | ヒントモード（Vimium 風） |
| Alt+Left / Right | 戻る / 進む |
| Ctrl+U / Ctrl+K | 戻る / 進む（アドレスバーではカーソル前後の文字列を切り取り／復元） |
| Alt+C | 選択テキストをコピー |
| Ctrl+V | ペースト |
| Ctrl+Q | 終了 |

`~/.casty/keys.json` でカスタマイズ可能。

### ヒントモード

**Alt+F** または **Ctrl+L** でクリック可能な要素にラベルを表示。ラベルを入力してクリック。ホームロウキー (`a s d f j k l`) を使用。

### アドレスバー

**Alt+L** で開く。URL または検索クエリを入力。`/b クエリ` でブックマーク検索。

### ブックマーク

`~/.casty/bookmarks.json` を作成:

```json
{
  "GitHub": "https://github.com",
  "YouTube": "https://youtube.com"
}
```

### 設定

`~/.casty/config.json`:

```json
{
  "homeUrl": "https://github.com/sanohiro/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| キー | 説明 | デフォルト |
|------|------|-----------|
| `homeUrl` | スタートページ | `https://github.com/sanohiro/casty` |
| `searchUrl` | 検索エンジン URL | `https://www.google.com/search?q=` |
| `transport` | 画像転送方式: `auto`, `file`, `inline` | `auto` (bcon/kitty→file、他→inline) |
| `format` | キャプチャ形式: `auto`, `png`, `jpeg` | `auto` (file→jpeg adaptive、inline→png) |
| `mouseMode` | `1002` (ボタンイベント) or `1003` (全イベント) | 自動 (Ghostty→1003、他→1002) |
| `media` | WebRTC 用カメラ/マイク有効化（実験的、`ffmpeg` 必要） | `false` |

## 比較

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| エンジン | Chrome | Firefox | 独自パーサー |
| 描画 | ピクセルそのまま | テキスト近似 | テキストのみ |
| JavaScript | 動く | 動く | 動かない |
| 表示方式 | Kitty graphics | 文字セル | 文字セル |
| 依存 | Node.js + Chrome | Go + Firefox | 単体 |

<details>
<summary>技術詳細</summary>

全体で約2300行の JavaScript です。中でやっていること:

- chrome-headless-shell を起動して生 CDP WebSocket で通信
- `Runtime.enable` は絶対に送らない（Google ログインが壊れる。これは苦労して発見した）
- ステルスパッチは `Page.addScriptToEvaluateOnNewDocument` でページロード前に注入
- フレーム取得はハイブリッド方式: 低解像度 Screencast で変更を検知して、`Page.captureScreenshot` で DPR 対応の高解像度フレームを取得
- ファイル転送モードでは JPEG→PNG のアダプティブ切替: スクロール中や動画再生中は高速な JPEG、止まったら鮮明な PNG
- CSI 14t でターミナルのピクセルサイズを取得して自動ズーム

```
bin/casty          シェルラッパー（Chrome インストール/更新）
bin/casty.js       エントリポイント（ターミナル、ズーム、リサイズ）
lib/browser.js     CDP ブラウザ制御、フレームキャプチャ
lib/cdp.js         軽量 CDP WebSocket クライアント
lib/chrome.js      Chrome 検出、起動、プロファイルクリーンアップ
lib/kitty.js       Kitty graphics protocol（file/inline）
lib/input.js       マウス/キーボード処理
lib/hints.js       Vimium 風ヒントモード
lib/urlbar.js      アドレス/検索バー
lib/config.js      ユーザー設定
lib/keys.js        キーバインド設定
lib/bookmarks.js   ブックマーク検索
```

</details>

## トラブルシューティング

### YouTube で音が出ない（Ubuntu Server）

Chrome はシステムのオーディオサーバーを通じて直接音声を再生します。音が出ない場合：

```bash
sudo apt install pulseaudio
sudo usermod -aG audio $USER
# ログアウトして再ログイン後：
pulseaudio --start
```

### Chrome がクラッシュする

casty が起動しない、または Chrome がクラッシュする場合、ブラウザキャッシュを削除してください：

```bash
rm -rf ~/.casty/browsers
casty  # Chrome が自動で再ダウンロードされます
```

すべての設定とプロファイルをリセットするには：

```bash
rm -rf ~/.casty
```

## 実装メモ

### 入力座標とデバイススケールファクター

CDP の `Input.dispatchMouseEvent` は常に **CSS ピクセル**で指定します。
ズーム / デバイススケールファクターを掛けてはいけません。

casty は `Emulation.setDeviceMetricsOverride` で `deviceScaleFactor = zoom`
をエミュレートして高解像度フレームを得ています。デバイスエミュレーション中に
`Page.captureScreenshot` を実行すると、Chromium は物理解像度のビットマップを
得るため、エミュレートしたビューを一時的に `エミュレート DSF / 実 DSF` 倍に
拡大し、撮影後に元に戻します（`content/browser/devtools/protocol/page_handler.cc`
の `PageHandler::CaptureScreenshot`）。入力処理はエミュレーションを考慮しない
ため、キャプチャ中に届いたクリックはデバイスピクセルとして解釈され、
`(x / zoom, y / zoom)` に当たります。フレームは毎秒約 12 回キャプチャされるので、
タップが「ときどき」外れる、または左上の別の要素に当たる症状として現れました。
CSS ピクセルで描くクリックマーカーの位置は正しく見えます。

対策: Chrome を `--force-device-scale-factor=<zoom>` 付きで起動し、実 DSF と
エミュレート DSF を一致させます。拡大率が 1 になるので、キャプチャ中でも入力は
CSS ピクセルのまま扱われます。フレーム解像度は変わりません。以前の
「headless-shell はデバイスピクセルを受け取る」という誤った結論も、
サンプルの大半がこのキャプチャ競合に当たっていたことで説明できます。

既知の制限: 実行中にズームが変わった場合（ターミナルのフォントサイズ変更）、
実 DSF は casty を再起動するまで起動時の値のままです。

## ライセンス

MIT
