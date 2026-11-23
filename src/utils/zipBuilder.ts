export interface ZipInputEntry {
  /** Forward-slash relative path inside the ZIP archive (e.g. "src/App.tsx") */
  path: string;
  /** Raw bytes or UTF-8 text content */
  data: Uint8Array | string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a valid, standards-compliant PKZIP (Store / method 0) archive in pure TypeScript
 * with IEEE CRC-32 checksums. Works identically in Node.js (server) and the browser.
 */
export function buildZipArchive(entries: ZipInputEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const normalized = entries.map((entry) => {
    const cleanPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = encoder.encode(cleanPath);
    const dataBytes =
      typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const crc = computeCrc32(dataBytes);
    return { cleanPath, nameBytes, dataBytes, crc };
  });

  // Compute DOS timestamp (valid fixed/current timestamp)
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  let localSize = 0;
  let centralSize = 0;
  for (const item of normalized) {
    localSize += 30 + item.nameBytes.length + item.dataBytes.length;
    centralSize += 46 + item.nameBytes.length;
  }
  const totalSize = localSize + centralSize + 22;
  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);

  const offsets: number[] = [];
  let cursor = 0;

  // 1. Local file headers + payloads
  for (const item of normalized) {
    offsets.push(cursor);
    view.setUint32(cursor, 0x04034b50, true); // Local file header signature
    view.setUint16(cursor + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(cursor + 6, 0x0800, true); // UTF-8 filename flag
    view.setUint16(cursor + 8, 0, true); // Compression method: 0 (store)
    view.setUint16(cursor + 10, dosTime, true);
    view.setUint16(cursor + 12, dosDate, true);
    view.setUint32(cursor + 14, item.crc, true);
    view.setUint32(cursor + 18, item.dataBytes.length, true);
    view.setUint32(cursor + 22, item.dataBytes.length, true);
    view.setUint16(cursor + 26, item.nameBytes.length, true);
    view.setUint16(cursor + 28, 0, true); // Extra field length
    cursor += 30;

    output.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
    output.set(item.dataBytes, cursor);
    cursor += item.dataBytes.length;
  }

  const centralDirStart = cursor;

  // 2. Central directory file headers
  for (let i = 0; i < normalized.length; i += 1) {
    const item = normalized[i];
    view.setUint32(cursor, 0x02014b50, true); // Central directory signature
    view.setUint16(cursor + 4, 20, true); // Version made by
    view.setUint16(cursor + 6, 20, true); // Version needed
    view.setUint16(cursor + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(cursor + 10, 0, true); // Store
    view.setUint16(cursor + 12, dosTime, true);
    view.setUint16(cursor + 14, dosDate, true);
    view.setUint32(cursor + 16, item.crc, true);
    view.setUint32(cursor + 20, item.dataBytes.length, true);
    view.setUint32(cursor + 24, item.dataBytes.length, true);
    view.setUint16(cursor + 28, item.nameBytes.length, true);
    view.setUint16(cursor + 30, 0, true); // Extra length
    view.setUint16(cursor + 32, 0, true); // Comment length
    view.setUint16(cursor + 34, 0, true); // Disk number start
    view.setUint16(cursor + 36, 0, true); // Internal attrs
    view.setUint32(cursor + 38, 0, true); // External attrs
    view.setUint32(cursor + 42, offsets[i], true); // Relative offset of local header
    cursor += 46;

    output.set(item.nameBytes, cursor);
    cursor += item.nameBytes.length;
  }

  // 3. End of Central Directory (EOCD) record
  view.setUint32(cursor, 0x06054b50, true); // EOCD signature
  view.setUint16(cursor + 4, 0, true); // Disk number
  view.setUint16(cursor + 6, 0, true); // Start disk
  view.setUint16(cursor + 8, normalized.length, true);
  view.setUint16(cursor + 10, normalized.length, true);
  view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, centralDirStart, true);
  view.setUint16(cursor + 20, 0, true); // ZIP comment length

  return output;
}

/**
 * Generates ready-to-run Windows Desktop App & Website launcher scripts
 * included at the root of the downloadable ZIP package.
 */
export function buildWindowsLauncherEntries(hostedUrl?: string): ZipInputEntry[] {
  const safeHostedUrl =
    hostedUrl && /^https?:\/\//i.test(hostedUrl.trim())
      ? hostedUrl.trim().replace(/["'`\r\n]/g, '')
      : 'http://localhost:3000';

  const startWindowsAppBat = [
    '@echo off',
    'title CampusGuard CCTV - Windows Desktop App',
    'cd /d "%~dp0"',
    'echo ==========================================================',
    'echo   CampusGuard CCTV - Windows Desktop App & Website',
    'echo ==========================================================',
    'where node >nul 2>nul',
    'if %errorlevel% neq 0 (',
    '  echo [!] Node.js is not installed on this PC.',
    '  echo     Install Node.js LTS from https://nodejs.org/ and re-run.',
    '  echo     Or run OPEN-HOSTED-WINDOWS-APP.bat to open the live web app directly.',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist "node_modules" (',
    '  echo [1/2] Installing dependencies ^(first launch only^)...',
    '  call npm install',
    '  if %errorlevel% neq 0 (',
    '    echo [!] npm install failed. Check your internet connection and retry.',
    '    pause',
    '    exit /b 1',
    '  )',
    ')',
    'echo [2/2] Starting CampusGuard CCTV local engine on http://localhost:3000 ...',
    'start "CampusGuard Engine" /min cmd /c "npm run dev"',
    'timeout /t 4 /nobreak >nul',
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app=http://localhost:3000',
    ') else if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app=http://localhost:3000',
    ') else if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app=http://localhost:3000',
    ') else (',
    '  start "" "http://localhost:3000"',
    ')',
    'echo CampusGuard CCTV is running as a Windows App! Close the minimized Engine window to stop.',
    '',
  ].join('\r\n');

  const startWebsiteBat = [
    '@echo off',
    'title CampusGuard CCTV - Website Server (Local + Wi-Fi LAN)',
    'cd /d "%~dp0"',
    'where node >nul 2>nul',
    'if %errorlevel% neq 0 (',
    '  echo [!] Node.js is required to host the website server. Download at https://nodejs.org/',
    '  pause',
    '  exit /b 1',
    ')',
    'if not exist "node_modules" (',
    '  echo Installing dependencies...',
    '  call npm install',
    ')',
    'echo Starting CampusGuard Website on http://localhost:3000 ...',
    'echo Other devices on your Wi-Fi can open http://YOUR-PC-IP:3000',
    'start "" "http://localhost:3000"',
    'call npm run dev',
    '',
  ].join('\r\n');

  const openHostedAppBat = [
    '@echo off',
    'title CampusGuard CCTV - Instant Windows App',
    `set "TARGET_URL=${safeHostedUrl}"`,
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app=%TARGET_URL%',
    ') else if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app=%TARGET_URL%',
    ') else if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app=%TARGET_URL%',
    ') else (',
    '  start "" "%TARGET_URL%"',
    ')',
    '',
  ].join('\r\n');

  const desktopShortcutPs1 = [
    '$WshShell = New-Object -ComObject WScript.Shell',
    '$Desktop = [Environment]::GetFolderPath("Desktop")',
    '$Shortcut = $WshShell.CreateShortcut((Join-Path $Desktop "CampusGuard CCTV.lnk"))',
    '$Shortcut.TargetPath = Join-Path $PSScriptRoot "START-WINDOWS-APP.bat"',
    '$Shortcut.WorkingDirectory = $PSScriptRoot',
    '$Shortcut.Description = "CampusGuard CCTV Multi-Zone AI Security Monitor"',
    '$Shortcut.Save()',
    'Write-Host "Created Windows Desktop shortcut: CampusGuard CCTV.lnk"',
    '',
  ].join('\r\n');

  const readmeTxt = [
    '====================================================================',
    '  CAMPUSGUARD CCTV — WINDOWS DESKTOP APP & WEBSITE PACKAGE',
    '====================================================================',
    '',
    'OPTION 1: RUN AS A STANDALONE WINDOWS DESKTOP APP (LOCAL ON YOUR PC)',
    '  1. Extract this ZIP folder anywhere (e.g. C:\\CampusGuard).',
    '  2. Double-click  START-WINDOWS-APP.bat',
    '     - Installs packages on first run (requires Node.js LTS from nodejs.org).',
    '     - Launches CampusGuard in a clean native Windows App window.',
    '  3. Optional: Right-click INSTALL-DESKTOP-SHORTCUT.ps1 -> "Run with PowerShell"',
    '     to place a CampusGuard CCTV shortcut on your Windows Desktop.',
    '',
    'OPTION 2: RUN AS A WEBSITE (LOCALHOST + WI-FI LAN + CLOUD DEPLOY)',
    '  - Double-click  START-WEBSITE-SERVER.bat  to open at http://localhost:3000',
    '  - Or run `npm run build` followed by `npm start` for production hosting.',
    '',
    'OPTION 3: INSTANT WINDOWS APP WINDOW (ZERO NODE.JS INSTALL)',
    '  - Double-click  OPEN-HOSTED-WINDOWS-APP.bat  to open CampusGuard',
    '    directly in borderless Microsoft Edge / Chrome Windows App mode.',
    '',
    'ENVIRONMENT VARIABLES (OPTIONAL CLOUD AI)',
    '  - On-device Edge AI person tracking, Auto-PTZ, Re-ID Watchlist, Perimeter',
    '    Zone alarms, >90.1 dB acoustic monitoring, and WebM DVR recording work',
    '    100% locally with ZERO API keys.',
    '  - Copy `.env.example` to `.env` if you want optional Gemini/OpenAI cloud vision.',
    '',
  ].join('\r\n');

  return [
    { path: 'START-WINDOWS-APP.bat', data: startWindowsAppBat },
    { path: 'START-WEBSITE-SERVER.bat', data: startWebsiteBat },
    { path: 'OPEN-HOSTED-WINDOWS-APP.bat', data: openHostedAppBat },
    { path: 'INSTALL-DESKTOP-SHORTCUT.ps1', data: desktopShortcutPs1 },
    { path: 'README-WINDOWS-AND-WEB.txt', data: readmeTxt },
  ];
}

/**
 * Checks whether a project relative path is safe to include in the downloadable ZIP
 * (strictly excludes secrets, .env, node_modules, build artifacts, and test outputs).
 */
export function isSafeZipProjectPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm || norm.includes('..')) return false;
  const blockedPrefixes = [
    'node_modules/',
    'dist/',
    '.git/',
    '.playwright-cli/',
    '.aistudio/',
    'tmp/',
  ];
  if (blockedPrefixes.some((p) => norm === p.slice(0, -1) || norm.startsWith(p))) {
    return false;
  }
  const baseName = norm.split('/').pop() || '';
  if (
    baseName === '.env' ||
    (baseName.startsWith('.env.') && baseName !== '.env.example') ||
    baseName.endsWith('.pem') ||
    baseName.endsWith('.key') ||
    baseName.includes('service-account')
  ) {
    return false;
  }
  return true;
}
