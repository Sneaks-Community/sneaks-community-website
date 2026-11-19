// Boots dist/index.js on a free port against a throwaway config and exercises every route.
// Requires npm run build first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const COMMUNITY_NAME = 'Smoke Test Community';
// Loopback with nothing listening: no DNS, no live server. Costs GameDig's ~4s give-up time.
const TEST_CONFIG = {
    serversHeading: 'Smoke & Servers',
    modes: [{ icon: 'waves', title: 'Surf & Turf', description: 'Fast <b>maps</b>' }],
    servers: [
        { id: 'smoke_test', host: '127.0.0.1', port: 1, type: 'csgo', name: 'Smoke & Test <Server>' },
        { id: 'smoke_unnamed', host: '127.0.0.1', port: 2, type: 'csgo' },
        { id: 'smoke_numeric', host: '127.0.0.1', port: 3, type: 'csgo', name: 2024 },
    ],
};

// Stands in for Discord's invite endpoint. The extra field is the kind of detail that must stay server-side.
const DISCORD_REPLY = { approximate_presence_count: 312, approximate_member_count: 4120, guild: { id: 'not-for-clients' } };
const discordRequests = [];
const discordStub = http.createServer((req, res) => {
    discordRequests.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(DISCORD_REPLY));
});

let child;
let childEnv;
let base;
let temporaryDirectory;
let output = '';

// Boots a second server with `env` and resolves once it exits; startup checks exit before listening.
const startup = (env) => new Promise((resolve) => {
    const proc = spawn(process.execPath, ['dist/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    proc.stdout.on('data', (chunk) => { log += chunk; });
    proc.stderr.on('data', (chunk) => { log += chunk; });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); }, 10_000);
    proc.on('exit', (code) => { clearTimeout(timer); resolve({ code, log }); });
});

const freePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => { resolve(port); });
    });
});

