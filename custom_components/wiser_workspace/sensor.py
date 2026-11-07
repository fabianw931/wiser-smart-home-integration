"""Numeric readings with documented units only; anything else is not exposed."""
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from .entity import WorkspaceSensorEntity
from .model import sensor_spec

DEVICE_CLASSES = {"temperature": SensorDeviceClass.TEMPERATURE, "illuminance": SensorDeviceClass.ILLUMINANCE,
                  "wind_speed": SensorDeviceClass.WIND_SPEED}


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceSensor(coordinator, sensor, spec) for sensor in coordinator.data["sensors"]
                       if (spec := sensor_spec(sensor)) and spec["platform"] == "sensor")


class WorkspaceSensor(WorkspaceSensorEntity, SensorEntity):
    _attr_state_class = SensorStateClass.MEASUREMENT

    def __init__(self, coordinator, sensor, spec):
        super().__init__(coordinator, sensor)
        self._attr_device_class = DEVICE_CLASSES[spec["device_class"]]
        # model.SENSOR_SPECS units are exactly Home Assistant's "°C", "lx" and "m/s".
        self._attr_native_unit_of_measurement = spec["unit"]

    @property
    def native_value(self):
        return self.reading
