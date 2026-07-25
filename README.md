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

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Node environment (`production` / `development`) |
| `PORT` | Port to listen on (default `3000`) |
| `LOG_LEVEL` | Pino log level |
| `COMMUNITY_NAME` | Community name used in the title, headings and footer |
| `COMMUNITY_ESTABLISHED` | Founding year shown in the title/OG tags |
| `SITE_URL` | Canonical site origin (no trailing slash); fills canonical/OpenGraph/Twitter URLs, the absolute `og:image`, and `robots.txt` / `sitemap.xml` |
| `META_DESCRIPTION` | SEO meta description (also OpenGraph/Twitter description) |
| `META_KEYWORDS` | SEO meta keywords |
| `HERO_TAGLINE` | Hero subtitle line |
| `ABOUT_PARAGRAPH_1` / `ABOUT_PARAGRAPH_2` | The two "Our History" paragraphs |
| `STEAM_LINK` | Steam group/community link |
| `TWITCH_LINK` | Twitch channel link |
| `GITHUB_LINK` | GitHub organization/repo link |
| `DISCORD_LINK` | Discord invite used by the "JOIN DISCORD" CTAs |
| `STATS_LINK` | "Player Statistics" resource card destination |
| `BANS_LINK` | "Ban List" resource card destination |
| `ALLOWED_ORIGINS` | Comma-separated CORS allow-list |
| `ANALYTICS_PROVIDER` | Analytics tracker to embed: `umami` or `plausible`. Unset (default) disables analytics entirely |
| `ANALYTICS_HOST` | Origin of your existing analytics instance (no trailing slash), self-hosted on any domain or a hosted service such as `https://cloud.umami.is` |
| `ANALYTICS_WEBSITE_ID` | Site identifier from the analytics dashboard (a UUID for Umami, the configured domain for Plausible) |
| `TRUST_PROXY` | Trust `X-Forwarded-For` for the client IP. **Only enable behind a trusted reverse proxy** — otherwise clients can spoof their IP to evade the rate limiter and the `/health` guard. `false` (default), `true`, a hop count (e.g. `1`), or a comma-separated IP/CIDR list |

### Analytics

Analytics is **disabled by default** and only activates when `ANALYTICS_PROVIDER`, `ANALYTICS_HOST` and `ANALYTICS_WEBSITE_ID` are all set to valid values; anything missing or malformed logs a warning at startup and leaves the site untouched. Standing up the analytics backend is out of scope: point `ANALYTICS_HOST` at an instance you already run (on any domain) or at a hosted service.

The server reverse-proxies analytics traffic under `/stats`, so:

- The browser only ever talks to this site's own origin. The tracker loads from `/stats/script.js` and events post to `/stats/*`, which the server forwards to `ANALYTICS_HOST`.
- **No Content-Security-Policy change is needed.** The hardened `script-src 'self'` / `connect-src 'self'` policy already permits same-origin requests, and no third-party analytics hostname is ever exposed to the client.
- The client IP is forwarded as `X-Forwarded-For` so backend geolocation works. Set `TRUST_PROXY` correctly if you run behind a reverse proxy.
- If the analytics host is unreachable, the proxy returns a `502` and logs a warning; page loads are unaffected.

The reference provider is [Umami](https://umami.is) (cookieless, no consent banner needed); [Plausible](https://plausible.io) is also supported. Like every other variable, these are read at container start, so a change plus `docker compose up -d` is enough.

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
