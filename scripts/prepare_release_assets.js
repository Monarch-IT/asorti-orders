const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const publicDir = path.resolve(__dirname, '..', 'public');
const assetsDir = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'web');

function copyRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(publicDir, assetsDir);

const appJsPath = path.join(assetsDir, 'app.js');
const rawAppJs = fs.readFileSync(appJsPath, 'utf8');
const obfAppJs = JavaScriptObfuscator.obfuscate(rawAppJs, {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  transformObjectKeys: false,
  unicodeEscapeSequence: false
}).getObfuscatedCode();
fs.writeFileSync(appJsPath, obfAppJs, 'utf8');

const prodDataPath = path.join(assetsDir, 'products_data.js');
if (fs.existsSync(prodDataPath)) {
  const rawProd = fs.readFileSync(prodDataPath, 'utf8');
  const obfProd = JavaScriptObfuscator.obfuscate(rawProd, {
    compact: true,
    identifierNamesGenerator: 'hexadecimal',
    rotateStringArray: true,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.8
  }).getObfuscatedCode();
  fs.writeFileSync(prodDataPath, obfProd, 'utf8');
}

const apiProdPath = path.join(assetsDir, 'api', 'products');
if (fs.existsSync(apiProdPath)) {
  try {
    const list = JSON.parse(fs.readFileSync(apiProdPath, 'utf8'));
    if (Array.isArray(list)) {
      const cleanList = list.map(item => {
        const copy = { ...item };
        delete copy.costPrice;
        return copy;
      });
      fs.writeFileSync(apiProdPath, JSON.stringify(cleanList, null, 2), 'utf8');
    }
  } catch (e) {}
}

const pubApiProdPath = path.join(publicDir, 'api', 'products');
if (fs.existsSync(pubApiProdPath)) {
  try {
    const list = JSON.parse(fs.readFileSync(pubApiProdPath, 'utf8'));
    if (Array.isArray(list)) {
      const cleanList = list.map(item => {
        const copy = { ...item };
        delete copy.costPrice;
        return copy;
      });
      fs.writeFileSync(pubApiProdPath, JSON.stringify(cleanList, null, 2), 'utf8');
    }
  } catch (e) {}
}

console.log('Release assets successfully obfuscated and hardened!');
