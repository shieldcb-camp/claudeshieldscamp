// netlify/functions/stripe-webhook.mjs
//
// Listens for Stripe telling us a payment actually completed, and flips
// the matching row in the Google Sheet from "Pending" to "Paid" — this is
// what lets you glance at the sheet and instantly see who has (and hasn't)
// paid, instead of manually cross-referencing 120 Kids Camp form
// submissions against the Stripe dashboard by hand.
//
// How the pieces connect:
//   1. assets/script.js generates a unique Registration ID when the form
//      is submitted, and sends it to save-registration.mjs (which writes
//      a new sheet row with Payment Status = "Pending") and separately to
//      create-checkout-v2.mjs (which attaches it to the Stripe Checkout
//      Session as metadata.registration_id).
//   2. When the parent actually completes payment on Stripe's page, Stripe
//      calls THIS function with a checkout.session.completed event.
//   3. This function looks up that same Registration ID in the Sheet and
//      updates Payment Status to "Paid" (column C) with a timestamp
//      (column D). See netlify/functions/lib/google-sheets.mjs for the
//      lookup/update logic.
//
// Requires two environment variables (Site configuration → Environment
// variables) in addition to the existing STRIPE_SECRET_KEY:
//   STRIPE_WEBHOOK_SECRET   starts with "whsec_" — generated when you add
//                             this endpoint in the Stripe Dashboard
//                             (Developers → Webhooks → Add endpoint).
//                             See SETUP_INSTRUCTIONS.md section 3f.
//
// Also requires GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_SHEET_ID (already
// set up for save-registration.mjs — this function reuses them).

import Stripe from "stripe";
import { markRowPaid } from "./lib/google-sheets.mjs";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function sheetNameForSession(sessionKey) {
  if (sessionKey === "session-1" || sessionKey === "session-2") {
    return "Kids Camp Registrations";
  }
  return "Elite Camp Registrations";
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const rawBody = await req.text();

  if (!webhookSecret) {
    console.error("stripe-webhook: Missing STRIPE_WEBHOOK_SECRET env var.");
    // Return 200 so Stripe doesn't retry forever over a config problem —
    // this just means payment-status tracking is paused until it's set.
    return new Response("Webhook not configured", { status: 200 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("stripe-webhook: signature verification failed.", String(err));
    return new Response("Invalid signature", { status: 400 });
  }

  // Only checkout.session.completed matters here — that's Stripe telling
  // us the Checkout Session finished (for card payments, that means paid).
  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const session = event.data.object;

  if (session.payment_status !== "paid") {
    // e.g. a delayed payment method still processing — nothing to mark yet.
    return new Response(JSON.stringify({ received: true, note: "not yet paid" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const registrationId = session.metadata && session.metadata.registration_id;
  const sessionKey = session.metadata && session.metadata.session;

  if (!registrationId) {
    // Older registrations (from before this tracking existed) won't have
    // one — nothing to update, not an error.
    return new Response(JSON.stringify({ received: true, note: "no registration_id in metadata" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const sheetName = sheetNameForSession(sessionKey);

  try {
    const found = await markRowPaid(sheetName, registrationId, new Date().toISOString());
    return new Response(JSON.stringify({ received: true, updated: found }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    // Log for visibility, but still return 200 — Stripe will otherwise
    // keep retrying this webhook, and a spreadsheet hiccup shouldn't turn
    // into a flood of retries. Worst case, you spot the "Pending" row
    // manually and can cross-check Stripe directly for that one.
    console.error("stripe-webhook: markRowPaid failed.", String(err));
    return new Response(JSON.stringify({ received: true, error: String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/api/stripe-webhook"
};
