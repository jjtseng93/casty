# casty

Use browsers and a Wayland desktop through your terminal.

**[日本語](README.ja.md)** | **[繁體中文](README.zh-TW.md)**

> **This is [jjtseng93](https://github.com/jjtseng93)'s fork of [sanohiro/casty](https://github.com/sanohiro/casty).** It retains the upstream Chrome terminal browser and extends the same CDP/Kitty bridge to [Buninu Browser](https://github.com/jjtseng93/buninu-browser) and [Buninu Land](https://github.com/jjtseng93/buninu-land), where the displayed content can be a Wayland desktop rather than a web page.
>
> - Select the engine with `CASTY_BROWSER`; use `--no-shortcuts` to pass page keys through to applications, with an `@` command entry for local controls.
> - Negotiate Kitty keyboard events, including Super and key releases, and forward horizontal/vertical wheel input with modifiers. Address-bar selection and clipboard editing remain local.
> - Probe terminal file-transfer support and negotiate optional Buninu RGBA/BGRA files with compatible engines and terminals, avoiding image encoding on that path. Other peers retain PNG/JPEG capture. The capture interval is configurable and defaults to 16 ms, not a guaranteed frame rate.
>
> Compared against upstream [**v1.3.3 (`f72ecdd`)**](https://github.com/sanohiro/casty/commit/f72ecdd). Upstream already provides Chrome rendering, Kitty images and address-bar editing, including its latest long-URL fix; those are shared foundations, not fork-only features.

Casty receives rendered frames over CDP, draws them with the Kitty graphics protocol and sends input back. Chrome remains supported; choosing Buninu Browser or Land changes the rendering engine and available features, not the terminal transport.

![casty running on Ghostty](docs/screenshot-ghostty.png)

<video src="https://github.com/user-attachments/assets/552f1972-bb53-481e-9516-c36b7e5085d8" autoplay loop muted playsinline></video>

## How It Works

```
┌──────────────────────────────────┐
│ Terminal (you)                   │
│ Kitty graphics display           │
│ Mouse / keyboard                 │
└──────────────────────────────────┘
    ▲ frames            │ input
    │                   ▼
┌──────────────────────────────────┐
│ casty                            │
│ Screencast + hi-res capture      │
│ Input bridge                     │
└──────────────────────────────────┘
    ▲ frames            │ input
    │                   ▼
┌──────────────────────────────────┐
│ Chrome / Buninu Browser / Land   │
│ Engine / compositor rendering    │
│ Pages or Wayland applications    │
└──────────────────────────────────┘
```

Rendering belongs to the selected engine. Casty bridges its CDP WebSocket to terminal graphics and input without Playwright or Puppeteer.

With Chrome, web rendering, Canvas and WebGL come from Chrome. Buninu Browser has its own compatibility limits; Land renders Wayland clients. Chrome-specific stealth and camera/microphone integrations do not imply equivalent support in other engines.

## Why use this?

If you're working over SSH on a headless server and need to check a web page, your options are usually `curl`, `lynx`, or forwarding X11. casty gives you an actual browser without leaving the terminal. The Chrome path needs no X11, VNC or Wayland desktop; a Kitty-compatible terminal is enough. With Land selected, that terminal becomes the display for its Wayland clients.

### Google Meet with camera & mic (experimental)

![Google Meet on casty](docs/screenshot-meet.png)

Camera and microphone can be streamed to WebRTC sites like Google Meet, Zoom, etc. via ffmpeg. Requires `ffmpeg` installed. Background effects are not available since the video is captured directly from the device. See [Configuration](#configuration) to enable.

## Installation

```bash
git clone https://github.com/jjtseng93/casty
cd casty/bin
bun casty.js https://google.com
```

If the system `chromium-headless-shell` is installed, it is used first. Otherwise Chrome Headless Shell is auto-installed to `~/.casty/browsers/` on first run.

### Dependencies on a bare Debian

A minimal Debian (e.g. a fresh container or chroot) does not have what casty needs. Install these first:

```bash
apt update
apt install --no-install-recommends ca-certificates curl unzip chromium-headless-shell fonts-noto-cjk fonts-noto-color-emoji git
curl -fsSL https://bun.sh/install | bash
```

### Full walkthrough on Buninu Linux

From a Buninu Linux shell: download an x64 Debian rootfs with [js-udocker](https://github.com/jjtseng93/js-udocker), enter it, install the dependencies, then run casty:

```bash
# Run inside bunterm first (e.g. bunterm --font-size 13)
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

### Requirements

- A terminal with **Kitty graphics protocol** support (tested on Ghostty, kitty, bcon)
  - This fork has only been tested in [bunterm](https://github.com/jjtseng93/buninu-linux/tree/main/initramfs/lib/bunterm) of [Buninu Linux](https://github.com/jjtseng93/buninu-linux) and in [jsgotty](https://github.com/jjtseng93/js-gotty)
- Bun (or Node.js >= 18 after `npm install`)
- `unzip` (for Chrome auto-install)

### tmux

If you run casty inside tmux, enable passthrough so Kitty graphics escape
sequences can reach your terminal:

```tmux
set -g allow-passthrough on
```

## Usage

### Attach to an existing browser or desktop

```sh
casty --attach 9222
casty --attach http://127.0.0.1:9222
casty --attach ws://127.0.0.1:9222/devtools/page/TARGET_ID
casty --attach 9222 --readonly
# Land: forward page shortcuts, with @ as the local command entry
casty --attach 9222 --no-shortcuts
```

`--attach` is writable by default. A port means localhost; HTTP(S) discovers existing pages, while a page WebSocket URL selects one directly (WSS is also accepted). If there are multiple pages, Casty lists their WebSocket URLs and exits so you can choose explicitly. It never starts/downloads a browser, creates a page, performs initial navigation, changes viewport/DPR/UA, or installs startup page scripts. The existing viewport is fitted into terminal cells; terminal resize only changes local display and pointer mapping. The zoom command is unavailable in attach mode. Exit disconnects without closing the browser or page.

`--readonly` starts in viewing-only mode, with or without attach. Use **Ctrl-E → `readonly on` / `readonly off`**; `readonly` reports the current state. With `--no-shortcuts`, click **@** to enter the command. Page keys, mouse, wheel, paste, navigation, reload and page-modifying commands are blocked; local command/address editing, copying the URL and quitting remain available. This is a client-side guard, not server authorization. Attach still enables CDP page events and starts/stops screenshot streaming, which may interfere with another viewer of the same target.

The image area reserves the rightmost terminal column; the address bar remains full width. Normal mode sizes the viewport to this area without shortening its height. Attach keeps the remote aspect ratio, so additional space may remain.

If the attached target disconnects, the last frame stays visible and a red **@** marks the disconnected state. Click it and enter `q` (or use the normal quit shortcut) to exit; captures and remote input stop until then.

Attach captures a fallback frame after 1 second without a completed capture, including in readonly mode. Normal updates reset this timer; slow captures never accumulate periodic requests.

```bash
cd casty/bin
bun casty.js https://google.com
bun casty.js https://youtube.com
bun casty.js   # opens home page
bun casty.js example.com -- --lang=ja   # arguments after -- go to the browser
CASTY_BROWSER=/path/to/buninu-browser.js bun casty.js   # choose the browser
CASTY_ZOOM=1.5 bun casty.js   # zoom pages 1.5x on top of the automatic zoom
```

The browser is `CASTY_BROWSER`, else `BUN_CHROME_PATH`, else the first one
found automatically. A browser ending in `.js`, `.ts` or a similar extension
is run with Bun (or, without Bun, with the runtime running casty); anything
else is executed directly.

### Forward all page keys

Use `casty --no-shortcuts [url]` to forward every page key, including Ctrl+Q,
Ctrl+E and Ctrl+V, to the browser/compositor. The left loading slot displays a
permanent **@** (cyan normally, amber while loading). Click that three-cell
area to open an **empty `cmd>`**, then type `q` (or `quit` / `exit`) and Enter
to quit. Clicking the URL keeps its normal editing behavior. Address/command
editing retains its shortcuts, including Alt+C, Ctrl+V and Ctrl+C to copy and Esc to cancel.
Without this flag, the original shortcuts and spinner remain unchanged.

### Keybindings

| Key | Action |
|-----|--------|
| Alt+L | Address bar |
| Ctrl+E | Command line |
| Alt+F / Ctrl+L | Hint mode (Vimium-style) |
| Alt+Left / Right | Back / Forward |
| Ctrl+U / Ctrl+K | Back / Forward (in the address bar, toggle the text before / after the cursor) |
| Alt+C | Copy selected text |
| Ctrl+V | Paste |
| Ctrl+C | Send to the page; copy in the address bar or command line |
| Ctrl+Q | Quit |

Customizable via `~/.casty/keys.json`.

### Mouse scrolling

Vertical, horizontal and diagonal wheel reports are forwarded on their respective axes (100 CDP pixels per terminal wheel report), preserving Shift, Alt and Ctrl. Shift-wheel can become horizontal scrolling when the outer terminal maps it that way; Casty does not swap axes again. Terminal protocols used here do not encode Super in mouse reports. The application must have scrollable content, and events target the reported pointer position.

### Kitty keyboard

Casty automatically detects the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
and requests flags **1, 2, 8** (unambiguous keys, press/repeat/release, all keys).
Updated jsgotty and bunterm support this, as do compatible terminals. Ctrl, Alt,
Shift and Super remain distinct; Super is forwarded as CDP Meta (`meta` in
`keys.json`). Terminals without support keep the legacy input path. On exit,
casty pops its keyboard mode to restore the terminal's previous state.

The address bar and command line work in both modes: drag with the left mouse
button or use **Shift+arrows** to select text (Shift+Home/End selects to an end).
**Tab** switches between URL and `cmd>` mode while editing, keeping the text and cursor.
**Alt+C / Ctrl+C** copies the selection, or the entire text if nothing is selected.
**Ctrl+V** pastes through OSC 52, replacing the selection if present, otherwise
inserting at the cursor. Releases do not repeat local
actions or leak into the page. Terminal/browser/OS shortcuts intercepted before
reaching casty still cannot be forwarded.

### Hint Mode

**Alt+F** or **Ctrl+L** shows labels on clickable elements. Type the label to click. Labels use home-row keys (`a s d f j k l`).

### Address Bar

**Alt+L** to open. Type a URL or search query. `/b query` searches bookmarks.

### Command Line

**Ctrl+E** turns the address bar into a `cmd>` prompt. Enter runs the command; Esc cancels.

| Command | Action |
|---|---|
| `open <url\|query>` (`o`, `go`) | Open a URL or search |
| `back` (`b`) / `forward` (`f`) | Back / Forward |
| `reload` (`r`) | Reload |
| `home` | Home page |
| `bookmark [query]` (`bm`) | Open the first matching bookmark |
| `links` (`hints`, `l`) | Hint mode |
| `copy` (`c`) / `paste` (`p`) | Copy selected text / Paste |
| `copyurl` (`yank`, `y`) | Copy the page URL |
| `pasteurl` (`pu`) | Put the clipboard into the address bar, to edit or send with Enter |
| `download` (`dl`, `save`) | Save the page as the browser received it to the system Downloads folder |
| `find [text]` (`/text`) | Find text in the page; `find` alone goes to the next match |
| `eruda` (`devtools`) | Show or hide the [eruda](https://github.com/liriliri/eruda) console in the page (loaded from a CDN, needs network) |
| `zoom [n\|n%\|+\|-\|reset]` (`z`) | Show or set the zoom; 1 is the automatic zoom |
| `cdp [ws]` | Show CDP addr:port, connection state, engine, protocol and pending requests; `cdp ws` shows the full WebSocket URL |
| `kitty [inline\|file]` | Show transport and negotiated capture format, or switch transport for this session |
| `pixelmouse [on\|off]` | Show mouse mode; query and enable pixels, or return to cells |
| `help` (`?`) | List commands |
| `quit` (`q`) | Quit |

Casty queries mode 1016 at startup. A supported reply enables pixel coordinates; an unsupported reply or a 500 ms timeout keeps SGR 1006 cell coordinates (including Konsole 25.04.2). In Ctrl+E, `pixelmouse on` queries again, `pixelmouse off` switches to 1006, and `pixelmouse` shows the current mode. Changes last for this session. Set `"mousePixels": false` in config.json to start in cell mode without querying.

Pixel mode also requires a successful terminal pixel-size query (CSI 14t). Casty maps reported terminal pixels to the image’s cell rectangle, including fractional cell sizes. If dimensions are unknown, it stays on 1006. After updating jsgotty, restart its server, reload the browser page to load the updated frontend, and restart Casty.


In both the address bar and the command line:

- **Up / Down** walk the history of that mode, kept in `~/.casty/history.json`
- **Clicking** the prompt (` > ` or `cmd>`) switches between the two modes, keeping the text; clicking the text moves the cursor
- **Double-clicking** the bar: left third = next history entry, middle = previous, right = Enter
- Text longer than the bar **scrolls** with the cursor; **Home / End** jump to either end

`zoom 1.5`, `zoom 150%`, `zoom +` and `zoom -` apply at once; `CASTY_ZOOM` sets the zoom at start-up.
Other actions for `~/.casty/keys.json`: `command`, `reload`, `home`, `copy_url`, `paste_url`, `download`, `eruda`, `zoom_in`, `zoom_out`, `zoom_reset`.

### Bookmarks

Create `~/.casty/bookmarks.json`:

```json
{
  "GitHub": "https://github.com",
  "YouTube": "https://youtube.com"
}
```

### Configuration

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

| Key | Description | Default |
|-----|-------------|---------|
| `homeUrl` | Start page | `https://github.com/jjtseng93/casty` |
| `searchUrl` | Search engine URL | `https://www.google.com/search?q=` |
| `transport` | Image transfer: `auto`, `file`, `inline` | `auto` (file-access query; inline on error/timeout) |
| `format` | Capture format: `auto`, `png`, `jpeg` | `auto` (file → adaptive JPEG, inline → PNG) |
| `mouseMode` | `1002` (button-event) or `1003` (any-event) | Auto (Ghostty→1003, others→1002) |
| `media` | Enable camera/mic for WebRTC (experimental, requires `ffmpeg`) | `false` |

### Image transport and capture format

Press `Ctrl-E`: `kitty` shows the current transport and negotiated capture format (for example `Kitty: file · format=bgra`); `kitty inline` or `kitty file` switches it for this session without editing config. Auto transport starts inline, queries a temporary image file, and selects file only on a matching OK reply (700 ms timeout). Manual file mode bypasses the probe and requires shared paths. `format: auto` selects adaptive JPEG after a successful file probe, otherwise PNG. Manual transport switches preserve encoded formats (raw falls back when switching to inline); inline JPEG requires a decoder that supports it.

When file transport is available, Casty first queries the terminal’s preferred raw pixel format, then probes CDP with one screenshot. An exact `OK Buninu1 bgra` or `OK Buninu1 rgba` reply plus a valid CDP raw-file response enables raw frames ahead of every configured codec, including explicit PNG/JPEG/WebP. This private Buninu extension avoids image encoding and base64 pixel transfer. Unsupported peers, timeouts or runtime errors fall back to the configured policy: auto uses JPEG with PNG refinement over file transport, or PNG inline. Inline never probes raw; switching to inline retires raw for the session.

Raw files are forwarded with Kitty `t=t`: the terminal deletes them after reading. Casty accepts producer-supplied paths without directory-name or filename special cases and does not delete those files itself; the producer cleans up abandoned files. Format, dimensions and file size are still validated.

Negotiated raw captures use standard CDP `clip` with `scale: 1`, retaining fractional CSS dimensions until physical-pixel conversion. `Page.getLayoutMetrics` supplies the document scroll position. This keeps the output aligned with terminal cells at fractional zoom (for example 1918×1053 at 1.75×), avoiding an unnecessary bunterm resize. Encoded PNG/JPEG captures retain their previous behavior for compatibility with Chromium versions that round fractional clips differently.

After raw negotiation, a capture interrupted by navigation or a removed stale frame is skipped without retiring raw. Unsupported formats and invalid raw responses still fall back to the original codec.

Change-detection screencasts include a private `clip` extension alongside standard `maxWidth/maxHeight`, using the same width/height and `scale: 1`. Browser/Land crop at native pixel density without resizing; Chromium ignores `clip` and uses the standard max limits. These notification images are never displayed, including during navigation. Raw streams also request the private `clip: {x: 0, y: 0, width: 0, height: 0, scale: 1}` option. Browser/Land answer those updates with a fixed 1×1 PNG placeholder without reading or rendering the scene; Casty ignores that placeholder and captures the real raw frame. Other engines may ignore the option. Falling back to an encoded format stops requesting it.

### Capture interval

Set `CASTY_CAPTURE_MIN_INTERVAL=16` to use a 16 ms minimum interval between high-resolution capture starts (default: 16 ms). Accepts integer milliseconds from 0 to 60000; 0 disables the time throttle while retaining one capture at a time. Invalid values warn and fall back to 16 ms. Read when a screencast starts; restart Casty to change it. Actual FPS also depends on rendering, encoding and terminal throughput. Forced captures still bypass this throttle.

```sh
CASTY_CAPTURE_MIN_INTERVAL=16 bun index.js
```

## Comparison

| | casty | Browsh | w3m/lynx |
|---|---|---|---|
| Engine | Chrome | Firefox | Custom parser |
| Rendering | Pixel-perfect | Text approximation | Text only |
| JavaScript | Yes | Yes | No |
| Display | Kitty graphics | Character cells | Character cells |
| Dependencies | Node.js + Chrome | Go + Firefox | Standalone |

<details>
<summary>Technical Details</summary>

Casty is written in JavaScript. Here's what's going on under the hood:

- Launches chrome-headless-shell and talks to it via raw CDP WebSocket
- `Runtime.enable` is never sent (it breaks Google login — discovered the hard way)
- Stealth patches are injected via `Page.addScriptToEvaluateOnNewDocument` before any page loads
- Frame capture is hybrid: low-res Screencast triggers change detection, then `Page.captureScreenshot` grabs hi-res frames with proper DPR
- When JPEG is selected, file transfer uses adaptive JPEG→PNG: fast JPEG during scrolling/video, crisp PNG after things settle
- Terminal pixel size is detected via CSI 14t for auto-zoom

```
bin/casty.js       Entry point (terminal, zoom, resize)
lib/browser.js     CDP browser control, frame capture
lib/cdp.js         Lightweight CDP WebSocket client
lib/chrome.js      Chrome detection, launch, profile cleanup
lib/install.js     Chrome Headless Shell install/update
lib/kitty.js       Kitty graphics protocol (file/inline)
lib/input.js       Mouse/keyboard handling
lib/hints.js       Vimium-style hint mode
lib/urlbar.js      Address/search bar
lib/config.js      User configuration
lib/keys.js        Keybinding config
lib/bookmarks.js   Bookmark search
```

</details>

## Troubleshooting

### No audio on YouTube (Ubuntu Server)

Chrome plays audio directly through the system audio server. If there's no sound:

```bash
sudo apt install pulseaudio
sudo usermod -aG audio $USER
# Log out and back in, then:
pulseaudio --start
```

### Chrome crashes

If casty fails to start or Chrome crashes:

- With the system `chromium-headless-shell` installed, casty always uses it and never downloads Chrome. Reinstall the package instead:

  ```bash
  apt install --reinstall chromium-headless-shell
  ```

- Without it, casty uses the Chrome downloaded to `~/.casty/browsers/`. Remove it and it is downloaded again on the next start:

  ```bash
  rm -rf ~/.casty/browsers
  bun casty.js
  ```

To reset all settings and profile data:

```bash
rm -rf ~/.casty
```

## Implementation Notes

CDP timeouts: queries, repeatable settings and navigation retry one second after a failed attempt. Late replies arriving during that wait are accepted; deadlines grow after timeouts so slow machines can finish. New navigation supersedes old retries; `javascript:` URLs are never replayed. Failed screenshots use a single recovery queue, even without frame events. Closing cancels retries, and a disconnected backend leaves the terminal view open until you quit. Input, arbitrary JavaScript and script registration are not blindly repeated because their effects may already have happened. Target creation reconciles through the target list. Slow browser startup keeps waiting for the same process; a timed-out installation check does not delete the binary.

### Input coordinates and device scale factor

CDP `Input.dispatchMouseEvent` always takes **CSS pixels**. Never multiply
them by the zoom / device scale factor.

casty renders HiDPI frames by emulating `deviceScaleFactor = zoom` via
`Emulation.setDeviceMetricsOverride`. While `Page.captureScreenshot` runs
under device emulation, Chromium temporarily rescales the emulated view by
`emulated DSF / real DSF` so the bitmap comes out at physical resolution, and
restores it afterwards (`PageHandler::CaptureScreenshot` in
`content/browser/devtools/protocol/page_handler.cc`). Input dispatch ignores
emulation, so a click that lands during a capture is read in device pixels
and hits `(x / zoom, y / zoom)`. With frames captured ~12 times per second,
this showed up as taps that *sometimes* missed or hit something up and to
the left, while the click marker (drawn in CSS pixels) looked correct.

Fix: Chrome is launched with `--force-device-scale-factor=<zoom>`, so the
real and emulated DSF match, the rescale factor is 1, and input stays in CSS
pixels even mid-capture. Frame resolution is unchanged. This also explains an
earlier false lead that headless-shell "consumes device pixels": the samples
were dominated by the capture race.

Known limitation: if the zoom changes at runtime (terminal font resize), the
real DSF keeps its launch value until casty restarts.

## License

MIT
