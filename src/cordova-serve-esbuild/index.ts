import { createBuilder, targetFromTargetString } from '@angular-devkit/architect';
import type { BuilderContext } from '@angular-devkit/architect';
import { getSystemPath, join, normalize } from '@angular-devkit/core';
import { executeDevServerBuilder } from '@angular/build';
import type { DevServerBuilderOptions, DevServerBuilderOutput } from '@angular/build';
import type { json } from '@angular-devkit/core';
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import type * as http from 'http';
import { extname, resolve, sep } from 'path';
import { from } from 'rxjs';
import type { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { GlobalScriptsByBundleName } from '../utils';
import { augmentIndexHtml } from '../utils/append-scripts';
import { createConsoleLogServer } from '../utils/log-server';
import type { CordovaServeBuilderSchema } from './schema';

/** `assets/` next to `dist/` in the package: this file is `dist/cordova-serve-esbuild/index.js`. */
const PACKAGE_ASSETS = resolve(__dirname, '..', '..', 'assets');

export type CordovaDevServerBuilderOptions = CordovaServeBuilderSchema & json.JsonObject;

const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.map': 'application/json',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
};

export function serveCordova(options: CordovaServeBuilderSchema, context: BuilderContext): Observable<DevServerBuilderOutput> {
  const { devServerTarget, port, host, ssl } = options;
  const root = context.workspaceRoot;
  const devServerTargetSpec = targetFromTargetString(devServerTarget);

  async function setup() {
    const devServerTargetOptions = await context.getTargetOptions(devServerTargetSpec);
    const devServerName = await context.getBuilderNameForTarget(devServerTargetSpec);

    devServerTargetOptions.port = port;
    devServerTargetOptions.host = host;
    devServerTargetOptions.ssl = ssl;

    const formattedOptions = await context.validateOptions<DevServerBuilderOptions & json.JsonObject>(devServerTargetOptions, devServerName);
    const serverAssets = prepareEsbuildServerConfig(options, root);

    if (options.consolelogs && options.consolelogsPort) {
      await createConsoleLogServer(host, options.consolelogsPort);
    }

    return { formattedOptions, serverAssets };
  }

  return from(setup()).pipe(
    switchMap(({ formattedOptions, serverAssets }) =>
      from(
        executeDevServerBuilder(formattedOptions as unknown as DevServerBuilderOptions, context as any, {
          middleware: buildMiddleware(serverAssets),
          indexHtmlTransformer: indexHtmlTransformFactory(serverAssets),
        })
      )
    )
  );
}

export default createBuilder<CordovaDevServerBuilderOptions, any>(serveCordova);

function buildMiddleware(
  serverAssets: EsbuildServerAssets
): ((req: http.IncomingMessage, res: http.ServerResponse, next: (err?: unknown) => void) => void)[] {
  const handlers: ((req: http.IncomingMessage, res: http.ServerResponse, next: (err?: unknown) => void) => void)[] = [];

  // Serve each script bundle at /{bundleName}.js by concatenating its source files
  for (const script of serverAssets.scripts) {
    const bundlePath = `/${script.bundleName}.js`;
    handlers.push((req, res, next) => {
      const reqPath = (req.url ?? '/').split('?')[0];
      if (reqPath === bundlePath) {
        const content = script.paths.map((p) => readFileSync(p, 'utf-8')).join('\n');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(content);
        return;
      }
      next();
    });
  }

  // Serve static asset directories (e.g. cordova platform_www)
  for (const dir of serverAssets.staticDirs) {
    const base = resolve(dir);
    handlers.push((req, res, next) => {
      const filePath = resolveInside(base, (req.url ?? '/').split('?')[0]);
      if (filePath && existsSync(filePath) && statSync(filePath).isFile()) {
        const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(readFileSync(filePath));
        return;
      }
      next();
    });
  }

  return handlers;
}

/**
 * The file a request path names inside `base`, or null when it is malformed or climbs out of `base`
 * (`/../x`, `/%2e%2e/x`). The path is decoded first: a file name with a space or a non-ASCII letter arrives encoded.
 */
export function resolveInside(base: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const target = resolve(base, decoded.replace(/^\/+/, ''));
  return target === base || target.startsWith(base + sep) ? target : null;
}

export const indexHtmlTransformFactory: (serverAssets: EsbuildServerAssets) => (content: string) => Promise<string> =
  ({ scripts }) =>
  (indexHtml: string) =>
    Promise.resolve(augmentIndexHtml(indexHtml, scripts));


export interface EsbuildServerAssets {
  scripts: GlobalScriptsByBundleName[];
  staticDirs: string[];
}

export function prepareEsbuildServerConfig(options: CordovaServeBuilderSchema, root: string): EsbuildServerAssets {
  const rawScripts: { input: string; bundleName: string }[] = [];
  const staticDirs: string[] = [];
  const cordovaBasePath = normalize(options.cordovaBasePath ? options.cordovaBasePath : '.');

  if (options.consolelogs) {
    // Written to the temp directory: the package's own directory may be read-only (node_modules).
    const configPath = resolve(tmpdir(), 'cordova-serve-esbuild-consolelog-config.js');
    writeFileSync(
      configPath,
      `window.Ionic = window.Ionic || {}; Ionic.ConsoleLogServerConfig = { wsPort: ${options.consolelogsPort} }`
    );
    rawScripts.push({ input: configPath, bundleName: 'consolelogs' });
    rawScripts.push({
      input: getSystemPath(join(normalize(PACKAGE_ASSETS), normalize('consolelogs.js'))),
      bundleName: 'consolelogs',
    });
  }

  if (options.cordovaMock) {
    rawScripts.push({
      input: getSystemPath(join(normalize(PACKAGE_ASSETS), normalize('cordova.js'))),
      bundleName: 'cordova',
    });
  } else if (options.cordovaAssets) {
    const platformWWWPath = join(cordovaBasePath, normalize(`platforms/${options.platform}/platform_www`));
    staticDirs.push(getSystemPath(platformWWWPath));
    rawScripts.push({
      input: getSystemPath(join(platformWWWPath, normalize('cordova.js'))),
      bundleName: 'cordova',
    });
  }

  const scripts = rawScripts.reduce((prev: GlobalScriptsByBundleName[], curr) => {
    const resolvedPath = resolve(root, curr.input);
    const existingEntry = prev.find((el) => el.bundleName === curr.bundleName);
    if (existingEntry) {
      existingEntry.paths.push(resolvedPath);
    } else {
      prev.push({ bundleName: curr.bundleName, inject: true, paths: [resolvedPath] });
    }
    return prev;
  }, []);

  return { scripts, staticDirs };
}
