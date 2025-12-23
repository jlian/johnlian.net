type KVNamespace = {
  put(key: string, value: string, options?: { metadata?: Record<string, unknown> }): Promise<void>;
};

type PagesFunction<Env = unknown> = (context: { request: Request; env: Env }) => Promise<Response>;

type Env = {
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  CONTACT_TO_EMAIL?: string;
  CONTACT_FROM_EMAIL?: string;
  CONTACT_MESSAGES?: KVNamespace;
};

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const CONTACT_BANNER_CONTAINER_ID = "contact-messages";
const CONTACT_BANNER_SUCCESS_ID = "contact-success";
const CONTACT_BANNER_ERROR_ID = "contact-error";

const CONTACT_BANNER_SUCCESS_CLASS_VISIBLE = "pa3 mv3 bg-washed-green dark-green br2";
const CONTACT_BANNER_SUCCESS_CLASS_HIDDEN = "dn pa3 mv3 bg-washed-green dark-green br2";
const CONTACT_BANNER_ERROR_CLASS_VISIBLE = "pa3 mv3 bg-washed-red dark-red br2";
const CONTACT_BANNER_ERROR_CLASS_HIDDEN = "dn pa3 mv3 bg-washed-red dark-red br2";

const CONTACT_BANNER_SUCCESS_MESSAGE = "Message sent successfully. Thank you for reaching out!";
const CONTACT_BANNER_ERROR_MESSAGE = "Something went wrong sending your message. Please try again later.";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  try {
    const { name, email, message, turnstileToken } = await parseContactForm(request);
    if (!name || !email || !message) {
      return errorResponse(request, "Missing required fields", 400);
    }

    const turnstileResult = await validateTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request);
    if (!turnstileResult.ok) {
      return errorResponse(request, turnstileResult.message, 400);
    }

    // Store (best-effort) for auditing/debugging.
    await storeMessage(env.CONTACT_MESSAGES, {
      name,
      email,
      message,
      turnstile: turnstileResult.valid,
      userAgent: request.headers.get("user-agent") || undefined,
      referer: request.headers.get("referer") || undefined,
    });

    const emailStatus = await sendEmail(request, env, { name, email, message });

    if (!emailStatus.ok) {
      console.error("Email send failed", { status: emailStatus.status, message: emailStatus.message });
      return errorResponse(request, "Email send failed", 502);
    }

    if (isHtmxRequest(request)) {
      return contactBannerHtmlResponse({ ok: true });
    }

    return nonHtmxNotSupportedResponse();
  } catch (err) {
    console.error("Unhandled exception in /api/contact", err);

    return errorResponse(request, "Internal Server Error", 500);
  }
};

async function parseContactForm(request: Request): Promise<{
  name: string;
  email: string;
  message: string;
  turnstileToken: string;
}> {
  // Cloudflare Workers generally support request.formData() for both
  // multipart/form-data and application/x-www-form-urlencoded.
  try {
    const form = await request.formData();
    return {
      name: (form.get("name") || "").toString().trim(),
      email: (form.get("email") || "").toString().trim(),
      message: (form.get("message") || "").toString().trim(),
      turnstileToken: (form.get("cf-turnstile-response") || "").toString().trim(),
    };
  } catch (e) {
    // Fallback for odd encodings.
    console.error("Failed to parse form data", e);
    const text = await request.text();
    const params = new URLSearchParams(text);
    return {
      name: (params.get("name") || "").toString().trim(),
      email: (params.get("email") || "").toString().trim(),
      message: (params.get("message") || "").toString().trim(),
      turnstileToken: (params.get("cf-turnstile-response") || "").toString().trim(),
    };
  }
}

function errorResponse(request: Request, message: string, status: number) {
  if (isHtmxRequest(request)) {
    return contactBannerHtmlResponse({ ok: false, status });
  }

  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
}

function nonHtmxNotSupportedResponse() {
  return new Response("This contact form requires JavaScript (HTMX) to submit.", {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
  });
}

function isHtmxRequest(request: Request): boolean {
  // HTMX sends HX-Request: true for AJAX requests.
  return request.headers.get("HX-Request") === "true";
}

