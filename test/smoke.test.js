// Boots dist/index.js on a free port against a throwaway config and exercises every route.
// Requires npm run build first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const COMMUNITY_NAME = 'Smoke Test Community';
// Loopback with nothing listening: no DNS, no live server. Costs GameDig's ~4s give-up time.
const TEST_CONFIG = {
    servers: [{ id: 'smoke_test', host: '127.0.0.1', port: 1, type: 'csgo', name: 'Smoke Test Server' }],
};

let child;
let base;
let temporaryDirectory;

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

    const port = await freePort();
    base = `http://127.0.0.1:${String(port)}`;
    child = spawn(process.execPath, ['dist/index.js'], {
        cwd: root,
        env: { ...process.env, PORT: String(port), CONFIG_PATH: configPath, COMMUNITY_NAME, LOG_LEVEL: 'silent', NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
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
