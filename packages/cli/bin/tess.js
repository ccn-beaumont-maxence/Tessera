#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runTs } from './runner.js';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
process.exitCode = await runTs(main, (cli, importer) => cli.main(process.argv.slice(2), importer));
