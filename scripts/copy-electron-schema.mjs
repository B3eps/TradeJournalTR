import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schema = new URL('../server/src/db/schema.sql', import.meta.url);
const destination = new URL('../electron/schema.sql', import.meta.url);

copyFileSync(fileURLToPath(schema), fileURLToPath(destination));
console.log('SQLite schema copied into the Electron package.');
