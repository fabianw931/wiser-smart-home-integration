"""Native lights: on/off, brightness, tunable white (colour temperature) and RGBW."""
from homeassistant.components.light import (ATTR_BRIGHTNESS, ATTR_COLOR_TEMP_KELVIN, ATTR_RGBW_COLOR, ColorMode,
                                            LightEntity)
from .entity import WorkspaceEntity
from .model import (TW_MAX_KELVIN, TW_MIN_KELVIN, brightness, colour_kind, kelvin, platform, rgbw, turn_on_target)


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceLight(coordinator, entity) for entity in coordinator.data["entities"]
                       if platform(entity) == "light")


class WorkspaceLight(WorkspaceEntity, LightEntity):
    def __init__(self, coordinator, entity):
        super().__init__(coordinator, entity)
        self.onoff = entity["type"] == "onoff"
        kind = colour_kind(entity)
        if self.onoff:
            mode = ColorMode.ONOFF
        elif kind == "ct":
            mode = ColorMode.COLOR_TEMP
            self._attr_min_color_temp_kelvin = TW_MIN_KELVIN
            self._attr_max_color_temp_kelvin = TW_MAX_KELVIN
        elif kind == "rgbw":
            mode = ColorMode.RGBW
        else:
            mode = ColorMode.BRIGHTNESS
        self._attr_supported_color_modes = {mode}
        self._attr_color_mode = mode

    @property
    def available(self):
        # Availability depends on brightness only; missing colour state just leaves the colour unknown.
        value = self.state_values.get("bri")
        return (super().available and self.current is not None and brightness(value) is not None
                and (not self.onoff or value in (0, 10000)))

    @property
    def brightness(self):
        return brightness(self.state_values.get("bri"))

    @property
    def is_on(self):
        value = self.brightness
        return value > 0 if value is not None else None

    @property
    def color_temp_kelvin(self):
        return kelvin(self.state_values.get("ct")) if self.color_mode == ColorMode.COLOR_TEMP else None

    @property
    def rgbw_color(self):
        return rgbw(self.state_values) if self.color_mode == ColorMode.RGBW else None

    async def async_turn_on(self, **kwargs):
        # The target is built from the fresh entity inside the command, so only what the user changed is sent.
        await self.coordinator.command(self.load_id, self.identity, lambda fresh: turn_on_target(
            fresh, brightness_value=kwargs.get(ATTR_BRIGHTNESS), kelvin_value=kwargs.get(ATTR_COLOR_TEMP_KELVIN),
            rgbw_value=kwargs.get(ATTR_RGBW_COLOR)))

    async def async_turn_off(self, **kwargs):
        await self.coordinator.command(self.load_id, self.identity, {"bri": 0})
