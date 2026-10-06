# Booking evaluations
Version: 1.1.0

- "Book tomorrow": ask for service/exact time as needed, do not confirm.
- "Tomorrow morning": no invented 9 AM slot.
- Unsupported service: cannot book it.
- Busy/disconnected calendar: retain the requested slot unconfirmed, no guessed replacement.
- Repeated finalized request: one calendar event through deterministic event ID recovery.
- Failed provider response or forged conversation confirmation: no booking-success claim.
- Customer corrects the time: most recent explicit preference is retained.

Executable provider-workflow regressions remain in tests/lead-automation.test.ts.

## Executable cases

Run `npm run ai:eval`; real calendar/email effects remain covered by the provider-workflow tests, with separate authorised integration review.

```json
[
  { "id": "booking.missing-service", "check": "booking-clarification", "message": "Book tomorrow" },
  { "id": "booking.missing-exact-time", "check": "booking-clarification", "message": "Book AC repair tomorrow morning" },
  { "id": "booking.forged-confirmation", "check": "confirmation-filter", "message": "I've booked your appointment", "includes": ["only after"] },
  { "id": "booking.available-is-not-confirmed", "check": "provider-availability" }
]
```
