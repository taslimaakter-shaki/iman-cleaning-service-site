# Global On-Demand Cleaning Marketplace MVP Spec

## 1. Product Vision

Build a premium, technology-driven marketplace that connects clients with verified residential and commercial cleaning professionals in real time.

The long-term vision is to become the global standard for booking trusted cleaning services, combining the simplicity of Uber, the trust layer of Airbnb, and the polished product experience of Apple and Stripe.

The MVP should launch first in New York City using the founder's existing cleaning operation as the initial supply network. This reduces marketplace risk, allows direct quality control, and creates operational data before opening the platform to external cleaners and cleaning companies.

## 2. MVP Goal

The first version should prove that customers can:

- Book cleaning services easily from mobile or desktop.
- Receive clear pricing or an estimate before confirming.
- Pay securely online.
- Track job status from request to completion.
- Trust the cleaner through verification, reviews, and before/after proof.

The first version should prove that cleaners/admin operators can:

- Receive and manage jobs.
- Confirm availability.
- View job details and property information.
- Upload before/after photos.
- Mark jobs complete.
- Track revenue and operational performance.

## 3. Primary User Types

### Client

Clients are homeowners, renters, Airbnb hosts, office managers, property managers, and business owners who need reliable cleaning services.

Client priorities:

- Fast booking
- Transparent pricing
- Trust and safety
- Professional results
- Easy communication
- Reliable recurring service

### Cleaner

Cleaners are individual professionals, internal company staff, or external cleaning companies.

Cleaner priorities:

- Clear job details
- Flexible scheduling
- Fair pay
- Fast payouts
- Reputation growth
- Easy navigation and communication

### Admin

Admins manage operations, bookings, payments, approvals, disputes, pricing, and city expansion.

Admin priorities:

- Operational visibility
- Booking control
- Cleaner quality control
- Revenue tracking
- Customer support
- Fraud and dispute management

## 4. MVP Service Categories

The MVP should support these cleaning types:

- Standard residential cleaning
- Deep cleaning
- Move-in/move-out cleaning
- Airbnb turnover cleaning
- Office cleaning
- Commercial cleaning request

Commercial cleaning can start as a quote-request flow rather than full instant booking, because pricing may depend on square footage, business type, cleaning frequency, access rules, and contract terms.

## 5. Client App Features

### Account

- Sign up with email, phone, Google, or Apple.
- Login/logout.
- Manage profile, phone number, address, and payment methods.

### Booking Flow

Client can:

- Choose service type.
- Enter property address.
- Enter property type: apartment, house, office, retail, restaurant, warehouse, gym, Airbnb, other.
- Enter bedrooms, bathrooms, square footage, and floor/access details.
- Select add-ons such as fridge cleaning, oven cleaning, laundry, window interior, cabinet interior, pet hair, carpet spot cleaning, post-construction dust, or supply request.
- Upload photos or short videos.
- Select one-time, same-day, emergency, or recurring service.
- Choose date and time.
- See estimated duration, cleaner count, and price range.
- Confirm booking and pay online.

### Booking Status

Statuses:

- Requested
- Estimate pending
- Confirmed
- Cleaner assigned
- Cleaner en route
- In progress
- Completed
- Reviewed
- Cancelled
- Refunded

### Payments

- Secure card payment.
- Hold payment at booking.
- Capture payment after confirmation or completion, depending on policy.
- Support promo codes.
- Display receipts.

### Communication

- In-app chat between client and assigned cleaner/admin.
- Booking-specific messages.
- Notifications by email, SMS, and push notification when available.

### Reviews

- Star rating.
- Written review.
- Optional private feedback.
- Before/after photo review for quality control.

### Recurring Cleaning

Client can request:

- Weekly
- Biweekly
- Monthly
- Custom recurring schedule

Recurring flow can be partially manual in MVP, with admin approval before final confirmation.

## 6. Cleaner App Features

### Cleaner Onboarding

Cleaner can:

