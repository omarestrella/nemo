const PKCE_VALUE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

export function isValidPkceValue(value: string): boolean {
  return PKCE_VALUE_PATTERN.test(value);
}

export function codeChallengeS256(verifier: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(verifier).digest();
  return Buffer.from(digest).toString("base64url");
}

export function endpointFromRequest(request: Request): string {
  const url = new URL(request.url);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function safeEndpoint(value: string, request: Request): string {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol === "http:" || endpoint.protocol === "https:") {
      endpoint.pathname = endpoint.pathname.replace(/\/pair$/, "");
      endpoint.search = "";
      endpoint.hash = "";
      return endpoint.toString().replace(/\/$/, "");
    }
  } catch {
    // Fall back to the request origin below.
  }
  return endpointFromRequest(request);
}
