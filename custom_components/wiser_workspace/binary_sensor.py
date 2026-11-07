"""Rain and hail flags."""
from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity
from .entity import WorkspaceSensorEntity
from .model import sensor_spec

# Home Assistant has no rain or hail device class; moisture (wet/dry) is the closest fit for rain only.
DEVICE_CLASSES = {"rain": BinarySensorDeviceClass.MOISTURE}


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceBinarySensor(coordinator, sensor) for sensor in coordinator.data["sensors"]
                       if (spec := sensor_spec(sensor)) and spec["platform"] == "binary_sensor")


class WorkspaceBinarySensor(WorkspaceSensorEntity, BinarySensorEntity):
    def __init__(self, coordinator, sensor):
        super().__init__(coordinator, sensor)
        self._attr_device_class = DEVICE_CLASSES.get(sensor.get("type"))

    @property
    def is_on(self):
        return self.reading
