const allowedStatuses = new Set([
  "New",
  "Confirmed",
  "Cleaner assigned",
  "In progress",
  "Completed",
  "Cancelled"
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
    endpoint: `${url.replace(/\/$/, "")}/rest/v1/bookings`,
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
    if (!assertAdmin(request)) {
      return json(response, 401, { error: "Admin token required." });
    }

    const id = request.query.id;

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
