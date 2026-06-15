import { createJsonResponse, HttpError } from '#/http';
import type { TokenRoute } from '#/types/routes';
import { env } from 'cloudflare:workers';

const SECRETS_STORE_BINDINGS: Partial<Record<string, SecretsStoreSecret>> = {
  SLACK_CONFIG_TOKEN: env.SLACK_CONFIG_TOKEN,
  SLACK_CONFIG_REFRESH_TOKEN: env.SLACK_CONFIG_REFRESH_TOKEN,
};

export async function getToken(route: TokenRoute): Promise<Response> {
  switch (route.kind) {
    case 'secret': {
      const binding = SECRETS_STORE_BINDINGS[route.name];
      if (!binding) {
        throw new HttpError(404, `Unknown secret: ${route.name}`);
      }
      const value = await binding.get();
      return createJsonResponse({ name: route.name, value });
    }
    case 'variable': {
      const value = await env.RESUMAESTRO_CONFIG.get(`variable:${route.name}`);
      if (value === null) {
        throw new HttpError(404, `Unknown variable: ${route.name}`);
      }
      return createJsonResponse({ name: route.name, value });
    }
    default:
      throw new HttpError(404, 'Not Found');
  }
}
