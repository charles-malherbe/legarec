import { Prisma } from '../../generated/prisma/client';

/** Code of PostgreSQL when it refused (42501, 23505…), otherwise the code of Prisma. */
export function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  return meta?.driverAdapterError?.cause?.originalCode ?? error.code;
}

/** Index that refused a value already taken. */
export function takenIndex(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } | undefined;
  return meta?.driverAdapterError?.cause?.constraint?.index;
}
