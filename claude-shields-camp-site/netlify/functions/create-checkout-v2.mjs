// netlify/functions/create-checkout-v2.mjs
//
// Creates a fresh, single-use Stripe Checkout Session on request.
// This is what makes the payment gate real: there is no public,
// bookmarkable, or guessable Stripe payment URL anywhere on the
// site. Every checkout link is generated here, on demand, only
// when this function is called (which the Camper Info Form does
// automatically right after a successful submission).
//
// NOTE: this file replaced the old create-checkout.mjs (same name,
// new file) to force Netlify to build a brand-new function with no
// possible stale/cached bundle — the old one kept serving an outdated
// Price ID even after repeated clean redeploys. If you ever need to
// touch this again, this -v2 file is the real, live one.
//
// Requires one environment variable, set in the Netlify dashboard
// (Site configuration → Environment variables) — never in this file:
//   STRIPE_SECRET_KEY = sk_live_... (or sk_test_... while testing)

import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Price IDs for each registration option. Find these in the
// Stripe Dashboard under Product catalog → click the product → the
// Price ID starts with "price_". See SETUP_INSTRUCTIONS.md section 3.
const PRICE_IDS = {
  session1Early:   "price_REPLACE_SESSION1_EARLY",
  session1Regular: "price_REPLACE_SESSION1_REGULAR",
  session2Early:   "price_REPLACE_SESSION2_EARLY",
  session2Regular: "price_REPLACE_SESSION2_REGULAR",
  elite:           "price_1U1BR3Hk8x31lRhs60JXAT6l"
};

// Same registration window as the rest of the site (kept in sync
// manually with assets/script.js — see note in that file).
const REG_OPENS  = new Date("2027-01-01T00:00:00-05:00");
const EARLY_ENDS = new Date("2027-01-31T23:59:59-05:00");

// Kids Camp hard cap per session — Elite Camp has no cap enforced here.
// This replaces what Ryzer used to do automatically: once a session hits
// this many completed (paid) registrations, new registrants are told the
// session is full instead of being sent to payment. Because their full
// Camper Info Form was already saved to Formspree in the step just before
// this function is called, that submission *is* their waitlist entry —
// no separate waitlist form needed. Just re-check that inbox/spreadsheet
// when a spot opens up.
const KIDS_CAMP_CAP = 120;

function priceIdForSession(sessionKey) {
  if (sessionKey === "elite") return PRICE_IDS.elite;

  const now = new Date();
  if (now < REG_OPENS) return null;

  const tier = now <= EARLY_ENDS ? "Early" : "Regular";
  if (sessionKey === "session-1") return PRICE_IDS["session1" + tier];
  if (sessionKey === "session-2") return PRICE_IDS["session2" + tier];
  return null;
}

// Counts completed (paid) Checkout Sessions tagged with this session key,
// regardless of which price tier (early/regular) they paid under. Stops
// early once it reaches the cap — no need to keep paginating past that.
// Note: Stripe's Search API has a short indexing delay (usually just a
// few seconds), so there's a small chance two people right at the cap
// boundary could both slip through — a minor, acceptable edge case, and
// the same kind of overbooking risk any registration system has.
async function countPaidRegistrations(sessionKey) {
  let count = 0;
  let page;
  do {
    const result = await stripe.checkout.sessions.search({
      query: `status:'complete' AND metadata['session']:'${sessionKey}'`,
      limit: 100,
      page
    });
    count += result.data.length;
    page = result.next_page;
    if (count >= KIDS_CAMP_CAP) break;
  } while (page);
  return count;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400 });
  }

  const sessionKey = body.session;
  const priceId = priceIdForSession(sessionKey);

  if (!priceId) {
    return new Response(
      JSON.stringify({
        error: "Registration opens January 1, 2027. We've saved your info — please check back then to complete payment."
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (sessionKey === "session-1" || sessionKey === "session-2") {
    try {
      const paidCount = await countPaidRegistrations(sessionKey);
      if (paidCount >= KIDS_CAMP_CAP) {
        const sessionLabel = sessionKey === "session-1" ? "Session 1" : "Session 2";
        return new Response(
          JSON.stringify({
            full: true,
            message: sessionLabel + " is full! We've saved your info and added you to the waitlist — we'll reach out by email if a spot opens up."
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    } catch (err) {
      // If the cap check itself fails (e.g. a transient Stripe API issue),
      // fail open rather than blocking a legitimate registration — log it
      // so it's visible in the function logs, but let checkout proceed.
      console.error("Registration cap check error:", err);
    }
  }

  try {
    const origin = new URL(req.url).origin;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: origin + "/payment-success.html",
      cancel_url: origin + (sessionKey === "elite" ? "/elite-registration.html" : "/camper-info.html"),
      metadata: {
        camper_name: (body.camperName || "").slice(0, 200),
        session: sessionKey
      }
    });

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Stripe checkout session error:", err);
    return new Response(
      JSON.stringify({ error: "Could not start payment. Please try again or contact cbshields@peace.edu." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export const config = {
  path: "/api/create-checkout-v2"
};
