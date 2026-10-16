/** A non-OK HTTP response from a provider. `body` is the raw response text, kept for debugging. */
export class ProviderHttpError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`HTTP ${status}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

/** Throws ProviderHttpError for any non-OK response. Shared by every provider adapter. */
export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new ProviderHttpError(response.status, body);
}
