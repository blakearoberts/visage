# Session Lifecycle

## Authorization Code Flow (ACF)

```mermaid
sequenceDiagram
  participant Browser
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant IdP as OIDC provider
  participant Upstream

  Browser->>NGINX: Fetch <URL>
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 401 Unauthorized
  NGINX-->>Browser: 302 /oauth2/start?rd=<URL>
  Browser->>NGINX: GET /oauth2/start?rd=<URL>
  NGINX->>Proxy: proxy_pass
  Proxy-->>NGINX: 302 authorization endpoint
  NGINX-->>Browser: pass
  Browser->>IdP: Authorization request
  IdP-->>Browser: 302 /oauth2/callback?code=...
  Browser->>NGINX: GET /oauth2/callback?code=...
  NGINX->>Proxy: proxy_pass
  Proxy->>IdP: token redemption via authorization code grant
  IdP-->>Proxy: ID token, access token, refresh token
  Proxy-->>NGINX: Set-Cookie <session>
  NGINX-->>Browser: Set-Cookie <session>#59; 302 <URL>
  Browser->>NGINX: Fetch <URL>
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 202 Accepted
  NGINX->>Upstream: proxy_pass Fetch <URL>
  Upstream-->>NGINX: response
  NGINX-->>Browser: pass
```

## Session Refresh

```mermaid
sequenceDiagram
  participant Browser
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant IdP as OIDC provider
  participant Upstream

  Browser->>NGINX: Fetch <URL>
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy->>IdP: token redemption via refresh token grant
  IdP-->>Proxy: ID token, access token, refresh token
  Proxy-->>NGINX: Set-Cookie <session>#59; 202 Accepted
  NGINX->>Upstream: proxy_pass Fetch <URL>
  Upstream-->>NGINX: response
  NGINX-->>Browser: Set-Cookie <session>#59; response
```

## Reauthentication via ACF Popup

```mermaid
sequenceDiagram
  participant Browser
  participant Popup as Reauth popup
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant IdP as OIDC provider
  participant Upstream

  Browser->>NGINX: Fetch <URL>
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 401 Unauthorized
  NGINX-->>Browser: 401 Unauthorized
  Browser-->>Browser: Show lock screen and queue requests

  Browser->>Popup: Open /oauth2/start?rd=/?reauth
  Note over Popup,IdP: ACF via Popup
  Popup->>NGINX: GET /oauth2/start?rd=/?reauth
  NGINX->>Proxy: proxy_pass
  Proxy-->>NGINX: 302 authorization endpoint
  NGINX-->>Popup: pass
  Popup->>IdP: Authorization request
  IdP-->>Popup: 302 /oauth2/callback?code=...
  Popup->>NGINX: GET /oauth2/callback?code=...
  NGINX->>Proxy: proxy_pass
  Proxy->>IdP: token redemption via authorization code grant
  IdP-->>Proxy: ID token, access token, refresh token
  Proxy-->>NGINX: Set-Cookie <session>#59; 302 /?reauth
  NGINX-->>Popup: pass
  Popup->>NGINX: GET /?reauth
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 202 Accepted
  NGINX->>Upstream: proxy_pass GET /?reauth
  Upstream-->>NGINX: response
  NGINX-->>Popup: pass
  Popup-->>Browser: Broadcast session ready
  Popup-->>Popup: Close

  Note over Browser,Popup: Session resumes
  Browser-->>Browser: Hide lock screen
  Browser->>NGINX: Refetch <URL>
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 202 Accepted
  NGINX->>Upstream: proxy_pass Refetch <URL>
  Upstream-->>NGINX: response
  NGINX-->>Browser: pass
```

## Managed Dex Sign-out

### Signout when the app session is accepted

