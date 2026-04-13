const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const JOBTREAD_API = "https://api.jobtread.com/pave";
const GRANT_KEY = process.env.JOBTREAD_KEY;
const ORG_ID = "22PKKRUxRtz8";

// ─── Helper to call JobTread API safely
async function jtQuery(query) {
  const res = await fetch(JOBTREAD_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  const text = await res.text();
  console.log("JobTread response:", text);
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("JobTread returned non-JSON:", text);
    return null;
  }
}

// ─── Health check
app.get("/health", (req, res) => res.json({ status: "FXR Server running" }));

// ─── Submit lead from website form → JobTread
app.post("/api/submit-lead", async (req, res) => {
  const { name, email, phone, address, service, message } = req.body;

  if (!name || !phone || !service) {
    return res.status(400).json({ error: "Name, phone, and service are required." });
  }

  try {
    // Step 1: Create customer
    const customerData = await jtQuery({
      $: { grantKey: GRANT_KEY },
      createAccount: {
        $: {
             organizationId: ORG_ID,
          name: name,
          type: "customer",
        },
        createdAccount: { id: {}, name: {} }
      }
    });

    const customerId = customerData?.createAccount?.createdAccount?.id;
    if (!customerId) {
      console.error("Could not create customer:", JSON.stringify(customerData));
      return res.status(500).json({ error: "Could not create customer in JobTread." });
    }
    console.log(`✅ Customer created: ${customerId}`);

    // Step 2: Create job
    const jobNotes = [
      service ? `Service Requested: ${service}` : "",
      address ? `Property Address: ${address}` : "",
      message ? `Notes: ${message}` : "",
    ].filter(Boolean).join("\n");

    const jobData = await jtQuery({
      $: { grantKey: GRANT_KEY },
      createJob: {
        $: {
          organizationId: ORG_ID,
          accountId: customerId,
          name: `${service} – ${name}`,
          description: jobNotes,
        },
        createdJob: { id: {}, name: {} }
      }
    });

    const jobId = jobData?.createJob?.createdJob?.id;
    if (!jobId) {
      console.error("Could not create job:", JSON.stringify(jobData));
      return res.status(500).json({ error: "Customer created but job could not be created." });
    }

    console.log(`✅ New lead: ${name} | Job: ${jobId}`);
    return res.json({ success: true, customerId, jobId });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`FXR server running on port ${PORT}`));
