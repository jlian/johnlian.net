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
const SUCCESS_REDIRECT = "/about/?sent=1";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const form = await request.formData();
  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const message = (form.get("message") || "").toString().trim();
  const turnstileToken = (form.get("cf-turnstile-response") || "").toString().trim();

  if (!name || !email || !message) {
    return new Response("Missing required fields", { status: 400 });
  }

  const turnstileResult = await validateTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, request);
  if (!turnstileResult.ok) {
    return new Response(turnstileResult.message, { status: 400 });
  }

  const emailStatus = await sendEmail(env, { name, email, message });
  if (!emailStatus.ok) {
    return new Response(emailStatus.message, { status: 500 });
  }

  await storeMessage(env.CONTACT_MESSAGES, {
    name,
    email,
    message,
    turnstile: turnstileResult.valid,
    userAgent: request.headers.get("user-agent") || undefined,
    referer: request.headers.get("referer") || undefined,
  });

  return Response.redirect(SUCCESS_REDIRECT, 303);
};

async function validateTurnstile(token: string, secret: string | undefined, request: Request) {
  if (!token) {
    return { ok: true, valid: false, message: "" };
  }

  if (!secret) {
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
    return { ok: false, valid: false, message: "Captcha validation failed" };
  }

  const verification = (await response.json()) as { success?: boolean };
  if (!verification.success) {
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

  if (!apiKey || !to || !from) {
    return { ok: false, message: "Email configuration missing" };
  }

  const body = {
    from,
    to: [to],
    subject: `New contact form message from ${payload.name}`,
    text: `Name: ${payload.name}\nEmail: ${payload.email}\n\n${payload.message}`,
  };

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return { ok: false, message: "Failed to send email" };
  }

  return { ok: true, message: "" };
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
) {
  if (!kv) {
    return;
  }

  const id = `contact:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    ...record,
    createdAt: new Date().toISOString(),
  };

  try {
    await kv.put(id, JSON.stringify(entry), { metadata: { email: record.email } });
  } catch (error) {
    console.error("KV write failed", error);
  }
}
