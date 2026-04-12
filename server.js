const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const JOBTREAD_API = "https://api.jobtread.com/pave";
const GRANT_KEY = process.env.JOBTREAD_KEY;
const ORG_SLUG = "FXR-Construction-Inc";

// ─── Health check
app.get("/", (req, res) => res.json({ status: "FXR Server running" }));

// ─── Submit lead from website form → JobTread
app.post("/api/submit-lead", async (req, res) => {
  const { name, email, phone, address, service, message } = req.body;

  if (!name || !phone || !service) {
    return res.status(400).json({ error: "Name, phone, and service are required." });
  }

  try {
    // Step 1: Find the organization ID by slug
    const orgRes = await fetch(JOBTREAD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          $: { grantKey: GRANT_KEY },
          organization: {
            $: { urlSlug: ORG_SLUG },
            id: {},
            name: {}
          }
        }
      })
    });

    const orgData = await orgRes.json();
    const orgId = orgData?.organization?.id;

    if (!orgId) {
      console.error("Could not find org ID", orgData);
      return res.status(500).json({ error: "Could not locate JobTread organization." });
    }

    // Step 2: Create the customer in JobTread
    const customerRes = await fetch(JOBTREAD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          $: { grantKey: GRANT_KEY },
          createAccount: {
            $: {
              organizationId: orgId,
              name: name,
              type: "customer",
              email: email || null,
              phone: phone || null,
            },
            createdAccount: {
              id: {},
              name: {}
            }
          }
        }
      })
    });

    const customerData = await customerRes.json();
    const customerId = customerData?.createAccount?.createdAccount?.id;

    if (!customerId) {
      console.error("Could not create customer", customerData);
      return res.status(500).json({ error: "Could not create customer in JobTread." });
    }

    // Step 3: Create a Job linked to the customer
    const jobNotes = [
      service ? `Service Requested: ${service}` : "",
      address ? `Property Address: ${address}` : "",
      message ? `Notes: ${message}` : "",
    ].filter(Boolean).join("\n");

    const jobRes = await fetch(JOBTREAD_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          $: { grantKey: GRANT_KEY },
          createJob: {
            $: {
              organizationId: orgId,
              accountId: customerId,
              name: `${service} – ${name}`,
              description: jobNotes,
            },
            createdJob: {
              id: {},
              name: {}
            }
          }
        }
      })
    });

    const jobData = await jobRes.json();
    const jobId = jobData?.createJob?.createdJob?.id;

    if (!jobId) {
      console.error("Could not create job", jobData);
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
