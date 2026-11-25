import { describe, expect, it } from 'vitest';
import { deviceOf } from './devices';

const WEBKIT = 'AppleWebKit/537.36 (KHTML, like Gecko)';
describe('device', () => {
  it.each([
    [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT} Chrome/140.0.0.0 Safari/537.36`, 'Chrome · Windows', false],
    [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT} Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0`, 'Edge · Windows', false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15', 'Safari · macOS', false],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0', 'Firefox · Linux', false],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
      'Safari · iPhone',
      true,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
      'Chrome · iPhone',
      true,
    ],
    ['Mozilla/5.0 (iPad; CPU OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1', 'Safari · iPad', true],
    [`Mozilla/5.0 (Linux; Android 16; Pixel 10) ${WEBKIT} Chrome/140.0.0.0 Mobile Safari/537.36`, 'Chrome · Android', true],
    [`Mozilla/5.0 (X11; CrOS x86_64 16000.0.0) ${WEBKIT} Chrome/140.0.0.0 Safari/537.36`, 'Chrome · ChromeOS', false],
    [`Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${WEBKIT} Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0`, 'Opera · Windows', false],
    ['curl/8.14.1', 'Navigateur · appareil inconnu', false],
    ['', 'Navigateur · appareil inconnu', false],
    ['<script>alert(1)</script>'.repeat(200), 'Navigateur · appareil inconnu', false],
  ])('%s', (agent, label, mobile) => expect(deviceOf(agent)).toEqual({ label, mobile }));
});
