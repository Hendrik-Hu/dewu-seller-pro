import http from 'node:http';

const port = Number(process.env.LOCAL_AGENT_PORT || 3001);

const json = (res, statusCode, data) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  });
  res.end(JSON.stringify(data));
};

const resolveReplyFromRaw = (raw, contentType) => {
  const answerParts = [];
  const normalizedType = String(contentType || '').toLowerCase();
  if (normalizedType.includes('text/event-stream') || raw.includes('\ndata:') || raw.startsWith('data:')) {
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === '[DONE]') continue;
      try {
        const data = JSON.parse(chunk);
        const answer = data?.content?.answer;
        if (typeof answer === 'string' && answer.trim()) {
          answerParts.push(answer);
        }
      } catch {
        continue;
      }
    }
    const joined = answerParts.join('').trim();
    if (joined) return joined;
  } else {
    try {
      const data = JSON.parse(raw);
      const answer = data?.content?.answer || data?.answer || data?.reply;
      if (typeof answer === 'string' && answer.trim()) return answer.trim();
    } catch {
      if (raw.trim()) return raw.trim();
    }
  }
  return '抱歉，我暂时无法回答。';
};

const tryParseStructuredResult = (text) => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const jsonBlock = normalized.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const candidate = jsonBlock || normalized;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch {
    return null;
  }
};

const callStreamRun = async ({ token, streamRunUrl, projectId, sessionId, prompt }) => {
  const response = await fetch(streamRunUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: {
        query: {
          prompt: [
            {
              type: 'text',
              content: {
                text: prompt
              }
            }
          ]
        }
      },
      type: 'query',
      session_id: sessionId,
      project_id: projectId
    })
  });
  const raw = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    raw,
    contentType: response.headers.get('content-type')
  };
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS'
    });
    res.end();
    return;
  }

  if (!['/api/agent/chat', '/api/agent/manage'].includes(req.url) || req.method !== 'POST') {
    json(res, 404, { error: 'Not Found' });
    return;
  }

  let payload = '';
  req.on('data', (chunk) => {
    payload += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const body = payload ? JSON.parse(payload) : {};
      const message = String(body.message || '').trim();
      const context = String(body.context || '').trim();
      const confirm = Boolean(body.confirm);
      const conversationId = String(body.conversationId || '').trim() || undefined;
      const userId = String(body.userId || 'dewu-seller-pro-user').trim();
      const sessionId = conversationId || `${userId}-${Date.now()}`;

      if (!message) {
        json(res, 400, { error: 'message 不能为空' });
        return;
      }

      const isManage = req.url === '/api/agent/manage';
      const token = isManage
        ? (process.env.COZE_MANAGE_STREAM_TOKEN || process.env.COZE_STREAM_TOKEN || process.env.COZE_PAT)
        : (process.env.COZE_STREAM_TOKEN || process.env.COZE_PAT);
      const streamRunUrl = isManage
        ? (process.env.COZE_MANAGE_STREAM_RUN_URL || process.env.COZE_STREAM_RUN_URL)
        : process.env.COZE_STREAM_RUN_URL;
      const projectId = Number(isManage
        ? (process.env.COZE_MANAGE_PROJECT_ID || process.env.COZE_PROJECT_ID)
        : process.env.COZE_PROJECT_ID);
      if (!token || !streamRunUrl || !projectId) {
        json(res, 500, { error: isManage ? '服务端缺少 AI 管理 stream_run 配置' : '服务端缺少 stream_run 配置' });
        return;
      }

      const prompt = isManage
        ? `${context || '你是得物卖家库存管理 Agent，支持 add_inventory、query_inventory、update_inventory、delete_inventory。'}\n\n${confirm
          ? '用户已确认执行。请直接调用工具执行库存操作，并返回 JSON：{"summary":"...","executed":true,"actions":[...],"resultCount":0}。'
          : '请先只做执行计划，不要修改库存。返回 JSON：{"summary":"...","executed":false,"actions":[...],"resultCount":0}。'}\n${JSON.stringify({
          task: confirm ? 'inventory_management_execute' : 'inventory_management_plan',
          instruction: message,
          inventory_snapshot: Array.isArray(body.inventorySnapshot) ? body.inventorySnapshot.slice(0, 200) : [],
          execute_confirmed: confirm
        })}`
        : (context ? `${context}\n\n用户问题：${message}` : message);

      const result = await callStreamRun({ token, streamRunUrl, projectId, sessionId, prompt });
      if (!result.ok) {
        json(res, result.status, {
          error: `stream_run 调用失败（HTTP ${result.status}）: ${result.raw.slice(0, 200)}`
        });
        return;
      }
      const reply = resolveReplyFromRaw(result.raw, result.contentType);
      const structured = tryParseStructuredResult(reply);
      const executed = structured?.executed === true;
      const actions = Array.isArray(structured?.actions) ? structured.actions : [];
      const summary = typeof structured?.summary === 'string' && structured.summary.trim() ? structured.summary.trim() : reply;

      if (isManage) {
        json(res, 200, {
          reply: summary,
          conversationId: sessionId,
          dryRun: !confirm || !executed,
          requiresConfirmation: !confirm,
          executionConfirmed: confirm,
          actions,
          pendingIntegration: false,
          executed
        });
        return;
      }

      json(res, 200, { reply, conversationId: sessionId });
    } catch (error) {
      json(res, 500, {
        error: error?.message || 'Agent 调用失败'
      });
    }
  });
});

server.listen(port, () => {
  console.log(`Local agent API running at http://localhost:${port}/api/agent/chat and /api/agent/manage`);
});
