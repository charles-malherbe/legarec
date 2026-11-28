import { z } from 'zod';

export const creditorSummary = z.object({ id: z.string(), name: z.string(), initials: z.string(), siren: z.string().optional(), count: z.number().int() });
export const menuCounts = z.object({
  teamOnline: z.number().int(),
  remindersToday: z.number().int(),
  litigationUrgent: z.number().int(),
  callQueue: z.number().int(),
  unreadEmails: z.number().int(),
  unreadSms: z.number().int(),
});
export const notificationKind = z.enum(['PAYMENT', 'MESSAGE', 'DEADLINE', 'CREDITOR', 'SYSTEM']);
export const notification = z.object({ id: z.string(), kind: notificationKind, text: z.string(), meta: z.string(), href: z.string(), unread: z.boolean() });
export const searchHit = z.object({
  id: z.string(),
  kind: z.enum(['DEBTOR', 'CREDITOR', 'INVOICE']),
  title: z.string(),
  sub: z.string(),
  href: z.string(),
  initials: z.string(),
});
export type SearchResult = z.infer<typeof searchHit>;

export const shellData = z.object({
  creditors: z.array(creditorSummary),
  counts: menuCounts,
  notifications: z.array(notification),
  /** The last cases opened, the latest first, offered under the search box before anything is typed (five at most). */
  recentCases: z.array(searchHit).max(5),
});
export type ShellData = z.infer<typeof shellData>;
export type Notification = z.infer<typeof notification>;
