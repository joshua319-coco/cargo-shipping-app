const fs = require('node:fs');
const path = require('node:path');
const source = path.join(__dirname, '..', 'preview', 'registration');
const output = path.join(__dirname, '..', 'registration-preview-output');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js']) {
  fs.copyFileSync(path.join(source, file), path.join(output, file));
}
console.log('Built isolated static registration demo. No database or carrier connections.');
