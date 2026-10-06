// netlify/functions/lib/google-sheets.mjs
//
// Shared Google Sheets + auth helpers used by both save-registration.mjs
// (appends new rows) and stripe-webhook.mjs (updates a row's payment
// status once Stripe confirms payment). Kept in one place so the
// hard-won private-key/PEM handling only has to be right once.
//
// Requires environment variables, set in the Netlify dashboard
// (Site configuration → Environment variables) — never in this file:
//   GOOGLE_SERVICE_ACCOUNT_JSON    the ENTIRE contents of the downloaded
//                                    service-account .json key file, pasted
//                                    as-is (open the file, Select All, Copy,
//                                    paste the whole thing as one value).
//   GOOGLE_SHEET_ID                the long ID in your Google Sheet's URL
//                                    (a full URL is also fine — it gets
//                                    extracted automatically).
//
// (Older setup, still supported as a fallback: separate
// GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars.)

import crypto from "node:crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps fetch() with a couple of quick retries for transient failures —
// Google's APIs occasionally return a brief 503 "service unavailable" or
// 429 "rate limited" under normal, healthy operation (this is what caused
// a real registration to silently not save on Aug 28). Only retries on
// those transient statuses (and network-level failures); a 4xx like a bad
// auth token or malformed request fails immediately since retrying won't
// help. Short fixed backoff (400ms, 1200ms) keeps this well within
// Netlify's function timeout even in the worst case.
async function fetchWithRetry(url, options, label) {
  const delays = [400, 1200];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 503 || res.status === 429) {
        if (attempt < delays.length) {
          console.error("google-sheets: " + label + " got " + res.status + ", retrying in " + delays[attempt] + "ms (attempt " + (attempt + 1) + ")");
          await sleep(delays[attempt]);
          continue;
        }
      }
      return res;
    } catch (err) {
      // Network-level failure (fetch itself threw) — also worth a retry.
      lastErr = err;
      if (attempt < delays.length) {
        console.error("google-sheets: " + label + " network error, retrying in " + delays[attempt] + "ms (attempt " + (attempt + 1) + ")", String(err));
        await sleep(delays[attempt]);
        continue;
      }
    }
  }
  throw lastErr || new Error(label + " failed after retries.");
}

// Reads the service account's email + private key from env vars, preferring
// the single-JSON-blob method (GOOGLE_SERVICE_ACCOUNT_JSON) since it can't
// be partially/wrongly selected the way a raw PEM block can. Falls back to
// the older split GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY vars,
// with defensive cleanup of common copy/paste corruption.
function getServiceAccountCredentials() {
  const jsonBlob = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (jsonBlob && jsonBlob.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(jsonBlob.trim());
    } catch (err) {
      console.error(
        "google-sheets: GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.",
        "length:", jsonBlob.length,
        "starts with:", JSON.stringify(jsonBlob.trim().slice(0, 20)),
        "ends with:", JSON.stringify(jsonBlob.trim().slice(-20))
      );
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — paste the entire downloaded .json key file, unmodified.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key — paste the entire downloaded .json key file, unmodified.");
    }
    return { email: parsed.client_email, key: parsed.private_key };
  }

  // --- Fallback: older split-variable setup ---
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let key = process.env.GOOGLE_PRIVATE_KEY || "";

  if (!email || !key) {
    throw new Error("Missing Google credentials — set GOOGLE_SERVICE_ACCOUNT_JSON (recommended) or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.");
  }

  key = key.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  key = key.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
  key = key.trim();

  if (!key.includes("-----BEGIN PRIVATE KEY-----") || !key.includes("-----END PRIVATE KEY-----")) {
    console.error(
      "google-sheets: GOOGLE_PRIVATE_KEY doesn't look like a valid PEM key.",
      "length:", key.length,
      "starts with:", JSON.stringify(key.slice(0, 20)),
      "ends with:", JSON.stringify(key.slice(-20))
    );
    throw new Error("GOOGLE_PRIVATE_KEY is not a valid PEM-formatted private key — check the Netlify env var value.");
  }

  return { email, key };
}

