import { HttpError } from '#/http';
import { TokenRoute } from '#/types/routes';

const postSecret = (route: TokenRoute, request: Request) => {
  throw new HttpError(404, 'Not Implemented');
};

const postVariable = (route: TokenRoute, request: Request) => {
  throw new HttpError(404, 'Not Implemented');
};

export async function postToken(
  route: TokenRoute,
  request: Request,
): Promise<Response> {
  switch (route.kind) {
    case 'secret':
      return postSecret(route, request);
    case 'variable':
      return postVariable(route, request);
    default:
      throw new HttpError(404, 'Not Found');
  }
}
