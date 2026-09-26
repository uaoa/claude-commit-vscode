/** Thrown when the user cancels generation from the progress notification. */
export class GenerationCancelledError extends Error {
  constructor() {
    super("Generation cancelled");
    this.name = "GenerationCancelledError";
  }
}

export function isCancellation(error: unknown): boolean {
  return error instanceof GenerationCancelledError;
}
