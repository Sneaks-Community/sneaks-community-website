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
let base;
let temporaryDirectory;
let output = '';

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
    child = spawn(process.execPath, ['dist/index.js'], {
        cwd: root,
        env: {
            ...process.env,
            PORT: String(port),
            CONFIG_PATH: configPath,
            COMMUNITY_NAME,
            COMMUNITY_ALIAS: 'smokey',
            SITE_URL: '',
            LOG_LEVEL: 'warn',
            NODE_ENV: 'production',
            DISCORD_LINK: 'https://discord.gg/smoketest',
            DISCORD_API_URL: discordApiUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

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
    for (const server of example.servers) {
        assert.ok(server.id && server.host && server.type, 'example server entry is missing a required field');
        assert.ok(Number.isInteger(server.port) && server.port > 0 && server.port < 65_536, 'example server port is invalid');
    }
});

test('the title, hero tagline and description name the game', async () => {
    const body = await (await fetch(`${base}/`)).text();
    const title = `${COMMUNITY_NAME} | CS:GO Surf, KZ &amp; Bhop Servers`;
    assert.ok(body.includes(`<title>${title}</title>`), 'title does not name the game');
    assert.ok(body.includes(`<meta property="og:title" content="${title}">`), 'og:title differs from the title');
    assert.ok(body.includes(`<meta name="twitter:title" content="${title}">`), 'twitter:title differs from the title');
    assert.ok(body.includes(`${COMMUNITY_NAME} is an open CS:GO community running US-based Surf, KZ, Bhop, 1v1 Arenas and Retakes servers since 2015.`), 'hero tagline does not define the community');
    const description = /<meta name="description" content="([^"]*)">/.exec(body)[1];
    assert.ok(description.startsWith(`${COMMUNITY_NAME}: open CS:GO Surf`), 'description does not name the game');
    assert.ok(description.length <= 155, `description is ${String(description.length)} characters`);
    assert.match(body, />CS:GO SERVERS<\/h2>/);
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
    assert.equal(org.logo, `https://snksrv.com/${logo}`);
});

test('pages and sitemap carry no tags search engines ignore', async () => {
    const body = await (await fetch(`${base}/`)).text();
    for (const tag of ['name="keywords"', 'name="robots"', 'twitter:url', 'twitter:image:width', 'twitter:image:height']) {
        assert.equal(body.includes(tag), false, `${tag} is still in the page`);
    }
    const notFound = await (await fetch(`${base}/nope`, { headers: { Accept: 'text/html' } })).text();
    assert.ok(notFound.includes('<meta name="robots" content="noindex, follow">'), 'the 404 page lost its noindex');
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.ok(sitemap.includes('<loc>https://snksrv.com/</loc>'), 'sitemap lost its URL');
    assert.equal(/<changefreq>|<priority>/.test(sitemap), false, 'sitemap still has changefreq/priority');
});

test('an unset SITE_URL is logged, since canonical URLs then point at snksrv.com', () => {
    assert.match(output, /SITE_URL is not set/);
});
