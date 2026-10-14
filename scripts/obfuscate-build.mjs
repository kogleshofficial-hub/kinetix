import fs from 'node:fs';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const distDir = path.resolve('dist');
const pageNames = ['index.html', 'creator.html'];

function findPageEntry(pageName) {
  const htmlPath = path.join(distDir, pageName);
  if (!fs.existsSync(htmlPath)) {
    throw new Error('Required production page is missing: ' + pageName);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptMatch = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*><\/script>/i);
  if (!scriptMatch) {
    throw new Error('Could not identify the built application entry for ' + pageName);
  }

  const entryUrl = new URL(scriptMatch[1], 'https://kinetix.invalid');
  if (entryUrl.origin !== 'https://kinetix.invalid') {
    throw new Error('Unexpected non-local entry script in ' + pageName);
  }
  const relativePath = decodeURIComponent(entryUrl.pathname).replace(/^\/+/, '');
  const entryPath = path.resolve(distDir, relativePath);
  if (!entryPath.startsWith(distDir + path.sep) || !fs.existsSync(entryPath)) {
    throw new Error('Built application entry escapes dist/ or does not exist: ' + pageName);
  }
  return { pageName, entryPath };
}

const entries = pageNames.map(findPageEntry);
const assetsDir = path.join(distDir, 'assets');
const vendorFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((name) => /^mediapipe-vendor-.*\.js$/.test(name))
  : [];

if (vendorFiles.length !== 1) {
  throw new Error('Expected exactly one separate MediaPipe vendor bundle; refusing to obfuscate.');
}

for (const entry of entries) {
  const original = fs.readFileSync(entry.entryPath, 'utf8');
  if (original.includes('sourceMappingURL=')) {
    throw new Error('Unexpected source-map reference in ' + entry.pageName);
  }

  if (entry.pageName === 'index.html' && !original.includes(vendorFiles[0])) {
    throw new Error('Main game entry lost its separate MediaPipe vendor import.');
  }

  // Conservative obfuscation: rename local identifiers and encode a subset of
  // strings, while leaving browser globals, properties and control flow alone.
  const obfuscated = JavaScriptObfuscator.obfuscate(original, {
    target: 'browser',
    compact: true,
    simplify: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    renameProperties: false,
    stringArray: true,
    stringArrayThreshold: 0.25,
    stringArrayEncoding: [],
    numbersToExpressions: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    selfDefending: false,
    sourceMap: false,
    unicodeEscapeSequence: false,
    ignoreImports: true
  }).getObfuscatedCode();

  if (!obfuscated.trim() || obfuscated.length < original.length * 0.45) {
    throw new Error('Obfuscator output is unexpectedly empty or truncated for ' + entry.pageName);
  }
  if (entry.pageName === 'index.html' && !obfuscated.includes(vendorFiles[0])) {
    throw new Error('Obfuscation removed the MediaPipe import from the main game.');
  }
  if (obfuscated.includes('sourceMappingURL=')) {
    throw new Error('Obfuscator unexpectedly added a source-map reference to ' + entry.pageName);
  }

  fs.writeFileSync(entry.entryPath, obfuscated);
  console.log(
    'Obfuscated ' + entry.pageName + ' application entry (' +
    original.length + ' -> ' + obfuscated.length + ' bytes).'
  );
}

console.log('MediaPipe vendor code remains separate; production source maps are disabled.');
