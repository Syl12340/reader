export class FileOperationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FileOperationError';
  }
}

export function asFileError(error: unknown): FileOperationError {
  if (error instanceof FileOperationError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return new FileOperationError(String(error.code), String(error.message));
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return new FileOperationError('not_found', error.message);
  }
  return new FileOperationError('io_error', error instanceof Error ? error.message : String(error));
}
