"""Conservative brightness-only native lights."""
from homeassistant.components.light import ATTR_BRIGHTNESS, ColorMode, LightEntity
from .entity import WorkspaceEntity
from .model import brightness, target_brightness, platform


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceLight(coordinator, entity) for entity in coordinator.data["entities"]
                       if platform(entity) == "light")


class WorkspaceLight(WorkspaceEntity, LightEntity):
    def __init__(self, coordinator, entity):
        super().__init__(coordinator, entity)
        self.onoff = entity["type"] == "onoff"
        mode = ColorMode.ONOFF if self.onoff else ColorMode.BRIGHTNESS
        self._attr_supported_color_modes = {mode}
        self._attr_color_mode = mode

    @property
    def available(self):
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

    async def async_turn_on(self, **kwargs):
        value = 10000 if self.onoff else target_brightness(kwargs.get(ATTR_BRIGHTNESS, 255))
        await self.coordinator.command(self.load_id, self.identity, {"bri": value})

    async def async_turn_off(self, **kwargs):
        await self.coordinator.command(self.load_id, self.identity, {"bri": 0})
