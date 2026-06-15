type ResponseFormat = "html" | "json"

type ContentTypes = {
  html: string;
  json: string;
}

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
} satisfies ContentTypes;

export function createResponseInit(
  format: ResponseFormat,
  status = 200,
): ResponseInit {
  return {
    headers: {
      "content-type": CONTENT_TYPES[format],
    },
    status,
  };
}
