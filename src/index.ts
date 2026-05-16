export type {
  VisageCookiePolicy,
  VisageDexExpiry,
  VisageDexOptions,
  VisageDexUser,
  VisageExternalIdpOptions,
  VisageOAuth2Client,
  VisageOptions,
  VisageProxyPolicy,
  VisageServer,
  VisageService,
  VisageUpstream,
} from './types';

export { default, visage } from './plugin';
export { createVisageServer } from './server';
