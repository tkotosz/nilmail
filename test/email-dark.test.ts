import assert from 'node:assert/strict';
import test from 'node:test';
import { darkBackground, lightText, lightness, luminance, parseColor } from '../src/web/email-dark.ts';

const color = (value: string) => parseColor(value)!;

test('computed colors are read, with their alpha', () => {
  assert.deepEqual(parseColor('rgb(255, 255, 255)'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor('transparent'), null);
  assert.equal(lightness(color('rgb(255, 255, 255)')), 1);
});

test('light backgrounds turn dark and keep their tint; dark ones stay as the sender made them', () => {
  assert.equal(darkBackground(color('rgb(255, 255, 255)')), 'rgb(26, 26, 26)');
  const lavender = parseColor(darkBackground(color('rgb(200, 208, 228)'))!)!;
  assert.ok(lightness(lavender) < 0.3, 'a light tint becomes dark');
  assert.ok(lavender.b > lavender.r, 'and keeps its hue');
  assert.equal(darkBackground(color('rgb(14, 23, 53)')), null, 'a navy banner stays navy');
  assert.equal(darkBackground(color('rgb(20, 110, 220)')), null, 'a mid-tone button keeps its color');
});

test('dark text turns light; light text, such as white on a dark banner, stays', () => {
  assert.equal(lightText(color('rgb(0, 0, 0)')), 'rgb(230, 230, 230)');
  assert.ok(lightness(color(lightText(color('rgb(85, 85, 85)'))!)) > 0.55, 'gray text stays a softer gray');
  assert.equal(lightText(color('rgb(255, 255, 255)')), null);
  const link = color(lightText(color('rgb(0, 0, 238)'))!);
  assert.ok(luminance(link) > 0.2 && link.b > link.r, 'a default blue link becomes a lighter blue');
});
