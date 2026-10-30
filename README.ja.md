# casty

ターミナルからブラウザや Wayland デスクトップを操作する。

**[English](README.md)** | **[繁體中文](README.zh-TW.md)**

> **これは [sanohiro/casty](https://github.com/sanohiro/casty) の [jjtseng93](https://github.com/jjtseng93) によるフォークです。** 上流の Chrome ターミナルブラウザを維持し、同じ CDP／Kitty ブリッジを [Buninu Browser](https://github.com/jjtseng93/buninu-browser) と [Buninu Land](https://github.com/jjtseng93/buninu-land) にも拡張しています。Web ページだけでなく Wayland デスクトップも表示できます。
>
> - `CASTY_BROWSER` でエンジンを選択。`--no-shortcuts` でページ上のキーをアプリケーションに転送し、ローカル操作には `@` のコマンド入口を使えます。
> - Super やキーリリースを含む Kitty キーボードイベントを交渉し、水平・垂直ホイールと修飾キーを転送します。アドレスバーの選択・クリップボード編集はローカルで処理します。
> - 端末のファイル転送を照会し、対応するエンジンと端末では Buninu RGBA／BGRA ファイルを交渉して画像エンコードを省略します。それ以外は PNG／JPEG キャプチャを維持します。間隔は変更可能で既定値は 16 ms ですが、フレームレートを保証するものではありません。
>
> 比較対象は上流 [**v1.3.3 (`f72ecdd`)**](https://github.com/sanohiro/casty/commit/f72ecdd) です。Chrome 描画、Kitty 画像、アドレスバー編集は共通の基盤であり、上流の最新版にも長い URL の編集修正があります。これらをフォーク独自の機能とは扱いません。

Casty は描画済みのフレームを CDP で受け取り、Kitty graphics protocol で表示し、入力を返します。Chrome も引き続き使用できます。Buninu Browser や Land の選択で変わるのは描画エンジンと利用可能な機能であり、端末への転送方式ではありません。

![Ghostty 上で動作する casty](docs/screenshot-ghostty.png)

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## 仕組み

```
┌──────────────────────────────────┐
│ ターミナル（あなた）             │
│ Kitty graphics 画面表示          │
│ マウス / キーボード              │
└──────────────────────────────────┘
    ▲ フレーム          │ 入力
    │                   ▼
┌──────────────────────────────────┐
│ casty                            │
│ Screencast + 高解像度キャプチャ  │
│ 入力ブリッジ                     │
└──────────────────────────────────┘
    ▲ フレーム          │ 入力
    │                   ▼
┌──────────────────────────────────┐
│ Chrome / Buninu Browser / Land   │
│ エンジン／コンポジター描画        │
│ Web / Wayland アプリ             │
└──────────────────────────────────┘
```

描画は選択したエンジンが担当します。Casty は Playwright や Puppeteer を使わず、CDP WebSocket と端末の画像・入力を橋渡しします。

Chrome 使用時の Web 描画、Canvas、WebGL は Chrome が提供します。Buninu Browser には独自の互換性の制限があり、Land は Wayland クライアントを表示します。Chrome 向けのステルス、カメラ、マイクの統合が他のエンジンでも使えるとは限りません。

## どういうときに使う？

SSH でヘッドレスサーバーに入っていて Web ページを確認したいとき、普通は `curl` か `lynx` か X11 転送しかない。casty ならターミナルを離れずに本物のブラウザが使えます。Chrome の経路では X11、VNC、Wayland デスクトップは不要で、Kitty 対応端末だけで使えます。Land を選択すると、その端末が Wayland クライアントの表示先になります。

### Google Meet でカメラ＆マイク（実験的）

![casty で Google Meet](docs/screenshot-meet.png)

ffmpeg 経由でカメラとマイクをキャプチャし、Google Meet や Zoom 等の WebRTC サイトで使えます。`ffmpeg` のインストールが必要です。映像はデバイスから直接取得するため、背景エフェクトは使えません。有効にするには[設定](#設定)を参照。

## インストール

```bash
git clone https://github.com/jjtseng93/casty
cd casty/bin
bun casty.js https://google.com
```

システムの `chromium-headless-shell` がインストールされていればそれを優先して使います。なければ初回起動時に Chrome Headless Shell が `~/.casty/browsers/` に自動インストールされます。

### 素の Debian での依存パッケージ

最小構成の Debian（新しいコンテナや chroot など）には casty に必要なものが入っていません。先に以下をインストールしてください:

```bash
apt update
apt install --no-install-recommends ca-certificates curl unzip chromium-headless-shell fonts-noto-cjk fonts-noto-color-emoji git
curl -fsSL https://bun.sh/install | bash
```

### Buninu Linux での完全な手順

Buninu Linux のシェルから、[js-udocker](https://github.com/jjtseng93/js-udocker) で x64 Debian の rootfs を取得して入り、依存パッケージをインストールしてから casty を起動します:

```bash
# 先に bunterm 内で実行しておく（例: bunterm --font-size 13）
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

### 必要環境

- **Kitty graphics protocol** 対応ターミナル（動作確認済み: Ghostty, kitty, bcon）
  - このフォークは [Buninu Linux](https://github.com/jjtseng93/buninu-linux) の [bunterm](https://github.com/jjtseng93/buninu-linux/tree/main/initramfs/lib/bunterm) と [jsgotty](https://github.com/jjtseng93/js-gotty) でのみ動作確認しています
- Bun（または `npm install` 後の Node.js >= 18）
- `unzip`（Chrome 自動インストールに必要）

### tmux

tmux 内で casty を使う場合は、Kitty graphics のエスケープシーケンスを
ターミナルまで通すために passthrough を有効にしてください:

```tmux
set -g allow-passthrough on
```

## 使い方

### ネイティブ Windows ウィンドウ

Win32 は端末版とコマンド・入力処理を共有し、`keys.json`、`readonly`、
`--no-shortcuts`、`CASTY_ZOOM` に対応します。`casty --win32 --attach PORT`
で既存の対応エンジンに接続でき、ナビゲーションや viewport の変更は行いません。
ウィンドウを閉じると接続だけを終了します。attach モードではズームは使えません。
クリップボード操作は Windows のクリップボードを使い、終了後には端末版と
同じ操作説明とバージョンを表示します。

Windows では `casty --win32 [URL] [-- BROWSER_FLAGS...]` で CDP フレームをネイティブの Win32/GDI ウィンドウに表示できます。既定のフロントエンドはターミナルです。このバックエンドには Bun と、Buninu Browser などの Buninu raw BGRA ファイルキャプチャ対応エンジンが必要です。`CASTY_BROWSER` で指定してください。

### 起動済みのブラウザーやデスクトップに接続

```sh
casty --attach 9222
casty --attach http://127.0.0.1:9222
casty --attach ws://127.0.0.1:9222/devtools/page/TARGET_ID
casty --attach 9222 --readonly
# Land：ページのキーを転送し、@ からローカルコマンドを入力
casty --attach 9222 --no-shortcuts
```

`--attach` は既定で操作可能です。ポート番号は localhost、HTTP(S) は既存ページの検索、page WebSocket URL はページの直接指定です（WSS も対応）。複数ページがある場合は各 WebSocket URL を表示して終了するので、明示的に選択してください。ページがない場合は PUT /json/new?about:blank で作成して接続します。ブラウザーの起動／ダウンロード、追加の初期ナビゲーション、viewport／DPR／UA の変更、起動スクリプトの注入は行いません。既存画面を端末のセル内に収め、端末の resize はローカル表示とマウス座標変換だけを変更します。attach モードでは zoom コマンドを使えません。終了してもブラウザーやページは閉じません。

`--readonly` は attach と通常起動の両方で使えます。**Ctrl-E → `readonly on`／`readonly off`** で切り替え、`readonly` で状態を確認します。`--no-shortcuts` 使用時は **@** から入力できます。ページへのキー、マウス、ホイール、貼り付け、ナビゲーション、再読み込み、ページ変更コマンドを遮断します。ローカルのコマンド／アドレス編集、URL コピー、終了は利用できます。これはクライアント側の誤操作防止で、サーバーの権限制御ではありません。attach は CDP ページイベントと画面配信の開始／停止を使うため、同じ target の別の閲覧者に影響する場合があります。

画像領域は端末の右端 1 列を空け、アドレスバーは全幅を使います。通常モードは利用可能な高さを減らさず、この領域に viewport を合わせます。attach は接続先の縦横比を保つため、追加の余白が残る場合があります。

attach の接続先が切断されると最後の画面を保持し、赤い **@** を表示します。クリックして `q` を入力するか通常の終了キーで終了します。それまではキャプチャと接続先への入力を停止します。

attach はキャプチャ完了から 1 秒間更新がない場合、readonly でも補完キャプチャを行います。通常の更新でタイマーをリセットし、遅いキャプチャ中に定期リクエストを蓄積しません。

```bash
cd casty/bin
bun casty.js https://google.com
bun casty.js https://youtube.com
bun casty.js   # ホームページを開く
bun casty.js example.com -- --lang=ja   # -- 以降の引数はブラウザに渡される
CASTY_BROWSER=/path/to/buninu-browser.js bun casty.js   # ブラウザを指定
CASTY_ZOOM=1.5 bun casty.js   # 自動ズームに加えて 1.5 倍に拡大
```

ブラウザは `CASTY_BROWSER`、次に `BUN_CHROME_PATH` の順に使われ、どちらも未設定なら
自動で検出されます。拡張子が `.js`・`.ts` などのブラウザは Bun（見つからなければ casty を実行しているランタイム）で実行し、それ以外は直接実行します。

### ページへすべてのキーを転送

`casty --no-shortcuts [URL]` は Ctrl+Q / Ctrl+E / Ctrl+V を含むページ上の
キーをすべて転送します。左の読み込み表示欄には **@** が常に表示され、
通常はシアン、読み込み中はオレンジになります。クリックすると空の `cmd>`
が開き、`q`（`quit` / `exit`）と Enter で終了できます。URL のクリックと
編集中は Alt+C / Ctrl+C でコピー、Ctrl+V で貼り付け、Esc でキャンセルします。
このオプションがなければ従来のショートカットとスピナーを使います。

### キーバインド

| キー | アクション |
|------|-----------|
| Alt+L | アドレスバー |
| Ctrl+E | コマンドライン |
| Alt+F / Ctrl+L | ヒントモード（Vimium 風） |
| Alt+Left / Right | 戻る / 進む |
| Ctrl+U / Ctrl+K | 戻る / 進む（アドレスバーではカーソル前後の文字列を切り取り／復元） |
| Alt+C | 選択テキストをコピー |
| Ctrl+V | ペースト |
| Ctrl+C | ページへ送信。アドレスバーやコマンドラインではコピー |
| Ctrl+Q | 終了 |

`~/.casty/keys.json` でカスタマイズ可能。

### マウススクロール

垂直・水平・斜めのホイール入力を各軸に転送します。端末のホイール報告 1 回につき 100 CDP ピクセルで、Shift・Alt・Ctrl を保持します。外側の端末が Shift＋ホイールを水平に変換する場合、Casty は軸を再交換しません。ここで使用する端末マウスプロトコルは Super を符号化できません。対象アプリケーションにスクロール可能な内容が必要で、報告されたポインター位置に入力を送ります。

### Kitty キーボード

Casty は [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
を自動検出し、flags **1、2、8** を要求します。新しい jsgotty・bunterm などの
対応端末では Ctrl / Alt / Shift / Super と押下・リピート・解放を区別します。
Super は CDP Meta（`keys.json` では `meta`）として転送します。未対応端末では
従来の入力方式を使い、終了時には以前のキーボードモードを復元します。

編集中の **Tab** で URL と `cmd>` を切り替え、文字列とカーソル位置を保持します。
アドレスバーとコマンドラインでは左ドラッグや **Shift+矢印** で選択できます。
**Alt+C / Ctrl+C** は選択部分（未選択なら全文）をコピーします。**Ctrl+V** は OSC 52
から貼り付け、選択範囲があれば置き換え、なければカーソル位置に挿入します。キーの解放で操作を再実行しません。
OS・ブラウザー・外側の端末が先に消費したショートカットは転送できません。

### ヒントモード

**Alt+F** または **Ctrl+L** でクリック可能な要素にラベルを表示。ラベルを入力してクリック。ホームロウキー (`a s d f j k l`) を使用。

### アドレスバー

Win32 のアドレスバーは IME 入力に対応しています。アイコン／読み込みアニメーションと ` > `／`cmd> ` プロンプトは、独立した編集不可の 32px 領域（約 4 文字分）に表示されます。**Ctrl+A** はテキストのみを全選択します。Tab でプロンプトを切り替え、Up/Down でモードごとの履歴を参照し、プロンプトのクリックでモードを切り替えます。左・中央・右の各 3 分の 1 の領域でダブルクリックすると、次の履歴・前の履歴・送信を実行します。ページのクリック時にはターミナル版と同じ赤いマーカーを要求します。

**Alt+L** で開く。URL または検索クエリを入力。`/b クエリ` でブックマーク検索。

### コマンドライン

Web ページから開始したダウンロードでは、エンジンが保存先のパスを返す場合、
完了メッセージにそのパスを表示します。Casty は返されたパスをそのまま使い、
省略された場合は保存先を推測しません。両方のフロントエンドに適用されます。

Win32 でも同じコマンド名を使用できます。`kitty` は Kitty 転送を使用しないことを、`pixelmouse` はネイティブのピクセル座標入力を使用していることを表示します。

**Ctrl+E** でアドレスバーが `cmd>` プロンプトになります。Enter で実行、Esc でキャンセル。

| コマンド | 動作 |
|---|---|
| `open <url\|query>` (`o`, `go`) | URL を開く／検索 |
| `back` (`b`) / `forward` (`f`) | 戻る / 進む |
| `reload` (`r`) | 再読み込み |
| `home` | ホームページ |
| `bookmark [query]` (`bm`) | 最初に一致したブックマークを開く |
| `links` (`hints`, `l`) | ヒントモード |
| `copy` (`c`) / `paste` (`p`) | 選択テキストをコピー / 貼り付け |
| `copyurl` (`yank`, `y`) | ページの URL をコピー |
| `pasteurl` (`pu`) | クリップボードの内容をアドレスバーに貼り付け（編集または Enter で送信） |
| `download` (`dl`, `save`) | ブラウザが受け取ったページをそのままシステムのダウンロードフォルダーに保存 |
| `find [テキスト]` (`/テキスト`) | ページ内検索。`find` だけで次の一致へ |
| `eruda` (`devtools`) | ページ内の [eruda](https://github.com/liriliri/eruda) コンソールを表示・非表示（CDN から読み込むためネットワークが必要） |
| `zoom [n\|n%\|+\|-\|reset]` (`z`) | ズームの表示・設定（1 が自動ズーム） |
| `sh <command>` | **Casty が動くホスト**で shell コマンドを実行し、stdout／stderr をアドレスバーに 15 秒間表示します。`/bin/sh` を優先し、なければ `Bun.which` で検索（Windows の PowerShell／CMD を含む）。対話的 stdin はありません。 |
| `size` | CDP から現在の viewport の幅と高さ（CSS ピクセル）を表示。サイズは変更しません |
| `cdp [ws]` | CDP の addr:port、接続状態、エンジン、プロトコル、応答待ち数を表示。`cdp ws` は完全な WebSocket URL を表示 |
| `kitty [inline\|file]` | 転送方式とネゴシエートしたキャプチャ形式を表示、または今回の転送方式を切り替え |
| `pixelmouse [on\|off]` | マウスモードを表示、ピクセル座標を照会して有効化、またはセル座標に戻す |
| `help` (`?`) | コマンド一覧 |
| `quit` (`q`) | 終了 |

起動時にモード 1016 を照会し、対応の応答がある場合のみピクセル座標を有効にします。非対応または 500 ms 以内に応答がない場合は SGR 1006 のセル座標を使います（Konsole 25.04.2 を含む）。Ctrl+E で `pixelmouse on` は再照会、`pixelmouse off` は 1006 に切り替え、`pixelmouse` は現在のモードを表示します。変更は今回の実行だけに適用されます。config.json の `"mousePixels": false` で照会せずセル座標を使えます。

ピクセルモードには端末サイズの照会（CSI 14t）の成功も必要です。小数を含む実際のセルサイズで画像座標に変換し、サイズが不明なら 1006 を使います。jsgotty 更新後はサーバーを再起動し、ブラウザーのページを再読み込みしてから Casty を再起動してください。


アドレスバーとコマンドラインの共通操作：

- **↑ / ↓**：そのモードの履歴をたどる（`~/.casty/history.json` に保存）
- プロンプト（` > ` または `cmd>`）を**クリック**：入力中のテキストを保ったまま 2 つのモードを切り替え。テキストのクリックはカーソル移動
- バーを**ダブルクリック**：左 1/3 で次の履歴、中央で前の履歴、右 1/3 で Enter
- バーより長いテキストはカーソルに合わせて**横スクロール**し、**Home / End** で先頭／末尾へ移動

`zoom 1.5`・`zoom 150%`・`zoom +`・`zoom -` はすぐに反映されます。`CASTY_ZOOM` は起動時のズームを設定します。
`~/.casty/keys.json` では次のアクションも割り当てられます：`command`、`reload`、`home`、`copy_url`、`paste_url`、`download`、`eruda`、`zoom_in`、`zoom_out`、`zoom_reset`。

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
  "homeUrl": "https://github.com/jjtseng93/casty",
  "searchUrl": "https://www.google.com/search?q=",
  "transport": "auto",
  "format": "auto",
  "mouseMode": 1002
}
```

| キー | 説明 | デフォルト |
|------|------|-----------|
| `homeUrl` | スタートページ | `https://github.com/jjtseng93/casty` |
| `searchUrl` | 検索エンジン URL | `https://www.google.com/search?q=` |
| `transport` | 画像転送方式: `auto`, `file`, `inline` | `auto` (ファイル読み取りを照会、失敗・タイムアウト時は inline) |
| `format` | キャプチャ形式: `auto`, `png`, `jpeg` | `auto` (file → adaptive JPEG, inline → PNG) |
| `mouseMode` | `1002` (ボタンイベント) or `1003` (全イベント) | 自動 (Ghostty→1003、他→1002) |
| `media` | WebRTC 用カメラ/マイク有効化（実験的、`ffmpeg` 必要） | `false` |

### 画像転送とキャプチャ形式

以下の交渉とフォールバックの規則はターミナル版に適用されます。Win32 は raw BGRA を直接要求し、消費済み・破棄済みのフレームファイルを自ら削除して、生成側の未消費ファイル数の上限によるキャプチャ停止を防ぎます。

`Ctrl-E` の `kitty` で現在の転送方式とネゴシエートしたキャプチャ形式（例: `Kitty: file · format=bgra`）を表示し、`kitty inline` / `kitty file` で今回のセッションのみ切り替えます。auto は inline で開始し、一時画像ファイルへの照会に対応する OK を受け取った場合のみ file に切り替えます。700 ms でタイムアウトします。手動 file は照会を省略するため共有パスが必要です。`format: auto` はファイル照会成功時に adaptive JPEG、それ以外は PNG を選択します。手動の転送切り替えではエンコード形式を維持します（raw は inline への切り替え時に元の設定へ戻ります）。inline JPEG は対応するデコーダーが必要です。

file 転送では、端末が優先する生ピクセル形式を照会してから、CDP のスクリーンショットを一度試します。正確な `OK Buninu1 bgra` / `OK Buninu1 rgba` 応答と有効な CDP ファイル応答が揃った場合だけ raw を使い、明示的な PNG/JPEG/WebP 設定よりも優先します。この Buninu 独自拡張は画像エンコードとピクセルの base64 転送を省きます。未対応・タイムアウト・実行時エラーの場合は元の設定へ戻ります。auto は file で JPEG と静止時の PNG、inline で PNG を使います。inline では raw を照会せず、inline に切り替えるとそのセッションでは raw を無効にします。

生ピクセルファイルは Kitty `t=t` で転送し、読み取り後に端末が削除します。Casty は生成側が返したパスを受け取り、ディレクトリ名やファイル名による特別扱いや独自の削除は行いません。消費されなかったファイルは生成側が後で削除します。形式、寸法、ファイルサイズの検証は維持します。

ネゴシエート済みの raw キャプチャは標準 CDP の `clip` と `scale: 1` を使い、CSS 寸法の小数部分を物理ピクセルへの変換まで保持します。`Page.getLayoutMetrics` で文書のスクロール位置を取得します。これにより小数倍率でも端末のセル領域に正確に一致し（例: 1.75 倍で 1918×1053）、bunterm での再スケーリングを避けます。小数 clip の丸め方が異なる Chromium との互換性のため、PNG/JPEG 経路は従来の動作を維持します。

raw の確認後、ナビゲーションで中断されたキャプチャや削除済みの古いフレームはスキップし、raw を無効にしません。非対応形式や不正な raw 応答では元のコーデックへ戻ります。

更新検知用 screencast は標準の `maxWidth/maxHeight` と同じ幅・高さ、`scale: 1` の独自 `clip` 拡張を送ります。Browser/Land は元のピクセル密度で切り出し、縮小しません。Chromium は `clip` を無視し、標準の max 制限を使います。通知画像はナビゲーション中も表示しません。raw ストリームは独自オプション `clip: {x: 0, y: 0, width: 0, height: 0, scale: 1}` も送ります。Browser/Land はシーンの読み出しや描画をせず、固定の 1×1 PNG を更新通知として返します。Casty はこの仮画像を表示せず、実際の raw フレームを取得します。他のエンジンはこのオプションを無視できます。符号化形式にフォールバックすると要求を停止します。

### キャプチャ間隔

`CASTY_CAPTURE_MIN_INTERVAL=16` で高解像度キャプチャの開始間隔を最短 16 ms に設定できます（既定値: 16 ms）。0–60000 の整数ミリ秒を指定します。0 は時間制限を解除しますが、同時に処理するキャプチャは常に一つです。不正な値は警告して 16 ms に戻ります。設定はストリーム開始時に読み込まれるため、変更後は Casty を再起動してください。実際の FPS は描画、エンコード、端末出力の速度にも依存します。強制キャプチャはこの制限を迂回します。

```sh
CASTY_CAPTURE_MIN_INTERVAL=16 bun index.js
```

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

Casty は JavaScript で実装されています。中でやっていること:

- chrome-headless-shell を起動して生 CDP WebSocket で通信
- `Runtime.enable` は絶対に送らない（Google ログインが壊れる。これは苦労して発見した）
- ステルスパッチは `Page.addScriptToEvaluateOnNewDocument` でページロード前に注入
- フレーム取得はハイブリッド方式: 低解像度 Screencast で変更を検知して、`Page.captureScreenshot` で DPR 対応の高解像度フレームを取得
- JPEG を選択した場合、ファイル転送モードでは JPEG→PNG のアダプティブ切替: スクロール中や動画再生中は高速な JPEG、止まったら鮮明な PNG
- CSI 14t でターミナルのピクセルサイズを取得して自動ズーム

```
bin/casty.js       エントリポイント（ターミナル、ズーム、リサイズ）
lib/browser.js     CDP ブラウザ制御、フレームキャプチャ
lib/cdp.js         軽量 CDP WebSocket クライアント
lib/chrome.js      Chrome 検出、起動、プロファイルクリーンアップ
lib/install.js     Chrome Headless Shell のインストール/更新
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

casty が起動しない、または Chrome がクラッシュする場合：

- システムの `chromium-headless-shell` がインストールされていれば、casty は常にそれを使い、Chrome をダウンロードしません。パッケージを再インストールしてください：

  ```bash
  apt install --reinstall chromium-headless-shell
  ```

- インストールされていなければ、casty は `~/.casty/browsers/` にダウンロードした Chrome を使います。削除すると次回起動時に再ダウンロードされます：

  ```bash
  rm -rf ~/.casty/browsers
  bun casty.js
  ```

すべての設定とプロファイルをリセットするには：

```bash
rm -rf ~/.casty
```

## 実装メモ

CDP タイムアウト：照会、再送可能な設定とナビゲーションは失敗後 1 秒待って再試行し、待機中の遅い応答も受け付けます。タイムアウト後は期限を延長します。新しいナビゲーションは古い再試行を置き換え、`javascript:` URL は再送しません。画像取得は単一の復旧キューを使い、通知がなくても再試行します。終了時は再試行を取り消し、バックエンドの切断時はユーザーが終了するまで画面を残します。入力、任意の JavaScript、スクリプト登録は副作用の重複を避けて無条件には再送しません。ページ作成はページ一覧で確認します。遅い起動は同じプロセスを待ち、インストール後の確認がタイムアウトしてもバイナリを削除しません。

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
