/** Same codes as the simulations: a portal never has to know which one answers. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    /** Extra facts the screen needs (attempts left, holder of a single role…). Never personal data of someone else. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export const unauthorized = () => new ApiError(401, 'UNAUTHORIZED');
export const forbidden = () => new ApiError(403, 'FORBIDDEN');
export const notFound = () => new ApiError(404, 'NOT_FOUND');
export const conflict = (code: string, details: Record<string, unknown> = {}) => new ApiError(409, code, details);
export const invalid = (details: Record<string, unknown> = {}) => new ApiError(422, 'INVALID', details);
