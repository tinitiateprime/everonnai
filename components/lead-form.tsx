"use client";

import { FormEvent, useState } from "react";

export function LeadForm({ kind }: { kind: "demo" | "preview" }) {
  const [submitted, setSubmitted] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="form-success" role="status">
        <strong>Thank you—your request has been received.</strong>
        <br />We’ll use the details you provided to follow up with the right next step.
      </div>
    );
  }

  return (
    <form className="lead-form" onSubmit={submit}>
      <label>Business name<input required name="businessName" autoComplete="organization" /></label>
      <label>Your name<input required name="name" autoComplete="name" /></label>
      <label>Work email<input required type="email" name="email" autoComplete="email" /></label>
      <label>Phone<input required type="tel" name="phone" autoComplete="tel" /></label>
      <label className="form-wide">Current website, if any<input type="url" name="website" placeholder="https://" /></label>
      <label className="consent">
        <input required type="checkbox" name="consent" />
        <span>I agree to receive calls or texts about my request. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.</span>
      </label>
      <button className="button button-primary button-wide" type="submit">
        {kind === "demo" ? "Request a demo" : "Get my free website preview"}
      </button>
      <p className="form-note">Your preview stays private until a verified owner approves publication.</p>
    </form>
  );
}
