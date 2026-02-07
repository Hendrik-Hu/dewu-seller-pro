import React, { useState, useEffect, useRef } from 'react';
import { X, Send, Bot, Loader2, Sparkles } from 'lucide-react';
import { Product, Activity } from '../types';

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  activities: Activity[];
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Hardcoded configuration as requested
const API_KEY = 'sk-2cdad215142e4b4382ded48955001e39';
const PROVIDER = 'deepseek'; // Assuming DeepSeek based on context

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({
  isOpen,
  onClose,
  products,
  activities
}) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '你好！我是你的得物经营分析助手。我可以帮你分析库存状况、销售趋势，或者给出补货建议。请问有什么可以帮你的？' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const generateSystemPrompt = () => {
    // Simplify data to reduce token usage
    const inventorySummary = products.map(p => ({
      name: p.name,
      sku: p.sku,
      stock: p.stock,
      price: p.price, // cost
      status: p.status,
      warehouse: p.warehouse
    }));

    const recentSales = activities
      .filter(a => a.type === 'outbound')
      .slice(0, 20)
      .map(a => ({
        product: a.productName,
        price: a.price, // sell price
        time: a.time
      }));

    return `
You are an intelligent business analyst for a sneaker reseller (using the "Dewu" platform).
You have access to the user's current inventory and recent sales data.

Current Inventory Data (JSON):
${JSON.stringify(inventorySummary).slice(0, 10000)}

Recent Sales Activity (Last 20):
${JSON.stringify(recentSales)}

Your capabilities:
1. Analyze inventory health (overstock, low stock).
2. Calculate estimated profit margins (if cost/price data allows).
3. Identify slow-moving items.
4. Suggest restocking based on sales trends.

Rules:
- Answer concisely in Chinese.
- Be professional but encouraging.
- If the user asks about specific shoes, look up the SKU in the provided data.
- If data is missing, say so politely.
    `;
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setIsLoading(true);

    try {
      const systemPrompt = generateSystemPrompt();
      
      let apiUrl = 'https://api.openai.com/v1/chat/completions';
      let model = 'gpt-3.5-turbo';

      if (PROVIDER === 'deepseek') {
        apiUrl = 'https://api.deepseek.com/chat/completions';
        model = 'deepseek-chat';
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.filter(m => m.role !== 'system').slice(-5), // Keep last 5 messages for context
            { role: 'user', content: userMsg }
          ],
          temperature: 0.7
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }

      const aiContent = data.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。';
      
      setMessages(prev => [...prev, { role: 'assistant', content: aiContent }]);

    } catch (error: any) {
      console.error('AI Error:', error);
      setMessages(prev => [...prev, { role: 'assistant', content: `分析出错: ${error.message}. 请稍后再试。` }]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-md h-[80vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-zinc-800">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-white dark:bg-zinc-900 z-10">
          <div className="flex items-center space-x-2">
            <div className="bg-purple-100 dark:bg-purple-900/30 p-2 rounded-xl">
              <Sparkles size={20} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white">经营分析助手</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">基于您的实时库存数据</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-full transition-colors"
            >
              <X size={20} className="text-slate-500 dark:text-zinc-400" />
            </button>
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50 dark:bg-black/50">
          {messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div 
                className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-purple-600 text-white rounded-tr-none' 
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
                <Loader2 size={16} className="animate-spin text-purple-500" />
                <span className="text-xs text-slate-400">正在分析数据...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800">
          <div className="flex items-center space-x-2">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="问问库存情况，例如：'库存最多的鞋子是哪双？'"
              className="flex-1 px-4 py-3 bg-slate-50 dark:bg-zinc-800 border-none rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 dark:text-white placeholder:text-slate-400"
              disabled={isLoading}
            />
            <button 
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="p-3 bg-purple-600 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform"
            >
              <Send size={18} />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
