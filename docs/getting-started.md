---
title: Connect to a Wiser gateway
aliases:
  - Getting started
  - API examples
tags:
  - wiser
  - api
  - howto
type: guide
status: examples-not-hardware-tested
---

# Connect to a Wiser gateway

These commands follow the official authentication and cURL tutorials. They have **not** been executed against a real installation.

## Prerequisites

- A commissioned **Wiser by Feller** installation with a WLAN-enabled µGateway.
- The gateway's local IP address.
- A computer on a network that can reach that address.
- Physical access to the gateway for pairing.
- `curl`; `jq` is optional for inspecting responses.

Confirm the gateway generation before expecting heating or weather resources. Use a unique client name and keep credentials out of the repository and Obsidian vault.

## 1. Set the gateway address

Replace the example address:

```sh
export GATEWAY_IP_ADDRESS="192.168.1.123"
```

## 2. Claim a client account

Run this and press a flashing physical gateway button within approximately 30 seconds:

```sh
curl --silent --show-error --max-time 45 \
  --request POST \
  "http://${GATEWAY_IP_ADDRESS}/api/account/claim" \
  --header "Content-Type: application/json" \
  --data '{"user":"wiser-research-client"}'
```

A successful response contains `data.secret`. **Do not paste that response into a shared note, issue, chat, or fixture.**

Read the returned token into a shell variable without placing it directly in shell history. In Bash:

```bash
read -r -s -p "Gateway token: " GATEWAY_TOKEN
printf '\n'
export GATEWAY_TOKEN
```

This avoids a literal token in the command history, but terminal output and authenticated command lines still need care on shared machines. Use the target application's credential store for a persistent integration.

## 3. Read gateway and entity information

```sh
curl --silent --show-error --max-time 15 \
  "http://${GATEWAY_IP_ADDRESS}/api/info" \
  --header "Authorization: Bearer ${GATEWAY_TOKEN}"

curl --silent --show-error --max-time 15 \
  "http://${GATEWAY_IP_ADDRESS}/api/loads" \
  --header "Authorization: Bearer ${GATEWAY_TOKEN}"

curl --silent --show-error --max-time 15 \
  "http://${GATEWAY_IP_ADDRESS}/api/loads/state" \
  --header "Authorization: Bearer ${GATEWAY_TOKEN}"
```

Inspect both the HTTP result and JSON `status`. For other resources, use the ordinary read endpoints listed in [Entity model](entity-model.md). Do not probe configuration, calibration, reset, or job-execution URLs as if they were read-only.

## 4. Optional: control one known light

**This changes the installation.** Select a real, safe `onoff` or `dim` load ID from discovery; do not assume ID 1 is a light.

```sh
LOAD_ID="REPLACE_WITH_KNOWN_LIGHT_ID"

# Turn the selected light off.
curl --silent --show-error --max-time 15 \
  --request PUT \
  "http://${GATEWAY_IP_ADDRESS}/api/loads/${LOAD_ID}/target_state" \
  --header "Authorization: Bearer ${GATEWAY_TOKEN}" \
  --header "Content-Type: application/json" \
  --data '{"bri":0}'
```

For these documented light types, `{"bri":10000}` requests fully on. Read the state afterward to confirm the reported result.

Do not experiment with motor, HVAC, or weather-protection writes until their ranges and behavior are understood.

## 5. Observe state changes

A WebSocket client must set this HTTP header during the connection handshake:

```http
Authorization: Bearer <token>
```

Connect to:

```text
ws://<gateway-ip>/api
```

Request a snapshot:

```json
{"command":"dump_loads"}
```

Then observe messages while a known light is operated:

```json
{"load":{"id":1,"state":{"bri":10000}}}
```

A browser's native WebSocket API cannot set arbitrary handshake headers. Use a suitable client library or a backend rather than assuming the same pairing example will work directly in a browser.

## 6. Finish safely

```sh
unset GATEWAY_TOKEN
```

For integration development, keep only **redacted** response samples. Remove tokens, account data, and household-specific information before committing fixtures.

## Sources

- [Official authentication tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/authentication.md)
- [Official cURL examples](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/tool_curl.md)
- [Official WebSocket tutorial](https://github.com/Feller-AG/wiser-tutorial/blob/main/doc/websocket.md)

Related: [API overview](api-overview.md) · [Sources and open questions](sources.md)
