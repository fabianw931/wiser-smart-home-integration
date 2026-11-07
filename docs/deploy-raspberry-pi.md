# Running the app on a Raspberry Pi (Docker)

One container runs the Wiser Workspace app **and** the Home Assistant (HA) integration listener (`node server.js`). Verified: the image builds and starts read-only as a non-root user with all capabilities dropped; the web UI answers, and the listener answers 401 without the token. **Not** verified on a real Raspberry Pi, a real gateway or a real HA.

## What you need

- Raspberry Pi with a 64-bit OS, Docker and the Compose plugin (`docker compose version`), on the same LAN as the gateway and HA.
- A fixed address for the Pi (DHCP reservation in the router). HA stores it.
- The gateway IP and its API token (see `docs/getting-started.md`).

## Set up

```sh
git clone git@github.com:fabianw931/wiser-smart-home-integration.git wiser && cd wiser
cp .env.example .env && chmod 600 .env
```

Edit `.env` (shell variables win over the file; compose passes the file to the container):

```
WISER_GATEWAY_HOST=<gateway ip>
WISER_GATEWAY_TOKEN=<gateway token>
WISER_INTEGRATION_TOKEN=<openssl rand -hex 32>
WISER_API_TLS=0
WISER_API_BIND=<the Pi's LAN address, or 0.0.0.0>
```

Leave `WISER_INTEGRATION_CONTROL` unset: HA starts read-only. Then:

```sh
mkdir -p data && chown "$(id -u):$(id -g)" data   # the container runs as your user so ./data stays writable
UID=$(id -u) GID=$(id -g) docker compose up -d --build
docker compose logs -f
```

Keep the `UID`/`GID` prefix in front of every `docker compose` command, or put `UID=…` and `GID=…` into `.env`.

To keep the names, rooms and layout you made on your laptop, stop the container and copy `data/wiser.sqlite` into the Pi's `data/` (names are stored per gateway address, so they match). Gateway credentials come from `.env`, so `data/credentials` is not needed.

## Network exposure

- The container uses host networking (`compose.yaml`). The **web UI stays on the Pi's `127.0.0.1:3000`** and has no login, so never publish it. Open it from your computer with `ssh -L 3000:127.0.0.1:3000 <user>@<pi>` and browse `http://127.0.0.1:3000`.
- The **HA listener** (default port `3443`) listens on `WISER_API_BIND`. It requires the Bearer token, but plain HTTP means the token is readable on the LAN, so allow only HA through the firewall.
- Host networking means Docker does not add its own firewall bypass: the Pi's host firewall decides who reaches port 3443.

## Firewall: allow only HA to port 3443

Replace `<HA_IP>` with HA's address (give HA a fixed address too).

**ufw** (the usual choice on Raspberry Pi OS / Ubuntu):

```sh
sudo ufw allow from <HA_IP> to any port 3443 proto tcp comment 'Home Assistant -> Wiser listener'
sudo ufw allow OpenSSH            # before enabling, or you lock yourself out
sudo ufw enable
sudo ufw status numbered
```

**nftables** (if you use it instead; add to your `inet filter input` chain):

```
ip saddr <HA_IP> tcp dport 3443 accept
```

With a default-deny inbound policy this is the only rule needed for HA. Check from HA's machine: `curl -i http://<pi>:3443/` must answer `401` (reachable, token required); from any other machine it must time out.

## Connect HA

Follow `docs/ha-native.md`: host = the Pi's address, port `3443`, the integration token, **Use HTTPS off**. Start read-only; after confirming names and states, set `WISER_INTEGRATION_CONTROL=1` in `.env` and run `docker compose up -d` to apply it.

## Operate

| Task | Command |
|---|---|
| Logs | `docker compose logs -f` |
| Update | `git pull && docker compose up -d --build` |
| Stop | `docker compose down` |
| Restart after `.env` change | `docker compose up -d` |

The container has a health check (`docker ps` shows `healthy`), restarts after a reboot (`restart: unless-stopped`), and its filesystem is read-only except `./data` and `/tmp`.
