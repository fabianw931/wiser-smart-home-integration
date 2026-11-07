"""Pure, conservative API validation and unit conversions."""
import math
import re
import unicodedata
from urllib.parse import urlsplit

IDENTITY = re.compile(r"[a-f0-9]{64}")
CHANNELS = ("red", "green", "blue", "white")
# Native ranges accepted by the workspace API and relayed by its live stream.
STATE_RANGES = {"bri": (0, 10000), "level": (0, 10000), "ct": (1000, 20000),
                "red": (0, 255), "green": (0, 255), "blue": (0, 255), "white": (0, 255)}
# Slider range shown by Home Assistant for tunable white. The API accepts 1000-20000 K, but the fitting's real
# range is unknown here; Home Assistant clamps requests to this narrower, typical range.
TW_MIN_KELVIN = 2000
TW_MAX_KELVIN = 6500
# Only readings whose type and unit the gateway documents are mapped; anything else is skipped, never guessed.
SENSOR_SPECS = {
    ("temperature", "°C"): {"platform": "sensor", "device_class": "temperature", "unit": "°C"},
    ("illuminance", "lux"): {"platform": "sensor", "device_class": "illuminance", "unit": "lx"},
    ("wind", "m/s"): {"platform": "sensor", "device_class": "wind_speed", "unit": "m/s"},
}
BINARY_SENSORS = ("rain", "hail")


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


def ranged(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def native(value, maximum=10000):
    return ranged(value, 0, maximum)


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


def colour_kind(entity):
    """'ct' for tunable white, 'rgbw' for RGB(W) DALI loads, otherwise None (brightness only)."""
    if platform(entity) != "light" or entity.get("type") != "dali":
        return None
    return {"tw": "ct", "rgb": "rgbw"}.get(entity.get("sub_type"))


def kelvin(value):
    """Native colour temperature, or None when the gateway value is missing or out of range."""
    return value if ranged(value, *STATE_RANGES["ct"]) else None


def rgbw(state):
    """(red, green, blue, white) only when all four reported channels are valid."""
    if not isinstance(state, dict):
        return None
    values = tuple(state.get(channel) for channel in CHANNELS)
    return values if all(ranged(value, 0, 255) for value in values) else None


def _integer(value, minimum, maximum, message):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(message)
    value = round(value)
    if not minimum <= value <= maximum:
        raise ValueError(message)
    return value


def turn_on_target(entity, *, brightness_value=None, kelvin_value=None, rgbw_value=None):
    """Native target for a turn-on request, built from a fresh entity.

    Brightness and colour are independent: only fields the user supplied are sent, and colour channels only
    when they differ from the reported colour. An empty result means nothing needs to be sent.
    """
    if platform(entity) != "light" or not valid_state(entity):
        raise ValueError("Load state unavailable")
    state = entity["state"]
    if entity.get("type") == "onoff":
        return {} if state["bri"] == 10000 else {"bri": 10000}
    target = {}
    if brightness_value is not None:
        target["bri"] = target_brightness(brightness_value)
    elif state["bri"] == 0:
        # Turning on without a brightness means full, as for on/off loads; an already-lit load keeps its level.
        target["bri"] = 10000
    kind = colour_kind(entity)
    if kelvin_value is not None:
        if kind != "ct":
            raise ValueError("This light has no colour temperature")
        wanted = _integer(kelvin_value, *STATE_RANGES["ct"], "Invalid colour temperature")
        if kelvin(state.get("ct")) is None:
            raise ValueError("Colour state unavailable; colour command not sent")
        if wanted != state["ct"]:
            target["ct"] = wanted
    if rgbw_value is not None:
        if kind != "rgbw":
            raise ValueError("This light has no RGBW colour")
        if not isinstance(rgbw_value, (tuple, list)) or len(rgbw_value) != 4:
            raise ValueError("Invalid RGBW colour")
        wanted = tuple(_integer(value, 0, 255, "Invalid RGBW colour") for value in rgbw_value)
        reported = rgbw(state)
        if reported is None:
            raise ValueError("Colour state unavailable; colour command not sent")
        target.update({channel: new for channel, new, old in zip(CHANNELS, wanted, reported) if new != old})
    return target


def physical_device(item):
    """Gateway reference of the physical device, or None when absent or malformed."""
    value = item.get("device")
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9]{1,64}", value) else None


def sensor_spec(sensor):
    """Home Assistant mapping for a documented type and unit, otherwise None."""
    kind, unit = sensor.get("type"), sensor.get("unit")
    if not isinstance(kind, str) or not isinstance(unit, str):
        return None
    # The gateway documents the Celsius sign as the single code point U+2103; NFKC turns it into degree + C.
    unit = unicodedata.normalize("NFKC", unit).strip()
    if kind in BINARY_SENSORS and unit == "bool":
        return {"platform": "binary_sensor", "device_class": None, "unit": None}
    return SENSOR_SPECS.get((kind, unit))


def sensor_value(sensor):
    """Reading as a number or bool. Zero and False are real values; anything unusable is None."""
    spec = sensor_spec(sensor)
    value = sensor.get("value")
    if spec is None:
        return None
    if spec["platform"] == "binary_sensor":
        if isinstance(value, bool):
            return value
        return bool(value) if type(value) is int and value in (0, 1) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if spec["device_class"] in ("illuminance", "wind_speed") and value < 0:
        return None
    return value


def sensor_name(sensor):
    value = sensor.get("name")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return f"Wiser {sensor.get('type') or 'sensor'} {sensor.get('device') or sensor.get('id')}"


def identifiable_button(button):
    return physical_device(button) is not None and ranged(button.get("channel"), 0, 2 ** 31)


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
                or not IDENTITY.fullmatch(entity["identity"])):
            raise ValueError("Invalid entity identity")
        ids.add(entity["id"])
    return value


def labels(entity):
    """Display name and room are the user's own; the gateway's originals stay secondary."""
    def text(key):
        value = entity.get(key)
        return value.strip() if isinstance(value, str) and value.strip() else None
    name = text("name") or text("gateway_name") or f"Wiser load {entity.get('id')}"
    return {"name": name, "room": text("room"), "gateway_name": text("gateway_name"), "gateway_room": text("gateway_room")}
