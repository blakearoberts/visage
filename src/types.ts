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
   * Session cookie settings normalized into OAuth2 Proxy configuration.
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
 * Cookie lifetime, scope, and naming policy for the OAuth2 Proxy session.
 */
export type VisageCookiePolicy = {
  /**
   * Session cookie name. Host-only cookies are automatically prefixed with
   * `__HOST-` when no domains are configured, so the default rendered
   * host-only cookie name is `__HOST-session`.
   *
   * @defaultValue `'session'`
   */
  readonly name?: string;
  /**
   * Maximum cookie lifetime using an OAuth2 Proxy duration string.
   *
   * @defaultValue `'8h'`
   */
  readonly expire?: string;
  /**
   * Interval after which OAuth2 Proxy refreshes the session using an OAuth2
   * Proxy duration string.
   *
   * @defaultValue `'15m'`
   */
  readonly refresh?: string;
  /**
   * Cookie domains for sharing the session across local hostnames. Leave unset
   * for a host-only cookie.
   */
  readonly domains?: readonly string[];
  /**
   * Cookie path scope.
   *
   * @defaultValue `'/'`
   */
  readonly path?: string;
};

/**
 * Managed Dex identity provider options.
 */
export type VisageDexOptions = {
  /**
   * Token expiration and rotation settings rendered into the Dex config.
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
   */
  readonly email: string;
  /**
   * Plain-text development password. Visage hashes this before rendering the
   * Dex config.
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
   * OIDC issuer URL used by OAuth2 Proxy.
   */
  readonly issuer: string;
  /**
   * OIDC authorization path appended to
   * {@link VisageExternalIdpOptions.issuer}.
   *
   * @defaultValue '/auth'
   */
  readonly authorization?: string;
  /**
   * OIDC token endpoint path appended to
   * {@link VisageExternalIdpOptions.issuer}.
   *
   * @defaultValue '/token'
   */
  readonly token?: string;
  /**
   * OIDC JWKS endpoint path appended to
   * {@link VisageExternalIdpOptions.issuer}.
   *
   * @defaultValue '/keys'
   */
  readonly jwks?: string;
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
   * @defaultValue `'http'`
   */
  readonly scheme?: 'http' | 'https';
  /**
   * Port NGINX should proxy to on {@link VisageUpstream.host}.
   *
   * @defaultValue `80`
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
     * Whether the authenticated access token should be forwarded upstream as an
     * `Authorization: Bearer ...` header.
     *
     * @defaultValue `true`
     */
    readonly forward?: boolean;
  };
  /**
   * Request headers to set when proxying to the upstream. Values may include
   * NGINX variables. These are merged with Visage's default proxy headers:
   * `Cookie`, `Host`, `X-Real-IP`, `X-Forwarded-For`, and
   * `X-Forwarded-Proto`.
   */
  readonly headers?: { readonly [key: string]: string };
};