before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'snksrv-smoke-'));
    const configPath = path.join(temporaryDirectory, 'config.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- own temp dir
    fs.writeFileSync(configPath, JSON.stringify(TEST_CONFIG));

    await new Promise((resolve) => { discordStub.listen(0, '127.0.0.1', resolve); });
    const discordApiUrl = `http://127.0.0.1:${String(discordStub.address().port)}`;

    const port = await freePort();
    base = `http://127.0.0.1:${String(port)}`;
    childEnv = {
        ...process.env,
        PORT: String(port),
        CONFIG_PATH: configPath,
        COMMUNITY_NAME,
        COMMUNITY_ALIAS: 'smokey',
        COMMUNITY_ESTABLISHED: '2015',
        STEAM_LINK: 'https://steamcommunity.com/groups/smoke',
        // Unset on purpose: each of these must leave its markup out of the page.
        TWITCH_LINK: '',
        GITHUB_LINK: '',
        STATS_LINK: '',
        BANS_LINK: '',
        META_TITLE: '',
        META_DESCRIPTION: '',
        HERO_TAGLINE: '',
        ABOUT_PARAGRAPH_1: '',
        ABOUT_PARAGRAPH_2: '',
        SITE_URL: 'https://smoke.example',
        LOG_LEVEL: 'warn',
        NODE_ENV: 'production',
        DISCORD_LINK: 'https://discord.gg/smoketest',
        DISCORD_API_URL: discordApiUrl,
    };
    child = spawn(process.execPath, ['dist/index.js'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });

    let exited = false;
    child.on('exit', (code) => { exited = true; output += `\n[server exited early with code ${String(code)}]`; });

    // Poll rather than assume a fixed startup delay.
    const deadline = Date.now() + 20_000;
    for (;;) {
        assert.ok(!exited, `server did not stay up:\n${output}`);
        try {
            const res = await fetch(`${base}/health`);
            if (res.ok) { break; }
        } catch { /* not listening yet */ }
        assert.ok(Date.now() < deadline, `server did not become ready in 20s:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
});

after(async () => {
    if (child && child.exitCode === null) {
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 10_000);
        await exited;
        clearTimeout(timer);
    }
    if (temporaryDirectory) {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
    discordStub.closeAllConnections();
    discordStub.close();
});

test('GET / serves the branded page with every token substituted', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.ok(body.includes(COMMUNITY_NAME), 'COMMUNITY_NAME was not injected into the page');
    assert.equal(body.includes('{{'), false, 'page still contains an unsubstituted {{token}}');
    // A short grid grows when the cards arrive, pushing every #fragment below it out of reach.
    const skeletons = [...body.matchAll(/animate-pulse/g)].length;
    assert.equal(skeletons, TEST_CONFIG.servers.length, 'skeleton count does not match configured servers');
});

test('GET /icons.svg serves the sprite built from public/icons/', async () => {
    const res = await fetch(`${base}/icons.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    const body = await res.text();
    const symbols = [...body.matchAll(/<symbol id="icon-[a-z0-9-]+"/g)].length;
    const files = fs.readdirSync(path.join(root, 'public', 'icons')).filter((f) => f.endsWith('.svg')).length;
    assert.equal(symbols, files, 'sprite symbol count does not match public/icons/');
});

test('hashed asset URLs are served immutable, bare ones are not', async () => {
    const body = await (await fetch(`${base}/`)).text();
    const hashed = [...body.matchAll(/(?:src|href)="(\/[^"]+\?v=[\w-]+)"/g)].map((m) => m[1]);
    // theme-init.js, tailwind.css, lib/motion.js, common.js, script.js
    assert.equal(hashed.length, 5, `expected 5 hashed asset URLs, got ${String(hashed.length)}`);

    for (const url of hashed) {
        const res = await fetch(`${base}${url}`);
        assert.equal(res.status, 200, `${url} did not resolve`);
        assert.match(res.headers.get('cache-control'), /max-age=31536000, immutable/, `${url} is not immutable`);
    }

    // Without the hash the URL still means "whatever the current build is", so it must stay short.
    const bare = await fetch(`${base}/tailwind.css`);
    assert.equal(bare.status, 200);
    assert.equal(bare.headers.get('cache-control'), 'public, max-age=300');

    // A made-up hash vouches for nothing, so it must not pin the current file for a year.
    const wrong = await fetch(`${base}/tailwind.css?v=wrong`);
    assert.equal(wrong.status, 200);
    assert.equal(wrong.headers.get('cache-control'), 'public, max-age=300');
});

test('GET /api/status answers without waiting for an unreachable server', async () => {
    const started = Date.now();
    const res = await fetch(`${base}/api/status`);
    const elapsed = Date.now() - started;
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    // The configured server is a dead port, so a blocking implementation would sit on
    // GameDig's ~4s give-up time here.
    assert.ok(elapsed < 2000, `status took ${String(elapsed)}ms; it must not block on the query`);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.data), 'data is not an array');
    assert.equal(body.data.length, TEST_CONFIG.servers.length);
    assert.equal(body.pending, TEST_CONFIG.servers.length, 'unresolved servers should report as pending');
    assert.equal(body.data[0].status, 'pending');
    assert.match(res.headers.get('cache-control'), /no-store/, 'a pending payload must not be cacheable');
});

