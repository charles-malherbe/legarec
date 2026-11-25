import { Prisma } from '../../generated/prisma/client';

/** Code of PostgreSQL when it refused (42501, 23505…), otherwise the code of Prisma. */
export function databaseCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: string } } } | undefined;
  return meta?.driverAdapterError?.cause?.originalCode ?? error.code;
}
