export type Credential = {
  readonly access_token?: string;
  readonly id_token?: string;
  readonly issued_token_type?: string;
  readonly refresh_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
  readonly scope?: string;
};

export type Context = Omit<NginxHTTPRequest, 'rawVariables' | 'variables'> & {
  readonly rawVariables: Readonly<NginxRawVariables>;
  readonly variables: Readonly<NginxVariables>;
  credential?: Credential;
  user?: string;
  email?: string;
  preferred_username?: string;
  groups?: string;
  session?: { cookie?: string };
};

export type Middleware = (
  ctx: Context,
  next: () => Promise<void>,
) => Promise<void>;
