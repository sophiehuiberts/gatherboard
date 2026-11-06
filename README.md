[soph's note: putting this on github because i use it personally and am very happy with it. all is vibe coded]


# Gatherboard

A browser whiteboard for the people already in your Zoom or Discord call. Everyone joins the same room URL with a name and the room password. No accounts for your guests, no installation, and no video/audio permissions.

## What’s included

- Live shared pen strokes and erasing, with pressure-sensitive pen input.
- A white pointer trail with your own colored outline, fading out after 3 seconds. Pointer color is independent of ink.
- An effectively infinite canvas: drag to pan, pinch to zoom, and fit all drawings in view.
- Persistent, separate boards for named, password-protected rooms.
- Up to your last 30 drawing/erasing actions can be undone. Anyone can erase or clear a room.
- Presence, live cursors, invitation links, arbitrary colors, three pen widths, and PNG/PDF export.
- Automatic reconnection. Drawing pauses while offline; only server-confirmed strokes are saved. An in-progress stroke can be lost if the connection drops.

## Start on your computer

Install **Node.js 22.12 or newer** (Node 24 recommended; npm comes with it), then open a terminal in this folder:

```sh
npm install
npm run dev
```

Open the address shown in your terminal (usually http://127.0.0.1:5173). The first run creates `rooms.config.json` from `rooms.example.json`.

For the initial **local preview only**, The lounge password is `change-this-lounge-password`. The other example passwords are in `rooms.example.json`. Publishing is blocked until you change these defaults.

## Choose your rooms and passwords

Edit **`rooms.config.json`**. It looks like this:

```json
{
  "rooms": [
    {
      "id": "the-lounge",
      "name": "The lounge",
      "description": "A little space to think together.",
      "password": "choose-a-long-private-password"
    },
    {
      "id": "game-night",
      "name": "Game night",
      "description": "Plans, puzzles, and questionable diagrams.",
      "password": "a-different-long-private-password"
    }
  ]
}
```

Use lowercase letters, numbers, and hyphens for each unique `id`, and a non-empty password for each room (up to 256 characters). Add, rename, or remove rooms here; redeploy for changes to take effect. Keep the same `id` to retain a room’s drawing. Changing a password requires guests to sign in again after their connection restarts.

This file is ignored by Git and bundled **only into the server**, never the browser files. Keep it private. Anyone with access to your Cloudflare deployment or local files can read it. Room names and descriptions are visible on the lobby; drawings require the password.

## Put it online, on Cloudflare’s free plan

This app runs on **Cloudflare Workers with SQLite Durable Objects**, which are available on the Workers Free plan. It needs no separate database or server. Stay on the Free plan if you want a hard free-tier limit; if you exceed its limits, requests fail until the quota resets.

1. Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up). Keep the Workers plan set to **Free**.
2. Set your room names and passwords in `rooms.config.json`.
3. Sign in once from this folder:

   ```sh
   npx wrangler login
   ```

4. Publish:

   ```sh
   npm run deploy
   ```

Cloudflare prints your HTTPS address, such as `https://gatherboard.YOUR-SUBDOMAIN.workers.dev`. Send that address to friends. Use **(invite)** inside a room to copy a direct room link; share its password separately.

If the deployment name is already used in your own Cloudflare account, change `name` in `wrangler.jsonc` before your first deployment. Future changes use the same `npm run deploy` command; persisted boards remain intact. Deploying may briefly disconnect guests, who reconnect automatically.

**Why Cloudflare?** GitHub Pages serves static files, and Netlify’s normal static/functions hosting does not supply the persistent WebSocket room server this app needs. Cloudflare hosts the frontend, real-time room server, and saved boards together.

Current hosting details: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). Free quotas and provider terms can change.

## Controls

| Action | Control |
| --- | --- |
| Draw | Pen tool, then mouse or pen drag; **A** |
| Erase a whole stroke | Eraser tool; **S** (USB pen eraser button/tip supported when reported by the browser) |
| Fading pointer | Pointer tool; **D** |
| Pan | Hand tool (**G**), Space + drag, middle mouse drag, or scroll |
| Zoom | Trackpad/iPad pinch, Ctrl/⌘ + scroll, + / −, or the zoom buttons |
| Undo your last draw/erase | Ctrl/⌘ + Z |
| Fit the drawing on screen | **F** |
| Save a picture or PDF | Download button at bottom left, then choose PNG or PDF |
| Clear the room | Trash button, followed by confirmation |

