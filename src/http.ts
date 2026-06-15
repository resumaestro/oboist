import { createResponseInit } from "#/headers";

type CreateJsonResponseOptions = {
  authenticate?: boolean;
  status?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function parseJsonValue(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }

  return body;
}

export async function parseOptionalJsonValue(
  request: Request,
): Promise<unknown> {
  if (!request.body) {
    return undefined;
  }

  return parseJsonValue(request);
}

export function createJsonResponse(
  body: unknown,
  options: CreateJsonResponseOptions = {},
): Response {
  const { authenticate = false, status = 200 } = options;
  const responseInit = createResponseInit("json", status);

  if (authenticate) {
    const headers = new Headers(responseInit.headers);
    headers.set("www-authenticate", "Bearer");
    responseInit.headers = headers;
  }

  return new Response(JSON.stringify(body), responseInit);
}
