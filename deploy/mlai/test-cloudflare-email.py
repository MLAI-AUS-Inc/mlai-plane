#!/usr/bin/env python3
"""Run the real email backend with mocked HTTP, without Plane startup or a database."""

import importlib.util
import json
from email import message_from_string
from io import StringIO
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock, patch

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.management import CommandError
from django.test import override_settings
import requests


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "cloudflare_email_under_test", ROOT / "apps/api/plane/utils/cloudflare_email.py"
)
backend = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = backend
SPEC.loader.exec_module(backend)
settings.configure(
    **{
        "DEFAULT_CHARSET": "utf-8",
        "DEFAULT_FROM_EMAIL": "old-smtp@example.com",
        "EMAIL_BACKEND": backend.BACKEND,
        "CLOUDFLARE_EMAIL_ACCOUNT_ID": "a" * 32,
        "CLOUDFLARE_EMAIL_API_TOKEN": "unit-test-token",
        "CLOUDFLARE_EMAIL_FROM": "no-reply@plane.example.com",
    }
)


def load_source(name, relative_path):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CloudflareEmailTests(unittest.TestCase):
    def setUp(self):
        self.post = self.enterContext(patch.object(backend.requests, "post"))
        self.response = Mock(status_code=200)
        self.response.json.return_value = {
            "success": True,
            "errors": [],
            "result": {"delivered": ["member@example.com"], "queued": []},
        }
        self.post.return_value = self.response
        self.connection = get_connection(
            backend="cloudflare_email_under_test.EmailBackend",
            host="ignored-smtp.example.com",
            port=587,
            username="ignored",
            password="ignored",
            use_tls=True,
        )

    def message(self, **kwargs):
        return EmailMultiAlternatives(
            subject="Join MLAI — invitation",
            body="Your invite: https://plane.example.com/invite?token=test",
            from_email="Old SMTP <old@example.com>",
            to=["member@example.com"],
            connection=self.connection,
            **kwargs,
        )

    def test_mime_preserves_html_attachments_reply_to_and_bcc_privacy(self):
        message = self.message(
            cc=["CC Person <cc@example.com>"],
            bcc=["private@example.com"],
            reply_to=["support@example.com"],
            headers={"From": "stale@example.com", "Bcc": "private@example.com"},
        )
        message.attach_alternative("<p>Your invitation</p>", "text/html")
        message.attach("report.csv", b"name,value\nexample,2\n", "text/csv")
        message.attach("data.bin", b"\x00\xff\n\r\x80", "application/octet-stream")
        self.response.json.return_value["result"]["queued"] = ["cc@example.com", "private@example.com"]
        self.assertEqual(message.send(), 1)
        args, kwargs = self.post.call_args
        self.assertEqual(args[0], f"https://api.cloudflare.com/client/v4/accounts/{'a' * 32}/email/sending/send_raw")
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["timeout"], 30)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer unit-test-token")
        payload = kwargs["json"]
        self.assertEqual(payload["from"], "no-reply@plane.example.com")
        self.assertEqual(payload["recipients"], ["member@example.com", "cc@example.com", "private@example.com"])
        mime = message_from_string(payload["mime_message"])
        self.assertEqual(mime["From"], payload["from"])
        self.assertIsNone(mime["Bcc"])
        self.assertNotIn("private@example.com", payload["mime_message"])
        self.assertEqual(mime["Reply-To"], "support@example.com")
        self.assertIn("text/html", [part.get_content_type() for part in mime.walk()])
        attachment = next(part for part in mime.walk() if part.get_filename() == "report.csv")
        self.assertEqual(attachment.get_payload(decode=True), b"name,value\r\nexample,2\r\n")
        binary = next(part for part in mime.walk() if part.get_filename() == "data.bin")
        self.assertEqual(binary.get_payload(decode=True), b"\x00\xff\n\r\x80")
        self.assertEqual(message.from_email, "Old SMTP <old@example.com>")
        self.response.close.assert_called_once()

    def test_empty_messages_and_recipients_do_not_send(self):
        self.assertEqual(self.connection.send_messages(None), 0)
        self.assertEqual(self.connection.send_messages([]), 0)
        message = self.message()
        message.to = []
        self.assertEqual(self.connection.send_messages([message]), 0)
        self.post.assert_not_called()

    def test_provider_errors_redirects_and_timeouts_do_not_leak_details_or_retry(self):
        for status in (301, 400, 401, 403, 429, 500):
            with self.subTest(status=status):
                self.post.reset_mock()
                self.response.status_code = status
                self.response.text = "unit-test-token member@example.com invitation-token"
                with self.assertRaisesRegex(backend.CloudflareEmailError, f"HTTP {status}") as error:
                    self.message().send()
                self.assertNotIn("unit-test-token", str(error.exception))
                self.assertNotIn("member@example.com", str(error.exception))
                self.post.assert_called_once()
        self.post.reset_mock()
        self.post.side_effect = requests.Timeout("unit-test-token member@example.com")
        with self.assertRaisesRegex(backend.CloudflareEmailError, "check delivery logs"):
            self.message().send()
        self.post.assert_called_once()

    def test_rejections_partial_delivery_and_malformed_responses_fail(self):
        for data in (
            {"success": False, "result": {}},
            {"success": True, "errors": [{"message": "private"}], "result": {}},
            {"success": True, "result": {"permanent_bounces": ["member@example.com"]}},
            {"success": True, "result": {"suppressed_recipients": ["member@example.com"]}},
            {"success": True, "result": {"queued": ["other@example.com"]}},
            {"success": True, "result": {"delivered": None}},
            {"success": True, "result": None},
            [],
        ):
            with self.subTest(data=data):
                self.response.json.return_value = data
                with self.assertRaises(backend.CloudflareEmailError):
                    self.message().send()
        self.response.json.side_effect = json.JSONDecodeError("invalid", "", 0)
        with self.assertRaises(backend.CloudflareEmailError):
            self.message().send()

    def test_fail_silently_counts_only_accepted_messages(self):
        self.connection.fail_silently = True
        failure = Mock(status_code=503)
        self.post.side_effect = [failure, self.response]
        self.assertEqual(self.connection.send_messages([self.message(), self.message()]), 1)

    def test_configuration_and_compatibility_flag(self):
        self.assertTrue(backend.email_is_configured(""))
        for key, value in (
            ("CLOUDFLARE_EMAIL_ACCOUNT_ID", ""),
            ("CLOUDFLARE_EMAIL_ACCOUNT_ID", "../another-account"),
            ("CLOUDFLARE_EMAIL_API_TOKEN", ""),
            ("CLOUDFLARE_EMAIL_API_TOKEN", "token\nheader"),
            ("CLOUDFLARE_EMAIL_FROM", ""),
            ("CLOUDFLARE_EMAIL_FROM", "Sender <sender@example.com>"),
            ("CLOUDFLARE_EMAIL_FROM", "sender@example.com\nBcc:other@example.com"),
        ):
            with self.subTest(key=key, value=value), override_settings(**{key: value}):
                self.assertFalse(backend.email_is_configured("stale.smtp.example.com"))
                with self.assertRaises(ImproperlyConfigured):
                    self.message().send()
        self.post.assert_not_called()
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend"):
            self.assertFalse(backend.using_cloudflare_email())
            self.assertFalse(backend.email_is_configured(""))
            self.assertTrue(backend.email_is_configured("smtp.example.com"))

    def test_recipient_validation_and_limit(self):
        for recipients in (["not-an-address"], [f"member{i}@example.com" for i in range(51)]):
            message = self.message()
            message.to = recipients
            with self.assertRaises(backend.CloudflareEmailError):
                message.send()
        self.post.assert_not_called()

    def test_queued_delivery_and_explicit_timeout(self):
        self.connection.timeout = 12
        self.response.json.return_value["result"] = {"queued": ["member@example.com"]}
        self.assertEqual(self.message().send(), 1)
        self.assertEqual(self.post.call_args.kwargs["timeout"], 12)

    def test_instance_configuration_uses_cloudflare_without_reading_saved_smtp(self):
        models = ModuleType("plane.license.models")
        models.InstanceConfiguration = Mock()
        encryption = ModuleType("plane.license.utils.encryption")
        encryption.decrypt_data = Mock()
        with patch.dict(
            sys.modules,
            {
                "plane.license.models": models,
                "plane.license.utils.encryption": encryption,
                "plane.utils.cloudflare_email": backend,
            },
        ):
            instance_value = load_source("instance_value_under_test", "apps/api/plane/license/utils/instance_value.py")
        self.assertEqual(
            instance_value.get_email_configuration(),
            ("api.cloudflare.com", "", "", 443, "0", "0", "no-reply@plane.example.com"),
        )
        models.InstanceConfiguration.objects.values.assert_not_called()
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend", SKIP_ENV_VAR=True):
            models.InstanceConfiguration.objects.values.return_value = [
                {"key": "EMAIL_HOST", "value": "saved.smtp.example.com", "is_encrypted": False},
                {"key": "EMAIL_FROM", "value": "saved@example.com", "is_encrypted": False},
            ]
            config = instance_value.get_email_configuration()
            self.assertEqual(config[0], "saved.smtp.example.com")
            self.assertEqual(config[-1], "saved@example.com")

    def test_management_command_fails_on_rejected_or_unsent_email(self):
        instance_value = ModuleType("plane.license.utils.instance_value")
        instance_value.get_email_configuration = lambda: ("ignored", "", "", 443, "0", "0", "sender@example.com")
        with patch.dict(sys.modules, {"plane.license.utils.instance_value": instance_value}):
            command = load_source("test_email_under_test", "apps/api/plane/db/management/commands/test_email.py")
        with (
            patch.object(command, "render_to_string", return_value="<p>Test</p>"),
            patch.object(command, "get_connection", return_value=self.connection),
        ):
            self.response.status_code = 403
            with self.assertRaises(CommandError):
                command.Command(stdout=StringIO()).handle(to_email="member@example.com")
            self.connection.fail_silently = True
            with self.assertRaises(CommandError):
                command.Command(stdout=StringIO()).handle(to_email="member@example.com")
            self.response.status_code = 200
            command.Command(stdout=StringIO()).handle(to_email="member@example.com")


if __name__ == "__main__":
    unittest.main()
