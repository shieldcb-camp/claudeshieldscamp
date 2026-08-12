// netlify/functions/save-registration.mjs
//
// Automatically logs every camper/registration form submission into a
// Google Sheet, replacing what Ryzer used to do on its own. This runs
// alongside (not instead of) the existing Formspree email step — if
// this fails for any reason, it should never block or interrupt the
// registration/payment flow, since the email to Formspree is already
// the authoritative save at that point.
//
// Requires three environment variables, set in the Netlify dashboard
// (Site configuration → Environment variables) — never in this file:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL   the service account's "client_email"
//   GOOGLE_PRIVATE_KEY             the service account's "private_key"
//                                    (paste it with the \n characters intact —
//                                    this code converts them to real newlines)
//   GOOGLE_SHEET_ID                the long ID in your Google Sheet's URL,
//                                    e.g. docs.google.com/spreadsheets/d/<THIS PART>/edit
//
// See SETUP_INSTRUCTIONS.md section 3e for the one-time setup walkthrough
// (creating the service account, sharing the sheet with it, etc).

import crypto from "node:crypto";

// Column order for each sheet tab — these must be created as tabs named
// exactly "Kids Camp Registrations" and "Elite Camp Registrations" in
// your Google Sheet (see SETUP_INSTRUCTIONS.md). The strings below are
// the exact `name="..."` attributes used in camper-info.html / elite-registration.html —
// if you ever add or rename a form field, update the matching list here too.
const KIDS_FIELDS = [
  "Camper Name", "Date of Birth", "Age as of Event", "Grade as of Fall 2027",
  "Height", "Gender", "T-Shirt Size", "Session",
  "Address", "Cell Phone", "City", "State", "Zip",
  "Parent/Guardian Email", "Participant Email",
  "Food Allergies", "Medical Conditions",
  "Emergency Contact 1 Name", "Emergency Contact 1 Relationship", "Emergency Contact 1 Phone",
  "Emergency Contact 2 Name", "Emergency Contact 2 Relationship", "Emergency Contact 2 Phone",
  "Insurance Company", "Insurance Phone", "Policy Number", "Policy Holder",
  "Waiver Acknowledged"
];

const ELITE_FIELDS = [
  "Camper Name", "Date of Birth", "High School Graduation Year", "Height", "Weight",
  "Gender", "T-Shirt Size", "Session",
  "Address", "Cell Phone", "City", "State", "Zip", "Email Address",
  "Parent/Guardian 1 Name", "Parent/Guardian 1 Phone", "Parent/Guardian 1 Email",
  "Parent/Guardian 2 Name", "Parent/Guardian 2 Phone", "Parent/Guardian 2 Email",
  "Siblings",
  "High School", "High School City/State", "School Phone", "Class Rank", "GPA", "Student Type",
  "SAT Math", "SAT Critical Reading", "SAT Writing", "SAT Total", "ACT", "Entry Term",
  "Academic Honors", "Other College Choices", "Transcripts",
  "Position", "Tournaments Attending", "Game Schedule", "Recruiting Website", "YouTube Link",
  "HS Coach Name", "HS Coach Phone", "HS Coach Email",
  "AAU Team Name", "AAU Coach Name", "AAU Coach Phone", "AAU Coach Email",
  "Food Allergies", "Medical Conditions",
  "Emergency Contact 1 Name", "Emergency Contact 1 Relationship", "Emergency Contact 1 Phone",
  "Emergency Contact 2 Name", "Emergency Contact 2 Relationship", "Emergency Contact 2 Phone",
  "Insurance Company", "Insurance Phone", "Policy Number", "Policy Holder",
  "Waiver Acknowledged"
];

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

// Exchanges the service account's private key for a short-lived Google
// API access token. This is a standard OAuth2 "JWT bearer" flow, done
// by hand here with Node's built-in crypto module so no extra npm
// dependency (like googleapis) is needed for something this small.
async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || "";
  const key = rawKey.replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env vars.");
  }

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
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
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

async function appendRow(sheetName, rowValues) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID env var.");

  const accessToken = await getAccessToken();
  const range = encodeURIComponent(sheetName + "!A1");
  const url = "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId +
    "/values/" + range + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [rowValues] })
  });

  if (!res.ok) {
    throw new Error("Sheets append failed: " + (await res.text()));
  }
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

  const target = body._sheetTarget;
  const fields = body.fields || {};
  const isKids = target === "session-1" || target === "session-2";
  const sheetName = isKids ? "Kids Camp Registrations" : "Elite Camp Registrations";
  const columnKeys = isKids ? KIDS_FIELDS : ELITE_FIELDS;

  const timestamp = new Date().toISOString();
  const row = [timestamp].concat(columnKeys.map((key) => fields[key] || ""));

  try {
    await appendRow(sheetName, row);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    // Log the error for visibility, but always return a soft-success
    // response — a spreadsheet-logging hiccup should never surface as
    // a problem to a parent registering their kid for camp.
    console.error("save-registration error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
};

export const config = {
  path: "/api/save-registration"
};
