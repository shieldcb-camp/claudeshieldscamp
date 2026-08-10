// Claude Shields Basketball Camp — shared site behavior

/* -------------------------------------------------------------
   PAYMENT
   Actual Stripe Checkout Sessions are created server-side by the
   Netlify Function at netlify/functions/create-checkout.mjs — this
   keeps every payment link single-use and un-guessable (nothing
   static to bookmark or share). This file just calls that function.
   See SETUP_INSTRUCTIONS.md section 3 for the Price IDs it needs.
   ------------------------------------------------------------- */

/* Registration window for the kids camp early-bird price.
   Registration opens Jan 1, 2027. Early bird runs through Jan 31;
   regular pricing applies Feb 1 onward. Runs on the visitor's
   local clock, so this updates itself automatically every year. */
var REG_OPENS   = new Date("2027-01-01T00:00:00-05:00");
var EARLY_ENDS  = new Date("2027-01-31T23:59:59-05:00");
var EARLY_PRICE = "$425";
var REG_PRICE   = "$475";

function kidsPricingStatus() {
  var now = new Date();
  if (now < REG_OPENS) return { state: "not-open" };
  if (now <= EARLY_ENDS) return { state: "early", price: EARLY_PRICE };
  return { state: "regular", price: REG_PRICE };
}

