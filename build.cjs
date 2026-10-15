// Produce a portable, offline single-file build; source files stay easy to edit.
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
html = html.replace('  <link rel="stylesheet" href="styles.css">', '  <style>\n' + css + '\n  </style>');
const scripts = ['engine.js', 'renderer.js', 'app.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8').replace(/<\/script/gi, '<\\/script')).join('\n');
for (const file of ['engine.js', 'renderer.js', 'app.js']) html = html.replace(`  <script src="${file}" defer></script>\n`, '');
html = html.replace('</body>', '<script>\n' + scripts + '\n</script>\n</body>');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.html'), html, 'utf8');
console.log('Portable game: ' + path.join(output, 'index.html'));
