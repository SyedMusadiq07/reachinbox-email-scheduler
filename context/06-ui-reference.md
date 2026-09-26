# UI Reference — Supplied Figma Screenshots

The supplied Figma file has export/copy disabled, so the candidate provided screenshots as the visual reference. These screenshots are stored in `context/figma/`.

## Login

Reference: `context/figma/login-screen.png`

Observed:

- full white canvas
- centered login card
- thin light-gray border
- rounded card corners
- `Login` heading centered
- pale green Google button
- divider text between Google and email/password form
- light gray email/password inputs
- green `Login` button
- overall minimal, spacious style

## Scheduled dashboard

Reference: `context/figma/homepage-scheduled.png`

Observed:

- white page
- left sidebar
- Reach/Outbox Labs-style monochrome logo at top
- user block with avatar/name/email/dropdown
- outlined green `Compose` button
- CORE navigation with `Scheduled` selected and count
- `Sent` navigation item and count
- top search field
- filter icon
- refresh icon
- email rows with recipient, schedule/status chip, subject/preview, star icon
- thin row separators

## Sent dashboard

Reference: `context/figma/homepage-sent.png`

Observed:

- same sidebar/header structure
- `Sent` selected
- email rows with `Sent` status chip
- recipient, subject, preview and star affordance

## Email detail

Reference: `context/figma/email-detail.png`

Observed:

- back arrow + message title
- top-right message actions
- sender avatar/name/email
- recipient line
- message timestamp
- email body
- highlighted callout block
- attachments displayed below message body

## Compose — initial

Reference: `context/figma/compose-initial.png`

Observed:

- full-page composer rather than a centered modal
- back arrow + `Compose New Email`
- `From` selector
- `To` field
- `Upload List` affordance
- `Subject` field
- `Delay between 2 emails` input
- `Hourly Limit` input
- rich-text editor area and toolbar
- attachment/clock controls at upper right
- `Send Later` button
- clicking scheduling control exposes the `Send Later` panel

## Compose — scheduling panel

Reference: `context/figma/compose-schedule-panel.png`

Observed:

- right-side `Send Later` panel
- date/time picker field
- preset options including Tomorrow and named times
- `Cancel` + green `Done` actions

## Compose — recipients

References:

- `context/figma/compose-recipients.png`
- `context/figma/compose-recipient-uploaded.png`

Observed:

- recipient chips rendered in the To row
- additional-recipient count chip such as `+4`
- `Upload List` remains available
- attached image/file preview can appear below the editor in the provided example

## Visual rule

Do not redesign these screens. Reproduce the observed layout and visual hierarchy as closely as practical in the implementation. When a new Figma screenshot is supplied, update this document and keep the corresponding reference image in `context/figma/`.