test('GET /api/status settles to offline and is then served from cache', async () => {
    const deadline = Date.now() + 20_000;
    let res;
    let body;
    for (;;) {
        res = await fetch(`${base}/api/status`);
        body = await res.json();
        if (body.pending === 0) { break; }
        assert.ok(Date.now() < deadline, 'status never settled within 20s');
        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const [server] = body.data;
    // What public/script.js renders; `ping` is absent when offline.
    for (const key of ['id', 'name', 'map', 'players', 'maxplayers', 'status', 'host', 'port']) {
        assert.ok(Object.hasOwn(server, key), `payload entry is missing "${key}"`);
    }
    assert.equal(server.id, 'smoke_test');
    // Must degrade to offline, not throw or stay pending.
    assert.equal(server.status, 'offline');
    assert.equal(body.fromCache, true);
    assert.match(res.headers.get('cache-control'), /max-age=60/);
});

test('a failed query logs why it failed, down to the last attempt', async () => {
    // Written as the entry turns offline above, but the log line can trail the HTTP response.
    const reason = /"reason":"Failed all \d+ attempts \(last attempt: [^"]+\)"/;
    const deadline = Date.now() + 5000;
    while (!reason.test(output)) {
        assert.ok(Date.now() < deadline, `no query failure reason logged:\n${output}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
});

test('unknown paths 404 as HTML for browsers and JSON for the API', async () => {
    const html = await fetch(`${base}/nope`, { headers: { Accept: 'text/html' } });
    assert.equal(html.status, 404);
    assert.match(html.headers.get('content-type'), /text\/html/);
    assert.ok((await html.text()).includes(COMMUNITY_NAME), '404 page is not the branded one');

    const json = await fetch(`${base}/api/nope`);
    assert.equal(json.status, 404);
    assert.match(json.headers.get('content-type'), /application\/json/);
    assert.equal((await json.json()).success, false);
});

test('Discord counts reach clients as two numbers, fetched on the server\'s own schedule', async () => {
    const deadline = Date.now() + 5000;
    let body;
    for (;;) {
        body = await (await fetch(`${base}/api/status`)).json();
        if (body.discord) { break; }
        assert.ok(Date.now() < deadline, 'Discord counts never appeared in /api/status');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // Exact shape: nothing else from Discord's reply may leak through.
    assert.deepEqual(body.discord, { online: 312, members: 4120 });
    // Every test above hit the API, yet Discord was asked once: requests cannot trigger a fetch.
    assert.deepEqual(discordRequests, ['/invites/smoketest?with_counts=true']);
});

test('GET /health answers on loopback', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
});

test('the shipped example config is loadable', () => {
    const example = JSON.parse(fs.readFileSync(path.join(root, 'config', 'config.json.example'), 'utf-8'));
    assert.ok(Array.isArray(example.servers) && example.servers.length > 0, 'example config has no servers');
    for (const mode of example.modes ?? []) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- icon names from the shipped example
        assert.ok(fs.existsSync(path.join(root, 'public', 'icons', `${mode.icon}.svg`)), `example mode icon "${mode.icon}" does not exist`);
    }
    for (const server of example.servers) {
        assert.ok(server.id && server.host && server.type, 'example server entry is missing a required field');
        assert.ok(Number.isInteger(server.port) && server.port > 0 && server.port < 65_536, 'example server port is invalid');
    }
});

test('unset copy is left out and the title falls back to the community name', async () => {
    const body = await (await fetch(`${base}/`)).text();
    assert.ok(body.includes(`<title>${COMMUNITY_NAME}</title>`), 'title should fall back to the community name');
    assert.ok(body.includes(`<meta property="og:title" content="${COMMUNITY_NAME}">`), 'og:title differs from the title');
    for (const tag of ['name="description"', 'og:description', 'twitter:description']) {
        assert.equal(body.includes(tag), false, `${tag} should be left out without META_DESCRIPTION`);
    }
    // #copy-status is a live region and starts empty on purpose.
    assert.equal(/<p(?![^>]*\bid=)[^>]*>\s*<\/p>/.test(body), false, 'unset copy left an empty paragraph');
    assert.equal(/sneak|snksrv/i.test(body), false, 'the page still carries Sneak\'s Community defaults');
});

test('unset links are left out of the page and the structured data', async () => {
    const body = await (await fetch(`${base}/`)).text();
    assert.ok(body.includes('href="https://steamcommunity.com/groups/smoke"'), 'a set link is missing');
    for (const id of ['link-twitch-community', 'link-github-community', 'link-twitch-footer', 'link-github-footer', 'resources']) {
        assert.equal(body.includes(`id="${id}"`), false, `#${id} should be left out when its link is unset`);
    }
    assert.equal(body.includes('href="#resources"'), false, 'the nav links to a section that was left out');
    assert.equal(body.includes('href=""'), false, 'an unset link left an empty href');
    const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body)[1]);
    const org = graph.find((node) => node['@type'] === 'Organization');
    assert.deepEqual(org.sameAs, ['https://discord.gg/smoketest', 'https://steamcommunity.com/groups/smoke']);
    const notFound = await (await fetch(`${base}/nope`, { headers: { Accept: 'text/html' } })).text();
    assert.ok(notFound.includes('id="link-steam-footer"'), '404 page lost a set link');
    assert.equal(notFound.includes('id="link-twitch-footer"'), false, '404 page kept an unset link');
});

