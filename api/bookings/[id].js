const allowedStatuses = new Set([
  "New",
  "Confirmed",
  "Cleaner assigned",
  "In progress",
  "Completed",
  "Cancelled"
]);
const {
  cancelRemainingAuthorization,
  captureRemainingBalance
} = require("../booking/_payments");

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

async function getBookingRecord(id) {
  const rows = await supabaseRequest(`?id=eq.${encodeURIComponent(id)}&select=*`);
  return Array.isArray(rows) ? rows[0] || null : null;
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

      const booking = await getBookingRecord(id);
      if (!booking) return json(response, 404, { error: "Booking not found." });

      await supabaseRequest(`?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({ status: body.status })
      });

      let payment = { status: "not_applicable" };
      try {
        if (body.status === "Completed") {
          payment = await captureRemainingBalance({ bookingId: id });
        } else if (body.status === "Cancelled") {
          payment = await cancelRemainingAuthorization({ booking });
        }
      } catch (error) {
        payment = { status: "error", error: error.message || "Payment update failed." };
      }

      return json(response, 200, { ok: true, payment });
    }

    if (request.method === "DELETE") {
      const booking = await getBookingRecord(id);
      if (booking) await cancelRemainingAuthorization({ booking });
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
