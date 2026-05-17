/**
 * A running Visage instance.
 */
export type VisageServer = {
  /**
   * Start the Visage managed services (NGINX, OAuth2 Proxy, and sometimes Dex).
   */
  listen(): Promise<void>;
  /**
   * Stop the Visage managed services.
   */
  close(): void;
};

/**
 * User-configurable options for the Visage Vite plugin.
 */
export type VisageOptions = {
  /**
   * Browser-facing hostname for the local Visage HTTPS origin.
   *
   * @defaultValue `'localhost'`
   */
  readonly host?: string;
  /**
   * Browser-facing HTTPS port for the local Visage proxy.
   *
   * @defaultValue `9001`
   */
  readonly port?: number;
  /**
   * OAuth2 Proxy session cookie settings for name, browser scope, lifetime, and
   * refresh timing.
   */
  readonly cookie?: VisageCookiePolicy;
  /**
   * Identity provider configuration. Omit this to use Visage's managed Dex
   * provider.
   */
  readonly idp?: VisageDexOptions | VisageExternalIdpOptions;
  /**
   * OAuth2 client settings shared by Dex or an external IdP and OAuth2 Proxy.
   */
  readonly oauth2?: VisageOAuth2Client;
  /**
   * Additional or replacement Docker Compose services managed with the Vite
   * dev-server lifecycle.
   */
  readonly services?: Record<string, VisageService>;
  /**
   * Upstream targets that NGINX can route to by path.
   */
  readonly upstreams?: Record<string, VisageUpstream>;
};

/**
 * Settings for the browser session cookie managed by OAuth2 Proxy.
 *
 * OAuth2 Proxy keeps OIDC session state behind this cookie. The cookie lifetime
 * caps the browser session, while the refresh interval controls when OAuth2
 * Proxy tries to renew token state with the provider.
 */
export type VisageCookiePolicy = {
  /**
   * Browser session cookie base name. When no domains are configured, Visage
   * renders a host-only name with a `__Host-` prefix, so the default rendered
   * name is `__Host-sess`.
   *
   * @defaultValue `'sess'`
   */
  readonly name?: string;
  /**
   * Maximum browser session lifetime. Rendered as OAuth2 Proxy `cookie_expire`
   * using its duration syntax. Keep this aligned with the identity provider's
   * refresh-token lifetime to avoid sessions that can no longer be renewed
   * silently.
   *
   * @defaultValue `'8h'`
   */
  readonly expire?: string;
  /**
   * Session age after which OAuth2 Proxy attempts silent renewal using the
   * stored refresh token, when one is available. Rendered as `cookie_refresh`
   * using OAuth2 Proxy duration syntax. If upstreams validate forwarded bearer
   * tokens, set this below the relevant token lifetime so OAuth2 Proxy refreshes
   * before forwarding expired token material.
   *
   * @defaultValue `'15m'`
   */
  readonly refresh?: string;
  /**
   * Cookie domains for sharing one session across hostnames. Omit for a
   * host-only cookie.
   */
  readonly domains?: readonly string[];
  /**
   * Cookie path scope. Keep broad enough for every protected route that should
   * send the session.
   *
   * @defaultValue `'/'`
   */
  readonly path?: string;
};

/**
 * Managed Dex identity provider options. Dex is the default identity provider
 * for Visage.
 */
export type VisageDexOptions = {
  /**
   * Token expiration and rotation settings rendered into the Dex config.
   *
   * @see {@link https://dexidp.io/docs/configuration/tokens/#expiration-and-rotation-settings}
   */
  readonly expiry?: VisageDexExpiry;
  /**
   * Static username/password users rendered into the Dex config.
   *
   * @defaultValue `[{ email: 'user@example.com', password: 'pass' }]`
   */
  readonly users?: readonly VisageDexUser[];
};

/**
 * Dex token expiration and rotation settings.
 *
 * @see {@link https://dexidp.io/docs/configuration/tokens/#expiration-and-rotation-settings}
 */
