const allowedStatuses = new Set([
  "Submitted",
  "Under review",
  "Approved",
  "Rejected",
  "Suspended"
]);

function json(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  return {
    endpoint: `${url.replace(/\/$/, "")}/rest/v1/cleaner_applications`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    }
  };
}

function assertAdmin(request) {
  const adminToken = process.env.ADMIN_TOKEN;
  const providedToken = request.headers["x-admin-token"];

  return Boolean(adminToken && providedToken && providedToken === adminToken);
}

function getCleanerId(request) {
  const queryId = request.query?.id;
  if (Array.isArray(queryId)) return String(queryId[0] || "");
  if (queryId) return String(queryId);

  const url = new URL(request.url || "", "https://www.imancleaningservice.com");
  const searchId = url.searchParams.get("id");
  if (searchId) return searchId;

  const match = url.pathname.match(/^\/api\/cleaners\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function sanitizeApplication(input) {
  const status = allowedStatuses.has(input.status) ? input.status : "Submitted";

  return {
    id: String(input.id || `CL-${Date.now().toString().slice(-6)}`),
    status,
    full_name: String(input.fullName || input.full_name || ""),
    phone: String(input.phone || ""),
    email: String(input.email || ""),
    city: String(input.city || ""),
    service_area: String(input.serviceArea || input.service_area || ""),
    experience: String(input.experience || ""),
    services: Array.isArray(input.services) ? input.services : [],
    languages: String(input.languages || ""),
    has_insurance: Boolean(input.hasInsurance || input.has_insurance),
    has_transportation: Boolean(input.hasTransportation || input.has_transportation),
    notes: String(input.notes || "")
  };
}

function toClientApplication(record) {
  return {
    id: record.id,
    createdAt: record.created_at,
    status: record.status,
    fullName: record.full_name,
    phone: record.phone,
    email: record.email,
    city: record.city,
    serviceArea: record.service_area,
    experience: record.experience,
    services: record.services || [],
    languages: record.languages,
    hasInsurance: record.has_insurance,
    hasTransportation: record.has_transportation,
    notes: record.notes
  };
}

async function supabaseRequest(path, options = {}) {
  const config = getSupabaseConfig();

  if (!config) {
    const error = new Error("Supabase is not configured.");
    error.code = "SUPABASE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(`${config.endpoint}${path}`, {
    ...options,
    headers: {
      ...config.headers,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || "Supabase request failed.");
    error.statusCode = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

module.exports = async function handler(request, response) {
  try {
    const id = getCleanerId(request);
    if (id) {
      if (!assertAdmin(request)) {
        return json(response, 401, { error: "Admin token required." });
      }

      if (request.method === "PATCH") {
        const body = await readBody(request);

        if (!allowedStatuses.has(body.status)) {
          return json(response, 400, { error: "Invalid status." });
        }

        await supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: {
            Prefer: "return=minimal"
          },
          body: JSON.stringify({ status: body.status })
        });

        return json(response, 200, { ok: true });
      }

      if (request.method === "DELETE") {
        await supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: {
            Prefer: "return=minimal"
          }
        });

        return json(response, 200, { ok: true });
      }

      return json(response, 405, { error: "Method not allowed." });
    }

    if (request.method === "GET") {
      if (!assertAdmin(request)) {
        return json(response, 401, { error: "Admin token required." });
      }

      const records = await supabaseRequest("?select=*&order=created_at.desc");
      return json(response, 200, { applications: records.map(toClientApplication) });
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const application = sanitizeApplication(body);

      if (!application.full_name || !application.phone || !application.email || !application.city || !application.service_area) {
        return json(response, 400, { error: "Name, phone, email, city, and service area are required." });
      }

      const records = await supabaseRequest("", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify(application)
      });

      return json(response, 201, { application: toClientApplication(records[0]) });
    }

    return json(response, 405, { error: "Method not allowed." });
  } catch (error) {
    if (error.code === "SUPABASE_NOT_CONFIGURED") {
      return json(response, 503, {
        error: "Backend is not configured yet.",
        setup: "Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ADMIN_TOKEN in Vercel."
      });
    }

    return json(response, error.statusCode || 500, {
      error: error.message || "Unexpected server error.",
      details: error.details
    });
  }
};
