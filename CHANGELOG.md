# Changelog

All notable changes to Postmill are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-10-14

### Added

- **AI Designer reference images now condition generation (img2img).** Reference images attached to a session are passed to the organization's `media/image-to-image` default for the background and hero image slots instead of being reduced to prose cues. The fallback order is image-to-image → text-to-image → stock, and every fallback is disclosed in the delivery note. The OpenRouter (gemini-image family) and Replicate (flux-kontext / flux-dev) media adapters accept a source image; a model that cannot take a reference now refuses rather than silently dropping it. Variant compose, quality-pass and format-expansion stages run three variants concurrently, and a failed generation is retried only when the failure is transient.
- AI Designer: "change the background" revisions now replace the background image (the request was previously dropped silently), and a revision that changes nothing is reported as unsupported instead of re-delivering the same design.

### Changed

- **Postmill is now owned and maintained by Postmill AI Inc.**, which succeeds REAA Technologies, Inc. The contributor license agreements (`ICLA.md`, `CCLA.md`), the documentation footer, the SDK package author and the security-policy scope name the new owner. The `@reaatech/*` packages Postmill builds on are unchanged and are credited in the README Acknowledgements.
- AI Designer: a run now requires a `media/text-to-image` model default. With no default configured, the run is blocked and points to **Settings → AI → Model Defaults**. A default that is configured but can't be resolved, such as a disabled provider, only adds a warning; the run continues with disclosed stock fallbacks. Stock stand-ins are disclosed whenever stock was not the deliberate choice.
- Design and template preview thumbnails and AI Designer intermediate files no longer appear in the **Files** library. `POST /files/upload-simple` accepts an optional `internal: 'design-preview'` marker.
- The root `package.json` version, and with it the OpenAPI `info.version`, now tracks the release version.

### Fixed

