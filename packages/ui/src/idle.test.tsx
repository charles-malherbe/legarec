import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDLE_LOGOUT_MS, IDLE_WARNING_MS, useIdle } from './idle';

const MINUTE = 60_000;
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const pass = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const touch = () => act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
const start = () => {
  const onLogout = vi.fn();
  const onActive = vi.fn();
  const { result } = renderHook(() => useIdle(onLogout, onActive));
  return { result, onLogout, onActive };
};

it('warns at 28 minutes of inactivity, and signs out at 30', () => {
  const { result, onLogout } = start();
  pass(IDLE_WARNING_MS - MINUTE);
  expect(result.current.warning).toBe(false);
  pass(MINUTE);
  expect(result.current).toMatchObject({ warning: true, secondsLeft: 120 });
  expect(onLogout).not.toHaveBeenCalled();
  pass(IDLE_LOGOUT_MS - IDLE_WARNING_MS);
  expect(onLogout).toHaveBeenCalledTimes(1);
});

it('tells the API of an activity that asks for nothing, once a minute, and after the last one', () => {
  const { onActive } = start();
  pass(5 * MINUTE);
  // Nobody touched anything.
  expect(onActive).not.toHaveBeenCalled();
  for (let i = 0; i < 12; i += 1) {
    touch();
    pass(10_000);
  }
  expect(onActive.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(onActive.mock.calls.length).toBeLessThanOrEqual(3);
  const told = onActive.mock.calls.length;
  pass(1);
  touch();
  pass(2 * MINUTE);
  expect(onActive.mock.calls.length).toBe(told + 1);
  // Then silence: what the screen does by itself is not an activity.
  pass(20 * MINUTE);
  expect(onActive.mock.calls.length).toBe(told + 1);
});

it('tells it at once with « Rester connecté »', () => {
  const { result, onActive, onLogout } = start();
  pass(IDLE_WARNING_MS);
  // Once warned, a movement is not enough: the button is.
  touch();
  expect(onActive).not.toHaveBeenCalled();
  act(() => result.current.stay());
  expect(onActive).toHaveBeenCalledTimes(1);
  expect(result.current.warning).toBe(false);
  pass(5 * MINUTE);
  expect(onLogout).not.toHaveBeenCalled();
});

it('is not closed by a tab that nobody looks at', async () => {
  // Two tabs of the same portal, and nothing else between them.
  const tabs: { post: () => void; receive: () => void }[] = [];
  class Channel {
    onmessage: (() => void) | null = null;
    private readonly tab = { post: () => undefined, receive: () => this.onmessage?.() };
    constructor(readonly name: string) {
      tabs.push(this.tab);
    }
    postMessage() {
      for (const other of tabs) if (other !== this.tab) other.receive();
    }
    close() {
      tabs.splice(tabs.indexOf(this.tab), 1);
    }
  }
  vi.stubGlobal('BroadcastChannel', Channel);
  const logouts = [vi.fn(), vi.fn()];
  const [first, second] = logouts.map((onLogout) => renderHook(() => useIdle(onLogout)));
  // Someone works in one of them for an hour.
  for (let i = 0; i < 12; i += 1) {
    touch();
    pass(5 * MINUTE);
  }
  expect(first!.result.current.warning).toBe(false);
  expect(second!.result.current.warning).toBe(false);
  // Then nobody: warned in both, and « Rester connecté » in one is enough.
  pass(IDLE_WARNING_MS - 5 * MINUTE);
  expect(second!.result.current.warning).toBe(true);
  act(() => first!.result.current.stay());
  expect(second!.result.current.warning).toBe(false);
  pass(5 * MINUTE);
  for (const onLogout of logouts) expect(onLogout).not.toHaveBeenCalled();
  pass(IDLE_LOGOUT_MS);
  for (const onLogout of logouts) expect(onLogout).toHaveBeenCalled();
  first!.unmount();
  second!.unmount();
  expect(tabs).toEqual([]);
  vi.unstubAllGlobals();
});

it('works where nothing has to be told', () => {
  const onLogout = vi.fn();
  const { result } = renderHook(() => useIdle(onLogout));
  touch();
  pass(2 * MINUTE);
  act(() => result.current.stay());
  pass(IDLE_LOGOUT_MS);
  expect(onLogout).toHaveBeenCalled();
});
