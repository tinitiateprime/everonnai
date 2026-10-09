// Ported from main: features/voice-agent/appointment-time.ts. Converts a wall-clock time in
// an IANA time zone to UTC, rejecting times that do not exist or repeat at clock changes.
function partsAt(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
  };
}

export function localDateTimeToUtc(value: string, timeZone: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) throw new Error("The appointment date and time are incomplete.");
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] || 0),
  };
  const desiredUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  if (!Number.isFinite(desiredUtc))
    throw new Error("The appointment date and time are invalid.");
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = partsAt(new Date(candidate), timeZone);
    const representedUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second,
    );
    candidate += desiredUtc - representedUtc;
  }
  const date = new Date(candidate);
  const actual = partsAt(date, timeZone);
  if (
    Object.keys(desired).some(
      (key) =>
        desired[key as keyof typeof desired] !==
        actual[key as keyof typeof actual],
    )
  ) {
    throw new Error(
      "The requested local time does not exist in the business time zone.",
    );
  }
  for (const offset of [-120, -60, -30, 30, 60, 120]) {
    const alternate = partsAt(new Date(candidate + offset * 60_000), timeZone);
    if (
      Object.keys(desired).every(
        (key) =>
          desired[key as keyof typeof desired] ===
          alternate[key as keyof typeof alternate],
      )
    ) {
      throw new Error(
        "The requested local time is ambiguous because the clocks change. Choose another time.",
      );
    }
  }
  return date;
}
