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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const token = process.env.COZE_STREAM_TOKEN || process.env.COZE_PAT;
  const streamRunUrl = process.env.COZE_STREAM_RUN_URL;
  const projectId = Number(process.env.COZE_PROJECT_ID);
  if (!token || !streamRunUrl || !projectId) {
    res.status(500).json({ error: '服务端缺少 stream_run 配置' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const message = String(body.message || '').trim();
  const context = String(body.context || '').trim();
  const conversationId = String(body.conversationId || '').trim() || undefined;
  const userId = String(body.userId || 'dewu-seller-pro-user').trim();
  const sessionId = conversationId || `${userId}-${Date.now()}`;

  if (!message) {
    res.status(400).json({ error: 'message 不能为空' });
    return;
  }

  const prompt = context ? `${context}\n\n用户问题：${message}` : message;

  try {
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
    if (!response.ok) {
      res.status(response.status).json({
        error: `stream_run 调用失败（HTTP ${response.status}）: ${raw.slice(0, 200)}`
      });
      return;
    }
    const reply = resolveReplyFromRaw(raw, response.headers.get('content-type'));

    res.status(200).json({
      reply,
      conversationId: sessionId
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message || 'Agent 调用失败'
    });
  }
}
