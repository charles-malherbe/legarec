import { Prisma } from '../../generated/prisma/client';

/** Piece of a query, its values always apart from its text. */
export const sql = Prisma.sql;
export const nothing = Prisma.empty;
export type Sql = Prisma.Sql;
/** What was typed, wherever it stands; its signs for themselves, those that `unaccent` gives back too. */
export const containing = (text: string): Sql => sql`('%' || regexp_replace(unaccent(${text.trim()}), '([\\\\%_])', '\\\\\\1', 'g') || '%')`;
