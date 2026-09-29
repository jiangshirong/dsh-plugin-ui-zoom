/**
 * Install a freshly built browser half into a DSH profile directory.
 *
 * Exists because the module-table envelope hard-codes the package name at build
 * time: mounting a bundle under a different row name makes `clientModules` fail
 * its registration check, which surfaces only as `import failed` in a console
 * nobody can read. This script rewrites the envelope id to the name the row
 * actually uses, so the two can never drift.
 *
 * Usage: node scripts/install-profile.mjs <profileDir> <rowName>
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [profileDir, rowName] = process.argv.slice(2);

if (profileDir === undefined || rowName === undefined) {
	console.error('usage: node scripts/install-profile.mjs <profileDir> <rowName>');
	process.exit(2);
}

const source = readFileSync(join(root, 'lib/client.js'), 'utf8');
const idLine = /^(\s*id:\s*)"[^"]*"(,?)$/m;
if (!idLine.test(source)) {
	console.error('lib/client.js has no envelope id line; run npm run build first');
	process.exit(1);
}
const installed = source.replace(idLine, `$1${JSON.stringify(rowName)}$2`);

const target = join(profileDir, 'node_modules', rowName);
mkdirSync(join(target, 'lib'), { recursive: true });
writeFileSync(join(target, 'lib/client.js'), installed, 'utf8');
copyFileSync(join(root, 'lib/index.js'), join(target, 'lib/index.js'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
pkg.name = rowName;
pkg.private = true;
writeFileSync(join(target, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

const check = /id:\s*"([^"]*)"/.exec(installed);
console.log(`installed ${rowName} into ${target}`);
console.log(`  envelope id: ${check?.[1] ?? '<none>'} (must equal the row name)`);
