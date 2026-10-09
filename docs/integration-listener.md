# Home Assistant machine listener

The browser application remains bound to localhost. Run a separate HTTPS listener for the Home Assistant VM using `node integration-listener.js` (or `npm run start:integration`). It only proxies authenticated `GET /api/integration/v1/snapshot` and `PUT /api/integration/v1/loads/<id>/target` requests to the local application. Configuration, browser pages, cookies, static files, redirects, and query strings are excluded. Browser Origin and browser fetch metadata requests are refused.

Configure both processes with the same `WISER_INTEGRATION_TOKEN`, containing 32–256 URL-safe ASCII characters. Generate and store it using your secret manager; never put it in source control. The application separately requires `WISER_INTEGRATION_CONTROL=1` for writes. Send the token as `Authorization: Bearer <token>`.

Listener settings:

| Environment variable | Purpose | Default |
| --- | --- | --- |
| `WISER_TLS_CERT` | PEM certificate and intermediate chain | Required |
| `WISER_TLS_KEY` | PEM private key | Required |
| `WISER_INTEGRATION_TOKEN` | Shared bearer token | Required |
| `WISER_API_BIND` | Listener address | `127.0.0.1` |
| `WISER_API_PORT` | HTTPS port | `3443` |
| `WISER_LOCAL_PORT` | Local application port | `3000` |

On POSIX, the private key must be a regular file owned by the listener account with no group or other permissions (for example mode `0600`). Symlinks are refused. Provision a certificate whose DNS SAN matches the name Home Assistant uses, issued by a CA trusted by that VM. Keep certificate verification enabled in Home Assistant. The self-signed certificate used by automated tests is not a production deployment recipe.

The upstream is always `http://127.0.0.1:<WISER_LOCAL_PORT>`; an arbitrary upstream URL cannot be configured. Requests are limited to 8 KiB and responses to 2 MiB. The listener times out after 40 seconds; the application's snapshot work must finish within its 30-second bound. Only the bearer token and JSON content type are forwarded. Upstream failures return generic errors.

Remote reachability requires a dedicated service, an explicit private interface bind address, and firewall rules restricted to the Home Assistant VM. Keep the application port bound to localhost and inaccessible from the VM. Deploying a service, opening a firewall, distributing secrets, and installing certificates are separate operational actions requiring user authorization; this implementation performs none of them. Confirm the chosen address, DNS name, certificate provisioning, service account, and VM source address before deployment.

Validate from the VM with a CA-verified HTTPS snapshot request, then verify that the browser root and `/api/config` return errors and that the original application port cannot be reached remotely. Start with read-only snapshots before enabling target writes. Run `node --test test/integration-listener.test.js` for local HTTPS proxy checks.