On an **iPad**, draw with Apple Pencil in Safari. One finger pans; two fingers pan and pinch. Finger input never draws, so palm contact cannot leave ink. USB tablets use the browser’s standard Pointer Events and pressure data; make sure your tablet driver/browser exposes pen input (Windows Ink may need to be enabled). Mouse input works as well. The drawing surface suppresses native selection/callout gestures, captures quick pen-up endpoints, and uses Pencil Touch Events as a fallback when available. Native pressure and palm behavior still need testing on your particular hardware.

Ink and pointer colors are separate. Use the swatches for ink; use the outlined pointer button beneath the swatches to choose your pointer outline color. The pointer stays white inside, fades over its final second, and disappears 3 seconds after that person last draws with the pointer. Drawing more pointer strokes refreshes all of that person’s still-visible pointer marks; already expired marks stay gone. Views are independent: panning or zooming your screen doesn’t move anyone else’s view.

## Checks

```sh
npm test
npm run build
npm run check:deploy
```

With the local development server running in another terminal:

```sh
npm run test:integration
```

Integration checks cover password rejection, cross-origin access, unauthenticated connections, two-person drawing, saved-board loading, non-persistent pointers/previews, erasing, undo, and room isolation. Input regression checks also cover quick taps, missing move events, capture failures, rapid re-contact, Pencil touch fallback, duplicate event streams, and selection suppression. They modify only their own random test stroke IDs and never clear the room. `check:deploy` validates packaging without uploading or publishing. Large-board tests exercise 100,000 strokes / 2,000,000 points in an in-memory SQLite database, bounded snapshot loading, point simplification, spatial queries, and cached rendering. These checks validate the data structures; they are not a guarantee of frame rate on every iPad or network.

## Practical limits and data

This is intended for a small call: at most **40 connections per room**, **100,000 saved stroke segments**, and **2,000,000 saved pen points** per room. Very long pen strokes split into segments; undo removes one segment at a time. The drawing area is effectively infinite (coordinates up to ±10 million); scale ranges from 8% to 800%. Redundant pen samples are simplified with a subpixel tolerance while preserving corners, endpoints, and pressure changes. This stretches the point budget further, although the reduction depends on what you draw. Saved ink is indexed by location and cached separately from live ink, so pointer/cursor activity does not redraw the entire board; small pans reuse an overscanned image. Very dense views and full-board exports still take more work, and older devices may slow down before reaching the limits.

Sessions last 12 hours and are held in HttpOnly, same-site cookies. Each room limits join attempts to 10 per minute per IP address. Room passwords are shared credentials: anyone who knows one has equal drawing, erasing, and clearing privileges. Clear is intentionally not undoable; export first. PNG and PDF exports include saved drawings, not cursors or pointer trails. PDFs preserve vector strokes and pen pressure, fitting the full board onto one A4 page in portrait or landscape as appropriate.

Boards are stored in indexed SQLite tables inside Cloudflare’s Durable Object storage in production, and `.wrangler/state` locally. Saved geometry uses compact coordinate triples. Joins load the board in bounded, acknowledged batches instead of buffering the entire board on the server. Existing boards migrate automatically on first access; legacy records are retained as a migration backup and are never re-imported after migration. Keep the same room IDs and Durable Object namespace when deploying. Names are kept for the session. Undo history is capped at 30 actions (fewer for large erasing operations) and expired sessions are cleaned up periodically. There are no analytics, external fonts, CDNs, tracking, or third-party browser scripts.

Project layout: `src/` is the canvas/lobby, `server/` is room access and collaboration, and `rooms.config.json` is your private settings file. TypeScript, Vite, and Wrangler provide the build and local runtime. `package-lock.json` pins the tested npm dependencies. Use `npm ci` for a fresh, reproducible installation.