test('server names and addresses are in the HTML before any script runs', async () => {
    const body = await (await fetch(`${base}/`)).text();
    const grid = /<div id="server-grid"[^>]*>([\s\S]*?)<\/div>\s*<p id="copy-status"/.exec(body)[1];
    assert.ok(grid.includes('Smoke &amp; Test &lt;Server&gt;'), 'configured name missing or unescaped');
    assert.equal(grid.includes('<Server>'), false, 'server name was injected as raw HTML');
    assert.ok(grid.includes('127.0.0.1:1') && grid.includes('127.0.0.1:2'), 'connect address missing');
    assert.ok(grid.includes('smoke_unnamed'), 'a server without a name should show its id');
    assert.ok(grid.includes('>2024</p>'), 'a numeric name should show as text');
    assert.equal([...grid.matchAll(/h-\[88px\]/g)].length, TEST_CONFIG.servers.length, 'placeholders must keep their fixed height');
});

test('structured data carries the logo, founding year and alias', async () => {
    const body = await (await fetch(`${base}/`)).text();
    const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(body)[1]);
    const org = graph.find((node) => node['@type'] === 'Organization');
    const site = graph.find((node) => node['@type'] === 'WebSite');
    assert.equal(org.foundingDate, '2015');
    assert.equal(org.alternateName, 'smokey');
    assert.equal(site.alternateName, 'smokey');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed filenames under the repo
    const logo = ['logo.svg', 'logo.webp', 'logo.png'].find((file) => fs.existsSync(path.join(root, 'user-assets', file))) ?? 'og-image.png';
    assert.equal(org.logo, `https://smoke.example/${logo}`);
});

test('pages and sitemap carry no tags search engines ignore', async () => {
    const body = await (await fetch(`${base}/`)).text();
    for (const tag of ['name="keywords"', 'name="robots"', 'twitter:url', 'twitter:image:width', 'twitter:image:height']) {
        assert.equal(body.includes(tag), false, `${tag} is still in the page`);
    }
    const notFound = await (await fetch(`${base}/nope`, { headers: { Accept: 'text/html' } })).text();
    assert.ok(notFound.includes('<meta name="robots" content="noindex, follow">'), 'the 404 page lost its noindex');
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes('<loc>https://smoke.example/</loc>'), 'sitemap lost its URL');
    assert.equal(/<changefreq>|<priority>/.test(sitemap), false, 'sitemap still has changefreq/priority');
});

test('the server refuses to start without a valid SITE_URL', async () => {
    const withoutSiteUrl = { ...childEnv };
    delete withoutSiteUrl.SITE_URL;
    const unset = await startup(withoutSiteUrl);
    assert.equal(unset.code, 1);
    assert.match(unset.log, /SITE_URL is required/);
    const invalid = await startup({ ...childEnv, SITE_URL: 'https://smoke.example/path' });
    assert.equal(invalid.code, 1);
    assert.match(invalid.log, /SITE_URL must be a bare http\(s\) origin/);
});

test('the server refuses to start without COMMUNITY_NAME', async () => {
    const { code, log } = await startup({ ...childEnv, COMMUNITY_NAME: ' ' });
    assert.equal(code, 1);
    assert.match(log, /COMMUNITY_NAME is required/);
});

test('the servers heading and game-mode cards come from config.json', async () => {
    const body = await (await fetch(`${base}/`)).text();
    assert.match(body, />Smoke &amp; Servers<\/h2>/);
    assert.ok(body.includes('Surf &amp; Turf') && body.includes('Fast &lt;b&gt;maps&lt;/b&gt;'), 'mode card missing or unescaped');
    assert.equal(body.includes('<b>maps</b>'), false, 'mode text was injected as raw HTML');
    assert.ok(body.includes('/icons.svg#icon-waves'), 'mode icon missing');
    assert.equal(body.includes('KZ Climb'), false, 'a built-in mode card is still in the page');
    assert.equal(body.includes('Global Reach'), false, 'the Global Reach card should be left out without globalReach');
    assert.equal(body.includes('CS:GO'), false, 'the page still names a game nobody configured');
});

test('the server refuses to start on a mode icon that does not exist', async () => {
    const configPath = path.join(temporaryDirectory, 'bad-icon.json');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- own temp dir
    fs.writeFileSync(configPath, JSON.stringify({ ...TEST_CONFIG, modes: [{ icon: 'no-such-icon', title: 'x', description: 'y' }] }));
    const { code, log } = await startup({ ...childEnv, CONFIG_PATH: configPath });
    assert.equal(code, 1);
    assert.match(log, /modes\[0\]\.icon/);
});
