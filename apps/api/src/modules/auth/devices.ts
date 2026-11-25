export interface Device {
  label: string;
  mobile: boolean;
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//u, 'Edge'],
  [/\b(?:OPR|Opera)\//u, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//u, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//u, 'Chrome'],
  [/\bSafari\//u, 'Safari'],
];
const SYSTEMS: [RegExp, string, boolean][] = [
  [/\biPhone\b/u, 'iPhone', true],
  [/\biPad\b/u, 'iPad', true],
  [/\bAndroid\b/u, 'Android', true],
  [/\bWindows\b/u, 'Windows', false],
  [/\bMac OS X\b/u, 'macOS', false],
  [/\bCrOS\b/u, 'ChromeOS', false],
  [/\bLinux\b/u, 'Linux', false],
];

/** What the holder recognises: « Chrome · Windows ». Nothing else of the header is kept. */
export function deviceOf(userAgent: string): Device {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Navigateur';
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent));
  return { label: `${browser} · ${system?.[1] ?? 'appareil inconnu'}`, mobile: system?.[2] ?? false };
}
