import type { Contact, Lead, Appointment } from "@/features/everonn/types";
import type { LeadCaptureInput } from "@/features/everonn/lead-capture";

export type CaptureResponse = { saved: boolean; lead: Lead; contact: Contact; appointment?: Appointment | null; automationError?: string };

export function createLeadCaptureQueue(options: { requestId: string; workspaceId?: string; previewToken?: string; publicSlug?: string; fetchImpl?: typeof fetch }) {
  let pending: Promise<CaptureResponse | null> = Promise.resolve(null);
  let lastSignature = "";
  return (input: Omit<LeadCaptureInput, "requestId">) => {
    const signature = JSON.stringify(input);
    if (signature === lastSignature) return pending;
    lastSignature = signature;
    const operation = pending.catch(() => null).then(async () => {
      const response = await (options.fetchImpl || fetch)("/api/site-assistant/lead", {
        method: "POST",
        keepalive: input.finalize === true,
        headers: { "Content-Type": "application/json", ...(options.workspaceId ? { "x-everonn-workspace": options.workspaceId } : {}) },
        body: JSON.stringify({ ...input, requestId: options.requestId, previewToken: options.previewToken, publicSlug: options.publicSlug }),
      });
      const data = await response.json() as CaptureResponse & { error?: string };
      if (!response.ok || !data.saved || !data.lead || !data.contact) throw new Error(data.error || "Your request could not be saved. Please try again.");
      return data;
    });
    pending = operation;
    void operation.catch(() => { if (lastSignature === signature) lastSignature = ""; });
    return operation;
  };
}
