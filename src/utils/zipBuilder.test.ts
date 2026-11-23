import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWindowsLauncherEntries,
  buildZipArchive,
  computeCrc32,
  isSafeZipProjectPath,
} from './zipBuilder';

test('computeCrc32 matches standard IEEE 802.3 CRC-32 check vector "123456789"', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(computeCrc32(bytes), 0xcbf43926);
});

test('buildZipArchive produces valid PKZIP local headers, central directory, and EOCD record', () => {
  const zip = buildZipArchive([
    { path: 'README.txt', data: 'CampusGuard CCTV' },
    { path: 'src/hello.txt', data: 'Windows App & Website' },
  ]);

  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Local file header signature PK\x03\x04
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // EOCD signature PK\x05\x06 at tail (length - 22)
  const eocdOffset = zip.length - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50);
  // Entry count = 2
  assert.equal(view.getUint16(eocdOffset + 8, true), 2);
  assert.equal(view.getUint16(eocdOffset + 10, true), 2);
});

test('buildWindowsLauncherEntries generates Windows App, Website, and Desktop Shortcut scripts', () => {
  const entries = buildWindowsLauncherEntries('https://example.com');
  const names = entries.map((e) => e.path);
  assert.ok(names.includes('START-WINDOWS-APP.bat'));
  assert.ok(names.includes('START-WEBSITE-SERVER.bat'));
  assert.ok(names.includes('OPEN-HOSTED-WINDOWS-APP.bat'));
  assert.ok(names.includes('INSTALL-DESKTOP-SHORTCUT.ps1'));
  assert.ok(names.includes('README-WINDOWS-AND-WEB.txt'));

  const hostedBat = entries.find((e) => e.path === 'OPEN-HOSTED-WINDOWS-APP.bat');
  assert.ok(typeof hostedBat?.data === 'string' && hostedBat.data.includes('https://example.com'));
});

test('isSafeZipProjectPath strictly excludes secrets, .env, node_modules, and traversal paths', () => {
  assert.equal(isSafeZipProjectPath('src/App.tsx'), true);
  assert.equal(isSafeZipProjectPath('.env.example'), true);
  assert.equal(isSafeZipProjectPath('package.json'), true);

  assert.equal(isSafeZipProjectPath('.env'), false);
  assert.equal(isSafeZipProjectPath('.env.local'), false);
  assert.equal(isSafeZipProjectPath('node_modules/react/index.js'), false);
  assert.equal(isSafeZipProjectPath('.git/config'), false);
  assert.equal(isSafeZipProjectPath('.playwright-cli/test.png'), false);
  assert.equal(isSafeZipProjectPath('../secret.txt'), false);
  assert.equal(isSafeZipProjectPath('keys/private.pem'), false);
});
