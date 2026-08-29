from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    async def publish(self, event: dict[str, Any]) -> None:
        stale: list[asyncio.Queue[dict[str, Any]]] = []
        for queue in self._subscribers:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                stale.append(queue)
        for queue in stale:
            self._subscribers.discard(queue)

    async def stream(self) -> AsyncIterator[str]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=20)
        self._subscribers.add(queue)
        try:
            yield "retry: 2000\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"event: state\ndata: {json.dumps(event, default=str, separators=(',', ':'))}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subscribers.discard(queue)

