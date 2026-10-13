import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTessServer } from './index';

/** `tess-mcp <scene.yaml|main.ts> [--headed] [--seed N]`: MCP server over stdio. */
export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      headed: { type: 'boolean', default: false },
      seed: { type: 'string', default: '1' },
    },
  });
  const entry = positionals[0];
  if (!entry) {
    console.error('usage: tess-mcp <scene.yaml|main.ts> [--headed] [--seed N]');
    return 1;
  }
  const tess = await createTessServer(entry, { headed: values.headed, seed: Number(values.seed) });
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((done) => {
    transport.onclose = done;
  });
  await tess.server.connect(transport);
  await closed;
  await tess.close();
  return 0;
}
