import { Prisma } from '../../generated/prisma/client';

/** Piece of a query, its values always apart from its text. */
export const sql = Prisma.sql;
export const nothing = Prisma.empty;
export type Sql = Prisma.Sql;
/** What was typed, whatever signs it holds. */
export const containing = (text: string) => `%${text.trim().replace(/[\\%_]/gu, (char) => `\\${char}`)}%`;
