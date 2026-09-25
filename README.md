# casty

Run a real Chrome browser inside your terminal.

**[日本語](README.ja.md)** | **[繁體中文](README.zh-TW.md)**

> **This is [jjtseng93](https://github.com/jjtseng93)'s fork of [sanohiro/casty](https://github.com/sanohiro/casty).** Main changes:
>
> - Fixes clicking links: taps and clicks sometimes missed or hit the wrong element (see [Implementation Notes](#implementation-notes))
> - Adapts casty to the kernel VT of [Buninu Linux](https://github.com/jjtseng93/buninu-linux), where the Alt+Left / Alt+Right navigation shortcuts cannot be used: **Ctrl+U / Ctrl+K** go back / forward instead

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

Chrome does all the rendering. casty is just a bridge (~2300 lines) that streams frames to your terminal and sends input back. No Playwright, no puppeteer — raw CDP over WebSocket.

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
```

### Keybindings

| Key | Action |
|-----|--------|
| Alt+L | Address bar |
| Alt+F / Ctrl+L | Hint mode (Vimium-style) |
| Alt+Left / Right | Back / Forward |
| Ctrl+U / Ctrl+K | Back / Forward (in the address bar, toggle the text before / after the cursor) |
| Alt+C | Copy selected text |
| Ctrl+V | Paste |
| Ctrl+Q | Quit |

Customizable via `~/.casty/keys.json`.

### Hint Mode

**Alt+F** or **Ctrl+L** shows labels on clickable elements. Type the label to click. Labels use home-row keys (`a s d f j k l`).

### Address Bar

**Alt+L** to open. Type a URL or search query. `/b query` searches bookmarks.

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
| `transport` | Image transfer: `auto`, `file`, `inline` | `auto` (bcon/kitty→file, others→inline) |
| `format` | Capture format: `auto`, `png`, `jpeg` | `auto` (file→jpeg adaptive, inline→png) |
| `mouseMode` | `1002` (button-event) or `1003` (any-event) | Auto (Ghostty→1003, others→1002) |
| `media` | Enable camera/mic for WebRTC (experimental, requires `ffmpeg`) | `false` |

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

The whole thing is about 1200 lines of JavaScript. Here's what's going on under the hood:

- Launches chrome-headless-shell and talks to it via raw CDP WebSocket
- `Runtime.enable` is never sent (it breaks Google login — discovered the hard way)
- Stealth patches are injected via `Page.addScriptToEvaluateOnNewDocument` before any page loads
- Frame capture is hybrid: low-res Screencast triggers change detection, then `Page.captureScreenshot` grabs hi-res frames with proper DPR
- File transfer mode uses adaptive JPEG→PNG: fast JPEG during scrolling/video, crisp PNG after things settle
- Terminal pixel size is detected via CSI 14t for auto-zoom

```
bin/casty          Shell wrapper (Chrome install/update)
bin/casty.js       Entry point (terminal, zoom, resize)
lib/browser.js     CDP browser control, frame capture
lib/cdp.js         Lightweight CDP WebSocket client
lib/chrome.js      Chrome detection, launch, profile cleanup
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
