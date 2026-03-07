/**
 * Twilio Voice Channel Provider
 * Handles inbound voice call webhooks and responds with TwiML.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class TwilioVoiceProvider implements ChannelProvider {
  type = 'twilio_voice' as const;

  verifyWebhook(headers: Record<string, string>, _body: unknown, config: ChannelConfig): ChannelVerifyResult {
    const authToken = config.config['auth_token'] as string | undefined;
    if (!authToken) return { valid: false };

    // Twilio uses X-Twilio-Signature
    const signature = headers['x-twilio-signature'];
    if (!signature) return { valid: false };

    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const payload = body as Record<string, unknown>;

    // Twilio Voice sends status callbacks and speech-to-text results
    // SpeechResult comes from <Gather> verb with speech input
    const speechResult = (payload['SpeechResult'] as string)
      || (payload['Digits'] as string);

    // CallStatus for new incoming calls
    const callStatus = payload['CallStatus'] as string;

    if (callStatus === 'ringing' || callStatus === 'in-progress') {
      return {
        text: speechResult || '[incoming call]',
        externalMessageId: payload['CallSid'] as string,
        externalChannelId: payload['To'] as string,
        externalUserId: payload['From'] as string,
        metadata: {
          callSid: payload['CallSid'],
          from: payload['From'],
          to: payload['To'],
          direction: payload['Direction'],
          callStatus,
        },
      };
    }

    if (!speechResult) return null;

    return {
      text: speechResult.trim(),
      externalMessageId: payload['CallSid'] as string,
      externalChannelId: payload['To'] as string,
      externalUserId: payload['From'] as string,
      metadata: {
        callSid: payload['CallSid'],
        from: payload['From'],
        to: payload['To'],
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    // Voice replies are handled via TwiML response in the webhook handler
    // For async replies, we update the call via Twilio API
    const accountSid = config.config['account_sid'] as string;
    const authToken = config.config['auth_token'] as string;
    const callSid = config.metadata?.['callSid'] as string;

    if (!accountSid || !authToken || !callSid) return;

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    // Update the call with new TwiML that says the response
    const twiml = `<Response><Say voice="alice">${escapeXml(message.text.substring(0, 4000))}</Say><Gather input="speech" timeout="5" speechTimeout="auto" action="/api/v1/forge/channels/twilio_voice/webhook/${config.id}"><Say voice="alice">What else can I help with?</Say></Gather></Response>`;

    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
      body: new URLSearchParams({
        Twiml: twiml,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
