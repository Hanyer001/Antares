import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
const root = new URL('../', import.meta.url);
const out = new URL('dist/.web-build/', root);
const target = new URL('dist/web/', root);
const web = new URL('web/', root);
const endpoint = process.env.ANTARES_WEB_API?.trim() ? new URL(process.env.ANTARES_WEB_API.trim()) : null;
if (endpoint && (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)) throw new Error('ANTARES_WEB_API debe ser HTTPS sin credenciales ni parámetros.');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(new URL('src/', root), out, { recursive: true });
for (const name of ['bootstrap.js', 'web-shell.css', 'manifest.webmanifest']) await cp(new URL(name, web), new URL(name, out));
await cp(new URL('src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', root), new URL('icon-192.png', out));
await cp(new URL('src-tauri/icons/icon.png', root), new URL('icon-512.png', out));
const fingerprint = createHash('sha256');
for (const name of await files(out)) fingerprint.update(name).update(await readFile(new URL(name, out)));
for (const name of ['web/sw.js', 'scripts/build-web.mjs', 'package-lock.json']) {
  fingerprint.update(await readFile(new URL(name, root)));
}
const version = fingerprint.update(endpoint?.href ?? '').digest('hex').slice(0, 12);
await writeFile(new URL('config.js', out), `export const API = ${JSON.stringify(endpoint ? endpoint.href.replace(/\/$/, '') + '/' : './api/')};\nexport const WEB_VERSION = "${version}";\n`);
const result = await build({ entryPoints: [fileURLToPath(new URL('bootstrap.js', out))], outdir: fileURLToPath(new URL('assets/', out)),
  bundle: true, splitting: true, format: 'esm', minify: true, target: ['safari16.4', 'chrome110'],
  entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', metafile: true, logLevel: 'warning' });
const outputs = Object.entries(result.metafile.outputs);
const entry = outputs.find(([, info]) => info.entryPoint?.endsWith('/bootstrap.js'))?.[0];
if (!entry) throw new Error('No se generó la entrada web.');
const relativeEntry = entry.slice(entry.indexOf('assets/'));
await rm(new URL('js/', out), { recursive: true, force: true });
await rm(new URL('main.js', out));
await rm(new URL('bootstrap.js', out));
async function files(dir, prefix = '') {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await files(new URL(entry.name + '/', dir), path + '/'));
    else result.push(path);
  }
  return result.sort();
}
const initial = await files(out);
const cssHash = createHash('sha256');
for (const name of initial.filter(name => name.endsWith('.css'))) {
  const css = await readFile(new URL(name, out), 'utf8');
  const transformed = await transform(css, { loader: 'css', minify: true, target: ['safari16.4', 'chrome110'] });
  cssHash.update(transformed.code);
  await writeFile(new URL(name, out), transformed.code);
}
const cssVersion = cssHash.digest('hex').slice(0, 12);
let html = await readFile(new URL('src/index.html', root), 'utf8');
html = html.replace('<html lang="es">', '<html lang="es" data-web="true">')
  .replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover')
  .replace('<script type="module" src="/main.js" defer></script>', `<script type="module" src="./${relativeEntry}"></script>`)
  .replace('</head>', '<meta name="theme-color" content="#141019"><link rel="manifest" href="./manifest.webmanifest"><link rel="apple-touch-icon" href="./icon-192.png"><link rel="icon" href="./icon-192.png"><link rel="stylesheet" href="./web-shell.css"></head>')
  .replace(/href="([^"]+\.css)"/g, `href="$1?v=${cssVersion}"`)
  .replace('src="boot-theme.js"', `src="boot-theme.js?v=${version}"`);
await writeFile(new URL('index.html', out), html);
const report = {
  version,
  sourceJavaScriptFiles: Object.keys(result.metafile.inputs).length,
  sourceJavaScriptBytes: Object.values(result.metafile.inputs).reduce((n, item) => n + item.bytes, 0),
  outputJavaScriptFiles: outputs.length,
  outputJavaScriptBytes: outputs.reduce((n, [, item]) => n + item.bytes, 0),
  gzipEstimateBytes: (await Promise.all(outputs.map(async ([path]) => gzipSync(await readFile(path)).length))).reduce((a,b) => a+b, 0),
  lazyViews: ['importlist', 'visualizer'],
};
await writeFile(new URL('build-report.json', out), JSON.stringify(report, null, 2));
const assets = await files(out);
// Las tipografías alternativas se guardan al usarlas, no durante el arranque.
const critical = assets.filter(name => !name.startsWith('fonts/') || name.startsWith('fonts/inter-latin'));
const worker = (await readFile(new URL('sw.js', web), 'utf8'))
  .replace('__VERSION__', version)
  .replace('__ASSETS__', JSON.stringify(['./', ...critical.map(name => './' + name),
    ...critical.filter(name => name.endsWith('.css')).map(name => './' + name + '?v=' + cssVersion),
    './boot-theme.js?v=' + version]));
await writeFile(new URL('sw.js', out), worker);
await writeFile(new URL('.nojekyll', out), '');
await rm(target, { recursive: true, force: true });
await rename(out, target);
console.log(`Antares web: ${report.sourceJavaScriptFiles} módulos → ${report.outputJavaScriptFiles} archivos JS; ${Math.round(report.outputJavaScriptBytes / 1024)} KiB minificados.`);
