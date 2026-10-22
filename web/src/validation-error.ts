export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public line = 0,
    public expected = '',
    public actual = '',
  ) {
    super(message)
  }
}
