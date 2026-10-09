"""Entities retain their original physical identity for their lifetime."""
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN


class WorkspaceEntity(CoordinatorEntity):
    def __init__(self, coordinator, entity):
        super().__init__(coordinator)
        self.load_id = entity["id"]
        self.identity = entity["identity"]
        self._attr_unique_id = f"{DOMAIN}_{self.identity}"
        self._attr_name = entity.get("name") or f"Wiser load {self.load_id}"

    @property
    def name(self):
        entity = self.current
        return entity.get("name") or self._attr_name if entity else self._attr_name

    @property
    def current(self):
        return next((entity for entity in self.coordinator.data["entities"]
                     if entity["id"] == self.load_id and entity["identity"] == self.identity
                     and entity.get("unused") is False), None)

    @property
    def state_values(self):
        entity = self.current
        state = entity.get("state") if entity else None
        return state if isinstance(state, dict) else {}

    @property
    def extra_state_attributes(self):
        entity = self.current
        return {"wiser_room": entity.get("room")} if entity else {}
