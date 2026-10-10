// 公開用ファイルだけを _site/ にコピーする（Netlify の publish 対象）
// リポジトリ直下をそのまま公開すると Code.gs・docs・netlify/ などのソースまで配信されるため、
// 配信してよいものを「許可リスト」で限定する。新しいページや画像を足すときはここに追加すること。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');

const ALLOWED_ROOT_FILES = /\.(html|png|jpe?g|svg|ico|webp)$/i;
const ALLOWED_DIRS = ['image'];
// 万一コピー対象に紛れ込んでも配信させない拡張子
const FORBIDDEN = /\.(gs|bak|md|txt|json|js|toml|env|lock)$/i;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT);

const copied = [];
for (const name of fs.readdirSync(ROOT)) {
  const src = path.join(ROOT, name);
  if (fs.statSync(src).isFile() && ALLOWED_ROOT_FILES.test(name)) {
    fs.copyFileSync(src, path.join(OUT, name));
    copied.push(name);
  }
}
for (const dir of ALLOWED_DIRS) {
  fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
  copied.push(dir + '/');
}

// 検証：配信してはいけないファイルが含まれていないこと、必須ページがあること
const walk = (d) => fs.readdirSync(d).flatMap(n => {
  const p = path.join(d, n);
  return fs.statSync(p).isDirectory() ? walk(p) : [path.relative(OUT, p)];
});
const leaked = walk(OUT).filter(f => FORBIDDEN.test(f));
if (leaked.length) {
  console.error('公開してはいけないファイルが含まれています:', leaked);
  process.exit(1);
}
for (const required of ['index.html', 'privacy.html', 'terms.html', 'tokushoho.html']) {
  if (!fs.existsSync(path.join(OUT, required))) {
    console.error('必須ページがありません:', required);
    process.exit(1);
  }
}
console.log(`_site/ に ${copied.length} 件をコピーしました:`, copied.join(', '));
