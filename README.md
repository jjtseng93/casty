# casty

Run a real Chrome browser inside your terminal.

**[日本語](README.ja.md)** | **[繁體中文](README.zh-TW.md)**

> **This is [jjtseng93](https://github.com/jjtseng93)'s fork of [sanohiro/casty](https://github.com/sanohiro/casty).** Main changes:
>
> - Fixes clicking links: taps and clicks sometimes missed or hit the wrong element (see [Implementation Notes](#implementation-notes))
> - Adapts casty to the kernel VT of [Buninu Linux](https://github.com/jjtseng93/buninu-linux), where the Alt+Left / Alt+Right navigation shortcuts cannot be used: **Ctrl+U / Ctrl+K** go back / forward instead
> - Fixes a race when a local server (e.g. `localhost`) responds before casty's event listeners are registered, which left the loading spinner stuck and the displayed frame out of sync with input

casty is not a text-mode browser like w3m or lynx. It launches headless Chrome, grabs the rendered frames over CDP, and draws them in your terminal via Kitty graphics protocol. Think of it as a remote desktop for Chrome that fits in a terminal window.

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
│ Chrome (headless)                │
│ Full web rendering               │
│ JS, CSS, Canvas, WebGL           │
└──────────────────────────────────┘
```

Chrome does all the rendering. casty is just a bridge that streams frames to your terminal and sends input back. No Playwright, no puppeteer — raw CDP over WebSocket.

Since it's real Chrome, JavaScript, CSS, Canvas, and WebGL all work. Google login works too (stealth patches bypass bot detection). Mouse clicks, scrolling, dragging, typing — everything you'd expect.

## Why use this?

If you're working over SSH on a headless server and need to check a web page, your options are usually `curl`, `lynx`, or forwarding X11. casty gives you an actual browser without leaving the terminal. No X11, no VNC, no Wayland — just a Kitty-compatible terminal.

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

### Capture interval

Set `CASTY_CAPTURE_MIN_INTERVAL=16` to use a 16 ms minimum interval between high-resolution capture starts (default: 50 ms). Accepts integer milliseconds from 0 to 60000; 0 disables the time throttle while retaining one capture at a time. Invalid values warn and fall back to 50 ms. Read when a screencast starts; restart Casty to change it. Actual FPS also depends on rendering, encoding and terminal throughput. Forced captures still bypass this throttle.

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
