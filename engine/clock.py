from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(slots=True)
class SimulationClock:
    start: datetime
    end: datetime
    current: datetime
    playing: bool = False
    speed: float = 60.0

    def command(self, action: str, *, t: datetime | None = None, speed: float | None = None) -> None:
        if action == "play": self.playing = True
        elif action == "pause": self.playing = False
        elif action == "seek":
            if t is None: raise ValueError("seek requires t")
            self.current = min(self.end, max(self.start, t))
        elif action == "speed":
            if speed is None: raise ValueError("speed requires speed")
            self.speed = speed
        elif action == "reset":
            self.current = self.start; self.playing = False

    def advance_wall_second(self) -> datetime:
        self.current = min(self.end, self.current + timedelta(seconds=self.speed))
        if self.current >= self.end:
            self.playing = False
        return self.current

    def payload(self) -> dict[str, object]:
        return {"t": self.current.isoformat(), "start": self.start.isoformat(), "end": self.end.isoformat(), "playing": self.playing, "speed": self.speed}

