#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { runTs } from '@tessera/cli/runner';

const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
process.exitCode = await runTs(main, (mcp) => mcp.main(process.argv.slice(2)));