function contactBannerHtmlResponse(result: { ok: boolean; status?: number }) {
  const successClass = result.ok ? CONTACT_BANNER_SUCCESS_CLASS_VISIBLE : CONTACT_BANNER_SUCCESS_CLASS_HIDDEN;
  const errorClass = result.ok ? CONTACT_BANNER_ERROR_CLASS_HIDDEN : CONTACT_BANNER_ERROR_CLASS_VISIBLE;

  const html = `
<div id="${CONTACT_BANNER_CONTAINER_ID}">
  <div id="${CONTACT_BANNER_SUCCESS_ID}" class="${successClass}">
    ${CONTACT_BANNER_SUCCESS_MESSAGE}
  </div>
  <div id="${CONTACT_BANNER_ERROR_ID}" class="${errorClass}">
    ${CONTACT_BANNER_ERROR_MESSAGE}
  </div>
</div>`.trim();

  return new Response(html, {
    status: result.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      // Avoid caching of a one-off interaction response.
      "Cache-Control": "no-store",
      // If any intermediary caching exists, vary by HTMX-ness.
      Vary: "HX-Request",
    },
  });
}

async function validateTurnstile(token: string, secret: string | undefined, request: Request) {
  if (!token) {
    console.warn("Turnstile token missing");
    return { ok: false, valid: false, message: "Captcha required" };
  }

  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY not configured");
    return { ok: false, valid: false, message: "Captcha validation unavailable" };
  }

  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip: request.headers.get("CF-Connecting-IP") || "",
  });

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("Turnstile verification HTTP failure", {
      status: response.status,
      body: text ? text.slice(0, 500) : "",
    });
    return { ok: false, valid: false, message: "Captcha validation failed" };
  }

  const verification = (await response.json()) as { success?: boolean; ["error-codes"]?: string[] };
  if (!verification.success) {
    console.error("Turnstile verification rejected", {
      errors: verification["error-codes"],
    });
    return { ok: false, valid: false, message: "Captcha verification failed" };
  }

  return { ok: true, valid: true, message: "" };
}

async function sendEmail(
  request: Request,
  env: Pick<Env, "RESEND_API_KEY" | "CONTACT_TO_EMAIL" | "CONTACT_FROM_EMAIL">,
  payload: { name: string; email: string; message: string },
) {
  const apiKey = env.RESEND_API_KEY;
  const to = env.CONTACT_TO_EMAIL;
  const from = env.CONTACT_FROM_EMAIL;

  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!to) missing.push("CONTACT_TO_EMAIL");
  if (!from) missing.push("CONTACT_FROM_EMAIL");

  if (missing.length) {
    return { ok: false, status: 0, message: `Email configuration missing: ${missing.join(", ")}` };
  }

  const apiKeyValue = apiKey!;
  const toValue = to!;
  const fromValue = from!;

  const hostname = safeHostname(request.url);
  const fromHeader = formatFromHeader(hostname, fromValue);

  const body = {
    from: fromHeader,
    to: [toValue],
    subject: `New contact form message from: ${payload.name}`,
    text: `Name:\n${payload.name}\n\nEmail Address:\n${payload.email}\n\nMessage:\n${payload.message}`,
    reply_to: payload.email,
  };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKeyValue}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, status: 0, message: `Resend request failed: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const requestId = response.headers.get("x-request-id") || response.headers.get("cf-ray") || "";
    const suffix = requestId ? ` (request-id: ${requestId})` : "";
    return {
      ok: false,
      status: response.status,
      message: `Resend error ${response.status}${suffix}: ${text || "(no body)"}`,
    };
  }

  return { ok: true, status: response.status, message: "" };
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function formatFromHeader(hostname: string, configuredFrom: string) {
  // If the user already provided a full RFC 5322-ish From value like
  // "Name <email@domain.com>", respect it.
  if (configuredFrom.includes("<") && configuredFrom.includes(">")) {
    return configuredFrom;
  }

  // Otherwise treat it as a bare email address and add the site hostname
  // as the display name.
  if (hostname) {
    return `${hostname} <${configuredFrom}>`;
  }

  return configuredFrom;
}

async function storeMessage(
  kv: KVNamespace | undefined,
  record: {
    name: string;
    email: string;
    message: string;
    turnstile: boolean;
    userAgent?: string;
    referer?: string;
  },
): Promise<string | undefined> {
  if (!kv) {
    return undefined;
  }

  const id = `contact:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    ...record,
    createdAt: new Date().toISOString(),
  };

  try {
    await kv.put(id, JSON.stringify(entry), { metadata: { email: record.email } });
    return id;
  } catch (error) {
    console.error("KV write failed", error);
    return undefined;
  }
}

// NOTE: We intentionally keep the interaction HTMX-only for simplicity.
