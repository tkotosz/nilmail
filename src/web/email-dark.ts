/*
 * Darkening an email for the dark theme, the way Gmail does: light backgrounds turn dark and dark text turns light, while
 * colors the sender already made dark, and light text on them, stay as they are. Pictures are left alone. Emails that
 * carry their own dark styles already get them, as the frame follows the app's color scheme.
 */

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Reads a computed color such as `rgb(255, 255, 255)` or `rgba(0, 0, 0, 0.5)`. */
export function parseColor(value: string): Rgba | null {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(value);
  if (!match) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
}

/** The color's HSL lightness, 0 (black) to 1 (white). */
export function lightness({ r, g, b }: Rgba): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

/** How bright the color looks: its relative luminance, 0 (black) to 1 (white). Pure blue is dark by this measure. */
export function luminance({ r, g, b }: Rgba): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The same hue and saturation at another lightness, as `rgb(…)` with the original alpha. */
function withLightness(color: Rgba, target: number): string {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = (h * 60 + 360) % 360;
  const c = (1 - Math.abs(2 * target - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = target - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const channel = (value: number) => Math.round((value + m) * 255);
  return color.a < 1
    ? `rgba(${channel(r1)}, ${channel(g1)}, ${channel(b1)}, ${color.a})`
    : `rgb(${channel(r1)}, ${channel(g1)}, ${channel(b1)})`;
}

/** A light background made dark: white becomes a dark gray near the message's own container, tints stay tinted. */
export function darkBackground(color: Rgba): string | null {
  return luminance(color) > 0.35 ? withLightness(color, 0.1 + (1 - lightness(color)) * 0.9) : null;
}

/** Dark text made light: black becomes a soft white, grays a lighter gray, deep blue links a readable blue. */
export function lightText(color: Rgba): string | null {
  return luminance(color) < 0.2 ? withLightness(color, Math.max(0.72, 0.9 - lightness(color) * 0.8)) : null;
}

/** Darkens every element of the email's document in place. */
export function darkenEmail(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  for (const element of [doc.documentElement, ...doc.querySelectorAll<HTMLElement>('body, body *')]) {
    if (!(element instanceof view.HTMLElement) || element instanceof view.HTMLImageElement) continue;
    const style = view.getComputedStyle(element);
    const background = parseColor(style.backgroundColor);
    if (background && background.a > 0 && style.backgroundImage === 'none') {
      const dark = darkBackground(background);
      if (dark) element.style.setProperty('background-color', dark, 'important');
    }
    const text = parseColor(style.color);
    const light = text && lightText(text);
    if (light) element.style.setProperty('color', light, 'important');
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      if (style.getPropertyValue(`border-${side}-style`) === 'none') continue;
      const border = parseColor(style.getPropertyValue(`border-${side}-color`));
      const lighter = border && lightText(border);
      if (lighter) element.style.setProperty(`border-${side}-color`, lighter, 'important');
    }
  }
}
