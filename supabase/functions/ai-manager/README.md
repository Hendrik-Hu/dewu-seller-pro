# AI Manager Edge Function

This function is the safe backend boundary for the home-page AI manager.

Frontend flow:

1. User sends a natural-language inventory command.
2. The app calls `supabase.functions.invoke('ai-manager')`.
3. This function authenticates the current Supabase user.
4. It sends the message and inventory context to Dify when `DIFY_API_KEY` is configured.
5. It returns a dry-run execution plan with structured actions.
6. The frontend asks the user to confirm.
7. The frontend sends the confirmed plan back with a signed `planToken`.
8. This function verifies the signature, then executes approved `inbound` / `outbound` actions with the service role key.

Required Supabase secrets:

```bash
supabase secrets set DIFY_API_KEY="app-xxxx"
supabase secrets set DIFY_BASE_URL="https://api.dify.ai/v1"
supabase secrets set AI_MANAGER_SIGNING_SECRET="replace-with-a-random-secret"
```

Optional Coze fallback secrets:

```bash
supabase secrets set COZE_AGENT_URL="https://jth5z746wp.coze.site/stream_run"
supabase secrets set COZE_AGENT_TOKEN="optional-token"
supabase secrets set COZE_PROJECT_ID="7638280101796446249"
```

Important:

- Dify is the primary agent provider for this project. The function calls `POST /workflows/run` with `response_mode=blocking`.
- The Dify workflow should return an object at `outputs.result` matching the JSON shape below.
- Because Dify input form fields can be length-limited, this function sends a compact serialized inventory summary to `context_json` instead of the full raw product list.
- If Dify is unavailable, the function can optionally try Coze when `COZE_AGENT_URL` is configured.
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
- If `DIFY_API_KEY` is not set, the function can use Coze or the local fallback parser.

Supported actions:

```json
{ "type": "inbound", "input": { "sku": "string", "size": "string", "quantity": 1, "cost": 0, "name": "string", "brand": "string", "warehouse": "string", "location": "string", "imageUrl": "string" } }
{ "type": "outbound", "input": { "sku": "string", "size": "string", "quantity": 1, "salePrice": 0, "warehouse": "string" } }
{ "type": "answer", "message": "string" }
```

If no external AI provider is available, the function uses a small fallback parser so the UI can still be tested with simple Chinese commands.
