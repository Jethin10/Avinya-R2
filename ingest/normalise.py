from __future__ import annotations

import re
import unicodedata


def text(value: str | None) -> str | None:
    if value is None:
        return None
    value = unicodedata.normalize("NFC", value).replace("\u200b", "").replace("\u200d", "")
    return re.sub(r"\s+", " ", value).strip()

