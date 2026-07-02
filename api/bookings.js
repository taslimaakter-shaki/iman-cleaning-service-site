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

function sanitizeBooking(input) {
  const estimate = input.estimate || {};
  const status = allowedStatuses.has(input.status) ? input.status : "New";

  return {
    id: String(input.id || `BK-${Date.now().toString().slice(-6)}`),
    status,
    service: String(input.service || ""),
    service_label: String(input.serviceLabel || input.service_label || ""),
    schedule: String(input.schedule || ""),
    schedule_label: String(input.scheduleLabel || input.schedule_label || ""),
    bedrooms_label: String(input.bedroomsLabel || input.bedrooms_label || ""),
    bathrooms_label: String(input.bathroomsLabel || input.bathrooms_label || ""),
    sqft: Number(input.sqft || 0),
    addons: Array.isArray(input.addons) ? input.addons : [],
    client_name: String(input.clientName || input.client_name || ""),
    phone: String(input.phone || ""),
    email: String(input.email || ""),
    address: String(input.address || ""),
    notes: String(input.notes || ""),
    estimate: {
      low: Number(estimate.low || 0),
      high: Number(estimate.high || 0),
      hours: Number(estimate.hours || 0),
      cleanerCount: Number(estimate.cleanerCount || estimate.cleaner_count || 1)
    }
  };
}

function toClientBooking(record) {
  return {
    id: record.id,
    createdAt: record.created_at,
    status: record.status,
    service: record.service,
    serviceLabel: record.service_label,
    schedule: record.schedule,
    scheduleLabel: record.schedule_label,
    bedroomsLabel: record.bedrooms_label,
    bathroomsLabel: record.bathrooms_label,
    sqft: record.sqft,
    addons: record.addons || [],
    clientName: record.client_name,
    phone: record.phone,
    email: record.email,
    address: record.address,
    notes: record.notes,
    estimate: record.estimate || {}
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
    if (request.method === "GET") {
      if (!assertAdmin(request)) {
        return json(response, 401, { error: "Admin token required." });
      }

      const records = await supabaseRequest("?select=*&order=created_at.desc");
      return json(response, 200, { bookings: records.map(toClientBooking) });
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const booking = sanitizeBooking(body);

      if (!booking.client_name || !booking.phone || !booking.email || !booking.address) {
        return json(response, 400, { error: "Name, phone, email, and address are required." });
      }

      const records = await supabaseRequest("", {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify(booking)
      });

      return json(response, 201, { booking: toClientBooking(records[0]) });
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
