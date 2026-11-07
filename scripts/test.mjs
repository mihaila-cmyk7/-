import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../test');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

console.log('Тесты:', files.join(', '), '\n');
for (const f of files) {
  await import(pathToFileURL(resolve(dir, f)).href);
}
