import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import { TASKS, type Task } from './tasks';

const ROOT = resolve(import.meta.dirname, '..');
const BENCH = join(ROOT, 'benchmarks');
const LANGS = {
  ts: {
    file: 'game.ts',
    fence: 'ts',
    context: join(BENCH, 'context/typescript.md'),
    name: 'TypeScript',
  },
  tess: {
    file: 'game.tess',
    fence: 'tess',
    context: join(ROOT, 'docs/tess-spec.md'),
    name: 'Tess',
  },
} as const;
type Lang = keyof typeof LANGS;

interface Attempt {
  task: string;
  lang: Lang;
  trial: number;
  pass: boolean;
  input: number;
  output: number;
  error: string;
}

const read = (p: string) => readFileSync(p, 'utf8');

function prompts(task: Task, lang: Lang) {
  const l = LANGS[lang];
  const ex = join(ROOT, 'examples', task.game);
  const system = `You implement gameplay features in games made with the Tessera engine.
Reply with the complete updated ${l.file} in a single \`\`\`${l.fence} code block and nothing else.

${read(l.context)}`;
  const scene = read(join(ex, 'scene.yaml')).replace(/\.\/game\.(ts|tess)\b/, `./${l.file}`);
  const user = `scene.yaml:\n\`\`\`yaml\n${scene}\`\`\`\n\n${l.file}:\n\`\`\`${l.fence}\n${read(join(ex, l.file))}\`\`\`\n\nTask: ${task.prompt}`;
  return { system, user };
}

/** The last fenced code block of a reply. */
function codeOf(text: string): string | null {
  const blocks = [...text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)];
  return blocks.at(-1)?.[1] ?? null;
}

function check(task: Task, lang: Lang, dir: string): string {
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', 'benchmarks/checks.test.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, BENCH_TASK: task.id, BENCH_DIR: dir, BENCH_SCRIPT: LANGS[lang].file },
  });
  if (res.status === 0) return '';
  const out = `${res.stdout}\n${res.stderr}`;
  const line = out.split('\n').find((l) => /Error|expected|tess:\d/.test(l));
  return (line ?? 'check failed').trim().slice(0, 160);
}

