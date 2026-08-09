import React, { useEffect, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Send, ShieldAlert, X, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AIManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuted?: () => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: ActionSummary[];
}

interface PlannedAction {
  type: 'inbound' | 'outbound' | 'answer';
  input?: Record<string, unknown>;
  message?: string;
}

interface ActionSummary {
  type: string;
  status: 'success' | 'failed' | 'planned' | 'answered';
  summary: string;
}

interface PendingPlan {
  sourceMessage: string;
  plannedActions: PlannedAction[];
  planToken: string;
  expiresAt?: string;
}

interface AiManagerResponse {
  reply: string;
  actions?: ActionSummary[];
  plannedActions?: PlannedAction[];
  planToken?: string | null;
  planExpiresAt?: string | null;
  requiresConfirmation?: boolean;
  executionConfirmed?: boolean;
  dryRun?: boolean;
  executed?: boolean;
  executable?: boolean;
}

const actionTypeLabel: Record<string, string> = {
  inbound: '入库',
  outbound: '出库',
  answer: '说明',
};

const statusBadgeClass: Record<ActionSummary['status'], string> = {
  planned: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-50 text-emerald-600',
  failed: 'bg-red-50 text-red-500',
  answered: 'bg-cyan-50 text-cyan-600',
};

export const AIManagementModal: React.FC<AIManagementModalProps> = ({
  isOpen,
  onClose,
  onExecuted,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '你好！我是 AI 助手。你可以让我分析库存和销售，也可以描述入库或出库动作。执行类请求会先生成计划，经过你确认后才写入库存和流水。',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isOpen, messages, isLoading, pendingPlan]);

  const pushAssistantMessage = (content: string, actions?: ActionSummary[]) => {
    setMessages((prev) => [...prev, { role: 'assistant', content, actions }]);
  };

  const requestPlan = async () => {
    const userMessage = input.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke<AiManagerResponse>('ai-manager', {
        body: {
          message: userMessage,
          confirm: false,
          history: messages.slice(-8).map((item) => ({ role: item.role, content: item.content })),
        },
      });

      if (error) throw error;
      if (!data) throw new Error('AI 管理服务没有返回内容');

      pushAssistantMessage(data.reply || '已生成库存执行计划。', data.actions || []);

      if (data.requiresConfirmation && data.planToken && (data.plannedActions || []).length > 0) {
        setPendingPlan({
          sourceMessage: userMessage,
          plannedActions: data.plannedActions || [],
          planToken: data.planToken,
          expiresAt: data.planExpiresAt || undefined,
        });
      } else {
        setPendingPlan(null);
      }
    } catch (error: any) {
      pushAssistantMessage(`处理失败：${error.message || '请稍后再试'}`);
      setPendingPlan(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmExecute = async () => {
    if (!pendingPlan || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', content: '确认执行' }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke<AiManagerResponse>('ai-manager', {
        body: {
          message: pendingPlan.sourceMessage,
          confirm: true,
          plannedActions: pendingPlan.plannedActions,
          planToken: pendingPlan.planToken,
        },
      });

      if (error) throw error;
      if (!data) throw new Error('AI 管理服务没有返回执行结果');

      pushAssistantMessage(data.reply || '执行完成。', data.actions || []);
      if (data.executed) {
        onExecuted?.();
      }
      setPendingPlan(null);
    } catch (error: any) {
      pushAssistantMessage(`确认失败：${error.message || '请重新生成执行计划'}`);
      setPendingPlan(null);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-md h-[82vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-zinc-800">
        <div className="p-4 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900">
          <div className="flex items-center space-x-2">
            <div className="bg-cyan-100 dark:bg-cyan-900/30 p-2 rounded-xl">
              <Bot size={20} className="text-cyan-600 dark:text-cyan-400" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">AI 助手</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">计划、确认、执行全程可见</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-full transition-colors">
            <X size={20} className="text-slate-500 dark:text-zinc-400" />
          </button>
        </div>

        <div className="mx-4 mt-3 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300 flex items-start space-x-2">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          <span>执行类指令至少要包含操作类型、品牌、货号和尺码。数量默认 1，仓库默认主仓库，入库成本默认 0；出库售价必须明确填写。真正执行由 Supabase 后端完成，且必须经过你的确认。</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-black/50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] p-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-cyan-600 text-white rounded-tr-none'
                    : 'bg-white dark:bg-zinc-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-zinc-700 rounded-tl-none shadow-sm'
                }`}
              >
                <div>{msg.content}</div>
                {msg.actions && msg.actions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {msg.actions.map((action, actionIndex) => (
                      <div key={`${idx}-${actionIndex}`} className="rounded-xl border border-slate-100 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-900/60 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {action.status === 'failed' ? (
                              <AlertCircle size={14} className="text-red-500" />
                            ) : (
                              <CheckCircle2 size={14} className={action.status === 'success' ? 'text-emerald-500' : action.status === 'answered' ? 'text-cyan-500' : 'text-slate-400'} />
                            )}
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-zinc-200">
                              {actionTypeLabel[action.type] || action.type}
                            </span>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadgeClass[action.status]}`}>
                            {action.status === 'planned' ? '待确认' : action.status === 'success' ? '已执行' : action.status === 'answered' ? '已回答' : '失败'}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400">{action.summary}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white dark:bg-zinc-800 p-3 rounded-2xl rounded-tl-none border border-slate-100 dark:border-zinc-700 shadow-sm flex items-center space-x-2">
                <Loader2 size={16} className="animate-spin text-cyan-500" />
                <span className="text-xs text-slate-400">{pendingPlan ? '正在执行确认计划...' : '正在生成执行计划...'}</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800">
          {pendingPlan && (
            <div className="mb-2 rounded-xl border border-cyan-200 dark:border-cyan-900/40 bg-cyan-50 dark:bg-cyan-950/20 p-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-cyan-700 dark:text-cyan-300">计划已锁定，10 分钟内有效且只能执行一次。</span>
              <button
                onClick={handleConfirmExecute}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs font-medium bg-cyan-600 text-white rounded-lg disabled:opacity-50 whitespace-nowrap"
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
              onKeyDown={(e) => e.key === 'Enter' && requestPlan()}
              placeholder="例如：Nike DD1391-100 42码 入库 2 双，成本 749，放杭州一号仓"
              className="flex-1 px-4 py-3 bg-slate-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 dark:text-white placeholder:text-slate-400"
              disabled={isLoading}
            />
            <button
              onClick={requestPlan}
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
