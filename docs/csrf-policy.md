# CSRF Policy

By default, Visage configures an edge CSRF policy for cookie-authenticated
routes. Application CSRF tokens are not required for ordinary same-origin SPA
mutations under this policy. App-level tokens may still be useful when a
location disables the edge policy, intentionally accepts cross-site browser
requests, or needs a token that encodes additional authorization semantics. CSP,
`frame-ancestors`, and other click-jacking controls remain application policy.

The CSRF policy is, for any cookie-authenticated request:

1. Allow if `Sec-Fetch-Site` is `same-origin` or `none`.
2. Allow if `Sec-Fetch-Site` is `same-site` or `cross-site` for top-level
   document navigations defined by:
   - method is `GET`;
   - `Sec-Fetch-Mode` is `navigate`;
   - `Sec-Fetch-Dest` is `document`.
3. Deny otherwise if `Sec-Fetch-Site` is `same-site` or `cross-site`.
4. When `Sec-Fetch-*` headers are absent or unrecognized, fallback to matching
   the configured browser origin against the `Origin` or `Referer` headers:
   - Allow safe methods `GET`, `HEAD`, and `OPTIONS`;
   - Allow unsafe methods when `Origin` matches the configured browser origin
     exactly, or when the origin of `Referer` matches the configured browser
     origin exactly.

## Sec-Fetch-* Headers

The following table demonstrates the conditions by which a request is permitted
when presenting valid/complete `Sec-Fetch-*` headers. If the headers are
supplied, but do not match any row, the request is denied. In this case, NGINX
returns 403, and the request does not reach oauth2-proxy or any prospective
upstream server.

| `Sec-Fetch-Site` | `Sec-Fetch-Mode` | `Sec-Fetch-Dest` | Method |
| ---------------- | ---------------- | ---------------- | ------ |
| `same-origin`    | any              | any              | any    |
| `none`           | any              | any              | any    |
| `same-site`      | `navigate`       | `document`       | `GET`  |
| `cross-site`     | `navigate`       | `document`       | `GET`  |

## Origin/Referer Fallback

The following table demonstrates the conditions by which a request is permitted
when the request does not present recognized `Sec-Fetch-*` headers. If a
request's details do not match any row, the request is denied. In this case,
NGINX returns 403, and the request does not reach oauth2-proxy or any
prospective upstream server.

| Method    | Origin | Referer |
| --------- | ------ | ------- |
| `GET`     | any    | any     |
| `HEAD`    | any    | any     |
| `OPTIONS` | any    | any     |
| any       | match  | match   |
| any       | match  | absent  |
| any       | absent | match   |

## Gaps

The policy allows cross-site and same-site top-level `GET` document navigations.
Therefore, it does not protect routes where `GET` mutates state. OWASP
recommends not using safe methods for state changes; an upstream that does not
follow this guideline needs stricter endpoint policy such as application-level
CSRF tokens.

## References

- [W3C Fetch Metadata Request Headers](https://www.w3.org/TR/fetch-metadata/)
- [MDN Fetch metadata guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Fetch_metadata)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [web.dev Fetch Metadata resource isolation article](https://web.dev/articles/fetch-metadata)
