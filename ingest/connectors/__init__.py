"""Offline, file-oriented adapters into the canonical RawEvent envelope."""

from .cap_feed import read_cap
from .jsonl import read_jsonl
from .machine_csv import read_machine_csv
from .odk import read_odk
from .whatsapp_export import read_whatsapp

__all__ = ["read_cap", "read_jsonl", "read_machine_csv", "read_odk", "read_whatsapp"]
