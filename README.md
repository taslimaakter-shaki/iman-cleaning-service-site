# IMAN APP

IMAN APP is the early booking marketplace prototype for IMAN CLEANING SERVICE LLC.

Live site: https://www.imancleaningservice.com

## Current Prototype

- Landing page for the NYC pilot
- Customer booking request form
- Live estimate calculator
- Supabase-ready booking API
- Admin operations board with booking status controls
- Cleaner workflow preview
- MVP product specification

## Backend Setup

The app includes Vercel API routes under `/api/bookings`.

To make bookings save to a shared database:

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL editor.
3. Add these environment variables in Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_TOKEN`
4. Redeploy the Vercel project.

Until those variables are added, the booking form falls back to browser-only prototype mode.

## AI Cleaning Estimate Setup

The client booking flow includes `/api/ai/cleaning-estimate` for photo-based AI estimates.

Add this Vercel environment variable to enable live OpenAI Vision analysis:

- `OPENAI_API_KEY`

Optional:

- `OPENAI_VISION_MODEL` defaults to `gpt-4.1-mini`

Without `OPENAI_API_KEY`, the app returns a realistic demo estimate so the booking experience still works.

If Gemini API keys are disallowed by Google organization policy, use the Cloud Run ADC service in:

- `cloud-run/gemini-estimator`

After deploying that service, add these Vercel environment variables:

- `GEMINI_ESTIMATOR_URL`
- `IMAN_AI_SERVICE_TOKEN`

When `GEMINI_ESTIMATOR_URL` is set, the Vercel API uses Cloud Run + Vertex AI Gemini before falling back to OpenAI/demo mode.

## Stripe Quote Payment Setup

The admin quote-payment page is available at `/quote-payment.html`.

Add these Vercel environment variables:

- `STRIPE_SECRET_KEY`
- `ADMIN_TOKEN`
- `PUBLIC_SITE_URL` set to `https://www.imancleaningservice.com`

In Stripe, also set the public Terms of Service URL to:

- `https://www.imancleaningservice.com/agreement.html`

The admin quote tool creates a customer approval link. The customer link shows the quoted price, requires agreement acceptance, requires photo ID upload, and then creates the Stripe Checkout session.

The supporting routes are:

- `/api/quote/approval-link`
- `/api/quote/approve-checkout`
- `/api/stripe/checkout-session` for legacy direct admin checkout links

## Quote Photo Upload Setup

The public quote form uses `/api/quote/start`, `/api/quote/photo`, and `/api/quote/finish` to upload up to 100 compressed customer photos to Google Drive and send the quote notification through Gmail API.

Add these Vercel environment variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- `QUOTE_EMAIL_FROM` set to `Info@imancleaningservice.com`
- `QUOTE_EMAIL_TO` set to `Info@imancleaningservice.com`

The Drive parent folder should already be shared with the Google users who need to view quote photos. The site keeps uploaded photo links private to those users instead of making public links.

## Live Chat to SMS Setup

The floating live chat widget uses `/api/chat/send`, `/api/chat/messages`, and `/api/chat/twilio-webhook`.

To enable real customer messages:

1. Run `supabase-schema.sql` in the Supabase SQL editor so the `live_chat_sessions` and `live_chat_messages` tables exist.
2. Add these Vercel environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` set to the Twilio SMS number
   - `OWNER_SMS_TO` set to the phone number that should receive chat texts
   - `PUBLIC_SITE_URL` set to `https://www.imancleaningservice.com`
3. In Twilio, set the SMS webhook for `TWILIO_FROM_NUMBER` to:
   - `https://www.imancleaningservice.com/api/chat/twilio-webhook`

When a website visitor sends a chat message, Twilio texts `OWNER_SMS_TO`. Reply with the included chat code, for example `C12345 I can help with that.` If there is only one active chat, a plain reply is routed to the latest open chat. Send `C12345 close` to close a chat.

## Customer App

The separate customer app and `client.imancleaningservice.com` flow were removed.

## Next Build Step

Add Supabase credentials in Vercel, then test real shared booking submissions from multiple devices.
