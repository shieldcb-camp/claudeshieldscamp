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

      // One ID per submission, shared between the sheet row and the Stripe
      // Checkout Session — this is how stripe-webhook.mjs finds the right
      // row to mark "Paid" once payment actually completes. Falls back to
      // a timestamp+random string on the rare browser without
      // crypto.randomUUID (older Safari/iOS versions).
      var registrationId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : "reg-" + Date.now() + "-" + Math.random().toString(36).slice(2);

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
      var formData = new FormData(camperForm);
      fetch(camperForm.action, {
        method: "POST",
        body: formData,
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

          // Also log this registration into the Google Sheet, in parallel.
          // Fire-and-forget — never let a spreadsheet hiccup block payment.
          try {
            var fieldsObj = {};
            formData.forEach(function (value, key) { fieldsObj[key] = value; });
            fetch("/api/save-registration", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ _sheetTarget: sessionValue, fields: fieldsObj, registrationId: registrationId })
            }).catch(function () { /* silent — this is a logging step only */ });
          } catch (e) { /* ignore */ }

          return fetch("/api/create-checkout-v2", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session: sessionValue, camperName: camperName, registrationId: registrationId })
          });
        })
        .then(function (response) { return response.json().then(function (data) { return { ok: response.ok, data: data }; }); })
        .then(function (result) {
          if (result.data.full) {
            // Session is at capacity — their form submission (already saved
            // via Formspree above) doubles as their waitlist entry.
            setSuccessMessage(result.data.message || "This session is full — we've added you to the waitlist.", null);
          } else if (result.ok && result.data.url) {
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

  /* -------------------------------------------------------------
     CAMP LIFE PHOTO LIGHTBOX
     The homepage only shows a handful of gallery thumbnails, but
     every photo (thumbnailed or not) lives in this array so visitors
     can arrow through the full album once they open one. Keep this
     list in sync with data-index attributes in index.html's
     .gallery-item buttons if photos are ever added/removed/reordered.
     ------------------------------------------------------------- */
  var campLifePhotos = [
    { src: "assets/photos/IMG_4652.jpg", alt: "Full camp team photo" },
    { src: "assets/photos/DSC03893.jpg", alt: "Coach huddled up with players" },
    { src: "assets/photos/IMG_0896.jpg", alt: "Campers doing a line drill" },
    { src: "assets/photos/IMG_0885.jpg", alt: "Campers with cucumber slices over their eyes at lunch" },
    { src: "assets/photos/IMG_1269.jpg", alt: "Camper at lunch" },
    { src: "assets/photos/IMG_0887.jpg", alt: "Camper dribbling in the hallway" },
    { src: "assets/photos/camp-life-1.jpg", alt: "Coach Shields kneeling with a young camper on the court" },
    { src: "assets/photos/camp-life-2.jpg", alt: "A group of campers posing with a coach" },
    { src: "assets/photos/camp-life-3.jpg", alt: "Campers piled up celebrating together" },
    { src: "assets/photos/camp-life-5.jpg", alt: "Camper striking a pose mid-drill" }
  ];

  var lightbox = document.getElementById("lightbox");
  if (lightbox) {
    var lightboxImg = document.getElementById("lightbox-img");
    var lightboxCounter = document.getElementById("lightbox-counter");
    var lightboxIndex = 0;

    function showLightboxPhoto(index) {
      lightboxIndex = (index + campLifePhotos.length) % campLifePhotos.length;
      var photo = campLifePhotos[lightboxIndex];
      lightboxImg.src = photo.src;
      lightboxImg.alt = photo.alt;
      lightboxCounter.textContent = (lightboxIndex + 1) + " / " + campLifePhotos.length;
    }

    function openLightbox(index) {
      showLightboxPhoto(index);
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
      lightbox.classList.remove("is-open");
      lightbox.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }

    document.querySelectorAll(".gallery-item").forEach(function (btn) {
      btn.addEventListener("click", function () {
        openLightbox(parseInt(btn.dataset.index, 10) || 0);
      });
    });

    var closeBtn = document.getElementById("lightbox-close");
    var prevBtn = document.getElementById("lightbox-prev");
    var nextBtn = document.getElementById("lightbox-next");
    if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
    if (prevBtn) prevBtn.addEventListener("click", function () { showLightboxPhoto(lightboxIndex - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { showLightboxPhoto(lightboxIndex + 1); });

    // Click the dark backdrop (but not the image itself) to close.
    lightbox.addEventListener("click", function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if (!lightbox.classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showLightboxPhoto(lightboxIndex - 1);
      if (e.key === "ArrowRight") showLightboxPhoto(lightboxIndex + 1);
    });
  }

  /* Current year in footer */
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });
});
