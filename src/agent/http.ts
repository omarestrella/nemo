import { NemoError, errorBody, toNemoError } from "./errors";
import type { AgentState } from "./storage";
import type { CredentialScope } from "./types";

type MaybePromise<T> = T | Promise<T>;

export type RouteHandler<RequestType extends Request> = (request: RequestType) => MaybePromise<Response>;

export type Middleware<RequestType extends Request> = (
  request: RequestType,
  next: () => MaybePromise<Response>,
) => MaybePromise<Response>;

export function handler<RequestType extends Request>(
  ...parts: [...Middleware<RequestType>[], RouteHandler<RequestType>]
): RouteHandler<RequestType> {
  const routeHandler = parts.at(-1) as RouteHandler<RequestType>;
  const middleware = parts.slice(0, -1) as Middleware<RequestType>[];

  return async (request) => {
    let activeIndex = -1;

    async function dispatch(index: number): Promise<Response> {
      if (index <= activeIndex) {
        throw new Error("Middleware called next more than once");
      }
      activeIndex = index;

      const layer = middleware[index];
      if (!layer) {
        return await routeHandler(request);
      }

      return await layer(request, () => dispatch(index + 1));
    }

    return await dispatch(0);
  };
}

export async function errors<RequestType extends Request>(
  request: RequestType,
  next: () => MaybePromise<Response>,
): Promise<Response> {
  try {
    return await next();
  } catch (error) {
    const nemoError = toNemoError(error);
    return Response.json(errorBody(nemoError), { status: nemoError.status });
  }
}

export function auth<RequestType extends Request>(
  state: AgentState,
  scope: CredentialScope,
): Middleware<RequestType> {
  return (request, next) => {
    const header = request.headers.get("authorization");
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new NemoError("UNAUTHORIZED", "Missing bearer credential", { status: 401 });
    }

    const credential = state.authenticateCredential(match[1], scope);
    if (!credential) {
      throw new NemoError("UNAUTHORIZED", "Invalid bearer credential", { status: 401 });
    }

    return next();
  };
}
