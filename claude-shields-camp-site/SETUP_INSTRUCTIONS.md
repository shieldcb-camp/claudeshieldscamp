# Claude Shields Basketball Camp Website — Setup Guide

Your site is mostly static HTML/CSS/JS, plus **one small serverless function** that creates each Stripe payment session on demand. That function is what makes the "fill out the form first, then pay" rule a real, tamper-proof gate rather than an honor system — there is no public Stripe payment URL anywhere on the site to find, bookmark, or share. Every payment link is generated fresh, once, only after a registration form is successfully submitted.

That one function is also why hosting has to be **Netlify** specifically (see section 5) rather than a plain drag-and-drop static host.

## Status — what's done, what's left

- [x] Elite Camp Price ID — set (`price_1U19AsHwd68VaJ2HFF9e4MJ1`)
- [x] Formspree endpoint — set (`xjybvrza`), used by both `camper-info.html` and `elite-registration.html`
- [ ] Kids Camp Price IDs (4 — Session 1/2 × Early/Regular) — still placeholders in `create-checkout.mjs`. Not urgent: Kids Camp registration doesn't open until Jan 1, 2027 anyway, but these need to be real before then.
- [ ] Site deployed to Netlify (section 5)
- [ ] `STRIPE_SECRET_KEY` set as a Netlify environment variable (section 3)

The last two are what's standing between this and being a live site — everything else is done or not time-sensitive yet.

## 1. Create your Stripe account

