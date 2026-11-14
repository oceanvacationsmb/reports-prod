export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type GmailEnv = {
  sendEnabled: boolean;
  clientId: string;
  clientSecret: string;
};

export function gmailEnvFromProcess(env: NodeJS.ProcessEnv = process.env): GmailEnv {
  return {
    sendEnabled: env.GMAIL_SEND_ENABLED === "true",
    clientId: env.GMAIL_CLIENT_ID || "",
    clientSecret: env.GMAIL_CLIENT_SECRET || ""
  };
}

export function buildRawGmailMessage(message: OutboundEmail) {
  const mime = [
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    message.html
  ].join("\r\n");
  return Buffer.from(mime).toString("base64url");
}

export class GmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailSendError";
  }
}

export function createGmailSender(options: {
  env: GmailEnv;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = options.fetchImpl || fetch;
  return {
    async send(message: OutboundEmail) {
      if (!options.env.sendEnabled) {
        throw new GmailSendError("Gmail sending is disabled. Set GMAIL_SEND_ENABLED=true only after OAuth is connected.");
      }
      if (!options.env.clientId || !options.env.clientSecret) {
        throw new GmailSendError("Gmail OAuth client id and secret are not configured.");
      }
      if (!options.refreshToken) {
        throw new GmailSendError("Gmail is not connected.");
      }
      const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: options.env.clientId,
          client_secret: options.env.clientSecret,
          refresh_token: options.refreshToken,
          grant_type: "refresh_token"
        })
      });
      const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
      if (!tokenResponse.ok || !tokenBody.access_token) {
        throw new GmailSendError(tokenBody.error || "Gmail did not return an access token.");
      }
      const sendResponse = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenBody.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ raw: buildRawGmailMessage(message) })
      });
      const sendBody = (await sendResponse.json()) as { id?: string; error?: { message?: string } };
      if (!sendResponse.ok || !sendBody.id) {
        throw new GmailSendError(sendBody.error?.message || "Gmail did not confirm the message.");
      }
      return { id: sendBody.id };
    }
  };
}
