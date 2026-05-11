export type VisageOptions = {
  readonly host?: string;
  readonly port?: number;
  readonly cookie?: VisageCookiePolicy;
  readonly idp?: VisageDexOptions | VisageIdpOptions;
  readonly oauth2?: VisageOAuth2Client;
  readonly services?: Record<string, VisageService>;
  readonly upstreams?: Record<string, VisageUpstream>;
};

export type VisageCookiePolicy = {
  readonly name?: string;
  readonly expire?: string;
  readonly refresh?: string;
  readonly domains?: readonly string[];
  readonly path?: string;
};

export type VisageDexOptions = {
  readonly kind?: 'dex';
  readonly expiry?: VisageDexExpiry;
  readonly users?: readonly VisageDexUser[];
};

/**
 * Dex token expiration and rotation settings.
 *
 * @see {@link https://dexidp.io/docs/configuration/tokens/#expiration-and-rotation-settings}
 */
export type VisageDexExpiry = {
  readonly idTokens?: string;
  readonly authRequests?: string;
  readonly deviceRequests?: string;
  readonly signingKeys?: string;
  readonly refreshTokens?: {
    readonly validIfNotUsedFor?: string;
    readonly absoluteLifetime?: string;
    readonly disableRotation?: boolean;
    readonly reuseInterval?: string;
  };
};

export type VisageDexUser = {
  readonly email: string;
  readonly password: string;
  readonly username?: string;
  readonly userID?: string;
};

export type VisageIdpOptions = {
  readonly kind: 'external';
  readonly upstream: string;
  readonly path?: string;
  readonly issuer?: string;
  readonly authorizationEndpoint?: string;
  readonly tokenEndpoint?: string;
  readonly jwksEndpoint?: string;
};

export type VisageOAuth2Client = {
  readonly clientId?: string;
  /**
   * Set to `null` to render a public Dex client and enable OAuth2 Proxy PKCE.
   */
  readonly clientSecret?: string | null;
  readonly scopes?: readonly string[];
};

export type VisageService = {
  readonly image: string;
  readonly command?: readonly string[];
  readonly depends_on?: readonly string[];
  readonly extra_hosts?: readonly string[];
};

export type VisageUpstream = {
  readonly host: string;
  readonly port: number;
  readonly locations?: { readonly [path: string]: VisageProxyPolicy };
};

export type VisageProxyPolicy = {
  readonly auth?: {
    readonly enabled?: boolean;
    readonly redirect?: boolean;
    readonly forward?: boolean;
  };
  readonly headers?: { readonly [key: string]: string };
};