- AI: the LangChain generator workflow (the agent's "generate post" tool and autopost utility calls) failed with "Missing credentials" for every provider, because the deprecated `openAIApiKey` field is ignored by `@langchain/openai` 1.4.x. All construction sites now pass `apiKey`.
- Designer:
  - A crash when transforming nodes after a commit (stale Transformer nodes).
  - Text editing: doubled text, font reverting, size entry, gradient fill and justify alignment.
  - The label text of CTA symbols is now editable.
  - Layer effects (outer glow, drop shadow) now render.
  - Image aspect ratio is preserved on insert.
  - The resize popover no longer overflows the screen.
  - Exports download as expected.
  - Video clips added to the timeline get their real dimensions.
- Media: the Designer no longer uploads an orphan preview file every few seconds while editing.
- Team: invited users whose invite cookie had expired (15 minutes) while the 1-hour invite token was still valid were placed in a new personal workspace. The cookie now lasts as long as the token. Refused invite joins are logged, and creating a duplicate user returns 409.
- Storage: saving an R2 configuration without an endpoint returned a 500 and left a broken configuration row. It now returns 400 and rolls back, and the R2 endpoint is required.
- Instagram: common OAuth token-exchange failures now show a specific error instead of "Unknown Error".
- Sentry: requests the client aborted are no longer reported as errors.

### Security

- Closed 14 high/critical dependency advisories (#109).

## [1.1.0] - 2026-09-30

### Added

- **Payment providers.** Billing is now a ProviderKernel domain (`payments`): Stripe is one provider (`payments/stripe@v1`, package `libraries/providers/stripe`) behind a provider-neutral orchestrator (`PaymentsService`), and any provider can be added by implementing the `PaymentsCapability` contract — see `docs/developer-docs/payment-providers.md`. Shipped alongside Stripe: **PayPal** (hosted checkout through the Subscriptions API, `PAYPAL_*`), the **Apple App Store** (`APPLE_IAP_*`) and **Google Play** (`GOOGLE_PLAY_*`) for the upcoming mobile app — the server verifies store purchases (`POST /billing/native/verify`) and consumes App Store Server Notifications / Play Real-time Developer Notifications. The billing pages branch on the deployment's checkout mode (embedded Stripe form, hosted redirect, or app-store copy) and hide affordances a provider lacks (portal, proration, coupons, add-ons, resume). Providers are enabled purely by their `.env` keys; `PAYMENTS_PROVIDER` picks the web-checkout default when several are enabled. New routes: `POST /payments/webhooks/:provider`, `GET /billing/config`, `POST /billing/native/verify` (for app-store purchases), `GET /billing/check/:id?ref=`. Schema: `Organization.paymentProvider`, `Subscription.provider`, `provider` on the webhook ledger (migration `20260921160000_payments_provider_domain`; existing Stripe organizations are backfilled). A daily `payments-expire-canceled` job tears down subscriptions whose scheduled end passed for providers that cannot keep a cancelled subscription alive until period end (Stripe rows are excluded — its own webhook tears them down).

- Organization-wide AI budget: a hard ceiling on total AI spend across all providers (monthly/daily caps + alert threshold), set from the new card at the top of **Settings → AI → LLM Providers** or `PUT /settings/ai/budget`. Enforced independently of per-provider caps — every AI call, including the AI Designer, content pipeline, agent digests and the daily brief, is refused with HTTP 429 (`org_budget_exceeded`) once reached. The usage dashboard now shows the organization's remaining budget. Stored on new nullable `Organization.aiBudget*` columns (migration `20260921130000_add_org_ai_budget_columns`); any cap previously written through the API into the legacy `perOrgCaps` settings slice is migrated on first boot. Previously that endpoint accepted a cap, sent an 80% alert, and never enforced it.

- **Postmill ID ("Sign in with Postmill").** First-party SSO federation: first-party apps (starting with the template store) can authenticate users of any Postmill instance — cloud or self-hosted — and receive verified identity claims (user id, name, email, avatar, and the consenting organization's id, name and role). No client registration or secrets: the client is pinned by a fixed audience and the `FEDERATION_TRUSTED_REDIRECT_URIS` allow-list (default `https://templates.postmill.ai/auth/callback/postmill`, exact match), and the code exchange is public-client PKCE (S256 mandatory). Each instance generates its own RS256 signing key on first use, encrypted at rest — self-hosters configure nothing. New endpoints: `/.well-known/postmill-identity`, `/federation/jwks`, `/federation/authorize`, `/federation/token`, `/federation/userinfo` (GET and POST), and grant list/revoke under `/user/approved-apps/federation`; the approved-apps page gains a "Postmill ID sign-ins" section. Claims are scope-gated (`profile`/`email`/`org` only). Schema: new `InstanceIdentity` and `FederationGrant` tables (migration `20260923094158_postmill_id_federation`). Relying-party contract: `docs/developer-docs/postmill-id.md`. The existing OAuth-app / MCP OAuth flow is unchanged.

- UI languages: **Dutch**, **Indonesian** and **Polish** (16 languages in total), with full catalogs and dayjs calendar locales.

### Changed

- Provider catalog metadata: modules that serve no AI/media/payments default surface (social, storage, shortlink, VPN, email, auth, comms, content packs) now declare `domains: []` instead of the historical `['media']` placeholder, and a kernel spec enforces the rule per module (the Google auth and Vultr storage modules got their own metadata files instead of inheriting the sibling AI module's `['ai']`). `PROVIDERS_INVENTORY.md` gains the auth rows it was missing (apple, facebook, linkedin, x) and the suno media row. No behaviour change — the field is not served over HTTP.
- Payment providers: an organization stays locked to the provider it first subscribed through, even after lapsing (documented; refused cross-provider activations log the operator escape hatch; `GET /billing/config` exposes `org.lockedTo`). Native-only deployments now show never-subscribed workspaces the "purchase in the mobile app" copy instead of web purchase buttons. The nightly expiry job warns about Stripe subscriptions past their scheduled end with no teardown webhook. Payments provider modules declare `domains: ['payments']` in the catalog.
- The billing master switch is "at least one payment provider is configured" (`billingEnabled()`) instead of `STRIPE_PUBLISHABLE_KEY` presence. For a Stripe-only deployment nothing changes: the same three `STRIPE_*` variables enable it. Deliberate normalisation: the public-API "no subscription" check and publish-time subscription checks previously keyed on `STRIPE_SECRET_KEY`; they now follow the same switch, so a deployment that set only the secret key loses those checks and one that set only the publishable key gains them — set both, as documented.
- A Stripe webhook with a bad signature now answers **401** (was 500) on both `POST /stripe` and `POST /payments/webhooks/stripe`; Stripe retries any non-2xx, so delivery behaviour is unchanged — adjust alerting keyed on 5xx.
- Purchase conversion tracking no longer substitutes the plan list price when the provider does not report the charged amount; those payments are simply not tracked.
- Stripe's proration preview no longer requires the price nickname to match (the four other lookups never did); prices are still matched by product name, interval and amount.

### Deprecated

- `POST /stripe` — the Stripe webhook now lives at `POST /payments/webhooks/stripe`. The old route forwards to the same handler and will be removed in a later release; re-point the Stripe dashboard webhook.

### Fixed

- Payment providers: a lapsed app-store subscriber whose expiry webhook was missed (a zombie row with lapsed dunning grace or a scheduled end in the past) can resubscribe again, and the re-bind resets the stale grace marker and deferred downgrade so the new purchase is honoured. Apple: transient verification failures now answer 500 (Apple retries) instead of 401, notifications for another app or the other store environment are acknowledged without action, free introductory offers are reported as trials, and a notification without a UUID gets a deterministic id. Google: a native purchase is verified with one Play read, a push whose token Play now rejects is acknowledged instead of retried for a week, and a push without a message id gets a deterministic id.
- `POST /billing/apply-discount` applied the coupon without waiting for the eligibility check (the check was never awaited); it now honours it.
- Budget-exceeded responses from `/copilot/chat` and the post generator now carry `{ error: 'BudgetExceeded', message }` so the UI shows a friendly message instead of the raw reason string; the message no longer claims the cap is monthly and resets on the 1st.

- Provider errors are attributed to the provider. Every AI/media upstream failure (bad key, quota or billing limit, rate limit, invalid request, outage) is now a typed `ProviderUpstreamError` → HTTP **502** with `{ provider, providerName, kind, upstreamStatus, message, settingsUrl }`, and the UI names the provider ("Google AI Studio reports the account's quota or billing limit was reached…") instead of showing `{"statusCode":500,"message":"Internal server error"}`. Previously a raw AI-SDK error also made Nest replay the provider's HTTP status as Postmill's own — a provider 401 logged the user out, a provider 429 showed Postmill's rate-limit toast. All 36 media adapters, the LLM facade (`generateText`/`generateObject`/`*WithModel`/`languageModel`), the AI routes' catch-alls, the studio render queue and the dashboard/analytics/generator toasts are covered. Sentry only sees provider outages (warning level), not users' key/plan problems.
- AI: system prompts were sent as a parts array instead of a string (LanguageModelV2 shape), which Gemini rejects with `Unknown name "text" at 'system_instruction.parts[0]'` — dashboard brief, structured output and every `system`-prompted call on Google models failed. `generateTextWithModel` / `generateObjectWithModel` also silently dropped their `system` argument, and alt-text vision used the SDK v1 `{type:'image'}` part.
- Copilot `/copilot/chat` crashed with an unhandled `CopilotApiDiscoveryError` for every LangChain-backed provider (Cohere, Together AI, Azure, Fireworks, DeepSeek, xAI, Bedrock, Perplexity, Vertex, Mistral) since `@copilotkit/runtime` 1.69. The chat now runs an explicit agent on the organization's governed model, so the AI budget gate, prompt guardrails and spend telemetry actually apply again (they had been bypassed), and Google organizations use their own credentials instead of an env key. `/copilot/agent` no longer 500s for Azure, Bedrock and Vertex.
- Dates: 57 translated date-format strings (de, fr, it, ru, tr, es, pt, vi) had translated format tokens or unescaped literal words that dayjs could not parse; they now use valid tokens in each language's natural order.
- Signing in from a signed-out browser via an OAuth or Postmill ID consent link now returns to the consent screen after login instead of dropping the user on the dashboard.

### Security

- `POST /billing/native/verify` (mobile store-purchase verification) now carries a 10/min per-IP `@Throttle` instead of relying on the global hourly limit alone — each call costs an outbound App Store / Play verification round-trip.
- Dependency updates close newly published high/critical advisories in undici, brace-expansion, engine.io, `@xhmikosr/decompress`, nodemailer (now v10) and `@nestjs/microservices` (Nest core packages moved together to 11.2.7).
- The Sentry scrubber redacts Postmill ID secrets (`id_token`, `code_verifier`, `posf_` tokens), and tests pin that a `posf_` federation token can never be used as an organization API key.

## [1.0.0] - 2026-09-16

### Added

- Initial public release.