export type VisageDexExpiry = {
  /**
   * Lifetime for ID tokens issued by Dex.
   */
  readonly idTokens?: string;
  /**
   * Lifetime for in-progress authorization requests.
   */
  readonly authRequests?: string;
  /**
   * Lifetime for in-progress device authorization requests.
   */
  readonly deviceRequests?: string;
  /**
   * Rotation interval for Dex signing keys.
   */
  readonly signingKeys?: string;
  /**
   * Refresh token lifetime and rotation settings.
   */
  readonly refreshTokens?: {
    /**
     * Maximum time a refresh token may go unused before it expires.
     */
    readonly validIfNotUsedFor?: string;
    /**
     * Absolute lifetime for refresh tokens, regardless of use.
     */
    readonly absoluteLifetime?: string;
    /**
     * Whether Dex should skip refresh-token rotation.
     */
    readonly disableRotation?: boolean;
    /**
     * Grace period during which a rotated refresh token may be reused.
     */
    readonly reuseInterval?: string;
  };
};

/**
 * Static user rendered into the managed Dex password database.
 */
export type VisageDexUser = {
  /**
   * Email address used as the Dex login identifier.
   *
   * @defaultValue `'user@example.com'`
   */
  readonly email: string;
  /**
   * Plain-text development password. Visage hashes this before rendering the
   * Dex config.
   *
   * @defaultValue `'pass'`
   */
  readonly password: string;
  /**
   * Display username. Defaults to the portion of {@link VisageDexUser.email}
   * before `@`.
   */
  readonly username?: string;
  /**
   * Stable Dex user ID. Defaults to {@link VisageDexUser.email}.
   */
  readonly userID?: string;
};

/**
 * External OpenID Connect identity provider options.
 */
export type VisageExternalIdpOptions = {
  /**
   * OIDC issuer URL used by OAuth2 Proxy. When no endpoint paths are
   * configured, OAuth2 Proxy discovers provider endpoints from this issuer.
   */
  readonly issuer: string;
  /**
   * OIDC authorization path appended to
   * {@link VisageExternalIdpOptions.issuer}. Configure this, `token`, or `jwks`
   * to disable OIDC discovery and render explicit provider endpoints.
   */
  readonly authorization?: string;
  /**
   * OIDC token endpoint path appended to
   * {@link VisageExternalIdpOptions.issuer}. Configure this, `authorization`,
   * or `jwks` to disable OIDC discovery and render explicit provider
   * endpoints.
   */
  readonly token?: string;
  /**
   * OIDC JWKS endpoint path appended to
   * {@link VisageExternalIdpOptions.issuer}. Configure this, `authorization`,
   * or `token` to disable OIDC discovery and render explicit provider
   * endpoints.
   */
  readonly jwks?: string;
  /**
   * OIDC end-session endpoint URL. When configured, Visage routes OAuth2 Proxy
   * sign-out redirects through this endpoint so the provider session can be
   * ended as part of the sign-out flow.
   */
  readonly end_session_endpoint?: string;
};

/**
 * OAuth2 client configuration used by OAuth2 Proxy and, for managed Dex, the
 * rendered Dex static client.
 */
export type VisageOAuth2Client = {
  /**
   * OAuth2 client identifier.
   *
   * @defaultValue `'visage'`
   */
  readonly clientId?: string;
  /**
   * OAuth2 client secret.
   *
   * Set to `null` for a public OAuth2 client. OAuth2 Proxy uses PKCE, and
   * managed Dex renders a public static client.
   *
   * @defaultValue `'visage-secret'`
   */
  readonly clientSecret?: string | null;
  /**
   * OIDC scopes requested by OAuth2 Proxy.
   *
   * @defaultValue `['openid', 'email', 'profile', 'offline_access']`
   */
  readonly scopes?: readonly string[];
  /**
   * Email domains allowed by OAuth2 Proxy after authentication.
   *
   * @defaultValue `['example.com']`
   */
  readonly emailDomains?: readonly string[];
};

