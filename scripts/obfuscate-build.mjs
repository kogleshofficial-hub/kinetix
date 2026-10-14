import fs from 'node:fs';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';

const distDir = path.resolve('dist');
const htmlPath = path.join(distDir, 'index.html');

if (!fs.existsSync(htmlPath)) {
  throw new Error('Production HTML is missing; refusing to skip source obfuscation.');
}

const html = fs.readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*><\/script>/i);

if (!scriptMatch) {
  throw new Error('Could not identify the built application entry script.');
}

const entryUrl = new URL(scriptMatch[1], 'https://kinetix.invalid');
if (entryUrl.origin !== 'https://kinetix.invalid') {
  throw new Error('Unexpected non-local application entry script.');
}

const relativePath = decodeURIComponent(entryUrl.pathname).replace(/^\/+/, '');
const entryPath = path.resolve(distDir, relativePath);
if (!entryPath.startsWith(distDir + path.sep) || !fs.existsSync(entryPath)) {
  throw new Error('Built application entry escapes dist/ or does not exist.');
}

const assetsDir = path.join(distDir, 'assets');
const vendorFiles = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((name) => /^mediapipe-vendor-.*\.js$/.test(name))
  : [];

if (vendorFiles.length !== 1) {
  throw new Error('Expected exactly one separate MediaPipe vendor bundle; refusing to obfuscate vendor code.');
}

const original = fs.readFileSync(entryPath, 'utf8');
if (!original.includes(vendorFiles[0])) {
  throw new Error('Application entry does not import the isolated MediaPipe vendor chunk.');
}
if (original.includes('sourceMappingURL=')) {
  throw new Error('Unexpected source map reference in the application entry.');
}

// Use a conservative profile: rename local identifiers and encode a subset of
// strings, but leave control flow, browser globals, property names and vendor
// code alone. This adds friction, not a security boundary.
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
  throw new Error('Obfuscator output is unexpectedly empty or truncated.');
}
if (!obfuscated.includes(vendorFiles[0])) {
  throw new Error('Obfuscation modified or removed the vendor import; refusing to publish.');
}
if (obfuscated.includes('sourceMappingURL=')) {
  throw new Error('Obfuscator unexpectedly added a source map reference.');
}

fs.writeFileSync(entryPath, obfuscated);
console.log(
  'Obfuscated Kinetix application entry only (' +
  original.length + ' -> ' + obfuscated.length +
  ' bytes). MediaPipe vendor bundle intentionally remains unobfuscated.'
);
