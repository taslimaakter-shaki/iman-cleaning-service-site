# Iman Cleaning Service Website

This repository contains the live website and online booking system for **Iman Cleaning Service LLC**.

- Live website: [www.imancleaningservice.com](https://www.imancleaningservice.com)
- GitHub repository: [taslimaakter-shaki/iman-cleaning-service-site](https://github.com/taslimaakter-shaki/iman-cleaning-service-site)
- Website hosting: Vercel
- Customer accounts and database: Supabase
- Payments and invoices: Stripe
- Email, calendar, and quote-photo storage: Google
- Text messages: Twilio

This guide explains what every major part of the website does, why it exists, and what must be checked when it is changed. It is written so that anyone working on the website can understand the complete system without needing to study every code file first.

## Start Here: What the Website Does

The website has four main jobs:

1. **Explain the business.** It tells visitors which cleaning services are available, where the company works, what prices start at, and how to contact the company.
2. **Help customers choose a service.** The booking form asks questions and guides customers toward Standard Cleaning, Deep Cleaning, Moving Cleaning, Organization/Decluttering, or a custom quote.
3. **Accept bookings and payments.** It calculates the price, shows available appointments, sends the customer to Stripe, and confirms the booking after payment.
4. **Support the customer after booking.** It sends confirmations and reminders, provides invoices, and allows eligible rescheduling or cancellation.

The public pages and the private booking operations are kept separate for security. Customers can see the public HTML, CSS, and browser JavaScript. Private API keys and business operations run on Vercel’s servers.

## The System in One Picture

```text
Customer visits the website
        │
        ├── Reads service and location pages
        ├── Requests a custom quote
        ├── Uses the booking form
        └── Logs into a customer account
                │
                ▼
        Vercel server functions
        ├── Validate prices and appointments
        ├── Save bookings and accounts
        ├── Create Stripe checkout
        ├── Send email and text messages
        ├── Update Google Calendar
        └── Handle quotes and private photos
                │
                ├── Supabase stores business data
                ├── Stripe handles payment
                ├── Google handles email, calendar, and Drive
                ├── Twilio handles text messages
                └── AI services support selected features
```

## Important Technical Words

These terms appear throughout the project:

- **Frontend:** Everything the customer sees and uses in the browser, such as pages, buttons, forms, images, and menus.
- **Backend:** Private server code that validates data and communicates with services such as Stripe and Supabase.
- **API route:** A private website address used by the frontend to request work from the backend. For example, `/api/booking/checkout` asks the server to create a payment session.
- **Environment variable:** A private setting stored in Vercel, such as an API key. The name can appear in documentation, but its secret value must never be placed in GitHub.
- **Webhook:** A secure message sent from one service to another. For example, Stripe sends a webhook to the website after a payment succeeds.
- **Deployment:** A specific version of the repository that Vercel has built and published.
- **Production:** The live website customers use.
- **Responsive design:** A layout that adjusts for phones, tablets, and desktop computers.

## How the Files Are Organized

### Main public pages

Most public pages are normal `.html` files in the main folder. Examples:

- `index.html` — homepage.
- `services-hub.html` — main service directory.
- `areas.html` — main service-area directory.
- `book-now.html` — online booking form.
- `quote.html` — custom quote form.
- `login.html` — customer login and account creation.
- `account.html` — customer dashboard.
- `contact.html` — contact page.
- `faq.html` — frequently asked questions.
- `agreement.html` — service agreement.
- `privacy-policy.html` — privacy policy.
- `sms-terms.html` — text-message terms.

Using normal HTML helps search engines read the pages and gives customers content even if JavaScript loads slowly.

### Browser JavaScript

JavaScript controls interactive behavior:

- `book-now.js` — booking questions, form memory, pricing display, saved quotes, appointment selection, and checkout.
- `booking-service-area.js` — ZIP-code and service-area checks.
- `account-auth-callback.js` — completes customer account confirmation.
- `homepage-mount.js` — turns the crawlable homepage into its enhanced React version.
- `chrome.jsx` — shared header, menu, footer, and icons.
- `sections.jsx` — interactive homepage sections.
- `site-footer.js` — footer behavior used by supporting pages.

### Styles

- `design-system.css` — reusable buttons, cards, layouts, and design foundations.
- `site.css` — main shared website styles.
- `styles.css` — older shared styles still used by some pages.
- `booking.css` — booking-form design.
- `customer-account.css` — login and dashboard design.
- `homepage-footer.css` — homepage footer design.
- `tokens/` — shared colors, fonts, spacing, and typography values.

Shared styles keep the website consistent. A button or header should not look completely different from one page to another unless there is a deliberate reason.

### Images and videos

Most media is stored in `assets/`. The website includes smaller versions and modern formats for some large images so phones do not need to download unnecessary data.

The homepage uses a poster image first. The background video loads only when the screen and motion settings make it appropriate. Visitors who prefer reduced motion receive the still image.

### Server code

The `api/` folder contains Vercel server functions. This code runs privately on the server and is not sent to the customer’s browser.

The main groups are:

- `api/booking/` — pricing validation, availability, checkout, saved quotes, reminders, rescheduling, and cancellation.
- `api/account/` — signup, confirmation, login, logout, session, and dashboard.
- `api/quote/` — quote requests, private photos, approval links, and quote payments.
- `api/chat/` — website chat and Twilio replies.
- `api/stripe/` — Stripe checkout and payment webhooks.
- `api/ai/` — AI chat and photo-based estimate support.
- `api/receptionist/` — AI receptionist call records and operational exports.

Files beginning with `_` are supporting files loaded by a public API route. For example, `/api/booking/checkout` is routed to `api/booking/_checkout.js` through `api/booking/[action].js`.

## Homepage

The homepage is `index.html`. Its main purpose is to help a new visitor understand the business and take action quickly.

It includes:

- Company logo and navigation.
- **Log In** and **Book Online** buttons in the navigation.
- A hero section explaining the company’s service area.
- **Call Us** and **Get an Instant Quote** buttons.
- Residential and commercial service sections.
- Reviews, trust information, contact details, and business hours.
- Links to the service and service-area pages.
- Structured data that helps search engines understand the company.

The homepage is built in two layers:

1. A complete HTML version appears immediately and can be read by search engines.
2. React replaces it with the interactive version after the scripts load.

Both versions must contain matching important information. If the header, footer, service links, or main wording is changed, check both the crawlable HTML and the React components.

## Navigation and Footer

The main navigation stays intentionally simple:

- Services
- Why Iman
- Service Areas
- Careers
- FAQs
- Contact
- Log In
- Book Online

Local SEO pages belong inside the body of the Service Areas page. They should not all be added to the main navigation because that would make the menu crowded and difficult to use.

The shared footer provides:

- Company name and logo.
- Email address.
- Service area.
- Phone number.
- Business hours.
- Location/map information when included by the shared footer.
- Social media links.
- Privacy, SMS, and careers links.

When changing the navigation or footer, inspect the homepage and several supporting pages on both desktop and mobile.

## Service Pages

### Residential service pages

- `standard-cleaning.html`
- `deep-cleaning.html`
- `move-in-move-out-cleaning.html`
- `details-cleaning.html`
- `extreme-cleaning.html`
- `organization-services.html`
- `post-construction-cleaning.html`
- `airbnb-cleaning.html`

These pages explain what the service is for, what it includes, starting prices when appropriate, and the next action. The price cards are informational. The booking form calculates the customer’s personalized price.

### Commercial service pages

- `commercial-cleaning.html`
- `office-cleaning.html`
- `janitorial-recurring-cleaning.html`
- `restaurant-cleaning.html`
- `retail-store-cleaning.html`
- `medical-clinic-cleaning.html`

Commercial prices usually require a walkthrough or custom review because size, traffic, business hours, cleaning frequency, and requested work vary from one property to another.

## Service Areas and Local SEO

`areas.html` is the main directory for geographic pages. Current local pages include:

- `queens-cleaning-service.html`
- `house-cleaning-jamaica-ny.html`
- `house-cleaning-flushing-ny.html`
- `apartment-cleaning-queens.html`

These pages help customers and search engines find a service connected to a real location. They should use the same brand, navigation, design, booking buttons, service information, and footer as the main website.

Each local page should still contain location-specific information such as:

- Correct neighborhood or city name.
- Relevant ZIP codes.
- Nearby neighborhoods.
- Recognizable local landmarks when useful.
- Services available in that area.
- Unique and accurate local wording.

Do not create hundreds of identical pages that only replace the city name. Search engines may treat those as low-quality doorway pages. Every public page should help a real customer.

## Search Engine Optimization

Search engine optimization is built directly into the website. There is no SEO plugin.

Important SEO parts include:

- A unique browser title for each page.
- A useful meta description.
- One clear main heading.
- Correct internal links.
- A canonical URL showing the preferred page address.
- Social-sharing image and text.
- Structured business data.
- Descriptive image alternative text.
- Fast, responsive images.
- `robots.txt`.
- `sitemap.xml`.

When adding, renaming, or deleting a public page, check all of the following:

1. Page title and description.
2. Main heading and body copy.
3. Canonical URL.
4. Links from related pages.
5. Link from `areas.html` if it is a location page.
6. Entry in `sitemap.xml`.
7. Mobile layout.

## The Customer Booking Journey

The booking system is mainly built with `book-now.html`, `book-now.js`, and `booking.css`.

The normal journey is:

1. The customer enters a ZIP code.
2. The website checks whether the area can be served online.
3. The customer chooses cleaning or organization/decluttering.
4. The form asks only the questions needed for that choice.
5. The website recommends the correct service or redirects to a custom quote.
6. The website calculates the personalized price.
7. The customer enters a name, email address, and phone number.
8. The quote appears on the website and a secure saved-quote link can be sent.
9. The customer selects an available appointment.
10. The customer accepts the service and payment terms.
11. The backend verifies everything again.
12. Stripe securely collects payment.
13. The website confirms the paid booking.

### Why the form asks conditional questions

Different services need different information. Asking every possible question would make the form longer and reduce completion.

Examples:

- Moving Cleaning includes oven, refrigerator, and inside-cabinet kitchen work unless the customer excludes an item.
- Organization/Decluttering asks for hours and an optional appointment note.
- Properties or conditions outside the online pricing rules are sent to a custom quote.
- Questions that do not apply to the selected service remain hidden.

### Form memory

Unfinished answers are saved in the customer’s browser. Refreshing the page or returning later on the same browser restores the progress.

The **Cancel & clear** control erases the saved form and starts over. This is different from closing the browser or refreshing, which should keep the unfinished progress.

### Saved quote links

After the contact step, the server can create a secure saved-quote link. The customer can receive it by email and, when text-message consent was given, by SMS.

The customer can reopen the link on another device, see the saved quote, choose an appointment, and continue to payment. Saved quote links expire after 90 days.

## Pricing

The frontend shows the estimate, but the backend is the final authority. This is important because a customer can technically change browser code, but cannot be allowed to change the amount sent to Stripe.

During checkout, the server:

1. Reads the submitted answers.
2. Checks that the service is eligible for online booking.
3. Recalculates the price.
4. Rejects missing or inconsistent information.
5. Sends the verified amount to Stripe.

If a price changes, update both the browser calculation and server calculation. Never change only the number displayed on the page.

## Tax-Inclusive Prices

Customer-facing totals include New York sales tax at **8.875%**. The final price does not increase at checkout. The system separates the already-included tax so the customer can see how much of the total is tax.

The calculation is:

```text
before-tax amount = final total / 1.08875
included tax      = final total - before-tax amount
```

For example, when the final tax-inclusive price is $100:

```text
Before tax:  $91.85
Tax:          $8.15
Final total: $100.00
```

The backend performs money calculations in cents to avoid rounding errors.

## Appointment Availability

`/api/booking/availability` returns appointment options.

It checks:

- Existing website bookings.
- Connected Google Calendar events.
- Required advance notice.
- The company’s booking schedule.

New online bookings require at least 24 hours of notice. A confirmed appointment is synchronized with Google Calendar when the integration is configured.

Availability is checked again before checkout. This reduces the chance that two customers purchase the same appointment.

## Stripe Payments and Invoices

The website does not collect or store card numbers. Stripe Checkout handles the payment page.

`/api/booking/checkout`:

- Verifies the answers and total.
- Saves the pending booking.
- Creates a Stripe Checkout session.
- Requests Stripe invoice creation.
- Returns the secure Stripe payment URL.

After payment, Stripe sends a webhook to `api/stripe/webhook.js`. The webhook confirms that the payment truly succeeded before the website treats the booking as paid.

The customer’s Stripe invoice, PDF invoice, or receipt link is stored with the payment information when available. The customer dashboard can display those links.

## Booking Confirmation and Reminders

After successful payment, the system can send:

- Booking confirmation.
- Appointment details by email.
- Booking-related text messages when the customer consented.
- A reminder approximately 6 hours before the appointment.
- A reminder approximately 1 hour before the appointment.

Reminder wording is built in `api/booking/_notifications.js`. Email uses Gmail API. Text messages use Twilio.

The reminder job is protected by `CRON_SECRET`. This prevents an unauthorized visitor from manually triggering reminders.

## Rescheduling, Cancellation, and Refunds

`manage-booking.html` gives a customer access through a secure management link. The secure token matters because a booking number alone should not allow someone to change another customer’s appointment.

The backend route `/api/booking/manage` can:

- Display the permitted booking details.
- Check whether a new appointment is available.
- Reschedule the booking.
- Update Google Calendar.
- Cancel the booking.
- Calculate and create a Stripe refund.
- Notify the customer.

Current cancellation rule:

- **24 hours or more before service:** 100% refund.
- **Less than 24 hours before service:** 75% refund; 25% is retained.

Refunds go back to the original payment method through Stripe.

If this rule changes, update the server logic, service agreement, customer-facing policy, and confirmation wording together.

## Guest Checkout and Customer Accounts

A customer can book as a guest. Creating an account is optional so login does not block a purchase.

Customer account pages:

- `login.html` — login and account creation.
- `account-confirmed.html` — email confirmation result.
- `account.html` — dashboard.
- `customer-account.css` — account styling.
- `account-auth-callback.js` — confirmation callback handling.

Supabase manages passwords, email verification, and account identity. The website keeps account sessions in secure cookies that normal browser scripts cannot read.

The customer dashboard is designed to show:

- Upcoming and previous bookings.
- Appointment information.
- Invoices and receipts.
- Rescheduling and cancellation links.
- A way to book again.

Existing guest bookings can be matched to the customer’s verified email address.

## Custom Quote System

Some jobs cannot be safely priced by the normal booking questions. Those customers use `quote.html`.

The quote flow uses:

- `quote.html` — customer request form.
- `api/quote/start` — creates the quote request.
- `api/quote/photo` — uploads a compressed photo.
- `api/quote/finish` — completes and sends the request.
- `approve-quote.html` — customer approval page.
- `quote-payment.html` — authorized payment-link creation.

### Quote photos

Customer photos are uploaded through the backend to a private Google Drive folder. They are not supposed to become public website links.

The Drive folder must be shared only with the people who need to review quote photos. Google OAuth credentials stay in Vercel.

### Quote approval

An authorized quote can create a signed customer approval link. The signature protects the amount and quote details from being changed in the browser. After acceptance, the customer continues to Stripe.

## Website Chat and Text Messaging

The live chat uses:

- `/api/chat/send`
- `/api/chat/messages`
- `/api/chat/twilio-webhook`

Supabase stores chat sessions and messages. Twilio can forward a website message to the business phone. Replies use the chat code to return the answer to the correct website visitor.

Text-message consent and opt-out language must remain clear. Customers can reply STOP where required by the Twilio messaging flow.

## AI Features

### Website AI chat

`/api/ai/chat` supports AI-assisted website conversations. The OpenAI API key remains on the server.

### Photo estimate support

`/api/ai/cleaning-estimate` can analyze cleaning photos through:

1. Vertex AI Gemini through the private Cloud Run service.
2. OpenAI Vision.
3. A controlled demo response when no live AI provider is configured.

The Cloud Run code is in `cloud-run/gemini-estimator/`.

AI results are estimates and support tools. They do not replace server price validation or a required human review.

## AI Receptionist

Routes under `api/receptionist/` receive and store receptionist call information. Depending on configuration, they can:

- Save call records in Supabase.
- Notify the business.
- Send a customer a quote link.
- Export operational information.

ElevenLabs webhook secrets must be verified by server code before incoming call information is trusted.

## Supabase Database

`supabase-schema.sql` describes the database tables and supporting rules used by the website.

The database may store:

- Customers and account identity references.
- Booking requests.
- Confirmed appointments.
- Payment, invoice, and receipt references.
- Saved quotes.
- Reminder-delivery records.
- Booking-management information.
- Chat sessions and messages.
- Receptionist call records.

The Supabase service-role key has powerful database access. It must only be used by server routes and must never appear in browser JavaScript or GitHub.

## External Services and Why They Are Used

### Vercel

Vercel hosts the pages, builds the production deployment, connects the custom domain, and runs the private API routes.

### GitHub

GitHub stores the reviewed source history. A commit is a saved version of the source. GitHub does not store the production secret values.

### Supabase

Supabase provides the shared database and customer authentication.

### Stripe

Stripe securely collects card payments, creates invoices and receipts, and returns refunds.

### Google

Google APIs are used for Gmail notifications, Google Calendar scheduling, and private Drive photo folders.

### Twilio

Twilio sends customer and business text messages and receives SMS replies used by website chat.

### OpenAI and Vertex AI

These services support selected AI chat and image-analysis features.

### ElevenLabs

ElevenLabs supports the AI receptionist integration and call records.

## Secret Keys and Environment Variables

Private values belong in the Vercel project’s Environment Variables settings. They do not belong in `README.md`, source files, screenshots, support messages, or GitHub.

Important names are listed below so the system can be understood without revealing their values.

### Website and database

- `PUBLIC_SITE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_TOKEN`

### Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `BOOKING_MANAGEMENT_SECRET`
- `QUOTE_APPROVAL_SECRET`

### Google

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_DRIVE_PARENT_FOLDER_ID`
- `QUOTE_EMAIL_FROM`
- `QUOTE_EMAIL_TO`

### Twilio

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `OWNER_SMS_TO`

### Reminders

- `CRON_SECRET`

### AI and receptionist

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`
- `OPENAI_VISION_MODEL`
- `GEMINI_ESTIMATOR_URL`
- `IMAN_AI_SERVICE_TOKEN`
- `ELEVENLABS_API_KEY`
- The ElevenLabs webhook secrets used by the receptionist routes

If a secret is accidentally exposed, removing it from a file is not enough. The secret must also be replaced at the service that issued it.

## How to Work Locally

Install the project dependencies:

```bash
npm install
```

Run the website with Vercel’s local server when API routes are needed:

```bash
npx vercel dev
```

A simple static web server can be used for basic HTML and CSS review, but payments, accounts, reminders, database operations, and other API features require the Vercel-style server environment and valid development configuration.

Do not copy production secret values into a committed file for local testing.

## Safe Change Process

Before changing anything:

1. Identify which customer action or business rule is affected.
2. Find both the visible frontend code and related backend validation.
3. Check whether the same information also appears in policies, emails, account pages, or SEO metadata.
4. Make the smallest necessary change.

Before publishing:

1. Review `git status` to see every changed file.
2. Review the code difference.
3. Test the affected page on desktop and mobile.
4. Test the complete customer flow, not only the edited screen.
5. Confirm no secret or personal customer data was added.
6. Commit the reviewed version.
7. Push the intended commit to GitHub.
8. Deploy that exact commit to Vercel.
9. Confirm Vercel reports **Ready**.
10. Verify the live custom domain.

## Changes That Must Stay Together

Some work affects more than one file:

### Changing a price

Update:

- Browser price calculation.
- Server price calculation.
- Service-page starting price if applicable.
- Checkout summary and agreement wording if applicable.

### Changing a booking question

Update:

- Visible form question.
- Browser state and validation.
- Draft saving and restoration.
- Saved quote restoration.
- Server validation.
- Checkout and booking summaries.

### Adding a public page

Update:

- Page title, description, heading, and canonical URL.
- Links from the related service or area page.
- `sitemap.xml`.
- Mobile layout.

### Changing navigation or footer

Update and inspect:

- Crawlable static HTML version.
- React version in `chrome.jsx` or `sections.jsx`.
- Supporting pages using the shared footer.
- Desktop and mobile menus.

### Changing cancellation rules

Update:

- Refund calculation in the backend.
- Service agreement.
- Customer-facing cancellation explanation.
- Confirmation and cancellation messages.

### Changing database information

Update:

- `supabase-schema.sql`.
- Server route that reads or writes the field.
- Frontend page that displays it.
- Existing-data migration when necessary.

## What Not to Do

- Do not put secret values in GitHub.
- Do not change only the visible price without changing server validation.
- Do not edit Stripe, Supabase, Google, or Twilio production settings without understanding which live flow uses them.
- Do not create local SEO pages by copying the same text and replacing only the city name.
- Do not add every local page to the main navigation.
- Do not make customer quote photos public.
- Do not trust a payment based only on the customer’s browser; wait for Stripe confirmation.
- Do not deploy unreviewed local files.
- Do not assume a desktop-only check proves the mobile form works.

## Production Source of Truth

GitHub contains the source code intended for deployment. Vercel builds that source and serves it at [www.imancleaningservice.com](https://www.imancleaningservice.com).

The complete live system also depends on private Vercel environment variables and the settings inside Supabase, Stripe, Google, Twilio, OpenAI, Vertex AI, and ElevenLabs.

Therefore:

- The same GitHub commit deployed to the same Vercel project with the same environment settings should produce the same website.
- Changing an external service or environment variable can change backend behavior even when the GitHub files have not changed.
- Website code, deployment configuration, and external-service settings must all be treated as parts of one production system.
