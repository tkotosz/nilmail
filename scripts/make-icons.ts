// Renders the PNG icons from public/icon.svg with Chrome. Run with `npm run icons` after changing the SVG.
// The maskable icon fills the whole square and keeps the mark inside the central safe zone.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const svg = await readFile('public/icon.svg', 'utf8');
const maskable = svg
  .replace('<rect width="512" height="512" rx="112" fill="url(#g)" />', '<rect width="512" height="512" fill="url(#g)" />')
  .replace('<g id="mark">', '<g id="mark" transform="translate(51.2 51.2) scale(0.8)">');

const executablePath = process.env.NILMAIL_CHROME;
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
async function render(source: string, size: number, file: string) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`,
  );
  await writeFile(file, await page.screenshot({ omitBackground: true }));
  await page.close();
}
for (const size of [180, 192, 512]) await render(svg, size, `public/icon-${size}.png`);
await render(maskable, 512, 'public/icon-maskable-512.png');
await browser.close();
console.log('Wrote public/icon-*.png');
