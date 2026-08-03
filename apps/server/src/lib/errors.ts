export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly type = 'invalid_request_error',
    public readonly param: string | null = null,
  ) {
    super(message)
  }
}

export const unauthorized = (message = 'Authentication required') =>
  new AppError(401, 'unauthorized', message, 'authentication_error')

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, 'forbidden', message, 'permission_error')

export const notFound = (resource = 'Resource') =>
  new AppError(404, 'not_found', `${resource} not found`)
