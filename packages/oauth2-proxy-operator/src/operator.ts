import { randomBytes } from 'node:crypto';
import {
  AppsV1Api,
  CoreV1Api,
  CustomObjectsApi,
  KubeConfig,
  makeInformer,
  type KubernetesObject,
  type V1Deployment,
  type V1Secret,
  type V1Service,
} from '@kubernetes/client-node';

interface HttpRoute extends KubernetesObject {
  spec?: {
    rules?: HttpRouteRule[];
    [key: string]: unknown;
  };
}

interface HttpRouteRule {
  backendRefs?: HttpRouteBackendRef[];
  matches?: { path?: { value?: string } }[];
  [key: string]: unknown;
}

interface HttpRouteBackendRef {
  group?: string;
  kind?: string;
  name?: string;
  namespace?: string;
  port?: number;
}

const kc = new KubeConfig();
kc.loadFromDefault();

const apps = kc.makeApiClient(AppsV1Api);
const core = kc.makeApiClient(CoreV1Api);
const custom = kc.makeApiClient(CustomObjectsApi);

const route = {
  group: 'gateway.networking.k8s.io',
  version: 'v1',
  plural: 'httproutes',
};
const issuer = 'oauth2-proxy.operator/issuer';
const clientId = 'oauth2-proxy.operator/client-id';
const clientSecretRef = 'oauth2-proxy.operator/client-secret-ref';
const cookieExpire = 'oauth2-proxy.operator/cookie-expire';
const cookieRefresh = 'oauth2-proxy.operator/cookie-refresh';
const cookieSecure = 'oauth2-proxy.operator/cookie-secure';
const passAuthorizationHeader =
  'oauth2-proxy.operator/pass-authorization-header';
const redirectUrl = 'oauth2-proxy.operator/redirect-url';
const originalRules = 'oauth2-proxy.operator/original-rules';
const image = process.env.OAUTH2_PROXY_IMAGE;
if (!image) throw new Error('OAUTH2_PROXY_IMAGE must be set');
const port = 4180;

const status = (e: unknown) =>
  e && typeof e === 'object' && 'code' in e ? e.code : undefined;

