# Sneak's Community Website

A static landing page with an Express backend designed for gaming communities. Features live server status fetching, theming (light/dark mode), responsive layout, and Discord widget integration.

## Features

- **Server Status Dashboard:** Automatically pings a list of configurable servers via GameDig ([supported games](https://github.com/gamedig/node-gamedig/blob/master/GAMES_LIST.md)) to query live status, player counts, and maps.
- **Configurable External Links:** Manage social media, community platforms, and Discord Widget ID through environment variables.
- **Dark/Light Mode Theme:** Beautiful user interface featuring motion animations and a togglabe theme.
- **Caching Mechanism:** Implements data caching to avoid spamming server queries.
- **API First:** Exposes backend JSON endpoints for status queries or external configs.

## Getting Started

### Prerequisites

- Node.js (v24+)

### Environment Variables

Configure your environment by setting properties in your `.env` file (see `.env.example`).
Available external links:

- `STEAM_LINK`
- `TWITCH_LINK`
- `GITHUB_LINK`
- `DISCORD_WIDGET_ID`

### Server Configuration

Game servers are configured in `config/config.json`. Copy the `config.json.example` file and update with your actual server details:

```bash
cp config/config.json.example config/config.json
```

The server status system relies on the [gamedig](https://www.npmjs.com/package/gamedig) package.

Example `config/config.json`:

```json
{
  "community": {
    "name": "Surf Community",
    "established": 2025,
    "discordLink": "https://discord.com/invite/YOUR_INVITE_LINK"
  },
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

#### Hot-Loading Custom Assets

The Docker Compose setup includes a `user-assets/` volume mount that allows you to add, remove, or modify static assets without rebuilding the Docker image. Files in `user-assets/` take precedence over built-in files in the `public/` directory.

#### Custom Logo

To replace the default crosshair icon in the header with your own logo, place an image file named `logo.png`, `logo.svg`, or `logo.webp` in the `user-assets/` directory. The site will automatically detect and use your logo on page load.

Recommended size: 64x64 pixels or larger. Transparent backgrounds work best.

### Build & Run

1. Build the backend using esbuild.
```bash
npm run build
```

2. Start the production backend server.
```bash
npm run start
```