// Exchanges the service account's private key for a short-lived Google
// API access token. Standard OAuth2 "JWT bearer" flow, done by hand with
// Node's built-in crypto module so no extra npm dependency is needed.
export async function getAccessToken() {
  const { email, key } = getServiceAccountCredentials();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  };

  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claims));

  let signature;
  try {
    signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  } catch (signErr) {
    console.error(
      "google-sheets: crypto.sign failed.",
      "key length:", key.length,
      "line count:", key.split("\n").length,
      "error:", String(signErr)
    );
    throw signErr;
  }
  const jwt = unsigned + "." + signature;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  if (!res.ok) {
    throw new Error("Google auth failed: " + (await res.text()));
  }

  const data = await res.json();
  return data.access_token;
}

// Resolves GOOGLE_SHEET_ID — tolerant of a full sheet URL, stray quotes,
// or whitespace, same defensive cleanup that fixed the private key issue.
export function resolveSheetId() {
  let sheetId = process.env.GOOGLE_SHEET_ID || "";
  sheetId = sheetId.trim();
  if ((sheetId.startsWith('"') && sheetId.endsWith('"')) || (sheetId.startsWith("'") && sheetId.endsWith("'"))) {
    sheetId = sheetId.slice(1, -1).trim();
  }
  const urlMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) {
    sheetId = urlMatch[1];
  }
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID env var.");
  return sheetId;
}

export async function appendRow(sheetName, rowValues) {
  const sheetId = resolveSheetId();
  const accessToken = await getAccessToken();
  const range = encodeURIComponent(sheetName + "!A1");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) +
    "/values/" + range + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [rowValues] })
  }, "appendRow");

  if (!res.ok) {
    const bodyText = await res.text();
    console.error(
      "google-sheets: append failed.",
      "status:", res.status,
      "sheetId length:", sheetId.length,
      "sheetName:", sheetName,
      "response (first 300 chars):", bodyText.slice(0, 300)
    );
    throw new Error("Sheets append failed (status " + res.status + "): " + bodyText.slice(0, 300));
  }
}

// Finds the row whose Registration ID column (column B) matches
// `registrationId`, and updates its Payment Status (C) and Paid At (D)
// columns. Used by stripe-webhook.mjs once Stripe confirms payment.
// Returns true if a matching row was found and updated, false otherwise.
export async function markRowPaid(sheetName, registrationId, paidAtIso) {
  if (!registrationId) return false;

  const sheetId = resolveSheetId();
  const accessToken = await getAccessToken();

  // Read the whole Registration ID column to find the matching row.
  const colRange = encodeURIComponent(sheetName + "!B:B");
  const getUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) +
    "/values/" + colRange;

  const getRes = await fetchWithRetry(getUrl, {
    headers: { Authorization: "Bearer " + accessToken }
  }, "markRowPaid lookup");

  if (!getRes.ok) {
    const bodyText = await getRes.text();
    console.error(
      "google-sheets: markRowPaid lookup failed.",
      "status:", getRes.status,
      "sheetName:", sheetName,
      "response (first 300 chars):", bodyText.slice(0, 300)
    );
    throw new Error("Sheets lookup failed (status " + getRes.status + "): " + bodyText.slice(0, 300));
  }

  const getData = await getRes.json();
  const values = getData.values || [];
  // values[0] is row 1 (header, if present). Find the first exact match.
  let rowNumber = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] && values[i][0] === registrationId) {
      rowNumber = i + 1; // Sheets rows are 1-indexed.
      break;
    }
  }

  if (!rowNumber) {
    console.error("google-sheets: markRowPaid found no matching row.", "sheetName:", sheetName, "registrationId:", registrationId);
    return false;
  }

  const updateRange = encodeURIComponent(sheetName + "!C" + rowNumber + ":D" + rowNumber);
  const updateUrl = "https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sheetId) +
    "/values/" + updateRange + "?valueInputOption=USER_ENTERED";

  const updateRes = await fetchWithRetry(updateUrl, {
    method: "PUT",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [["Paid", paidAtIso]] })
  }, "markRowPaid update");

  if (!updateRes.ok) {
    const bodyText = await updateRes.text();
    console.error(
      "google-sheets: markRowPaid update failed.",
      "status:", updateRes.status,
      "sheetName:", sheetName,
      "rowNumber:", rowNumber,
      "response (first 300 chars):", bodyText.slice(0, 300)
    );
    throw new Error("Sheets update failed (status " + updateRes.status + "): " + bodyText.slice(0, 300));
  }

  return true;
}
