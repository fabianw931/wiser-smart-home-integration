"""Pure, conservative API validation and unit conversions."""
import re
from urllib.parse import urlsplit


def base_url(value):
    """Accept only HTTPS origins; never send credentials to URL userinfo."""
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("URL whitespace and control characters are forbidden")
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise ValueError("An HTTPS origin without credentials or a path is required")
    _ = parsed.port
    return value.rstrip("/")


def native(value, maximum=10000):
    return type(value) is int and 0 <= value <= maximum


def brightness(value):
    if not native(value):
        return None
    return max(1, round(value * 255 / 10000)) if value else 0


def target_brightness(value):
    if not native(value, 255):
        raise ValueError("Invalid brightness")
    return round(value * 10000 / 255)


def position(value):
    return round((10000 - value) / 100) if native(value) else None


def target_position(value):
    if not native(value, 100):
        raise ValueError("Invalid cover position")
    return (100 - value) * 100


def platform(entity):
    if entity.get("unused") is not False:
        return None
    kind = entity.get("type")
    if kind == "motor":
        return "cover"
    if kind in ("onoff", "dim") or (kind == "dali" and entity.get("sub_type") in (None, "", "tw", "rgb")):
        return "light"
    return None


def valid_state(entity):
    state = entity.get("state")
    kind = platform(entity)
    if not isinstance(state, dict) or kind is None:
        return False
    field = "level" if kind == "cover" else "bri"
    value = state.get(field)
    return native(value) and (entity.get("type") != "onoff" or value in (0, 10000))


def snapshot(value):
    """Reject malformed snapshots rather than retaining apparent success."""
    if (not isinstance(value, dict) or type(value.get("version")) is not int or value["version"] != 1
            or not isinstance(value.get("gateway"), str) or not value["gateway"]
            or not isinstance(value.get("scope"), str) or not value["scope"]
            or not isinstance(value.get("entities"), list)):
        raise ValueError("Invalid snapshot")
    ids = set()
    for entity in value["entities"]:
        if (not isinstance(entity, dict) or type(entity.get("id")) is not int
                or entity["id"] < 0 or entity["id"] in ids
                or not isinstance(entity.get("identity"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", entity["identity"])):
            raise ValueError("Invalid entity identity")
        ids.add(entity["id"])
    return value
