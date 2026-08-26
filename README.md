# Sneak's Community Website

A lightweight static landing page designed for [Sneak's Community](https://snksrv.com), open sourced for anyone interested. Features live server status fetching, theming (light/dark mode), responsive layout, and Discord community link.

## Features

- **Server Status Dashboard:** Automatically pings a list of configurable servers via GameDig ([supported games](https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md)) to query live status, player counts, and maps.
- **Configurable External Links:** Manage social media, community platforms, and the Discord invite link through environment variables.
- **Dark/Light Mode Theme:** Beautiful user interface featuring motion animations and a togglabe theme.
- **Caching Mechanism:** Implements data caching to avoid spamming server queries.
- **JSON Status Endpoint:** Exposes a `/api/status` JSON endpoint for live server status queries.

## Getting Started

### Prerequisites

- Node.js (v26+)

### Environment Variables

Configure your environment by setting properties in your `.env` file (see `.env.example`).

> [!NOTE]
> These values are read **at container start** and injected into the page templates — so on a
> precompiled Docker image you only need to change the env and restart (`docker compose up -d`),
> **no rebuild required**. Every variable falls back to a sensible default when unset.

| Variable | Purpose | Default |
| --- | --- | --- |
| `NODE_ENV` | Node environment (`production` / `development`) | *unset* (anything but `development` behaves as production) |
| `PORT` | Port to listen on | `3000` |
| `CONFIG_PATH` | Path to the server list JSON | `config/config.json` |
| `LOG_LEVEL` | Pino log level | `info` (`debug` when `NODE_ENV=development`) |
| `COMMUNITY_NAME` | Community name used in the title, headings and footer | `Sneak's Community` |
| `COMMUNITY_ESTABLISHED` | Founding year shown in the title/OG tags | `2015` |
| `SITE_URL` | Canonical site origin (no trailing slash); fills canonical/OpenGraph/Twitter URLs, the absolute `og:image`, and `robots.txt` / `sitemap.xml` | `https://snksrv.com` |
| `META_DESCRIPTION` | SEO meta description (also OpenGraph/Twitter description) | Sneak's Community description |
| `META_KEYWORDS` | SEO meta keywords | Sneak's Community keyword list |
| `HERO_TAGLINE` | Hero subtitle line | `An open and fun gaming community for all. No application. No membership. Just fun and friends.` |
| `ABOUT_PARAGRAPH_1` / `ABOUT_PARAGRAPH_2` | The two "Our History" paragraphs | Sneak's Community history copy |
| `STEAM_LINK` | Steam group/community link | `https://steamcommunity.com/groups/sneakscommunity` |
| `TWITCH_LINK` | Twitch channel link | `https://twitch.tv/snksrv` |
| `GITHUB_LINK` | GitHub organization/repo link | `https://github.com/Sneaks-Community` |
| `DISCORD_LINK` | Discord invite used by the "JOIN DISCORD" CTAs | `https://discord.gg/snksrv` |
| `STATS_LINK` | "Player Statistics" resource card destination | `https://stats.snksrv.com` |
| `BANS_LINK` | "Ban List" resource card destination | `https://bans.snksrv.com` |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list | `http://localhost:3000` |
| `CLIENT_IP_HEADER` | Name of the header your proxy puts the real client IP in; see [Client IP resolution](#client-ip-resolution) | *unset* (TCP peer address) |

### Client IP resolution

`CLIENT_IP_HEADER` names the header the rate limiter reads the visitor's
address from:

| Value | Use it when |
| --- | --- |
| *unset* (default) | Nothing fronts the app, so the TCP peer address is used and no header is consulted. |
| `X-Forwarded-For` | A reverse proxy (nginx, Caddy, Traefik, HAProxy) appends to this chain, which is read from the right. |
| `X-Real-IP` | Your proxy publishes a single-IP header, which is unambiguous and preferable where available. |
| `CF-Connecting-IP` | Cloudflare fronts the app and overwrites this header at its edge. |

> [!WARNING]
> Whichever header you name, the app must be reachable only through the upstream that sets it, or a
> visitor can send it themselves. Values that are not a single IP address are ignored and the peer
> address is used instead.

### Server Configuration

> [!WARNING]
> HTTPS IS REQUIRED TO RUN THIS WEB APP PROPERLY

Game servers are configured in `config/config.json`. Copy the `config.json.example` file and update with your actual server(s) details. **This file is required for the web app to run!**

```bash
cp config/config.json.example config/config.json
```

Example `config/config.json`:

```json
{
  "servers": [
    {
      "id": "surf_tier1",
      "host": "127.0.0.1",
      "port": 27015,
      "type": "csgo",
      "name": "Tier 1 Surf"
    }
  ]
}
```

### Docker Deployment

When running with Docker Compose, `config/config.json` is mounted as a read-only volume:

```bash
docker compose up -d --build
```

Update `config/config.json` directly (not the `.example` file) and restart the container:

```bash
docker compose restart web
```

#### Image Variants (root / non-root)

The [`Dockerfile`](Dockerfile) is a distroless (`gcr.io/distroless/nodejs`) multi-stage build with two production targets:

| Target | User | Published tags |
| --- | --- | --- |
| `production-root` | root (uid 0) | `latest`, `<version>`, `dev` |
| `production` | non-root (uid 65532) | `latest-nonroot`, `<version>-nonroot`, `dev-nonroot` |

Build either locally with `--target`:

```bash
# Root image
docker build --target production-root -t sneaks-community-website:root .

# Non-root image (recommended; used by docker-compose.yml)
docker build --target production -t sneaks-community-website:nonroot .
```

The non-root variant is the default in [`docker-compose.yml`](docker-compose.yml) and suits its hardened runtime (`read_only`, `cap_drop: ALL`, `no-new-privileges`).

#### Hot-Loading Custom Assets

The Docker Compose setup includes a `user-assets/` volume mount that allows you to add, remove, or modify static assets without rebuilding the Docker image. Files in `user-assets/` take precedence over built-in files in the `public/` directory.

#### Custom Logo

To replace the default crosshair icon in the header with your own logo, place an image file named `logo.svg`, `logo.webp`, or `logo.png` in the `user-assets/` directory. The site will automatically detect and use your logo on page load.

Recommended size: 64x64 pixels or larger. Transparent backgrounds work best.

To comply with Open Graph Protocol standards, and to have a nice looking embed, including your desired logo in `user-assets/` folder as `/og-image.png` at 1200x630 px is also recommended.

#### Icons

Icons live one per file in `public/icons/` as plain, renderable SVGs. At startup they are
concatenated into a single sprite served at `/icons.svg` (cached for a day) and referenced from the
markup as `<use href="/icons.svg#icon-<filename>"/>`. To add an icon, drop `name.svg` into
`public/icons/` and reference `#icon-name`; no build step is involved. `npm test` checks that every
reference resolves to a file.

### Tests

`npm test` runs the Node built-in test runner: a smoke test that boots the built server on a free
port against a throwaway config (via `CONFIG_PATH`, so your own `config/config.json` is untouched)
and checks `/`, `/icons.svg`, `/api/status`, the HTML/JSON 404 split and `/health`, plus a check
that every icon reference resolves to a file. Run `npm run build` first, since the smoke test
executes `dist/index.js`. Takes ~10 s, most of it GameDig timing out against the unreachable test
server on purpose.

### Build & Run

1. Build the backend using esbuild.
```bash
npm run build
```

2. Start the production backend server.
```bash
npm run start
```