/**
 * Subset of a Docker Compose service definition managed by Visage.
 */
export type VisageService = {
  /**
   * Container image reference used for the service. Required for additional
   * services; defaults to the managed image when overriding `nginx` or
   * `oauth2_proxy`.
   */
  readonly image?: string;
  /**
   * Optional command override rendered into the Compose service.
   */
  readonly command?: readonly string[];
  /**
   * Compose service dependencies that should start before this service.
   */
  readonly depends_on?: readonly string[];
  /**
   * Additional host-to-IP mappings rendered into the Compose service.
   */
  readonly extra_hosts?: readonly string[];
  /**
   * Container restart policy.
   * @defaultValue `'on-failure'`
   */
  readonly restart?: 'always' | 'no' | 'on-failure' | 'unless-stopped';
  /**
   * Optional upstream override for this service. Omit this to create a default
   * upstream from the service name.
   */
  readonly upstream?: VisageUpstream;
};

/**
 * Named proxy target that NGINX routes to for one or more locations.
 */
export type VisageUpstream = {
  /**
   * Hostname or Compose service name NGINX should proxy to.
   *
   * @defaultValue The upstream name.
   */
  readonly host?: string;
  /**
   * URL scheme NGINX should use when proxying to this upstream.
   *
   * @defaultValue `'https'` for external upstreams; `'http'` otherwise.
   */
  readonly scheme?: 'http' | 'https';
  /**
   * Port NGINX should proxy to on {@link VisageUpstream.host}.
   *
   * @defaultValue `80`, or `443` when {@link VisageUpstream.scheme} is `'https'`.
   */
  readonly port?: number;
  /**
   * Path-location policies for this upstream, keyed by NGINX location path.
   *
   * @defaultValue `/{upstreamName}/`
   */
  readonly locations?: { readonly [path: string]: VisageProxyPolicy };
};

/**
 * Per-location NGINX authentication and header forwarding policy.
 */
export type VisageProxyPolicy = {
  /**
   * OAuth2 authentication behavior for this location.
   */
  readonly auth?: {
    /**
     * Whether requests to this location require OAuth2 authentication.
     *
     * @defaultValue `true`
     */
    readonly enabled?: boolean;
    /**
     * Whether unauthenticated browser requests should redirect to sign-in.
     *
     * @defaultValue `false`
     */
    readonly redirect?: boolean;
    /**
     * Token forwarding behavior for the upstream `Authorization` header. Set
     * to `false` to omit a bearer token. Set to `true` to forward the
     * default bearer token for the upstream kind: an OAuth access token for
     * external upstreams, or an OIDC ID token for local service upstreams.
     *
     * Use `'id'` or `'access'` to force a specific token kind.
     *
     * @defaultValue `false`
     */
    readonly forward?: boolean | 'id' | 'access';
  };
  /**
   * Browser request isolation policy for authenticated cookie-backed
   * locations. Set this to `false` when an upstream handles CSRF itself or
   * intentionally accepts cross-site browser requests.
   *
   * @defaultValue `'app'` for the built-in Vite root location; `'api'` for
   * authenticated upstream locations; `false` for unauthenticated locations.
   */
  readonly csrf?: false | 'app' | 'api';
  /**
   * Request headers to set when proxying to the upstream. Values may include
   * NGINX variables. These are merged with Visage's default proxy headers:
   * `Cookie`, `Host`, `X-Real-IP`, `X-Forwarded-For`, and
   * `X-Forwarded-Proto`. `Host` defaults to the upstream host for top-level
   * upstreams with no matching service, and to `$host` otherwise.
   */
  readonly headers?: { readonly [key: string]: string };
  /**
   * Additional NGINX location directives. Values may include NGINX variables.
   * String values render once; array values render once per item. These are
   * merged with Visage's default directives such as `proxy_buffer_size`.
   */
  readonly directives?: {
    readonly [name: string]: string | readonly string[];
  };
};
