// Every /icons.svg#icon-<name> reference must have a matching public/icons/<name>.svg, or the
// icon silently renders as nothing. Run with: npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.join(import.meta.dirname, '..');
const iconsDirectory = path.join(root, 'public', 'icons');
const sources = [
    'public/index.html',
    'public/404.html',
    'public/common.js',
    'public/script.js',
    'src/index.ts',
];

const available = new Set(
    fs.readdirSync(iconsDirectory)
        .filter((file) => file.endsWith('.svg'))
        .map((file) => path.basename(file, '.svg')),
);

test('every referenced icon has a file', () => {
    for (const source of sources) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed list above
        const text = fs.readFileSync(path.join(root, source), 'utf-8');
        const referenced = [...text.matchAll(/\/icons\.svg#icon-([a-z0-9-]+)/g)].map((m) => m[1]);
        for (const name of referenced) {
            assert.ok(available.has(name), `${source} references #icon-${name}, but public/icons/${name}.svg is missing`);
        }
        assert.equal(text.includes('href="#icon-'), false, `${source} still has a same-document #icon- reference`);
    }
});

test('every icon file is a symbol-able svg with a viewBox', () => {
    assert.ok(available.size > 0, 'no icons found');
    for (const name of available) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from readdirSync over a fixed directory
        const svg = fs.readFileSync(path.join(iconsDirectory, `${name}.svg`), 'utf-8');
        const rootTag = /<svg\b([^>]*)>/.exec(svg);
        assert.ok(rootTag, `${name}.svg has no <svg> root element`);
        assert.match(rootTag[1], /viewBox="/, `${name}.svg root has no viewBox`);
        assert.equal(svg.includes('<symbol'), false, `${name}.svg should be a plain svg, not a symbol`);
    }
});
