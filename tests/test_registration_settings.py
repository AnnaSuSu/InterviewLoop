import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.config import settings
from backend.models import LLMSettings, SettingsResponse, SystemSettings, UserSettings
from backend.routers import settings as settings_router
from backend.storage import system_settings as system_settings_store


class SystemSettingsPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.base_dir_patch = patch.object(settings, "base_dir", self.root)
        self.base_dir_patch.start()
        self.original_allow_registration = settings.allow_registration

    def tearDown(self):
        settings.allow_registration = self.original_allow_registration
        self.base_dir_patch.stop()
        self.temp_dir.cleanup()

    def test_saved_registration_flag_survives_runtime_reset(self):
        system_settings_store.save_system_settings(
            SystemSettings(allow_registration=True)
        )
        settings.allow_registration = False

        loaded = system_settings_store.apply_persisted_system_settings()

        self.assertTrue(loaded)
        self.assertTrue(settings.allow_registration)
        saved = json.loads(
            settings.system_settings_path().read_text(encoding="utf-8")
        )
        self.assertEqual(saved, {"allow_registration": True})

    def test_missing_persisted_settings_keep_environment_default(self):
        settings.allow_registration = True

        loaded = system_settings_store.apply_persisted_system_settings()

        self.assertFalse(loaded)
        self.assertTrue(settings.allow_registration)

    def test_admin_settings_update_is_persisted_before_runtime_change(self):
        payload = SettingsResponse(
            llm=LLMSettings(),
            system=SystemSettings(allow_registration=True),
            training=UserSettings(),
        )
        settings.allow_registration = False

        with (
            patch.object(settings_router, "is_admin_user", return_value=True),
            patch.object(settings_router, "embedding_signature", return_value="same"),
            patch.object(settings_router, "save_user_provider"),
            patch.object(settings_router, "reset_embedding_cache"),
            patch.object(settings_router, "save_user_settings"),
            patch.object(settings_router, "save_system_settings") as save_system,
        ):
            settings_router.put_user_settings(payload, user_id="admin-user")

        save_system.assert_called_once_with(payload.system)
        self.assertTrue(settings.allow_registration)


if __name__ == "__main__":
    unittest.main()
