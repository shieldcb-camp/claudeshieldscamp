// netlify/functions/create-checkout.mjs
//
// Creates a fresh, single-use Stripe Checkout Session on request.
// This is what makes the payment gate real: there is no public,
// bookmarkable, or guessable Stripe payment URL anywhere on the
// site. Every checkout link is generated here, on demand, only
// when this function is called (which the Camper Info Form does
// automatically right after a successful submission).
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
  elite:           "price_1U1OWeHk8x31lRhs0Rg71Qpc"
};

// Same registration window as the rest of the site (kept in sync
// manually with assets/script.js — see note in that file).
const REG_OPENS  = new Date("2027-01-01T00:00:00-05:00");
const EARLY_ENDS = new Date("2027-01-31T23:59:59-05:00");

function priceIdForSession(sessionKey) {
  if (sessionKey === "elite") return PRICE_IDS.elite;

  const now = new Date();
  if (now < REG_OPENS) return null;

  const tier = now <= EARLY_ENDS ? "Early" : "Regular";
  if (sessionKey === "session-1") return PRICE_IDS["session1" + tier];
  if (sessionKey === "session-2") return PRICE_IDS["session2" + tier];
  return null;
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

  try {
    const origin = new URL(req.url).origin;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: origin + "/payment-success.html",
      cancel_url: origin + "/camper-info.html",
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
  path: "/api/create-checkout"
};
