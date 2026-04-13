const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

const JOBTREAD_API = "https://api.jobtread.com/pave";
const GRANT_KEY = process.env.JOBTREAD_KEY;
const ORG_ID = "22PKKRUxRtz8";
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

console.log("Grant key starts with:", GRANT_KEY ? GRANT_KEY.substring(0, 8) : "NOT FOUND");
console.log("Cloudinary cloud:", CLOUD_NAME || "NOT FOUND");

async function jtQuery(query) {
  const res = await fetch(JOBTREAD_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const text = await res.text();
  console.log("JobTread response:", text);
  try { return JSON.parse(text); }
  catch (e) { console.error("JobTread returned non-JSON:", text); return null; }
}

// ─── Health check
app.get("/health", (req, res) => res.json({ status: "FXR Server running" }));

// ─── Sign upload (kept as backup)
app.post("/api/sign-upload", (req, res) => {
  const { folder } = req.body;
  const timestamp = Math.round(new Date().getTime() / 1000);
  const params = { folder: folder || "fxr-portfolio", timestamp };
  const str = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + API_SECRET;
  const signature = crypto.createHash("sha1").update(str).digest("hex");
  console.log("Sign upload called, folder:", folder);
  res.json({ signature, timestamp, api_key: API_KEY, cloud_name: CLOUD_NAME });
});

// ─── Get all portfolio photos from Cloudinary
app.get("/api/portfolio", async (req, res) => {
  try {
    const auth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64");
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image?type=upload&prefix=fxr-portfolio&max_results=100`;
    console.log("Fetching Cloudinary:", url);
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const data = await response.json();
    console.log("Cloudinary portfolio response:", JSON.stringify(data).substring(0, 300));
    res.json(data.resources || []);
  } catch (err) {
    console.error("Cloudinary fetch error:", err);
    res.json([]);
  }
});

// ─── Delete photo from Cloudinary
app.post("/api/delete-photo", async (req, res) => {
  const { public_id } = req.body;
  const timestamp = Math.round(new Date().getTime() / 1000);
  const str = `public_id=${public_id}&timestamp=${timestamp}${API_SECRET}`;
  const signature = crypto.createHash("sha1").update(str).digest("hex");
  const formData = new URLSearchParams();
  formData.append("public_id", public_id);
  formData.append("signature", signature);
  formData.append("timestamp", timestamp);
  formData.append("api_key", API_KEY);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/destroy`, {
    method: "POST",
    body: formData
  });
  const data = await response.json();
  res.json({ success: data.result === "ok" });
});

// ─── Submit lead from website form → JobTread
app.post("/api/submit-lead", async (req, res) => {
  const { name, email, phone, address, service, message } = req.body;
  if (!name || !phone || !service) {
    return res.status(400).json({ error: "Name, phone, and service are required." });
  }
  try {
    const customerData = await jtQuery({
      $: { grantKey: GRANT_KEY },
      createAccount: {
        $: { organizationId: ORG_ID, name, type: "customer" },
        createdAccount: { id: {}, name: {} }
      }
    });
    const customerId = customerData?.createAccount?.createdAccount?.id;
    if (!customerId) return res.status(500).json({ error: "Could not create customer in JobTread." });
    console.log(`✅ Customer created: ${customerId}`);

    const locationData = await jtQuery({
      $: { grantKey: GRANT_KEY },
      createLocation: {
        $: { accountId: customerId, name: address || "TBD" },
        createdLocation: { id: {}, name: {} }
      }
    });
    const locationId = locationData?.createLocation?.createdLocation?.id;

    const jobNotes = [
      `Service Requested: ${service}`,
      address ? `Property Address: ${address}` : "",
      email ? `Email: ${email}` : "",
      phone ? `Phone: ${phone}` : "",
      message ? `Notes: ${message}` : "",
    ].filter(Boolean).join("\n");

    const jobData = await jtQuery({
      $: { grantKey: GRANT_KEY },
      createJob: {
        $: { locationId, name: `${service} – ${name}`, description: jobNotes },
        createdJob: { id: {}, name: {} }
      }
    });
    const jobId = jobData?.createJob?.createdJob?.id;
    if (!jobId) return res.status(500).json({ error: "Customer created but job could not be created." });

    console.log(`✅ New lead: ${name} | Job: ${jobId}`);
    return res.json({ success: true, customerId, jobId });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FXR server running on port ${PORT}`));
