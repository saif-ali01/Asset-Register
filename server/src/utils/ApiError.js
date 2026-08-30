export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expected = true;
  }
  static badRequest(m = 'Bad request', d) { return new ApiError(400, m, d); }
  static unauthorized(m = 'Sign in to continue') { return new ApiError(401, m); }
  static forbidden(m = 'You do not have permission to do that') { return new ApiError(403, m); }
  static notFound(m = 'Not found') { return new ApiError(404, m); }
  static conflict(m = 'That already exists', d) { return new ApiError(409, m, d); }
}