```mermaid
sequenceDiagram
  participant Browser
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant Dex

  Browser->>NGINX: GET /oauth2/sign_out
  NGINX->>Proxy: auth_request GET /oauth2/auth
  opt refresh session
    Proxy->>Dex: POST /dex/token
    Dex-->>Proxy: 200 OK
  end
  Proxy-->>NGINX: 202 Accepted
  NGINX->>Proxy: proxy_pass GET /oauth2/sign_out
  Proxy-->>NGINX: 302 /dex/logout?id_token_hint=...&post_logout_redirect_uri=...
  NGINX-->>Browser: pass
  Browser->>NGINX: GET /dex/logout?id_token_hint=...&post_logout_redirect_uri=...
  NGINX->>Dex: proxy_pass
  Dex-->>NGINX: 302 /oauth2/start?rd=/
  NGINX-->>Browser: pass
  Browser->>NGINX: GET /oauth2/start?rd=/
  NGINX->>Proxy: proxy_pass
  Proxy-->>NGINX: 302 /dex/auth
  NGINX-->>Browser: pass
  Browser->>NGINX: GET /dex/auth
  NGINX->>Dex: proxy_pass
```

### Signout when app session refresh is rejected

```mermaid
sequenceDiagram
  participant Browser
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant Dex

  Browser->>NGINX: GET /oauth2/sign_out
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy->>Dex: POST /dex/token
  Dex-->>Proxy: 400 invalid_grant
  Proxy-->>NGINX: 401 Unauthorized
  alt Browser navigation
    NGINX-->>Browser: 302 /oauth2/start?rd=/oauth2/sign_out
    Browser->>NGINX: GET /oauth2/start?rd=/oauth2/sign_out
    NGINX->>Proxy: pass
    Proxy-->>NGINX: 302 /dex/auth
    NGINX-->>Browser: pass
    Browser->>NGINX: GET /dex/auth
    NGINX->>Dex: pass
  else Fetch or XHR
    NGINX-->>Browser: 401 Unauthorized
  end
```

### Signout without an app session

```mermaid
sequenceDiagram
  participant Browser
  participant NGINX
  participant Proxy as OAuth2 Proxy
  participant Dex

  Browser->>NGINX: GET /oauth2/sign_out
  NGINX->>Proxy: auth_request GET /oauth2/auth
  Proxy-->>NGINX: 401 Unauthorized
  alt Browser navigation
    NGINX-->>Browser: 302 /oauth2/start?rd=/oauth2/sign_out
    Browser->>NGINX: GET /oauth2/start?rd=/oauth2/sign_out
    NGINX->>Proxy: pass
    Proxy-->>NGINX: 302 /dex/auth
    NGINX-->>Browser: pass
    Browser->>NGINX: GET /dex/auth
    NGINX->>Dex: pass
    opt Valid IdP session (ACF without credentials)
      Dex-->>NGINX: 302 /oauth2/callback?code=...
      NGINX-->>Browser: pass
      Browser->>NGINX: GET /oauth2/callback?code=...
      NGINX->>Proxy: pass
      Proxy->>Dex: POST /dex/token
      Dex-->>Proxy: 200 OK
      Proxy-->>NGINX: 302 /oauth2/sign_out
      NGINX-->>Browser: pass
      Browser->>NGINX: GET /oauth2/sign_out
      NGINX->>Proxy: auth_request GET /oauth2/auth
      Proxy-->>NGINX: 202 Accepted
      NGINX->>Proxy: proxy_pass GET /oauth2/sign_out
      Proxy-->>NGINX: 302 /dex/logout?id_token_hint=...&post_logout_redirect_uri=...
      NGINX-->>Browser: pass
      Browser->>NGINX: GET /dex/logout?id_token_hint=...&post_logout_redirect_uri=...
      NGINX->>Dex: pass
      Dex-->>NGINX: 302 /oauth2/start?rd=/
      NGINX-->>Browser: pass
      Browser->>NGINX: GET /oauth2/start?rd=/
      NGINX->>Proxy: pass
      Proxy-->>NGINX: 302 /dex/auth
      NGINX-->>Browser: pass
      Browser->>NGINX: GET /dex/auth
      NGINX->>Dex: pass
    end
  else Fetch or XHR
    NGINX-->>Browser: 401 Unauthorized
  end
```
