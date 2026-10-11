const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const { resolveInside, prepareEsbuildServerConfig } = require('../dist/cordova-serve-esbuild/index.js');
const { augmentIndexHtml } = require('../dist/utils/append-scripts.js');

const base = resolve('/srv/www');

test('a path inside the directory resolves to the file', () => {
  assert.equal(resolveInside(base, '/cordova.js'), resolve(base, 'cordova.js'));
  assert.equal(resolveInside(base, '/plugins/a%20b/x.js'), resolve(base, 'plugins/a b/x.js'));
});

test('a path that climbs out of the directory is refused', () => {
  assert.equal(resolveInside(base, '/../etc/passwd'), null);
  assert.equal(resolveInside(base, '/%2e%2e/etc/passwd'), null);
  assert.equal(resolveInside(base, '/a/../../etc/passwd'), null);
  assert.equal(resolveInside(base, '/ok\0.js'), null);
  assert.equal(resolveInside(base, '/%E0%A4%A'), null);
});

test('a script bundle is injected as <name>.js', () => {
  const html = augmentIndexHtml('<html><head></head><body></body></html>', [
    { bundleName: 'cordova', inject: true, paths: ['/x/cordova.js'] },
  ]);
  assert.match(html, /<script src="cordova\.js"><\/script>/);
});

test('the mock and the console-log scripts ship with the package', () => {
  const { scripts } = prepareEsbuildServerConfig(
    { cordovaMock: true, consolelogs: true, consolelogsPort: 4201 },
    process.cwd(),
  );
  const names = scripts.map((s) => s.bundleName).sort();
  assert.deepEqual(names, ['consolelogs', 'cordova']);
  for (const script of scripts) {
    for (const path of script.paths) assert.ok(existsSync(path), `${path} exists`);
  }
});
