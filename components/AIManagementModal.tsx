import React, { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Send, ShieldAlert, X } from 'lucide-react';
import { Product } from '../types';

interface AIManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onExecuted?: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export const AIManagementModal: React.FC<AIManagementModalProps> = ({ isOpen, onClose, products, onExecuted }) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '你好！我是AI管理助手。你可以描述库存变更意图，我会先生成执行计划，确认后调用 Agent 执行库存增删改查。' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingConfirmMessage, setPendingConfirmMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages, isLoading]);

  const buildSnapshot = () => {
    return products.slice(0, 200).map((item) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      size: item.size,
      stock: item.stock,
      warehouse: item.warehouse || '',
      cost: item.price
    }));
  };

  const handleSend = async () => {
    const userMessage = input.trim();
    if (!userMessage || isLoading) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_AGENT_MANAGE_API_URL || '/api/agent/manage';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
          inventorySnapshot: buildSnapshot(),
          confirm: false
        })
      });
      const raw = await response.text();
      let data: any = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(`AI 管理接口返回非 JSON 响应（HTTP ${response.status}）`);
        }
      }
      if (!response.ok) {
        throw new Error(data.error || `AI 管理调用失败（HTTP ${response.status}）`);
      }
      if (data.conversationId) setConversationId(data.conversationId);
      const shouldConfirm = Boolean(data.requiresConfirmation);
      setPendingConfirmMessage(shouldConfirm ? userMessage : null);
      if (!shouldConfirm && data.executed) {
        onExecuted?.();
      }
      const suffix = shouldConfirm
        ? '\n\n请先点击“确认执行”再进入执行阶段。'
        : (data.executed ? '\n\n已完成执行。' : (data.dryRun ? '\n\n本次未实际执行。' : ''));
      setMessages((prev) => [...prev, { role: 'assistant', content: `${data.reply || '已收到指令。'}${suffix}` }]);
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `处理失败：${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmExecute = async () => {
    if (!pendingConfirmMessage || isLoading) return;
    setIsLoading(true);
    setMessages((prev) => [...prev, { role: 'user', content: '确认执行' }]);
    try {
      const apiUrl = import.meta.env.VITE_AGENT_MANAGE_API_URL || '/api/agent/manage';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: pendingConfirmMessage,
          conversationId,
          inventorySnapshot: buildSnapshot(),
          confirm: true
        })
      });
      const raw = await response.text();
      let data: any = {};
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error(`AI 管理接口返回非 JSON 响应（HTTP ${response.status}）`);
        }
      }
      if (!response.ok) {
        throw new Error(data.error || `AI 管理调用失败（HTTP ${response.status}）`);
      }
      if (data.conversationId) setConversationId(data.conversationId);
      const suffix = data.executed ? '\n\n执行完成。' : '\n\n已确认，但 Agent 未返回已执行标记。';
      setMessages((prev) => [...prev, { role: 'assistant', content: `${data.reply || '已确认执行。'}${suffix}` }]);
      if (data.executed) {
        onExecuted?.();
      }
      setPendingConfirmMessage(null);
    } catch (error: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `确认失败：${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-md h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-zinc-800">
        <div className="p-4 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900">
          <div className="flex items-center space-x-2">
            <div className="bg-cyan-100 dark:bg-cyan-900/30 p-2 rounded-xl">
              <Bot size={20} className="text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">AI 管理</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">自然语言生成库存执行计划</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} className="text-slate-500 dark:text-zinc-400" />
          </button>
        </div>

        <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 flex items-start space-x-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>库存变更采用二次确认，点击“确认执行”后才会触发 Agent 执行工具。</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-black/50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-cyan-600 text-white rounded-tr-none'
                    : 'bg-white dark:bg-zinc-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-zinc-700 rounded-tl-none shadow-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-800 p-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-zinc-700 shadow-sm flex items-center space-x-2">
                <Loader2 size={16} className="animate-spin text-cyan-500" />
                <span className="text-xs text-slate-400">正在生成执行计划...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800">
          {pendingConfirmMessage && (
            <div className="mb-2 rounded-xl border border-cyan-200 dark:border-cyan-900/40 bg-cyan-50 dark:bg-cyan-950/20 p-2.5 flex items-center justify-between">
              <span className="text-[11px] text-cyan-700 dark:text-cyan-300">已生成执行计划，请确认后继续。</span>
              <button
                onClick={handleConfirmExecute}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-medium bg-cyan-600 text-white rounded-lg disabled:opacity-50"
              >
                确认执行
              </button>
            </div>
          )}
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="例如：新增货号KK1391，品牌耐克，42码，数量9..."
              className="flex-1 px-4 py-3 bg-slate-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 dark:text-white placeholder:text-slate-400"
              disabled={isLoading}
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="p-3 bg-cyan-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