document.addEventListener("DOMContentLoaded", function () {
  /* Mobile nav toggle */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("open");
    });
  }

  /* Highlight current page in nav */
  var here = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(function (a) {
    var href = a.getAttribute("href");
    if (href === here || (here === "" && href === "index.html")) {
      a.classList.add("active");
    }
  });

  /* -------------------------------------------------------------
     KIDS CAMP PRICING DISPLAY (homepage session cards)
     Shows the current price/status and points the "Register"
     button at the Camper Info Form — payment happens after the
     form, not before. Session number is passed via data-session.
     ------------------------------------------------------------- */
  document.querySelectorAll("[data-kids-pricing]").forEach(function (el) {
    var status = kidsPricingStatus();
    var amountEl = el.querySelector("[data-amount]");
    var noteEl   = el.querySelector("[data-price-note]");
    var statusEl = el.querySelector("[data-reg-status]");
    var buttonEl = el.querySelector("[data-register-btn]");

    if (status.state === "not-open") {
      if (amountEl) amountEl.textContent = REG_PRICE;
      if (noteEl) noteEl.textContent = "Early bird pricing (" + EARLY_PRICE + ") opens January 1, 2027.";
      if (statusEl) statusEl.innerHTML = '<span class="dot" style="background:#b3541e"></span> Registration opens Jan 1, 2027';
      if (buttonEl) {
        buttonEl.textContent = "Registration Opens Jan 1";
        buttonEl.classList.add("is-disabled");
        buttonEl.removeAttribute("href");
      }
    } else if (status.state === "early") {
      if (amountEl) amountEl.textContent = EARLY_PRICE;
      if (noteEl) noteEl.textContent = "Early bird price — locked in through January 31, 2027. Regular price is " + REG_PRICE + ".";
      if (statusEl) statusEl.innerHTML = '<span class="dot"></span> Early bird registration open';
      if (buttonEl) buttonEl.classList.remove("is-disabled");
    } else {
      if (amountEl) amountEl.textContent = REG_PRICE;
      if (noteEl) noteEl.textContent = "Early bird pricing has ended for this season.";
      if (statusEl) statusEl.innerHTML = '<span class="dot"></span> Registration open';
      if (buttonEl) buttonEl.classList.remove("is-disabled");
    }
  });

  /* -------------------------------------------------------------
     REGISTRATION FORMS
     camper-info.html (Kids Camp) and elite-registration.html
     (Elite Camp) are two separate, independent forms — each has
     its own "camper-form" element, so this code applies to
     whichever one is on the current page. Both submit to Formspree
     via fetch, then request a fresh Stripe Checkout Session, so
     payment always happens after the form — never before.
     ------------------------------------------------------------- */
  var camperForm = document.getElementById("camper-form");
  if (camperForm) {
    /* Pre-select session from ?session=session-1 / session-2 (Kids Camp only —
       Elite Camp's session is a fixed hidden field, nothing to pre-select). */
    var params = new URLSearchParams(window.location.search);
    var presetSession = params.get("session");
    if (presetSession) {
      var radio = camperForm.querySelector('input[name="Session"][data-key="' + presetSession + '"]');
      if (radio) radio.checked = true;
    }

    /* -----------------------------------------------------------
       Kids Camp registration isn't open until Jan 1, 2027 — keep
       camper-info.html from being usable until then. Only applies
       when this page actually has the Session 1/2 radio buttons
       (i.e. does nothing on elite-registration.html).
       ----------------------------------------------------------- */
    var hasKidsSessionRadios = camperForm.querySelector('input[name="Session"][data-key="session-1"]');
    if (hasKidsSessionRadios && kidsPricingStatus().state === "not-open") {
      camperForm.style.display = "none";
      var closedEl = document.getElementById("form-closed");
      if (closedEl) closedEl.style.display = "block";
    }

    camperForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var submitBtn = camperForm.querySelector("button[type=submit]");
      var originalText = submitBtn.textContent;
      submitBtn.textContent = "Submitting…";
      submitBtn.disabled = true;

      // Kids Camp: a checked radio. Elite Camp: a fixed hidden field.
      var sessionField = camperForm.querySelector('input[name="Session"]:checked, input[name="Session"][type="hidden"]');
      var sessionValue = sessionField ? sessionField.dataset.key : null;
      var nameField = document.getElementById("name");
      var camperName = nameField ? nameField.value : "";

      function showFailure(message) {
        alert(message || "Something went wrong submitting the form. Please try again or email cbshields@peace.edu.");
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }

      function revealSuccess() {
        camperForm.style.display = "none";
        var success = document.getElementById("form-success");
        if (success) success.style.display = "block";
        window.scrollTo({ top: 0, behavior: "smooth" });
        return success;
      }

      function setSuccessMessage(text, payUrl) {
        var success = document.getElementById("form-success");
        if (!success) return;
        var msgEl = success.querySelector("[data-success-message]");
        var payBtn = success.querySelector("[data-pay-btn]");
        if (msgEl) msgEl.textContent = text;
        if (payBtn) {
          if (payUrl) {
            payBtn.href = payUrl;
            payBtn.textContent = "Continue to Payment";
            payBtn.style.display = "inline-flex";
          } else {
            payBtn.style.display = "none";
          }
        }
      }

      // Step 1: save the camper's info (Formspree — goes to your email).
      fetch(camperForm.action, {
        method: "POST",
        body: new FormData(camperForm),
        headers: { Accept: "application/json" }
      })
        .then(function (response) {
          if (!response.ok) {
            return response.json().then(function (data) {
              var msg = (data && data.errors) ? data.errors.map(function (err) { return err.message; }).join(", ") : null;
              var e = new Error(msg || "Could not save your info. Please try again.");
              e.stage = "save";
              throw e;
            });
          }
          // Step 2: info is saved — now (and only now) request a fresh,
          // single-use Stripe Checkout Session from our serverless function.
          revealSuccess();
          setSuccessMessage("Info received — creating your secure payment link…", null);

          return fetch("/api/create-checkout-v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session: sessionValue, camperName: camperName })
          });
        })
        .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok && result.data.url) {
            setSuccessMessage("Thanks! Last step — complete payment to lock in your spot.", result.data.url);
          } else {
            setSuccessMessage(result.data.error || "Thanks! We've saved your info. Please check back to complete payment, or contact cbshields@peace.edu.", null);
          }
        })
        .catch(function (err) {
          if (err && err.stage === "save") {
            // Info was never saved — form is still visible, let them retry.
            showFailure(err.message);
          } else {
            // Info was saved but the payment step failed to start.
            setSuccessMessage("Thanks! We've saved your info, but couldn't start payment automatically. Please contact cbshields@peace.edu to complete your registration.", null);
          }
        });
    });
  }

  /* Current year in footer */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
});
