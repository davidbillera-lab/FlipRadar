# FlipRadar - Resale Arbitrage Agent

This repository contains the automation scripts for FlipRadar, a resale arbitrage tool designed to identify deals, look up eBay comps, and calculate ROI.

## Components

- `score_deals.sh`: A script to trigger the deal scoring process via the FlipRadar API.

## How to Run

Ensure the following environment variables are set:
- `SCHEDULED_TASK_ENDPOINT_BASE`: The base URL for the FlipRadar API.
- `SCHEDULED_TASK_COOKIE`: The session cookie for authentication.

Run the script:
```bash
./score_deals.sh
```
