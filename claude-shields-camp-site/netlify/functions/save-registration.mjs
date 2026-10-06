// netlify/functions/save-registration.mjs
//
// Automatically logs every camper/registration form submission into a
// Google Sheet, replacing what Ryzer used to do on its own. This runs
// alongside (not instead of) the existing Formspree email step — if
// this fails for any reason, it should never block or interrupt the
// registration/payment flow, since the email to Formspree is already
// the authoritative save at that point.
//
// Requires environment variables, set in the Netlify dashboard
// (Site configuration → Environment variables) — never in this file:
//   GOOGLE_SERVICE_ACCOUNT_JSON    the ENTIRE contents of the downloaded
//                                    service-account .json key file, pasted
//                                    as-is (open the file, Select All, Copy,
//                                    paste the whole thing as one value —
//                                    this is the recommended method, since
//                                    there's no substring to select wrong).
//   GOOGLE_SHEET_ID                the long ID in your Google Sheet's URL,
//                                    e.g. docs.google.com/spreadsheets/d/<THIS PART>/edit
//
// (Older setup, still supported as a fallback: separate
// GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY env vars.)
//
// See SETUP_INSTRUCTIONS.md section 3e for the one-time setup walkthrough
// (creating the service account, sharing the sheet with it, etc).

import { appendRow } from "./lib/google-sheets.mjs";

// Kids Camp rows start with three tracking columns, then the form fields:
//   A Timestamp | B Registration ID | C Payment Status | D Paid At | E... form fields
// stripe-webhook.mjs finds the row by Registration ID (column B) and flips
// C to "Paid" and fills D once Stripe confirms payment. Elite Camp rows are
// unchanged: Timestamp + form fields.
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
  const fieldValues = columnKeys.map((key) => fields[key] || "");
  const row = isKids
    ? [timestamp, String(body.registrationId || "").slice(0, 100), "Pending", ""].concat(fieldValues)
    : [timestamp].concat(fieldValues);

  try {
    await appendRow(sheetName, row);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    // Soft-success: a spreadsheet hiccup must never surface to a parent.
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
