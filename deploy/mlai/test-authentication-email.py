#!/usr/bin/env python3
# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Exercise authentication email gates without a database, Redis, or email sends."""

import importlib.util
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import django
from django.conf import settings
from django.test import override_settings


ROOT = Path(__file__).resolve().parents[2]
settings.configure(
    **{
        "SECRET_KEY": "authentication-email-test",
        "INSTALLED_APPS": [],
        "REST_FRAMEWORK": {"UNAUTHENTICATED_USER": None},
        "EMAIL_BACKEND": "plane.utils.cloudflare_email.EmailBackend",
        "CLOUDFLARE_EMAIL_ACCOUNT_ID": "a" * 32,
        "CLOUDFLARE_EMAIL_API_TOKEN": "unit-test-token",
        "CLOUDFLARE_EMAIL_FROM": "no-reply@plane.example.com",
    }
)
django.setup()


def load_source(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / "apps/api/plane" / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stub_module(name, **attributes):
    module = ModuleType(name)
    for key, value in attributes.items():
        setattr(module, key, value)
    return module


class CredentialAdapter:
    def __init__(self, **kwargs):
        self.request = kwargs["request"]


class AuthenticationEmailTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = load_source("email_backend_under_test", "utils/cloudflare_email.py")
        cls.errors = load_source("auth_errors_under_test", "authentication/adapter/error.py")
        cls.user = Mock()
        cls.instance = Mock()
        cls.configuration = Mock()
        cls.forgot_password = Mock()
        modules = {
            "plane.utils.cloudflare_email": cls.backend,
            "plane.db.models": stub_module("plane.db.models", User=cls.user),
            "plane.license.models": stub_module("plane.license.models", Instance=cls.instance),
            "plane.license.utils.instance_value": stub_module(
                "plane.license.utils.instance_value", get_configuration_value=cls.configuration
            ),
            "plane.authentication.adapter.error": cls.errors,
            "plane.authentication.adapter.credential": stub_module(
                "plane.authentication.adapter.credential", CredentialAdapter=CredentialAdapter
            ),
            "plane.authentication.rate_limit": stub_module(
                "plane.authentication.rate_limit", AuthenticationThrottle=object
            ),
            "plane.settings.redis": stub_module("plane.settings.redis", redis_instance=Mock()),
            "plane.authentication.utils.host": stub_module(
                "plane.authentication.utils.host", base_host=Mock(return_value="https://plane.example.com")
            ),
            "plane.bgtasks.forgot_password_task": stub_module(
                "plane.bgtasks.forgot_password_task", forgot_password=cls.forgot_password
            ),
        }
        with patch.dict(sys.modules, modules):
            cls.magic = load_source("magic_provider_under_test", "authentication/provider/credentials/magic_code.py")
            cls.checks = [
                load_source("app_check_under_test", "authentication/views/app/check.py").EmailCheckEndpoint,
                load_source("space_check_under_test", "authentication/views/space/check.py").EmailCheckSpaceEndpoint,
            ]
            cls.resets = [
                load_source("app_reset_under_test", "authentication/views/app/password_management.py"),
                load_source("space_reset_under_test", "authentication/views/space/password_management.py"),
            ]

    def setUp(self):
        self.request = SimpleNamespace(data={"email": "member@example.com"})
        self.instance.objects.first.return_value = SimpleNamespace(is_setup_done=True)
        self.user.objects.filter.return_value.first.return_value = SimpleNamespace(
            is_password_autoset=True, first_name="Member", email="member@example.com"
        )
        self.configuration.side_effect = lambda keys: tuple(
            "1" if item["key"] == "ENABLE_MAGIC_LINK_LOGIN" else "" for item in keys
        )
        self.forgot_password.reset_mock()

    def assert_routing(self, expected):
        for endpoint in self.checks:
            for existing in (True, False):
                with self.subTest(endpoint=endpoint.__name__, existing=existing):
                    self.user.objects.filter.return_value.first.return_value = (
                        SimpleNamespace(is_password_autoset=True) if existing else None
                    )
                    response = endpoint().post(self.request)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, {"existing": existing, "status": expected})

    def test_cloudflare_routes_to_magic_code_without_smtp(self):
        self.assert_routing("MAGIC_CODE")

    def test_cloudflare_accepts_magic_provider_without_smtp(self):
        provider = self.magic.MagicCodeProvider(request=self.request, key="member@example.com")
        self.assertEqual(provider.key, "member@example.com")

    def test_password_users_still_route_to_credentials(self):
        self.user.objects.filter.return_value.first.return_value.is_password_autoset = False
        for endpoint in self.checks:
            self.assertEqual(endpoint().post(self.request).data["status"], "CREDENTIAL")

    def test_disabled_magic_login_remains_disabled(self):
        self.configuration.side_effect = lambda keys: tuple("" if k["key"] == "EMAIL_HOST" else "0" for k in keys)
        self.assert_routing("CREDENTIAL")
        with self.assertRaises(self.errors.AuthenticationException) as error:
            self.magic.MagicCodeProvider(request=self.request, key="member@example.com")
        self.assertEqual(error.exception.error_message, "MAGIC_LINK_LOGIN_DISABLED")

    def assert_password_reset_queued(self):
        for module in self.resets:
            endpoint = getattr(module, "ForgotPasswordEndpoint", None) or module.ForgotPasswordSpaceEndpoint
            with self.subTest(endpoint=endpoint.__name__), patch.object(
                module, "generate_password_token", return_value=("uid", "token")
            ):
                self.forgot_password.reset_mock()
                response = endpoint().post(self.request)
                self.assertEqual(response.status_code, 200)
                self.forgot_password.delay.assert_called_once_with(
                    "Member", "member@example.com", "uid", "token", "https://plane.example.com"
                )

    def test_cloudflare_password_reset_queues_existing_task_without_smtp(self):
        self.assert_password_reset_queued()

    def assert_email_unavailable(self):
        self.assert_routing("CREDENTIAL")
        with self.assertRaises(self.errors.AuthenticationException) as error:
            self.magic.MagicCodeProvider(request=self.request, key="member@example.com")
        self.assertEqual(error.exception.error_message, "SMTP_NOT_CONFIGURED")
        for module in self.resets:
            endpoint = getattr(module, "ForgotPasswordEndpoint", None) or module.ForgotPasswordSpaceEndpoint
            response = endpoint().post(self.request)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["error_message"], "SMTP_NOT_CONFIGURED")
        self.forgot_password.delay.assert_not_called()

    def test_incomplete_cloudflare_cannot_use_stale_smtp_configuration(self):
        self.configuration.side_effect = lambda keys: tuple(
            "stale.smtp.example.com" if k["key"] == "EMAIL_HOST" else "1" for k in keys
        )
        for key in ("CLOUDFLARE_EMAIL_ACCOUNT_ID", "CLOUDFLARE_EMAIL_API_TOKEN", "CLOUDFLARE_EMAIL_FROM"):
            with self.subTest(key=key), override_settings(**{key: ""}):
                self.assert_email_unavailable()

    def test_unconfigured_smtp_still_rejected(self):
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"):
            self.assert_email_unavailable()

    def test_configured_smtp_still_supports_magic_login_and_password_reset(self):
        self.configuration.side_effect = lambda keys: tuple(
            "smtp.example.com" if k["key"] == "EMAIL_HOST" else "1" for k in keys
        )
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"):
            self.assert_routing("MAGIC_CODE")
            provider = self.magic.MagicCodeProvider(request=self.request, key="member@example.com")
            self.assertEqual(provider.key, "member@example.com")
            self.user.objects.filter.return_value.first.return_value = SimpleNamespace(
                first_name="Member", email="member@example.com"
            )
            self.assert_password_reset_queued()


if __name__ == "__main__":
    unittest.main()
