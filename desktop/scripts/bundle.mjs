#!/usr/bin/env node
// Assembles a runnable bundle from the Electron runtime that npm already
// installed, for whichever platform this script runs on.
//
// electron-packager is avoided on purpose: it silently fails on some machines
// while extracting its own Electron download. This uses node_modules/electron
// directly, so there is nothing extra to fetch.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = path.join(root, 'node_modules', 'electron', 'dist');
const outRoot = path.join(root, 'release');
const APP = 'PSN Avatar Cart';
const PAYLOAD = ['package.json', 'main.js', 'preload.js', 'index.html', 'dist', 'resources'];

if (!fs.existsSync(runtime)) {
  console.error('Electron runtime missing. Run `npm ci` first.');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('dist/ missing. Run `npm run build` first.');
  process.exit(1);
}

fs.mkdirSync(outRoot, { recursive: true });

function copyPayload(target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of PAYLOAD) {
    fs.cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, verbatimSymlinks: true });
  }
}

function plist(plistPath, key, value) {
  const buddy = '/usr/libexec/PlistBuddy';
  try {
    execFileSync(buddy, ['-c', `Set :${key} ${value}`, plistPath]);
  } catch {
    execFileSync(buddy, ['-c', `Add :${key} string ${value}`, plistPath]);
  }
}

if (process.platform === 'darwin') {
  const appPath = path.join(outRoot, `${APP}.app`);
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.cpSync(path.join(runtime, 'Electron.app'), appPath, { recursive: true, verbatimSymlinks: true });

  const macos = path.join(appPath, 'Contents', 'MacOS');
  fs.renameSync(path.join(macos, 'Electron'), path.join(macos, 'PSNCart'));
  fs.rmSync(path.join(appPath, 'Contents', 'Resources', 'default_app.asar'), { force: true });

  copyPayload(path.join(appPath, 'Contents', 'Resources', 'app'));

  const info = path.join(appPath, 'Contents', 'Info.plist');
  plist(info, 'CFBundleExecutable', 'PSNCart');
  plist(info, 'CFBundleIdentifier', 'local.psncart');
  plist(info, 'CFBundleName', APP);
  plist(info, 'CFBundleDisplayName', APP);

  console.log(`macOS bundle: ${appPath}`);
} else if (process.platform === 'win32') {
  const dir = path.join(outRoot, `${APP}-win32-${process.arch}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(runtime, dir, { recursive: true, verbatimSymlinks: true });

  fs.renameSync(path.join(dir, 'electron.exe'), path.join(dir, `${APP}.exe`));
  fs.rmSync(path.join(dir, 'resources', 'default_app.asar'), { force: true });

  copyPayload(path.join(dir, 'resources', 'app'));

  console.log(`Windows bundle: ${dir}`);
} else {
  console.error(`Unsupported host platform: ${process.platform}`);
  process.exit(1);
}
