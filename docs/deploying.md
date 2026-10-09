# Deploying and building

How to put OpenFlyover on a web server, and how to build the desktop application. For using the app, see the
[user guide](user-guide.html).

- [Website on a server](#website-on-a-server)
- [Desktop application](#desktop-application)

## Website on a server

OpenFlyover is a static site: no server code, no database. A small personal server or shared hosting (OVH for example)
is enough. Your server only sends the site files. Each visitor's browser fetches the tiles, the weather and the
landmarks itself.

1. Build the site: `npm ci && npm run build`.
2. Copy the contents of `dist/` (about 17 MB) to the site root.
3. Serve it over HTTPS.

### HTTPS required

Outside `localhost`, the browser reserves some features for HTTPS pages (a "secure context"): the WebCodecs video
encoder, but also the creation of track identifiers at import. Over plain HTTP, neither import nor export works. A
Let's Encrypt certificate or the one from your hosting provider is enough.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name flyover.example.org;
    ssl_certificate     /etc/letsencrypt/live/flyover.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/flyover.example.org/privkey.pem;

    root /var/www/openflyover;

    location / {
        try_files $uri =404;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location /atmosphere/ {
        types { image/x-exr exr; application/octet-stream bin; }
    }
}
```

Files in `/assets/` have a fingerprint in their name: they can be cached for a year. The `/atmosphere/` folder
contains the sky textures, as `.exr` and `.bin`, two types that nginx does not know.

### Apache

On Apache hosting, add a `.htaccess` file at the root:

```apache
AddType image/x-exr .exr
AddType font/woff2 .woff2
```

### Known limitations

- The site must be served **at the root of the domain**. A few paths are hard-coded: `/samples/` in
  `src/ui/projectActions.ts`, `/favicon.svg` in `src/ui/TopBar.tsx` and `index.html`, and `/fonts/` in `src/ui/fonts.css`. For a subfolder,
  you must build with `vite build --base=/subfolder/` and prefix these paths with `import.meta.env.BASE_URL`.
- A public site remains subject to the terms of the sources ([README, "Data sources"](../README.md#data-sources)).
- A long video takes a lot of memory (about twice its size) where it cannot be written directly to disk (Firefox,
  Safari); Chrome, Edge and the desktop application write it as the export progresses.


## Desktop application

It is the same code as the website, in a native [Tauri 2](https://v2.tauri.app/) window (`src-tauri/` folder). The
"Ouvrir" and "Enregistrer" buttons and the end of an export open the system file dialogs. The application reads and
writes only the files chosen in these dialogs, its offline packs and "Mes projets" in its own folder (`tiles/` and
`projects/` in the application data folder), and the two folders given on the command line (`--rendu`, `--sortie`).
Tiles, weather and landmarks come from the same sources as online: an Internet connection is required, except for a
track prepared for offline use.

It has not yet been launched or packaged on a real machine.

### Prerequisites

- Node.js 24 and the website dependencies (`npm ci`);
- stable Rust (<https://rustup.rs>), 1.77 or later;
- the system libraries, depending on the platform:

| System | To install | Web engine |
|---|---|---|
| Windows 10 / 11 | Visual Studio "C++ Build Tools" (MSVC). WebView2 ships with Windows 11; otherwise the installer adds it | Edge (Chromium) |
| macOS 11 or later | `xcode-select --install` | Safari (WebKit) |
| Linux (Ubuntu 22.04, Debian 12 or newer) | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev` | WebKitGTK |

Ubuntu 20.04 does not work: it has neither `libwebkit2gtk-4.1` nor a recent enough GLib (2.70) for Tauri 2.

### Running and building

```bash
npm ci
npm run tauri:dev     # starts the development server, then the window; reloads on every change
npm run tauri:build   # builds dist/, then the application and its installers
```

`tauri:build` puts the application in `src-tauri/target/release/` and the installers in
`src-tauri/target/release/bundle/`: `.msi` and `.exe` (NSIS) on Windows, `.app` and `.dmg` on macOS, `.deb`,
`.rpm` and `.AppImage` on Linux. Each system builds its own installers. They are not signed: Windows and
macOS show a warning on first launch.


Command-line batch rendering (one film per track in a folder) is described in the
[user guide](user-guide.html#desktop).

GitHub also builds the installers for the three systems (*Actions* › "Desktop installers" › *Run workflow*, or a `v0.x.y`
tag, which prepares a draft release), signed as soon as the certificates are added to the repository secrets: see
[`installers.md`](installers.md).

The icons in `src-tauri/icons/` come from `public/favicon.svg`. To regenerate them: `npx tauri icon public/favicon.svg`
(then keep only the files listed in `src-tauri/tauri.conf.json`).

### Current limitations

- **Video export on Linux**: WebKitGTK does not have WebCodecs; the application then encodes the movie with the system
  `ffmpeg`, which must be installed (`sudo apt install ffmpeg`): MP4 H.264, with AAC audio (WebM VP9 and Opus if the
  name ends with ".webm"). Without ffmpeg, the export panel
  says so and the still image works; overlay only (transparent WebM) is not possible yet
  ([`ARCHITECTURE.md`](../ARCHITECTURE.md), "Video export without WebCodecs (Linux)"; not verified yet). On Windows (Edge)
  and on macOS (WebKit, WebCodecs since Safari 16.4), video export should go through WebCodecs as in the
  browser (not verified yet).
- Preferences and caches stay in the window storage (like `localStorage` in a browser), specific to the
  application.
