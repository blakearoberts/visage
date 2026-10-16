/**
 * Static confidential client accepted by the token endpoint.
 */
export type AuthorizationClient = {
  /** Client secret accepted through `client_secret_basic`. */
  readonly secret: string;
};

/**
 * Configuration for the trusted issuer of subject access tokens.
 */
export type SubjectIssuer = {
  /** Exact `iss` claim required on subject tokens. */
  readonly issuer: string;
  /** Remote JSON Web Key Set used to verify subject-token signatures. */
  readonly jwksURL: string;
};

/**
 * Configuration for the RFC 8693 token exchange handler.
 */
export type AuthorizationServerOptions = {
  /** Public issuer identifier for access tokens minted by this server. */
  readonly issuer: string;
  /** Extractable RSASSA-PKCS1-v1_5 private key used with RS256. */
  readonly signingKey: CryptoKey;
  /** Stable key identifier published through this server's JWKS. */
  readonly signingKeyId: string;
  /** Trusted issuer and verification keys for subject access tokens. */
  readonly subjectIssuer: SubjectIssuer;
  /** Static confidential clients keyed by client identifier. */
  readonly clients: Readonly<Record<string, AuthorizationClient>>;
  /** OPA Data API URL returning the token-exchange policy decision. */
  readonly policyURL: string;
  /**
   * Maximum issued access-token lifetime in seconds. The subject token's
   * remaining lifetime is always an additional upper bound.
   *
   * @defaultValue `300`
   */
  readonly accessTokenTTLSeconds?: number;
};