async function countTokens(
  client: Anthropic | null,
  model: string,
  text: string,
): Promise<number | null> {
  if (!client) return null;
  const r = await client.messages.countTokens({
    model,
    messages: [{ role: 'user', content: text }],
  });
  return r.input_tokens;
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string', default: 'claude-opus-5-5' },
      effort: { type: 'string', default: 'high' },
      trials: { type: 'string', default: '3' },
      tasks: { type: 'string' },
      oracle: { type: 'boolean', default: false },
    },
  });
  const trials = Number(values.trials);
  const tasks = TASKS.filter((t) => !values.tasks || values.tasks.split(',').includes(t.id));
  // --oracle applies the reference solutions instead of calling the model: validates tasks and checks offline.
  const client = values.oracle ? null : new Anthropic();
  const model = values.model;
  const effort = values.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max';

  const sizes: { game: string; lang: Lang; tokens: number | null; chars: number }[] = [];
  for (const game of ['platformer', 'arena']) {
    for (const lang of Object.keys(LANGS) as Lang[]) {
      const src = read(join(ROOT, 'examples', game, LANGS[lang].file));
      sizes.push({ game, lang, tokens: await countTokens(client, model, src), chars: src.length });
    }
  }
  const contextTokens = {
    ts: await countTokens(client, model, read(LANGS.ts.context)),
    tess: await countTokens(client, model, read(LANGS.tess.context)),
  };

  const tmp = join(BENCH, '.tmp');
  rmSync(tmp, { recursive: true, force: true });
  const attempts: Attempt[] = [];
  for (const task of tasks) {
    for (const lang of Object.keys(LANGS) as Lang[]) {
      for (let trial = 1; trial <= (values.oracle ? 1 : trials); trial++) {
        const dir = join(tmp, `${task.id}-${lang}-${trial}`);
        mkdirSync(dir, { recursive: true });
        cpSync(join(ROOT, 'examples', task.game), dir, { recursive: true });
        const file = join(dir, LANGS[lang].file);
        const a: Attempt = {
          task: task.id,
          lang,
          trial,
          pass: false,
          input: 0,
          output: 0,
          error: '',
        };
        if (client) {
          const { system, user } = prompts(task, lang);
          const msg = await client.messages
            .stream({
              model,
              max_tokens: 64000,
              thinking: { type: 'adaptive' },
              output_config: { effort },
              system,
              messages: [{ role: 'user', content: user }],
            })
            .finalMessage();
          a.input = msg.usage.input_tokens;
          a.output = msg.usage.output_tokens;
          const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
          const code = msg.stop_reason === 'refusal' ? null : codeOf(text);
          if (code) writeFileSync(file, code);
          else a.error = `no code block (stop_reason ${msg.stop_reason})`;
        } else {
          let src = read(file);
          for (const [from, to] of task.oracle[lang]) {
            if (!src.includes(from))
              throw new Error(`oracle ${task.id}/${lang}: anchor not found: ${from.slice(0, 60)}`);
            src = src.replace(from, to);
          }
          writeFileSync(file, src);
        }
        if (!a.error) a.error = check(task, lang, dir);
        a.pass = a.error === '';
        attempts.push(a);
        console.log(
          `${a.pass ? 'PASS' : 'FAIL'} ${task.id} ${lang} #${trial}${a.error ? ` - ${a.error}` : ''}`,
        );
      }
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  writeFileSync(
    join(BENCH, 'RESULTS.md'),
    report({ model, effort, trials, oracle: values.oracle, sizes, contextTokens, attempts }),
  );
  console.log(`wrote ${join(BENCH, 'RESULTS.md')}`);
  return attempts.every((a) => a.pass) || !values.oracle ? 0 : 1;
}

function report(r: {
  model: string;
  effort: string;
  trials: number;
  oracle: boolean;
  sizes: { game: string; lang: Lang; tokens: number | null; chars: number }[];
  contextTokens: Record<Lang, number | null>;
  attempts: Attempt[];
}): string {
  const n = (x: number | null) => (x === null ? 'n/a' : String(x));
  const pct = (a: Attempt[]) =>
    a.length ? `${Math.round((100 * a.filter((x) => x.pass).length) / a.length)}%` : 'n/a';
  const avg = (a: Attempt[], k: 'input' | 'output') =>
    a.length ? Math.round(a.reduce((s, x) => s + x[k], 0) / a.length) : 0;
  const lines = [
    '# Tessera benchmark: TypeScript vs Tess',
    '',
    r.oracle
      ? '> **Oracle run**: reference solutions were applied instead of model answers. It validates the tasks and checks; it measures no model. Token counts need API credentials.'
      : `Model \`${r.model}\`, effort \`${r.effort}\`, ${r.trials} trial(s) per task and language, one shot (no retries, no tool use).`,
    '',
    'Reproduce: `pnpm bench` (needs `ANTHROPIC_API_KEY`); `pnpm bench --oracle` validates offline.',
    '',
    '## Source size (tokens via the Anthropic token counting API)',
    '',
    '| Game | TypeScript tokens | Tess tokens | TypeScript chars | Tess chars |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const game of ['platformer', 'arena']) {
    const ts = r.sizes.find((s) => s.game === game && s.lang === 'ts');
    const te = r.sizes.find((s) => s.game === game && s.lang === 'tess');
    lines.push(
      `| ${game} | ${n(ts?.tokens ?? null)} | ${n(te?.tokens ?? null)} | ${ts?.chars} | ${te?.chars} |`,
    );
  }
  lines.push(
    `| context doc | ${n(r.contextTokens.ts)} | ${n(r.contextTokens.tess)} | | |`,
    '',
    '## Feature tasks (first-try success)',
    '',
    '| Task | TypeScript pass | Tess pass | TypeScript in/out tokens | Tess in/out tokens |',
    '| --- | --- | --- | --- | --- |',
  );
  const tasks = [...new Set(r.attempts.map((a) => a.task))];
  for (const t of [...tasks, 'all']) {
    const of = (lang: Lang) =>
      r.attempts.filter((a) => a.lang === lang && (t === 'all' || a.task === t));
    const ts = of('ts');
    const te = of('tess');
    lines.push(
      `| ${t === 'all' ? '**all**' : t} | ${pct(ts)} | ${pct(te)} | ${avg(ts, 'input')} / ${avg(ts, 'output')} | ${avg(te, 'input')} / ${avg(te, 'output')} |`,
    );
  }
  const failures = r.attempts.filter((a) => !a.pass);
  if (failures.length) {
    lines.push('', '## Failures', '');
    for (const f of failures)
      lines.push(`- ${f.task} ${LANGS[f.lang].name} #${f.trial}: ${f.error}`);
  }
  return `${lines.join('\n')}\n`;
}
