import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";

export type Session = {
  token: string;
  /** `app.inject` with this user's access token. */
  request: (options: InjectOptions) => Promise<LightMyRequestResponse>;
};

/** Signs up a new user and returns a helper that makes authenticated requests as them. */
export async function signUp(app: FastifyInstance, email: string): Promise<Session> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { email, password: "test password 123" },
  });
  const { accessToken } = res.json<{ accessToken: string }>();
  return {
    token: accessToken,
    request: (options) =>
      app.inject({
        ...options,
        headers: { ...options.headers, authorization: `Bearer ${accessToken}` },
      }),
  };
}
