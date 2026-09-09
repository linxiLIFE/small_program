const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const requiredSuffixes = ['.js', '.json', '.wxml', '.wxss'];

for (const page of app.pages) {
  for (const suffix of requiredSuffixes) {
    const file = path.join(root, `${page}${suffix}`);
    if (!fs.existsSync(file)) throw new Error(`missing page asset: ${path.relative(root, file)}`);
  }
}

for (const tab of app.tabBar.list) {
  if (!app.pages.includes(tab.pagePath)) throw new Error(`tab page is not registered: ${tab.pagePath}`);
}

const wxmlFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.name.endsWith('.wxml')) wxmlFiles.push(file);
  }
}
collect(root);

for (const file of wxmlFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const opens = (content.match(/\{\{/g) || []).length;
  const closes = (content.match(/\}\}/g) || []).length;
  if (opens !== closes) throw new Error(`unbalanced WXML interpolation: ${path.relative(root, file)}`);
}

console.log(`miniprogram validation passed: ${app.pages.length} pages, ${wxmlFiles.length} WXML files`);
