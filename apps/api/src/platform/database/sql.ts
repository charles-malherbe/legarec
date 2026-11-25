import { Prisma } from '../../generated/prisma/client';

/** Piece of a query, its values always apart from its text. */
export const sql = Prisma.sql;
export const nothing = Prisma.empty;
export type Sql = Prisma.Sql;
