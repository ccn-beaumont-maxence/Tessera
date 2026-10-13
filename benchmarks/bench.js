#!/usr/bin/env node
// `pnpm bench [--model M] [--effort E] [--trials N] [--tasks a,b] [--oracle]`
import { fileURLToPath } from 'node:url';
import { runTs } from '@tessera/cli/runner';

const run = fileURLToPath(new URL('./run.ts', import.meta.url));
process.exitCode = await runTs(run, (m) => m.main(process.argv.slice(2)));
