# Research Engine Capture Architecture

This document describes the AutoData Research Pipeline, which heavily leverages a Manifest V3 Chrome Extension targeted at Copart to scrape market data visually and submit it synchronously to a deployed Supabase Edge Function (`research-capture`).

## Core Mechanics
1. **The Extension**: Runs a background service worker alongside an active lot DOM parser. It listens natively for commands initiated via the Extension Popup UI.
2. **The Extraction**: DOM scraping occurs natively using Copart's `dataset` attributes (e.g., `data-uname`). 
3. **The API Routing**: Data is piped strictly over HTTPS payloads via a `fetch` loop routing towards `https://xrotvpuainpfdulhfhtt.supabase.co/functions/v1/research-capture` authenticated by `X-Research-Secret`.

## Configuration & Secrets Management

To deploy this securely, the architecture mandates configuring explicit Supabase Vault Secrets.

Execute the following via Supabase CLI in root:

```bash
# Push Secure Key to Supabase Vault
supabase secrets set RESEARCH_CAPTURE_SECRET="your_custom_secret_key_here"
```

Then, configure the Local Chrome Extension variables:
1. Open the Chrome Extension menu and navigate to **Extension Options** for **AutoData Research Capture**.
2. Supply the valid `Supabase URL`.
3. Enter exactly the same custom key utilized above.
4. Click Save. The plugin will retain securely off-disk via the `chrome.storage.local` API.
