"""Identify buttons: flash a physical wall button's LED. Press events are not available yet."""
from homeassistant.components.button import ButtonDeviceClass, ButtonEntity
from homeassistant.const import EntityCategory
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN
from .model import button_name, identifiable_button, physical_device


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    async_add_entities(WorkspaceIdentifyButton(coordinator, button) for button in coordinator.data["buttons"]
                       if identifiable_button(button))


class WorkspaceIdentifyButton(CoordinatorEntity, ButtonEntity):
    _attr_device_class = ButtonDeviceClass.IDENTIFY
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_entity_registry_enabled_default = False

    def __init__(self, coordinator, button):
        super().__init__(coordinator)
        self.identity = button["identity"]
        self._attr_unique_id = f"{DOMAIN}_button_{self.identity}_identify"
        self._attr_name = f"{button_name(button)} identify"
        device = physical_device(button)
        # One HA device per physical button device (all of its channels); gateway-scoped like load identities.
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, f"{coordinator.entry.unique_id}_button_{device}")},
                                            name=f"Wiser button {device}", manufacturer="Feller",
                                            model=button.get("sub_type") or button.get("type"))

    @property
    def current(self):
        return next((button for button in self.coordinator.data["buttons"] if button["identity"] == self.identity), None)

    @property
    def name(self):
        button = self.current
        return f"{button_name(button)} identify" if button else self._attr_name

    @property
    def available(self):
        return super().available and self.current is not None

    async def async_press(self):
        await self.coordinator.identify(self.identity)
