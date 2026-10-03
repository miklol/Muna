// Storybook gate for the `web` job: for each Storybook project (the design system, then the
// desktop module states) build the static Storybook, serve it locally, then run the test-runner
// (which executes axe on every story). Uses a plain node:http server so the gate has no extra
// dependencies.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { repoRoot, run, runAsync } from './lib.mjs';

const projects = [
  { filter: '@muna/ui', dir: path.join(repoRoot, 'packages', 'ui') },
  { filter: '@muna/desktop', dir: path.join(repoRoot, 'apps', 'desktop') },
];
const basePort = Number(process.env.STORYBOOK_CI_PORT ?? 6006);

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ico', 'image/x-icon'],
  ['.map', 'application/json'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function serve(staticDir, port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    let file = path.join(staticDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(staticDir)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': mime.get(path.extname(file)) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// Idempotent; downloads Chromium once per runner (see the Development section of README.md).
run('pnpm', ['--filter', '@muna/ui', 'exec', 'playwright', 'install', 'chromium']);

for (const [index, project] of projects.entries()) {
  const port = basePort + index;
  run('pnpm', ['--filter', project.filter, 'build-storybook']);
  const server = await serve(path.join(project.dir, 'storybook-static'), port);
  try {
    // Must be async: a blocking spawn would freeze the event loop and the server with it.
    await runAsync(
      'pnpm',
      [
        '--filter',
        project.filter,
        'exec',
        'test-storybook',
        '--url',
        `http://127.0.0.1:${port}`,
        '--ci',
        '--maxWorkers=2',
      ],
      { env: { STORYBOOK_DISABLE_TELEMETRY: '1' } },
    );
  } finally {
    server.close();
  }
  console.log(`storybook:ci ok (${project.filter})`);
}
