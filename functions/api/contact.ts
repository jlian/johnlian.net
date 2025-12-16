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
  CONTACT_DEBUG?: string;
};

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SUCCESS_REDIRECT = "/about/?sent=1";
const ERROR_REDIRECT = "/about/?error=1";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  try {
    const contentType = request.headers.get("content-type") || "";

    let name = "";
    let email = "";
    let message = "";
    let turnstileToken = "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      name = (params.get("name") || "").toString().trim();
      email = (params.get("email") || "").toString().trim();
      message = (params.get("message") || "").toString().trim();
      turnstileToken = (params.get("cf-turnstile-response") || "").toString().trim();
    } else {
      // Default to multipart/form-data or other form encodings
      let form: FormData;
      try {
        form = await request.formData();
      } catch (e) {
        console.error("Failed to parse form data", e);
        return new Response("Invalid form encoding", { status: 400 });
      }

      name = (form.get("name") || "").toString().trim();
      email = (form.get("email") || "").toString().trim();
      message = (form.get("message") || "").toString().trim();
      turnstileToken = (form.get("cf-turnstile-response") || "").toString().trim();
    }

    if (!name || !email || !message) {
      return new Response("Missing required fields", { status: 400 });
    }

    const turnstileResult = await validateTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request);
    if (!turnstileResult.ok) {
      return new Response(turnstileResult.message, { status: 400 });
    }

    // Store first so we don't lose submissions if email delivery fails
    const submissionId = await storeMessage(env.CONTACT_MESSAGES, {
      name,
      email,
      message,
      turnstile: turnstileResult.valid,
      userAgent: request.headers.get("user-agent") || undefined,
      referer: request.headers.get("referer") || undefined,
    });

    const emailStatus = await sendEmail(env, { name, email, message });

    // Update KV record with email send status if KV is configured
    if (submissionId && env.CONTACT_MESSAGES) {
      try {
        await env.CONTACT_MESSAGES.put(
          submissionId,
          JSON.stringify({
            name,
            email,
            message,
            turnstile: turnstileResult.valid,
            userAgent: request.headers.get("user-agent") || undefined,
            referer: request.headers.get("referer") || undefined,
            createdAt: new Date().toISOString(),
            emailSendOk: emailStatus.ok,
            emailSendStatus: emailStatus.status,
            emailSendError: emailStatus.ok ? undefined : emailStatus.message,
          }),
          { metadata: { email } },
        );
      } catch (error) {
        console.error("KV update after email failed", error);
      }
    }

    if (!emailStatus.ok) {
      console.error("Email send failed", { status: emailStatus.status, message: emailStatus.message });
      const errorRedirect = new URL(ERROR_REDIRECT, request.url).toString();
      return Response.redirect(errorRedirect, 303);
    }

    const redirectUrl = new URL(SUCCESS_REDIRECT, request.url).toString();
    return Response.redirect(redirectUrl, 303);
  } catch (err) {
    console.error("Unhandled exception in /api/contact", err);

    const debug = env.CONTACT_DEBUG === "1";
    if (debug) {
      const message =
        err instanceof Error
          ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack}` : ""}`
          : String(err);
      const capped = message.slice(0, 2000);
      return new Response(capped, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=UTF-8" },
      });
    }

    if (acceptsHtml(request)) {
      const errorRedirect = new URL(ERROR_REDIRECT, request.url).toString();
      return Response.redirect(errorRedirect, 303);
    }

    return new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain; charset=UTF-8" } });
  }
};

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

  const body = {
    from,
    to: [to],
    subject: `New contact form message from ${payload.name}`,
    text: `Name: ${payload.name}\nEmail: ${payload.email}\n\n${payload.message}`,
    reply_to: payload.email,
  };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
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

  return undefined;
}

function acceptsHtml(request: Request) {
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}
