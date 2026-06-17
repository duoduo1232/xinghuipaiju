# Pixel Card Duel

## Run

Install dependencies once:

```powershell
npm install
```

Start the web app:

```powershell
npm run dev
```

Build production files:

```powershell
npm run build
```

## LAN / Public Server

Run these commands in this project folder: `d:\Desktop\choujiang\兵棋`.

Default LAN server port:

```powershell
npm run lan
```

Explicit default port:

```powershell
npm run lan:8781
```

Custom port:

```powershell
npm run lan -- --port 9000
```

or:

```powershell
npm run lan:port -- 9000
```

After the server starts, it prints one or more phone URLs like:

```text
Phone WebSocket URL: ws://192.168.1.23:8781
```

On both phones, choose LAN mode, enter the same WebSocket URL and the same room name such as `room1`.

For public access, expose the same TCP port with your router, tunnel, or cloud relay, then enter:

```text
ws://PUBLIC_HOST:PORT
```

Use `wss://` only if your public relay provides TLS WebSocket support.

## Checks

```powershell
npm run audit:cards
npm run audit:behavior
npm run build
```

## GitHub Release Updates

The phone app can check GitHub Releases from Settings. Fill the repo field with:

```text
username/repository
```

or a GitHub URL like:

```text
https://github.com/username/repository
```

To publish an APK update from GitHub:

```powershell
git tag v0.1.1
git push origin v0.1.1
```

The workflow in `.github/workflows/android-debug-release.yml` builds `app-debug.apk` and uploads it to that tag's GitHub Release. Android will not allow a normal APK to silently replace itself; the app opens the Release/APK download link and the user confirms installation.

## Music Setting

The music field accepts either a direct audio URL:

```text
https://example.com/music.mp3
```

or an API URL that returns one of these JSON fields:

```json
{ "url": "https://example.com/music.mp3" }
```

Also supported: `musicUrl`, `audio`, `src`, or `data.url`.

Plain text responses containing only the audio URL are supported too.

## Developer Cards

Settings -> Developer Mode shows every built-in card and saved custom card.
Custom card code is JSON. A quick example:

```json
{"effect":"healSelf","value":15,"cost":1,"valueText":"+0","text":"我方本体+15血。"}
```

The project-local Codex skill for writing and checking custom card code is here:

```text
.codex/skills/card-code-skill/SKILL.md
```