1. Go to [stripe.com](https://stripe.com) and sign up as your camp business (or Coach Shields individually, whichever you use for banking).
2. Complete Stripe's identity/business verification — you'll need your bank account and tax info (EIN or SSN) to actually receive payouts.
3. Stay in **Test mode** while you build this out; flip to **Live mode** only once everything is confirmed working.

## 2. Create a Price for each registration option

You need **5 Products/Prices** in Stripe (not Payment Links this time — the function creates the actual checkout page on the fly using these):

| Product | Price | Notes |
|---|---|---|
| Kids Camp — Session 1 (Early Bird) | $425.00 | Available Jan 1–31, 2027 |
| Kids Camp — Session 1 (Regular) | $475.00 | Available Feb 1, 2027 onward |
| Kids Camp — Session 2 (Early Bird) | $425.00 | Available Jan 1–31, 2027 |
| Kids Camp — Session 2 (Regular) | $475.00 | Available Feb 1, 2027 onward |
| Elite Camp | $62.10 | Single price (covers Stripe's fee so you net $60) |

**To create each one:**
1. In the Stripe Dashboard, go to **Product catalog** → **+ Add product**.
2. Name it (e.g. "Kids Camp — Session 1, June 14–17, 2027 (Early Bird)"), set the price as **One time**, and save.
3. Click into the product and copy its **Price ID** — it starts with `price_...` (this is different from the Product ID, which starts with `prod_...`; you want the Price ID).

> Already created the 3 Payment Links from before (Session 1 Early, Session 1 Regular, Session 2 Early)? You don't need to redo those — open each existing Payment Link in the dashboard, click through to its product, and copy the same Price ID from there instead of creating a new one.

## 3. Add the Price IDs and your secret key

**Price IDs** go in one file: `netlify/functions/create-checkout.mjs`, near the top:

```js
const PRICE_IDS = {
  session1Early:   "price_REPLACE_SESSION1_EARLY",
  session1Regular: "price_REPLACE_SESSION1_REGULAR",
  session2Early:   "price_REPLACE_SESSION2_EARLY",
  session2Regular: "price_REPLACE_SESSION2_REGULAR",
  elite:           "price_REPLACE_ELITE"
};
```

Replace each placeholder with the real Price ID and save.

**Your Stripe secret key** (starts with `sk_test_...` or `sk_live_...`) is the one credential that must stay private — it's what lets the function actually create charges. It does **not** go in any file. Instead:

1. Deploy the site to Netlify first (section 5).
2. In the Netlify dashboard, go to **Site configuration → Environment variables → Add a variable**.
3. Key: `STRIPE_SECRET_KEY`. Value: your secret key from the Stripe Dashboard (**Developers → API keys**).
4. Save, then trigger a redeploy so the function picks it up.

This key never needs to be shared with me or typed anywhere in the code — Netlify injects it into the function at runtime.

## 3a. Turning Elite Camp on and off

Elite Camp is a one-day event, so it's set up as an **unlisted page** by default — the file `elite-camp.html` exists and works, but nothing on the homepage links to it. To promote it during your targeted window:

1. Open `index.html` in a text editor.
2. Find this block in the `<nav>` section near the top:
   ```html
   <!-- ELITE CAMP NAV LINK — uncomment the line below during your promotion window -->
   <!-- <li><a href="elite-camp.html">Elite Camp</a></li> -->
   ```
3. Delete the `<!--` and `-->` around the `<li>` line so it becomes active.
4. Do the same thing further down for the matching `<!-- ELITE CAMP FOOTER LINK -->` block if you also want it in the footer.
5. When the promotion window ends, add the `<!--` and `-->` back around those same lines to hide it again — the page itself stays live, just unlinked.

Send me a message any time and I can flip this for you in seconds if you'd rather not touch the code yourself.

## 3b. How the form-then-payment flow works now

There are **two separate, independent registration forms** since Kids Camp and Elite Camp run on completely different calendars:

- `camper-info.html` — Kids Camp only (Session 1 / Session 2), simple fields.
- `elite-registration.html` — Elite Camp only, includes the full recruiting profile (Family, Academic, Athletic sections).

Both work the same way:

1. Parent/player clicks "Register" → lands on the relevant form.
2. They fill it out — camper/player details, health info, emergency contacts, insurance, and (for Elite Camp) the recruiting profile.
3. On submit, the page first saves their info to your email via Formspree (see 3c). Only after that succeeds does it call the Netlify Function, which creates a **brand-new, single-use Stripe Checkout Session** and hands back its URL.
4. They're then shown a "Continue to Payment" button that takes them to that one-time session.

Because that Checkout Session doesn't exist until the function creates it, there's no static payment URL anywhere for someone to find, bookmark, or skip ahead to — this is a real gate, not just a suggested path. If the form is reached before Jan 1, 2027 (registration not open yet), the function returns a message instead of a payment link, and nothing is charged.

## 3c. Camper Info Form (Formspree)

**Formspree setup** (free, no backend code):

1. Go to [formspree.io](https://formspree.io) and sign up (free plan covers 50 submissions/month, which should be plenty).
2. Create a new form, name it something like "Camp Registration Info."
3. Formspree will give you a form endpoint that looks like `https://formspree.io/f/abcd1234`.
4. Open `camper-info.html`, find this line near the top of the `<form>` tag:
   ```html
   action="https://formspree.io/f/REPLACE_WITH_YOUR_FORM_ID"
   ```
   and replace `REPLACE_WITH_YOUR_FORM_ID` with your real ID (e.g. `abcd1234`).
5. Formspree will ask you to confirm your email the first time — do a test submission and check that confirmation.

Every submission lands in your inbox as a clean, readable list, and the Formspree dashboard keeps a running count of submissions — handy for tracking registrations (see next section).

## 3d. Keeping each session at or under 120 registrations

Two layers:

**1. Stripe's built-in payment cap (the hard stop).** Since Checkout Sessions are now created dynamically from a Price ID rather than a static Payment Link, the "limit number of payments" setting doesn't directly apply the same way it does to Payment Links. The reliable equivalent here: check the **Stripe Dashboard → Payments**, filter by product, and watch the count per session. If you want a fully automatic hard stop instead of manual watching, I can add a small check to the function itself (e.g., it refuses to create a new session once it's counted 120 successful payments for that session/price) — that's a quick follow-up if you want it; just say the word.

**2. A visible running count.** The Formspree dashboard shows a live submission count for your Camper Info Form, and since parents fill that out right before paying, it's a good real-time proxy for "how close are we to 120" — check it periodically as sessions fill up so you can post "almost sold out" messaging or get ahead of the waitlist conversation.

If you'd like one single authoritative, always-accurate live count instead of watching two dashboards (or want that automatic 120-payment hard stop built into the function), let me know — both are reasonable next steps and I can build either.

## 4. Fee note

Per your decision: the Kids Camp prices ($425/$475) are what you keep — you're absorbing Stripe's ~2.9% + $0.30 fee out of that. The Elite Camp price ($62.10) already has the fee built in, so you net the full $60.

## 5. Hosting (must be Netlify, for the function to work)

Because this site includes a serverless function, it needs to be deployed in a way that includes `netlify/functions/`, `netlify.toml`, and `package.json` — plain drag-and-drop static hosting (or Netlify Drop) won't run the function. Two ways to deploy on Netlify:

**Option A — Netlify CLI (fastest, no GitHub needed):**
1. Install Node.js if you don't have it ([nodejs.org](https://nodejs.org)).
2. In a terminal, inside this project folder, run:
   ```
   npm install -g netlify-cli
   npm install
   netlify login
   netlify deploy --prod
   ```
3. Follow the prompts (create a new site, publish directory is `.`).

**Option B — Connect a GitHub repo (better for ongoing edits):**
1. Push this folder to a new GitHub repository.
2. In the Netlify dashboard, **Add new site → Import an existing project**, connect the repo.
3. Build settings: no build command needed, publish directory `.`.

Either way, once deployed, add the `STRIPE_SECRET_KEY` environment variable (section 3) and redeploy. Then point your domain (`claudeshieldsbasketballcamp.com`) at the Netlify site — Netlify's docs walk through custom domain setup, or I can help when you're ready.

## 6. Before going live, test end-to-end

1. Deploy with Stripe in **Test mode** and `STRIPE_SECRET_KEY` set to your test secret key.
2. Go through the real flow from `camper-info.html` for each of the 3 sessions, using [Stripe's test card](https://stripe.com/docs/testing) `4242 4242 4242 4242` (any future expiry, any CVC).
3. Confirm the form email arrives, the "Continue to Payment" button appears, and it lands on the correct price.
4. Confirm the payment shows up in your Stripe test dashboard.
5. Switch `STRIPE_SECRET_KEY` in Netlify to your **live** secret key (create live-mode Prices too, and update the Price IDs in `create-checkout.mjs` to the live versions), then redeploy.
6. Do one real small test registration yourself if you want extra peace of mind.

## Files in this folder

```
index.html                       Homepage — Kids Camp info + "Register" starts the flow here
elite-camp.html                    Elite Camp page + registration (unlisted until you activate it — see 3a)
camper-info.html                    Kids Camp registration form (see 3b/3c)
elite-registration.html              Elite Camp registration form + recruiting profile (see 3b/3c)
payment-success.html                 Shown after a successful Stripe payment
kids-camp.html                    Old URL, auto-redirects to index.html (kept so old links don't break)
netlify.toml                     Netlify config (tells it where the function lives)
package.json                     Declares the "stripe" dependency the function needs
netlify/functions/
  create-checkout.mjs               The serverless function — creates each payment session (see 3)
assets/
  style.css                      All site styling
  script.js                       Nav menu, pricing display logic, and the form → payment flow
  logo.png                       Your camp logo
  favicon.ico                      Browser tab icon
  photos/                           Camp photos
  videos/                           Camp highlight clips
```

Send me the Price IDs once you've created them and I can drop them in for you directly, or let me know if you'd rather I walk you through the Stripe dashboard or Netlify deploy step by step.
