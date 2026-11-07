"""Integration constants."""
DOMAIN = "wiser_workspace"
CONF_HOST = "host"
CONF_PORT = "port"
CONF_SSL = "ssl"
CONF_TOKEN = "token"
DEFAULT_PORT = 3443
# Fallback poll; the events stream is the primary update path. Sensors are only updated by snapshots.
POLL_INTERVAL = 30
# The app sends a heartbeat every ~20 s; three missed beats mean the link is dead.
EVENT_IDLE_TIMEOUT = 60
# Commands reuse coordinator data younger than this and refresh otherwise.
FRESH_SECONDS = 5
