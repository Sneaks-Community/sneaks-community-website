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
| `ANALYTICS_PROVIDER` | Analytics tracker to embed: `umami` or `plausible` | *unset* (analytics disabled) |
| `ANALYTICS_HOST` | Origin of your existing analytics instance (no trailing slash), reachable privately (e.g. `http://umami:3000`), self-hosted on any domain, or a hosted service such as `https://cloud.umami.is` | *unset* (analytics disabled) |
| `ANALYTICS_WEBSITE_ID` | Site identifier from the analytics dashboard (a UUID for Umami, the configured domain for Plausible) | *unset* (analytics disabled) |
| `ANALYTICS_SCRIPT_PATH` | Upstream path of the tracker script, for backends that rename it (Umami's `TRACKER_SCRIPT_NAME`, Plausible script variants). Must be a rooted `.js` path | `/script.js` (umami), `/js/script.js` (plausible) |
| `CLIENT_IP_HEADER` | Name of the header your proxy puts the real client IP in; see [Client IP resolution](#client-ip-resolution) | *unset* (TCP peer address) |

### Client IP resolution

`CLIENT_IP_HEADER` names the header the rate limiters and the analytics proxy read the visitor's
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

### Analytics

Analytics is **disabled by default** and only activates when `ANALYTICS_PROVIDER`, `ANALYTICS_HOST` and `ANALYTICS_WEBSITE_ID` are all set to valid values; anything missing or malformed logs a warning at startup and leaves the site untouched. Standing up the analytics backend is out of scope: point `ANALYTICS_HOST` at an instance you already run (on any domain) or at a hosted service.

The server reverse-proxies analytics traffic under `/stats`, so:

- The browser only ever talks to this site's own origin. The tracker loads from `/stats/<script path>` and events post to `/stats/<event path>`, which the server forwards to `ANALYTICS_HOST`.
- **No Content-Security-Policy change is needed.** The hardened `script-src 'self'` / `connect-src 'self'` policy already permits same-origin requests, and no third-party analytics hostname is ever exposed to the client.
- **Only the two paths the tracker needs are proxied**, matched exactly and per method; everything else under `/stats` returns `404` without contacting the backend. See [What the proxy exposes](#what-the-proxy-exposes).
- The resolved client IP is forwarded as a single-entry `X-Forwarded-For` so backend geolocation works. Configure [client IP resolution](#client-ip-resolution) first, or every hit will be attributed to your reverse proxy. If your *analytics host* is itself behind Cloudflare, set `CLIENT_IP_HEADER=x-forwarded-for` in **Umami's** own environment (it uses a variable of the same name), since it otherwise prefers the `CF-Connecting-IP` that Cloudflare rewrites to this server's address.
- If the analytics host is unreachable, the proxy returns a `502` and logs a warning; page loads are unaffected.
- `/stats` has its own rate limit (900 requests per 15 minutes per IP), well above what a real visitor generates.
- Page views are tracked on both the site and the 404 page, so hits on missing URLs appear in your dashboard.

The reference provider is [Umami](https://umami.is) (cookieless, no consent banner needed); [Plausible](https://plausible.io) is also supported. Like every other variable, these are read at container start, so a change plus `docker compose up -d` is enough.

#### What the proxy exposes

The proxy is not a general pass-through. It forwards exactly two upstream paths per provider, and only the method each one actually uses:

| Provider | `GET`/`HEAD` | `POST` |
| --- | --- | --- |
| `umami` | `/script.js` | `/api/send` (and `/api/collect` for v1) |
| `plausible` | `/js/script.js` | `/api/event` |

Anything else, including `/login`, the dashboard and the admin API, is answered with a `404` by this server and never forwarded. The wrong method on a proxied path returns `405`. Matching is exact, so path traversal (`/stats/api/send/../../login`) fails to match and is rejected as well. Override the script path with `ANALYTICS_SCRIPT_PATH` if your backend renames it; the value must be a rooted `.js` path, so it cannot be pointed at a data endpoint.

> [!TIP]
> Because only ingest is reachable, **your analytics backend never needs to be exposed to the internet.** Put it on the same Docker network and set `ANALYTICS_HOST=http://umami:3000`: no public hostname, no DNS record, no certificate, and no internet-reachable login form. Reach the dashboard over your LAN, a VPN or an SSH tunnel. A public or hosted instance works exactly the same way.

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

### Build & Run

1. Build the backend using esbuild.
```bash
npm run build
```

2. Start the production backend server.
```bash
npm run start
```
