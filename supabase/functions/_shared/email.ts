// PROMPT 34 Stage 1 pre-flight finding, fixed here: the "mailer" was never actually a shared
// module - intake-brief's Resend call was inline in its own handler, with no reusable function
// anywhere. "Reuse the existing mailer" therefore means extracting it now, not copying its
// pattern into a second inline implementation (which would be a second mailer in substance, even
// if it looked similar). This is the ONE place either caller sends an email through.
//
// Also fixes the failure-recording gap found in the same pre-flight: a failure was only ever
// console.error'd, never persisted. sendEmail always writes to email_log (success or failure)
// before returning - "a notification nobody knows failed is worse than none," now true for both
// callers, not just the new one.

export interface SendEmailParams {
  supabase: any;
  orgId: string | null;
  purpose: string;
  toEmail: string;
  fromAddress?: string;
  fromName?: string;
  subject: string;
  html: string;
  text: string;
  relatedTable?: string;
  relatedId?: string;
}

export interface SendEmailResult {
  ok: boolean;
  errorText: string | null;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const {
    supabase, orgId, purpose, toEmail, subject, html, text, relatedTable, relatedId,
  } = params;
  // theautodata.com is the verified sending domain in Resend (intake-brief's original comment,
  // preserved: deliberately not the BACKUP_FROM secret, which is monthly-backup's own admin-
  // facing sender identity for a different audience).
  const fromAddress = params.fromAddress ?? "noreply@theautodata.com";
  const fromName = params.fromName ?? "Caplimo";

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    await logEmail(supabase, orgId, purpose, toEmail, subject, relatedTable, relatedId, 'failed', 'Missing RESEND_API_KEY');
    return { ok: false, errorText: 'Missing RESEND_API_KEY' };
  }

  try {
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${fromName} <${fromAddress}>`,
        to: [toEmail],
        reply_to: fromAddress,
        subject,
        html,
        text,
      }),
    });

    if (resendResponse.ok) {
      await logEmail(supabase, orgId, purpose, toEmail, subject, relatedTable, relatedId, 'sent', null);
      return { ok: true, errorText: null };
    }

    const errText = await resendResponse.text();
    await logEmail(supabase, orgId, purpose, toEmail, subject, relatedTable, relatedId, 'failed', errText);
    return { ok: false, errorText: errText };
  } catch (err) {
    const errText = (err as Error).message;
    await logEmail(supabase, orgId, purpose, toEmail, subject, relatedTable, relatedId, 'failed', errText);
    return { ok: false, errorText: errText };
  }
}

async function logEmail(
  supabase: any,
  orgId: string | null,
  purpose: string,
  recipientEmail: string,
  subject: string,
  relatedTable: string | undefined,
  relatedId: string | undefined,
  status: 'sent' | 'failed',
  errorText: string | null
): Promise<void> {
  try {
    await supabase.from('email_log').insert({
      org_id: orgId,
      purpose,
      recipient_email: recipientEmail,
      subject,
      related_table: relatedTable ?? null,
      related_id: relatedId ?? null,
      status,
      error_text: errorText,
    });
  } catch (e) {
    // Logging the log failure is the last resort - never let a logging failure mask the
    // original send result from the caller.
    console.error("email.ts: failed to write email_log row:", e);
  }
}
