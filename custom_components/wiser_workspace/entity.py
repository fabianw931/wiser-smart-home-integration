"""Entities retain their original physical identity for their lifetime."""
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
from .model import labels, sensor_name, sensor_value


class WorkspaceEntity(CoordinatorEntity):
    def __init__(self, coordinator, entity):
        super().__init__(coordinator)
        self.load_id = entity["id"]
        self.identity = entity["identity"]
        self._attr_unique_id = f"{DOMAIN}_{self.identity}"
        first = labels(entity)
        self._attr_name = first["name"]
        # One device per load. The personal room becomes the suggested area only when the device is first created.
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, self.identity)}, name=first["name"], manufacturer="Feller",
                                            model=entity.get("type"), suggested_area=first["room"])

    @property
    def name(self):
        entity = self.current
        return labels(entity)["name"] if entity else self._attr_name

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
        if not entity:
            return {}
        found = labels(entity)
        # Hidden in the default card; visible under the entity's attributes.
        return {"wiser_room": found["room"], "wiser_gateway_name": found["gateway_name"], "wiser_gateway_room": found["gateway_room"]}


class WorkspaceSensorEntity(CoordinatorEntity):
    """A gateway reading; each one is its own HA device, named after the reading."""

    def __init__(self, coordinator, sensor):
        super().__init__(coordinator)
        self.sensor_id = sensor["id"]
        self.identity = sensor["identity"]
        self._attr_unique_id = f"{DOMAIN}_sensor_{self.identity}"
        self._attr_name = sensor_name(sensor)
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, f"sensor_{self.identity}")}, name=self._attr_name,
                                            manufacturer="Feller", model=sensor.get("sub_type") or sensor.get("type"))

    @property
    def current(self):
        return next((sensor for sensor in self.coordinator.data["sensors"]
                     if sensor["id"] == self.sensor_id and sensor["identity"] == self.identity), None)

    @property
    def name(self):
        sensor = self.current
        return sensor_name(sensor) if sensor else self._attr_name

    @property
    def reading(self):
        """Number or bool, or None when the gateway reports nothing usable."""
        sensor = self.current
        return sensor_value(sensor) if sensor else None

    @property
    def available(self):
        return super().available and self.reading is not None
