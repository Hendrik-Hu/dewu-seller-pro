# AI Manager Edge Function

This function is the safe backend boundary for the home-page AI manager.

Frontend flow:

1. User sends a natural-language inventory command.
2. The app calls `supabase.functions.invoke('ai-manager')`.
3. This function authenticates the current Supabase user.
4. It reads the current user's active products, warehouses, and activity ledger from Supabase.
5. It sends a deterministic compact summary and relevant SKU rows to Dify when `DIFY_API_KEY` is configured.
6. It returns a dry-run execution plan with structured actions.
7. The frontend asks the user to confirm.
8. The frontend sends the confirmed plan back with a signed `planToken`.
9. This function verifies the signature, reloads authoritative data, then executes approved actions through the shared atomic inventory RPCs.

Required Supabase secrets:

```bash
supabase secrets set DIFY_API_KEY="app-xxxx"
supabase secrets set DIFY_BASE_URL="https://api.dify.ai/v1"
supabase secrets set AI_MANAGER_SIGNING_SECRET="replace-with-a-random-secret"
```

Important:

- Dify is the primary agent provider for this project. The function calls `POST /workflows/run` with `response_mode=blocking`.
- The Dify workflow should return an object at `outputs.result` matching the JSON shape below.
- Because Dify input form fields can be length-limited, this function sends a compact server-generated summary to `context_json` instead of trusting client inventory data.
- If no external agent is available, the function falls back to a simple local parser so the UI can still handle basic Chinese inventory commands.

Dify `result` should return JSON in this shape:

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

Notes:

- The external AI workflow is responsible for understanding intent and producing `actions`.
- The external AI workflow should not claim it has already written the database.
- The database write happens only inside this Edge Function after plan confirmation.
- If `DIFY_API_KEY` is not set, the function uses the explicitly identified local fallback parser.

Supported actions:

```json
{ "type": "inbound", "input": { "sku": "string", "size": "string", "quantity": 1, "cost": 0, "name": "string", "brand": "string", "warehouse": "string", "location": "string", "source": "string", "imageUrl": "string" } }
{ "type": "outbound", "input": { "sku": "string", "size": "string", "quantity": 1, "salePrice": 0, "warehouse": "string" } }
{ "type": "answer", "message": "string" }
```

If no external AI provider is available, the function uses a small fallback parser so the UI can still be tested with simple Chinese commands.
