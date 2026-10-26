#!/usr/bin/env node
// game-version-fix.mjs (VAULT copy) — ONE-SHOT: same one-line GAME_VERSION
// bump on fateblade/src/game.html so the mirror sha stays identical to the
// CYF-Cards source. The workflow then regenerates the manifest (new sha) and
// runs the vault guard BEFORE committing.
import { readFileSync, writeFileSync } from 'node:fs';
const OLD = "const GAME_VERSION = '0.32.1';";
const NEW = "const GAME_VERSION = '0.41.1';";
const src = readFileSync('fateblade/src/game.html', 'utf8');
const n = src.split(OLD).length - 1;
if (n !== 1) { console.error(`game-version-fix: anchor matched ${n} times (must be exactly 1) — ABORT, nothing written`); process.exit(1); }
writeFileSync('fateblade/src/game.html', src.replace(OLD, NEW));
console.log('game-version-fix: vault game.html GAME_VERSION 0.32.1 -> 0.41.1 (mirror of the CYF-Cards fix)');
