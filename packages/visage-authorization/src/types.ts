/** Visage's registration with its upstream SSO provider. */
export type AuthorizationServerOptions = {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** https://<visage-host>/interaction/callback; its origin is Visage's issuer. */
  readonly redirectUri: string;
};
