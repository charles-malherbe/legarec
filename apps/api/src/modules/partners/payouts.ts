import type { portalPayouts } from '@legarec/contracts';
import type { z } from 'zod';
import type { Transaction } from '../../platform/database/database';
import { dayOf } from '../../platform/format';

interface Read {
  rateBp: number | null;
  frequency: string | null;
  next: { collected: number; fee: number; net: number };
  items: { id: string; state: 'READY' | 'PAID'; on: string; count: number; collected: number; fee: number; net: number }[];
}
const shown = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const plus = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The next day of transfers, as Paramètres › Reversements says it; null when it says something else. */
export function nextPayoutDay(frequency: string, today: string): string | null {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const monthly = (days: number[]) => {
    const next = days.find((wanted) => wanted > day);
    return next ? `${today.slice(0, 7)}-${String(next).padStart(2, '0')}` : new Date(Date.UTC(year, month, days[0])).toISOString().slice(0, 10);
  };
  if (frequency.startsWith('Mensuelle')) return monthly([15]);
  if (frequency.startsWith('Bimensuelle')) return monthly([1, 15]);
  if (frequency.startsWith('Hebdomadaire')) {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return plus(today, (8 - weekday) % 7 || 7);
  }
  return null;
}

/** What a creditor reads of its remittances: PostgreSQL gives its own only (`app.creditor_payouts`). */
export async function payouts(tx: Transaction): Promise<z.infer<typeof portalPayouts>> {
  const [{ data }] = (await tx.$queryRaw<{ data: Read }[]>`SELECT app.creditor_payouts() AS data`) as [{ data: Read }];
  const today = dayOf(new Date());
  const frequency = data.frequency ?? 'Mensuelle, le 15';
  const day = nextPayoutDay(frequency, today);
  const year = today.slice(0, 4);
  const ofYear = data.items.filter((item) => item.on.startsWith(year));
  const rate = data.rateBp === null ? '' : `, commission de ${(data.rateBp / 100).toLocaleString('fr-FR')} % HT retenue avec la TVA`;
  return {
    rateLabel: `Sommes encaissées pour votre compte${rate}, versées selon la fréquence « ${frequency} ».`,
    next: { date: day ? shown(day) : 'au prochain reversement', ...data.next },
    year: {
      paid: ofYear.filter((item) => item.state === 'PAID').reduce((sum, item) => sum + item.net, 0),
      recovered: ofYear.reduce((sum, item) => sum + item.collected, 0),
      fees: ofYear.reduce((sum, item) => sum + item.fee, 0),
    },
    items: data.items.map((item) => ({ id: item.id, date: shown(item.on), count: item.count, collected: item.collected, fee: item.fee, net: item.net })),
  };
}
