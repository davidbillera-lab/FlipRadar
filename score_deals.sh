#!/bin/bash
curl -v -X POST "$SCHEDULED_TASK_ENDPOINT_BASE/api/scheduled/deals.processDeals" \
  -H "Content-Type: application/json" \
  -H "Cookie: app_session_id=$SCHEDULED_TASK_COOKIE" \
  -d "{}"
