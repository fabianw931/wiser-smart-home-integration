"""Position-only blinds; no inferred stop or tilt support."""
from homeassistant.components.cover import ATTR_POSITION, CoverEntity, CoverEntityFeature
from .entity import WorkspaceEntity
from .model import position, target_position, platform


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceCover(coordinator, entity) for entity in coordinator.data["entities"]
                       if platform(entity) == "cover")


class WorkspaceCover(WorkspaceEntity, CoverEntity):
    _attr_supported_features = CoverEntityFeature.OPEN | CoverEntityFeature.CLOSE | CoverEntityFeature.SET_POSITION

    @property
    def current_cover_position(self):
        return position(self.state_values.get("level"))

    @property
    def available(self):
        return super().available and self.current is not None and self.current_cover_position is not None

    @property
    def is_closed(self):
        value = self.current_cover_position
        return value == 0 if value is not None else None

    async def async_open_cover(self, **kwargs):
        await self.coordinator.command(self.load_id, self.identity, {"level": 0})

    async def async_close_cover(self, **kwargs):
        await self.coordinator.command(self.load_id, self.identity, {"level": 10000})

    async def async_set_cover_position(self, **kwargs):
        await self.coordinator.command(self.load_id, self.identity,
                                       {"level": target_position(kwargs[ATTR_POSITION])})