const informer = makeInformer<HttpRoute>(
  kc,
  `/apis/${route.group}/${route.version}/${route.plural}`,
  () => custom.listCustomObjectForAllNamespaces(route),
);
informer.on('add', reconcile);
informer.on('update', reconcile);
informer.start().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function reconcile(r: HttpRoute) {
  const ns = r.metadata!.namespace!;
  const name = `oauth2-${r.metadata!.name!}`.slice(0, 63).replace(/-$/, '');
  const a = (r.metadata!.annotations ??= {});
  const configured = a[issuer] && a[clientId] && a[redirectUrl];

  if (!configured) {
    if (!a[originalRules]) return;
    r.spec ??= {};
    r.spec.rules = JSON.parse(a[originalRules]);
    delete a[originalRules];
    await replaceRoute(r);
    await ignore404(() =>
      apps.deleteNamespacedDeployment({ namespace: ns, name }),
    );
    await ignore404(() =>
      core.deleteNamespacedService({ namespace: ns, name }),
    );
    await ignore404(() => core.deleteNamespacedSecret({ namespace: ns, name }));
    return;
  }

  if (!r.spec) throw new Error('HTTPRoute has no spec');
  const hadOriginal = Boolean(a[originalRules]);
  const rules: HttpRouteRule[] = hadOriginal
    ? JSON.parse(a[originalRules]!)
    : (r.spec.rules ?? []);
  const upstreams = new Set<string>();

  for (const rule of rules) {
    const paths = rule.matches?.map((m) => m.path?.value ?? '/') ?? ['/'];
    for (const ref of rule.backendRefs ?? []) {
      if (
        (ref.group && ref.group !== '') ||
        (ref.kind && ref.kind !== 'Service')
      )
        throw new Error('only Service backendRefs are supported');
      if (!ref.name || !ref.port)
        throw new Error('Service backendRef has no matching port');
      for (const path of paths) {
        upstreams.add(
          `http://${ref.name}.${ref.namespace ?? ns}.svc.cluster.local:${ref.port}${path === '/' ? '' : path}`,
        );
      }
    }
  }

  if (!upstreams.size) throw new Error('HTTPRoute has no Service backendRefs');
  if (!hadOriginal) a[originalRules] = JSON.stringify(rules);

  const secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { namespace: ns, name, ownerReferences: [owner(r)] },
    stringData: { cookie_secret: randomBytes(32).toString('base64url') },
  } satisfies V1Secret;
  try {
    await core.readNamespacedSecret({ namespace: ns, name });
  } catch (e) {
    if (status(e) !== 404) throw e;
    await core.createNamespacedSecret({ namespace: ns, body: secret });
  }

  const svc = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { namespace: ns, name, ownerReferences: [owner(r)] },
    spec: { selector: { app: name }, ports: [{ port, targetPort: port }] },
  } satisfies V1Service;
  try {
    await core.readNamespacedService({ namespace: ns, name });
  } catch (e) {
    if (status(e) !== 404) throw e;
    await core.createNamespacedService({ namespace: ns, body: svc });
  }

  const ref = a[clientSecretRef]?.split(':');
  const args = [
    `--http-address=0.0.0.0:${port}`,
    '--provider=oidc',
    `--oidc-issuer-url=${a[issuer]}`,
    `--client-id=${a[clientId]}`,
    `--redirect-url=${a[redirectUrl]}`,
    '--email-domain=*',
    `--scope=openid email profile${a[cookieRefresh] ? ' offline_access' : ''}`,
    '--approval-prompt=auto',
    '--reverse-proxy=true',
    '--skip-provider-button=true',
    '--cookie-secret=$(OAUTH2_PROXY_COOKIE_SECRET)',
    ...(a[cookieExpire] ? [`--cookie-expire=${a[cookieExpire]}`] : []),
    ...(a[cookieRefresh] ? [`--cookie-refresh=${a[cookieRefresh]}`] : []),
    ...(a[cookieSecure] ? [`--cookie-secure=${a[cookieSecure]}`] : []),
    ...(a[passAuthorizationHeader]
      ? [`--pass-authorization-header=${a[passAuthorizationHeader]}`]
      : []),
    ...(ref
      ? ['--client-secret=$(OAUTH2_PROXY_CLIENT_SECRET)']
      : ['--client-secret-file=/dev/null', '--code-challenge-method=S256']),
    ...[...upstreams].map((u) => `--upstream=${u}`),
  ];
  const dep = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { namespace: ns, name, ownerReferences: [owner(r)] },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          containers: [
            {
              name: 'oauth2-proxy',
              image,
              args,
              ports: [{ containerPort: port }],
              env: [
                {
                  name: 'OAUTH2_PROXY_COOKIE_SECRET',
                  valueFrom: { secretKeyRef: { name, key: 'cookie_secret' } },
                },
                ...(ref
                  ? [
                      {
                        name: 'OAUTH2_PROXY_CLIENT_SECRET',
                        valueFrom: {
                          secretKeyRef: {
                            name: ref[0],
                            key: ref[1] ?? 'client_secret',
                          },
                        },
                      },
                    ]
                  : []),
              ],
            },
          ],
        },
      },
    },
  } satisfies V1Deployment;
  try {
    const existing = await apps.readNamespacedDeployment({
      namespace: ns,
      name,
    });
    await apps.replaceNamespacedDeployment({
      namespace: ns,
      name,
      body: {
        ...dep,
        metadata: {
          ...dep.metadata,
          resourceVersion: existing.metadata!.resourceVersion,
        },
      },
    });
  } catch (e) {
    if (status(e) !== 404) throw e;
    await apps.createNamespacedDeployment({ namespace: ns, body: dep });
  }

  const nextRules = rules.map((rule) => ({
    ...rule,
    backendRefs: [{ name, port }],
  }));
  if (
    JSON.stringify(r.spec.rules ?? []) === JSON.stringify(nextRules) &&
    hadOriginal
  )
    return;
  r.spec.rules = nextRules;
  await replaceRoute(r);
}

async function replaceRoute(r: HttpRoute) {
  await custom.replaceNamespacedCustomObject({
    ...route,
    namespace: r.metadata!.namespace!,
    name: r.metadata!.name!,
    body: r,
  });
}

async function ignore404(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (status(e) !== 404) throw e;
  }
}

function owner(r: HttpRoute) {
  return {
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'HTTPRoute',
    name: r.metadata!.name!,
    uid: r.metadata!.uid!,
  };
}
