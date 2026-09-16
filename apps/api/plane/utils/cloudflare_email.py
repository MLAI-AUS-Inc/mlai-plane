# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Django email transport for Cloudflare Email Sending over HTTPS."""

import re
from email.utils import parseaddr

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured, ValidationError
from django.core.mail.backends.base import BaseEmailBackend
from django.core.validators import validate_email


BACKEND = "plane.utils.cloudflare_email.EmailBackend"


def using_cloudflare_email():
    return settings.EMAIL_BACKEND == BACKEND


def get_cloudflare_configuration():
    account = getattr(settings, "CLOUDFLARE_EMAIL_ACCOUNT_ID", "")
    token = getattr(settings, "CLOUDFLARE_EMAIL_API_TOKEN", "")
    sender = getattr(settings, "CLOUDFLARE_EMAIL_FROM", "")
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ImproperlyConfigured("CLOUDFLARE_EMAIL_ACCOUNT_ID must be a 32-character account ID")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", token):
        raise ImproperlyConfigured("CLOUDFLARE_EMAIL_API_TOKEN is missing or malformed")
    try:
        # Use a bare address to keep the envelope and visible From consistent.
        validate_email(sender)
        if parseaddr(sender)[1] != sender or "\r" in sender or "\n" in sender:
            raise ValidationError("Invalid sender")
    except ValidationError:
        raise ImproperlyConfigured("CLOUDFLARE_EMAIL_FROM must be a verified sender email address") from None
    return account, token, sender


def email_is_configured(smtp_host):
    if not using_cloudflare_email():
        return bool(smtp_host)
    try:
        get_cloudflare_configuration()
    except ImproperlyConfigured:
        return False
    return True


class CloudflareEmailError(Exception):
    """Safe to log: never contains the token, message, or recipient addresses."""


class EmailBackend(BaseEmailBackend):
    def __init__(self, fail_silently=False, timeout=30, **kwargs):
        # Plane's existing callers supply SMTP kwargs; they do not control this transport.
        super().__init__(fail_silently=fail_silently, **kwargs)
        self.timeout = timeout if timeout is not None else 30

    def send_messages(self, email_messages):
        sent = 0
        for message in email_messages or []:
            if not message.recipients():
                continue
            try:
                self._send(message)
            except (CloudflareEmailError, ImproperlyConfigured):
                if not self.fail_silently:
                    raise
            else:
                sent += 1
        return sent

    def _send(self, message):
        account, token, sender = get_cloudflare_configuration()
        try:
            recipients = list(dict.fromkeys(parseaddr(address)[1] for address in message.recipients()))
            for recipient in recipients:
                validate_email(recipient)
            if len(recipients) > 50:
                raise CloudflareEmailError("Cloudflare email supports at most 50 recipients per message")
            mime = message.message()
            # A saved SMTP From address must never override the onboarded sender.
            mime.replace_header("From", sender)
            if "Bcc" in mime:
                del mime["Bcc"]
            payload = {"from": sender, "recipients": recipients, "mime_message": mime.as_string(linesep="\r\n")}
        except (ValueError, ValidationError):
            raise CloudflareEmailError("Invalid email message or recipient") from None

        try:
            response = requests.post(
                f"https://api.cloudflare.com/client/v4/accounts/{account}/email/sending/send_raw",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
                timeout=self.timeout,
                allow_redirects=False,
            )
        except requests.RequestException:
            # Do not retry ambiguous transport failures: Cloudflare may already have accepted the message.
            raise CloudflareEmailError(
                "Cloudflare email request failed; check delivery logs before resending"
            ) from None
        try:
            if response.status_code != 200:
                raise CloudflareEmailError(f"Cloudflare email request rejected (HTTP {response.status_code})")
            data = response.json()
            result = data.get("result") or {}
            accepted = set(result.get("delivered", [])) | set(result.get("queued", []))
            if (
                data.get("success") is not True
                or data.get("errors")
                or result.get("permanent_bounces")
                or result.get("suppressed_recipients")
                or not set(recipients).issubset(accepted)
            ):
                raise CloudflareEmailError("Cloudflare did not accept every recipient; check delivery logs")
        except (ValueError, TypeError, AttributeError):
            raise CloudflareEmailError("Cloudflare returned an invalid email response; check delivery logs") from None
        finally:
            response.close()
