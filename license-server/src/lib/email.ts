/**
 * Resend API email helper for sending license keys.
 */

export async function sendLicenseKeyEmail(
  apiKey: string,
  to: string,
  licenseKey: string
): Promise<void> {
  console.log(`Sending license key email to ${to}`)

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background-color:#18181b;padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Lead Routing</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#18181b;font-size:22px;font-weight:600;">Your Pro License Key</h2>
              <p style="margin:0 0 24px;color:#52525b;font-size:15px;line-height:1.6;">
                Thank you for purchasing Lead Routing Pro. Here is your license key:
              </p>
              <div style="background-color:#f4f4f5;border:2px dashed #d4d4d8;border-radius:8px;padding:20px;text-align:center;margin:0 0 24px;">
                <code style="font-size:20px;font-weight:700;color:#18181b;letter-spacing:2px;">${licenseKey}</code>
              </div>
              <p style="margin:0 0 8px;color:#52525b;font-size:15px;line-height:1.6;">
                To activate, run this command on your server:
              </p>
              <div style="background-color:#18181b;border-radius:8px;padding:16px;margin:0 0 24px;">
                <code style="color:#a1a1aa;font-size:14px;">npx @lead-routing/cli activate --key ${licenseKey}</code>
              </div>
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5;">
                This key is tied to your subscription and bound to a single server instance.
                Keep it safe and do not share it.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #e4e4e7;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;">
                &copy; ${new Date().getFullYear()} Lead Routing. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lead Routing <noreply@openedgeai.tech>',
      to: [to],
      subject: 'Your Lead Routing Pro License Key',
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`Resend API error: ${response.status} ${body}`)
    throw new Error(`Failed to send license email: ${response.status}`)
  }

  console.log(`License key email sent successfully to ${to}`)
}

export async function sendVerificationEmail(
  apiKey: string,
  to: string,
  firstName: string,
  token: string
): Promise<void> {
  console.log(`Sending verification email to ${to}`)

  const verifyUrl = `https://openedgeai.tech/verify-email.html?token=${token}`

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background-color:#18181b;padding:32px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Lead Routing</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#18181b;font-size:22px;font-weight:600;">Verify your email</h2>
              <p style="margin:0 0 24px;color:#52525b;font-size:15px;line-height:1.6;">
                Hi ${firstName}, thanks for signing up for Lead Routing. Please verify your email address by clicking the button below.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background-color:#18181b;border-radius:8px;padding:14px 32px;">
                    <a href="${verifyUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;color:#52525b;font-size:15px;line-height:1.6;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;color:#3b82f6;font-size:13px;line-height:1.5;word-break:break-all;">
                ${verifyUrl}
              </p>
              <p style="margin:0;color:#71717a;font-size:13px;line-height:1.5;">
                This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #e4e4e7;">
              <p style="margin:0;color:#a1a1aa;font-size:12px;">
                &copy; ${new Date().getFullYear()} Lead Routing. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lead Routing <noreply@openedgeai.tech>',
      to: [to],
      subject: 'Verify your email — Lead Routing',
      html,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`Resend API error: ${response.status} ${body}`)
    throw new Error(`Failed to send verification email: ${response.status}`)
  }

  console.log(`Verification email sent successfully to ${to}`)
}
