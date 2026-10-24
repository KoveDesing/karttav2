const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = process.cwd();
const htmlFiles = ['menu.html'];
let failed = false;
for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
  const scripts = [...html.matchAll(/<script([^>]*)>([\\s\\S]*?)<\\/script>/gi)];
  let index = 0;
  for (const match of scripts) {
    const attrs = match[1] || '';
    const source = match[2].trim();
    if (!source || /\\bsrc\\s*=/.test(attrs)) continue;
    const isModule = /\\btype\\s*=\\s*["']module["']/i.test(attrs);
    const temp = path.join(os.tmpdir(), 'kartta-menu-inline-' + index++ + (isModule ? '.mjs' : '.js'));
    fs.writeFileSync(temp, source);
    const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
    if (result.status !== 0) {
      failed = true;
      console.error('FAIL', htmlFile, result.stderr || result.stdout);
    } else {
      console.log('OK inline script', htmlFile, index);
    }
  }
}
if (failed) process.exit(1);
console.log('Public menu JavaScript syntax validation passed.');