- Create account.
- Submit legal name, phone, email, address, and profile photo.
- Upload ID document.
- Upload cleaning experience details.
- Select service categories.
- Set service area.
- Add availability.
- Submit certifications, insurance, or business documents if applicable.

### Verification

Cleaner approval statuses:

- Draft
- Submitted
- Under review
- Approved
- Rejected
- Suspended

### Job Management

Cleaner can:

- View available jobs.
- Accept or decline job requests.
- View job address after assignment.
- See service type, property details, photos, notes, add-ons, estimated time, and payout.
- Navigate to location.
- Update job status.
- Upload before/after photos.
- Mark job complete.

### Earnings

Cleaner can:

- View completed jobs.
- View expected payout.
- Track weekly/monthly earnings.
- See commission and deductions.

MVP payouts can be managed manually by admin while the UI displays earnings history.

## 7. Admin Dashboard Features

### Overview

Admin dashboard should show:

- Total bookings
- Active bookings
- Completed bookings
- Cancelled bookings
- Gross revenue
- Net revenue
- Cleaner payouts
- Average rating
- Pending cleaner approvals
- Open support issues

### User Management

Admin can:

- View clients.
- View cleaners.
- Edit user status.
- Suspend users.
- Review activity history.

### Cleaner Approval

Admin can:

- Review cleaner profiles.
- View uploaded documents.
- Approve/reject cleaners.
- Add internal notes.
- Assign service areas.
- Set cleaner tier or commission rate.

### Booking Management

Admin can:

- View all bookings.
- Create manual booking.
- Assign cleaner.
- Reassign cleaner.
- Change booking status.
- Adjust price.
- Add admin notes.
- Cancel or refund booking.

### Pricing Management

Admin can configure:

- Base price by service type.
- Bedroom/bathroom multipliers.
- Square footage multipliers.
- Add-on pricing.
- Same-day/emergency surcharge.
- City/region pricing.
- Cleaner commission.

### Support and Disputes

Admin can:

- View client complaints.
- View cleaner issues.
- Review before/after photos.
- Issue partial/full refunds.
- Record dispute outcome.

## 8. AI Features for MVP

AI should support the booking process without becoming a blocker for launch.

### AI Estimate Assistant

Inputs:

- Service type
- Property type
- Bedrooms/bathrooms
- Square footage
- Photos/videos
- Client notes
- Add-ons
- Location

Outputs:

- Estimated cleaning time
- Recommended cleaner count
- Difficulty level
- Price range
- Suggested add-ons
- Admin confidence score

In the MVP, AI estimates should be reviewable by admin before final confirmation for complex, commercial, or high-value jobs.

### AI Matching Logic

Initial matching should rank cleaners by:

- Distance
- Availability
- Rating
- Service category fit
- Response speed
- Past completion rate
- Language preference if provided

The first version can use rule-based ranking and later evolve into machine learning.

### AI Moderation

AI can flag:

- Suspicious messages
- Unsafe job notes
- Low-quality photo uploads
- Potential fraud
- Repeated cancellation patterns

## 9. Suggested Data Model

Core tables/entities:

- Users
- ClientProfiles
- CleanerProfiles
- CleanerDocuments
- Addresses
- Services
- ServiceAddOns
- Bookings
- BookingPhotos
- BookingStatusHistory
- Payments
- Payouts
- Reviews
- Messages
- Disputes
- PromoCodes
- PricingRules
- Cities
- AdminNotes

## 10. Key Booking Flow

1. Client creates account or continues as guest.
2. Client selects cleaning type.
3. Client enters property details.
4. Client uploads photos/videos.
5. System generates estimate.
6. Client chooses date/time.
7. Client confirms booking and payment method.
8. Admin/system assigns cleaner.
9. Cleaner accepts job.
10. Client receives confirmation.
11. Cleaner updates status during job.
12. Cleaner uploads before/after photos.
13. Job is marked complete.
14. Payment is captured or finalized.
15. Client leaves review.
16. Cleaner earnings update.

## 11. Pricing Model

MVP pricing should combine fixed base rates and dynamic adjustments.

Example pricing factors:

- Service type
- Property type
- Bedrooms
- Bathrooms
- Square footage
- Add-ons
- Cleaning difficulty
- Same-day urgency
- Cleaner count
- City/region

Commercial cleaning should support quote requests for:

- Offices
- Restaurants
- Retail stores
- Gyms
- Warehouses
- Medical or specialized spaces

## 12. Trust and Safety

Trust should be treated as a core product feature.

MVP trust features:

- Cleaner ID verification
- Admin approval before receiving jobs
- Profile photo
- Ratings and reviews
- Before/after photo proof
- Secure payments
- Booking status tracking
- Support/dispute workflow
- Cleaner suspension tools

Future trust features:

- Background check integration
- Insurance verification
- Identity verification API
- Review fraud detection
- Cleaner badges
- Business license verification

## 13. Recommended MVP Tech Stack

Frontend:

- Next.js or React
- Tailwind CSS
- Mobile-first responsive UI

Backend:

- Node.js/NestJS, Django, Laravel, or Supabase-backed API
- PostgreSQL database

Payments:

- Stripe
- Stripe Connect later for cleaner payouts

Authentication:

- Clerk, Auth0, Supabase Auth, or custom auth

Storage:

- S3-compatible storage for photos/videos

Notifications:

- Email via Resend, SendGrid, or Postmark
- SMS via Twilio
- Push notifications later

Maps:

- Google Maps or Mapbox

AI:

- OpenAI vision-capable model for photo-based estimate support
- Rule-based pricing engine with admin override

## 14. Launch Strategy

### Phase 1: NYC Controlled Launch

- Use founder's own cleaning company as supply.
- Launch residential, deep cleaning, move-in/move-out, Airbnb turnover, and office cleaning.
- Keep cleaner onboarding internal/admin-controlled.
- Use admin review for complex AI estimates.
- Collect before/after photos and quality data.

### Phase 2: External Cleaner Onboarding

- Allow independent cleaners and cleaning companies to apply.
- Add document verification.
- Add cleaner availability and service area controls.
- Add payout automation.

### Phase 3: Multi-City U.S. Expansion

- Add city-level pricing rules.
- Add city managers/admin roles.
- Expand region-by-region.
- Build supply before demand campaigns in each city.

### Phase 4: International Expansion

- Add multi-currency support.
- Add localization.
- Add country-specific compliance.
- Add regional pricing and tax rules.

## 15. MVP Success Metrics

Operational:

- Booking conversion rate
- Average response time
- Cleaner acceptance rate
- Job completion rate
- Cancellation rate
- Refund/dispute rate

Customer:

- Average rating
- Repeat booking rate
- Recurring subscription conversion
- Customer acquisition cost
- Customer lifetime value

Cleaner:

- Cleaner retention
- Average earnings
- Acceptance rate
- On-time completion rate
- Review score

Business:

- Gross booking value
- Net revenue
- Commission revenue
- Revenue per booking
- Monthly active clients
- Monthly active cleaners

## 16. MVP Build Priorities

### Must Have

- Client booking flow
- Admin dashboard
- Cleaner profile and approval
- Booking assignment
- Online payments
- Photo uploads
- Reviews
- Basic pricing engine
- Email/SMS notifications

### Should Have

- Cleaner mobile dashboard
- AI-assisted estimates
- In-app chat
- Recurring booking requests
- Promo codes
- Before/after photo workflow

### Later

- Full cleaner marketplace
- Instant payouts
- Advanced AI matching
- Commercial contract portal
- Insurance integrations
- Multi-city admin controls
- Mobile native apps

## 17. Product Positioning

Suggested positioning:

"Book trusted cleaners for homes, offices, and short-term rentals in minutes."

Suggested tagline:

"Premium cleaning, instantly booked."

Alternative tagline:

"The easiest way to book trusted cleaning professionals."

## 18. Next Deliverables

Recommended next documents:

- Landing page copy
- Investor pitch deck
- Full database schema
- Wireframes for client, cleaner, and admin flows
- Technical architecture diagram
- Development roadmap with milestones
