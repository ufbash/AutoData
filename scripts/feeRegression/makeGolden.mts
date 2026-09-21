// Run once against the frozen oracle: node --experimental-strip-types scripts/feeRegression/makeGolden.mts
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as old from './oldCore.mts';
import { buildGrid } from './goldenGrid.mts';
const grid = buildGrid(old as any, new URL('./rows_baseline.json', import.meta.url).pathname);
const text = JSON.stringify(grid);
// (golden.json is 3 MB; only its sha256 is kept in golden.sha256 - the oracle regenerates it deterministically)
console.log({ cells: Object.keys(grid.cells).length, prices: grid.prices, targets: grid.targets, bytes: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex') });
