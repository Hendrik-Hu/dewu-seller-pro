# AI Manager Edge Function

This function is the safe backend boundary for the home-page AI manager.

Frontend flow:

1. User sends a natural-language inventory command.
2. The app calls `supabase.functions.invoke('ai-manager')`.
3. This function authenticates the current Supabase user.
4. It sends the message and inventory context to Coze when `COZE_AGENT_URL` is configured.
5. It executes approved `inbound` / `outbound` actions with the service role key.

Required Supabase secrets:

```bash
supabase secrets set COZE_AGENT_URL="https://jth5z746wp.coze.site/stream_run"
supabase secrets set COZE_AGENT_TOKEN="optional-token"
supabase secrets set COZE_PROJECT_ID="7638280101796446249"
```

Coze should return JSON in this shape:

```json
{
  "reply": "已确认，准备入库。",
  "actions": [
    {
      "type": "inbound",
      "input": {
        "sku": "DD1391-100",
        "size": "42",
        "quantity": 2,
        "cost": 749,
        "name": "Nike Dunk Low Panda",
        "brand": "Nike",
        "warehouse": "杭州一号仓"
      }
    }
  ]
}
```

Supported actions:

```json
{ "type": "inbound", "input": { "sku": "string", "size": "string", "quantity": 1, "cost": 0, "name": "string", "brand": "string", "warehouse": "string", "location": "string", "imageUrl": "string" } }
{ "type": "outbound", "input": { "sku": "string", "size": "string", "quantity": 1, "salePrice": 0, "warehouse": "string" } }
{ "type": "answer", "message": "string" }
```

If `COZE_AGENT_URL` is not set, the function uses a small fallback parser so the UI can still be tested with simple Chinese commands.
