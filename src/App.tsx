import { useState, useEffect, useCallback, useRef } from 'react';
import { AiChat, useAiChatApi } from '@nlux/react';
import { useLmStudioAdapter } from './useLmStudioAdapter';
import '@nlux/themes/nova.css';
import './chat.css';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
);

interface ChatMessage { role: 'user' | 'assistant'; message: string; }
interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  createdAt: number;
  systemPrompt: string;
}
interface ModelUsageRecord { model: string; modelName: string; timestamp: number; responseTime: number; tokens: number; messageLength: number; }

interface GenerationSettings {
  temperature: number;
  maxTokens: number;
}

const DEFAULT_SYSTEM_PROMPT = 'Ты полезный ИИ-ассистент Анатолия. Помогай с программированием на Python, анализом данных, финансовым планированием и переводом. Отвечай структурированно, используй Markdown для кода и таблиц.';

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  maxTokens: 2048
};

function App() {
  const [selectedModel, setSelectedModel] = useState('phi-3-mini-4k-instruct');
  const [chats, setChats] = useState<Chat[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('chats') || '[]');
    } catch (e) {
      console.error('Ошибка парсинга chats из localStorage:', e);
      return [];
    }
  });
  const [activeChatId, setActiveChatId] = useState<string | null>(() => localStorage.getItem('activeChatId') || null);
  const [chatKey, setChatKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isServerOnline, setIsServerOnline] = useState(true);
  const [serverError, setServerError] = useState('');
  const [notification, setNotification] = useState('');
  const [lastResponseTime, setLastResponseTime] = useState<number | null>(null);
  const [lastTokens, setLastTokens] = useState<number | null>(null);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');
  const [modelUsageHistory, setModelUsageHistory] = useState<ModelUsageRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('modelUsageHistory') || '[]');
    } catch (e) {
      return [];
    }
  });
  const [showStats, setShowStats] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState(() => (localStorage.getItem('theme') || 'dark') === 'dark');

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [chatSettingsPrompt, setChatSettingsPrompt] = useState('');

  const [showGenerationSettings, setShowGenerationSettings] = useState(false);
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(() => {
    try {
      const saved = localStorage.getItem('generationSettings');
      return saved ? JSON.parse(saved) : DEFAULT_GENERATION_SETTINGS;
    } catch (e) {
      return DEFAULT_GENERATION_SETTINGS;
    }
  });
  const [tempSettings, setTempSettings] = useState<GenerationSettings>(generationSettings);

  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [attachedTexts, setAttachedTexts] = useState<{ name: string; content: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUserMessageRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Официальный API nlux для программной отправки сообщений
  const api = useAiChatApi();

  const activeChat = chats.find(c => c.id === activeChatId) || null;

  const handleMessageSent = useCallback((message: string) => {
    if (!activeChatId) return;
    pendingUserMessageRef.current = message;
    setChats(prev => {
      return prev.map(c => {
        if (c.id !== activeChatId) return c;
        const lastMsg = c.messages[c.messages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && lastMsg.message === message) return c;

        const newMessages = [...c.messages, { role: 'user' as const, message }];
        let newTitle = c.title;
        if (c.title === 'Новый чат' && message.length > 0) {
          newTitle = message.length > 40 ? message.substring(0, 40) + '...' : message;
        }
        return { ...c, messages: newMessages, title: newTitle };
      });
    });
  }, [activeChatId]);

  const handleMessageReceived = useCallback((message: string, metadata?: Record<string, any>) => {
    if (!activeChatId) return;
    pendingUserMessageRef.current = null;
    const responseTime = metadata?.responseTime || 0;
    const tokens = metadata?.tokens || Math.ceil(message.length / 4);

    setChats(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeChatId) return c;
        return { ...c, messages: [...c.messages, { role: 'assistant' as const, message }] };
      });
      localStorage.setItem('chats', JSON.stringify(updated));
      return updated;
    });

    setLastAssistantMessage(message);
    setLastResponseTime(responseTime);
    setLastTokens(tokens);

    const record: ModelUsageRecord = {
      model: selectedModel, modelName: selectedModel, timestamp: Date.now(),
      responseTime, tokens, messageLength: message.length
    };
    setModelUsageHistory(prev => {
      const newHistory = [record, ...prev].slice(0, 100);
      localStorage.setItem('modelUsageHistory', JSON.stringify(newHistory));
      return newHistory;
    });
  }, [activeChatId, selectedModel]);

  const adapter = useLmStudioAdapter({
    modelName: selectedModel,
    history: activeChat?.messages || [],
    systemPrompt: activeChat?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    generationSettings,
    abortControllerRef,
    onMessageSent: handleMessageSent,
    onMessageReceived: handleMessageReceived,
    attachedImages,
    attachedTexts,
  });

  const createNewChat = useCallback(() => {
    const welcomeMsg = '👋 Привет, Анатолий! Я твой локальный ИИ-ассистент. Чем могу помочь сегодня?';
    const newChat: Chat = {
      id: Date.now().toString(), title: 'Новый чат', messages: [{ role: 'assistant' as const, message: welcomeMsg }],
      model: selectedModel, createdAt: Date.now(), systemPrompt: DEFAULT_SYSTEM_PROMPT
    };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setLastResponseTime(null); setLastTokens(null); setLastAssistantMessage(welcomeMsg);
    setAttachedImages([]); setAttachedTexts([]);
    setChatKey(prev => prev + 1);
    showNotification('✨ Новый чат создан');
  }, [selectedModel]);

  const switchToChat = (chatId: string) => {
    setActiveChatId(chatId);
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setSelectedModel(chat.model);
      setLastAssistantMessage(chat.messages.slice().reverse().find(msg => msg.role === 'assistant')?.message || '');
    }
    setAttachedImages([]); setAttachedTexts([]);
    setChatKey(prev => prev + 1);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const deleteChat = (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Удалить этот чат?')) return;
    setChats(prev => {
      const newChats = prev.filter(c => c.id !== chatId);
      localStorage.setItem('chats', JSON.stringify(newChats));
      if (activeChatId === chatId) {
        setActiveChatId(null);
        setLastAssistantMessage(''); setLastResponseTime(null); setLastTokens(null);
        setAttachedImages([]); setAttachedTexts([]);
      }
      return newChats;
    });
    showNotification('🗑️ Чат удалён');
  };

  const clearChat = () => {
    if (!activeChat) return;
    if (!confirm('Очистить текущий чат?')) return;
    setChats(prev => {
      const updated = prev.map(c => c.id === activeChatId ? { ...c, messages: [], title: 'Новый чат' } : c);
      localStorage.setItem('chats', JSON.stringify(updated));
      return updated;
    });
    setLastResponseTime(null); setLastTokens(null); setLastAssistantMessage('');
    setAttachedImages([]); setAttachedTexts([]);
    setChatKey(prev => prev + 1);
    showNotification('🗑️ Чат очищен');
  };

  const undoLastExchange = () => {
    if (!activeChat || activeChat.messages.length < 2) { showNotification('Нечего отменять'); return; }
    if (!confirm('Удалить последнее сообщение и ответ?')) return;
    setChats(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeChatId) return c;
        let idx = -1;
        for (let i = c.messages.length - 1; i >= 0; i--) { if (c.messages[i].role === 'user') { idx = i; break; } }
        if (idx === -1) return c;
        return { ...c, messages: c.messages.slice(0, idx) };
      });
      localStorage.setItem('chats', JSON.stringify(updated));
      return updated;
    });
    setLastAssistantMessage('');
    setChatKey(prev => prev + 1);
    showNotification('↩️ Обмен удалён');
  };

  // =====================================================================
  // ПЕРЕГЕНЕРАЦИЯ: используем официальный API nlux
  // =====================================================================
  const regenerateLastResponse = () => {
    if (!activeChat || activeChat.messages.length < 2) { showNotification('История пуста'); return; }

    let lastUserIdx = -1;
    for (let i = activeChat.messages.length - 1; i >= 0; i--) {
      if (activeChat.messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) { showNotification('Нет вопроса'); return; }

    const userMsg = activeChat.messages[lastUserIdx].message;

    setChats(prev => {
      const updated = prev.map(c => {
        if (c.id !== activeChatId) return c;
        return { ...c, messages: c.messages.slice(0, lastUserIdx + 1) };
      });
      localStorage.setItem('chats', JSON.stringify(updated));
      return updated;
    });

    setLastAssistantMessage('');
    showNotification('🔄 Перегенерация...');

    // Перемонтируем AiChat, чтобы он сбросил внутреннее состояние
    setChatKey(prev => prev + 1);

    // Отправляем сообщение через официальный API после перерисовки
    setTimeout(() => {
      try {
        api.composer.send(userMsg);
      } catch (e) {
        console.error('Ошибка отправки при регенерации:', e);
      }
    }, 150);
  };

  const copyLastResponse = () => {
    if (!lastAssistantMessage) return;
    navigator.clipboard.writeText(lastAssistantMessage).then(() => showNotification('📋 Скопировано!'));
  };

  const openChatSettings = () => {
    if (activeChat) {
      setChatSettingsPrompt(activeChat.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      setShowChatSettings(true);
    }
  };

  const saveChatSettings = () => {
    if (activeChatId) {
      setChats(prev => {
        const updated = prev.map(c => c.id === activeChatId ? { ...c, systemPrompt: chatSettingsPrompt } : c);
        localStorage.setItem('chats', JSON.stringify(updated));
        return updated;
      });
      showNotification('⚙️ Системный промпт сохранён');
    }
    setShowChatSettings(false);
    setChatKey(prev => prev + 1);
  };

  const saveGenerationSettings = () => {
    setGenerationSettings(tempSettings);
    localStorage.setItem('generationSettings', JSON.stringify(tempSettings));
    showNotification('⚙️ Настройки генерации сохранены');
    setShowGenerationSettings(false);
    setChatKey(prev => prev + 1);
  };

  const resetGenerationSettings = () => setTempSettings(DEFAULT_GENERATION_SETTINGS);
  const showNotification = (text: string) => { setNotification(text); setTimeout(() => setNotification(''), 3000); };

  const exportChat = () => {
    if (!activeChat || activeChat.messages.length === 0) return;
    const markdown = activeChat.messages.map(msg => `**${msg.role === 'user' ? 'Анатолий' : 'Ассистент'}:**\n${msg.message}\n`).join('\n---\n\n');
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const safeTitle = activeChat.title.replace(/[^a-zа-яё0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    a.download = `${safeTitle}-${new Date().toISOString().slice(0,10)}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification('📥 Чат экспортирован');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) setAttachedImages(prev => [...prev, event.target!.result as string]);
          };
          reader.readAsDataURL(file);
        } else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|py|js|ts|html|css|csv|xml|yaml|yml)$/i)) {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) setAttachedTexts(prev => [...prev, { name: file.name, content: event.target!.result as string }]);
          };
          reader.readAsText(file);
        } else {
          showNotification(`⚠️ Неподдерживаемый формат: ${file.name}`);
        }
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = useCallback((index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  }, []);

  const removeText = useCallback((index: number) => {
    setAttachedTexts(prev => prev.filter((_, i) => i !== index));
  }, []);

  // =====================================================================
  // СТАРТОВЫЕ ПОДСКАЗКИ: используем официальный API nlux
  // =====================================================================
  const handleStarterClick = useCallback((text: string) => {
    try {
      api.composer.send(text);
    } catch (e) {
      console.error('Ошибка отправки через API nlux:', e);
    }
  }, [api]);

  // ПУНКТ 21: Сохранение названия чата
  const saveTitle = () => {
    if (editingChatId && editingTitle.trim()) {
      setChats(prev => {
        const updated = prev.map(c => c.id === editingChatId ? { ...c, title: editingTitle.trim() } : c);
        localStorage.setItem('chats', JSON.stringify(updated));
        return updated;
      });
    }
    setEditingChatId(null);
    setEditingTitle('');
  };

  // ИСПРАВЛЕНИЕ ОШИБКИ insertBefore: строгие проверки DOM и очистка таймеров
  useEffect(() => {
    let isMounted = true;
    const timer = setTimeout(() => {
      if (!isMounted) return;

      const composer = document.querySelector('.nlux-composer-container');
      if (!composer || !document.body.contains(composer)) return;

      if (!composer.querySelector('.custom-attach-btn')) {
        const btn = document.createElement('button');
        btn.className = 'custom-attach-btn';
        btn.innerHTML = '📎';
        btn.title = 'Прикрепить файл';
        btn.onclick = () => fileInputRef.current?.click();

        if (composer.firstChild) {
          composer.insertBefore(btn, composer.firstChild);
        } else {
          composer.appendChild(btn);
        }
      }

      const wrapper = composer.closest('.nlux-chat-wrapper');
      if (wrapper && composer.parentNode) {
        let preview = wrapper.querySelector('.attached-files-preview');
        if (!preview && (attachedImages.length > 0 || attachedTexts.length > 0)) {
          preview = document.createElement('div');
          preview.className = 'attached-files-preview';
          composer.parentNode.insertBefore(preview, composer);
        }

        if (preview) {
          if (attachedImages.length === 0 && attachedTexts.length === 0) {
            preview.remove();
          } else {
            preview.innerHTML = `
              <span class="attached-label">📎 Прикреплено:</span>
              ${attachedImages.map((img, idx) => `<div class="attached-item"><img src="${img}" class="attached-image" /><button class="attached-remove" data-type="image" data-idx="${idx}">✕</button></div>`).join('')}
              ${attachedTexts.map((txt, idx) => `<div class="attached-item attached-text-item"><span class="attached-text-icon">📄</span><span class="attached-text-name" title="${txt.name}">${txt.name}</span><button class="attached-remove" data-type="text" data-idx="${idx}">✕</button></div>`).join('')}
            `;
            preview.querySelectorAll('.attached-remove').forEach(btn => {
              (btn as HTMLElement).onclick = (e: MouseEvent) => {
                e.stopPropagation();
                const type = (btn as HTMLElement).getAttribute('data-type');
                const idx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '0');
                if (type === 'image') removeImage(idx);
                else if (type === 'text') removeText(idx);
              };
            });
          }
        }
      }
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [chatKey, activeChatId, isDarkTheme, attachedImages, attachedTexts, removeImage, removeText]);

  useEffect(() => {
    fetch('http://localhost:1234/v1/models')
      .then(response => { if (response.ok) { setIsServerOnline(true); setServerError(''); } else { throw new Error('Server error'); } })
      .catch(() => { setIsServerOnline(false); setServerError('LM Studio не запущен!'); });
  }, []);

  useEffect(() => { localStorage.setItem('theme', isDarkTheme ? 'dark' : 'light'); }, [isDarkTheme]);
  useEffect(() => { if (activeChatId) localStorage.setItem('activeChatId', activeChatId); }, [activeChatId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (showStats) setShowStats(false);
        else if (showChatSettings) setShowChatSettings(false);
        else if (showGenerationSettings) setShowGenerationSettings(false);
        else if (editingChatId) { setEditingChatId(null); setEditingTitle(''); }
        else if (abortControllerRef.current) { abortControllerRef.current.abort(); }
        return;
      }
      if (isCtrl && !e.shiftKey && e.key === 'z') { e.preventDefault(); createNewChat(); }
      if (isCtrl && !e.shiftKey && e.key === 'x') { e.preventDefault(); setIsDarkTheme(prev => !prev); }
      if (isCtrl && !e.shiftKey && e.key === 'b') { e.preventDefault(); setSidebarOpen(prev => !prev); }
      if (isCtrl && e.shiftKey && e.key === 'S') { e.preventDefault(); setShowStats(true); }
      if (isCtrl && !e.shiftKey && e.key === ',') { e.preventDefault(); if (activeChat) openChatSettings(); }
      if (isCtrl && e.shiftKey && e.key === 'G') { e.preventDefault(); setShowGenerationSettings(true); setTempSettings(generationSettings); }
      if (isCtrl && e.shiftKey && e.key === 'C') { e.preventDefault(); copyLastResponse(); }
      if (isCtrl && e.shiftKey && e.key === 'E') { e.preventDefault(); exportChat(); }
      if (isCtrl && e.shiftKey && e.key === 'O') { e.preventDefault(); clearChat(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showStats, showChatSettings, showGenerationSettings, editingChatId, activeChat, generationSettings, createNewChat]);

  const formatTime = (ms: number) => ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`;
  const formatDate = (ts: number) => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const getTimeSeriesData = () => {
    const days: { date: string; avgTime: number; count: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      days.push({ date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }), avgTime: 0, count: 0 });
    }
    modelUsageHistory.forEach(r => {
      const rDateStr = new Date(r.timestamp).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      const day = days.find(d => d.date === rDateStr);
      if (day) { day.avgTime += r.responseTime; day.count++; }
    });
    days.forEach(d => { if (d.count > 0) d.avgTime = Math.round(d.avgTime / d.count); });
    return {
      labels: days.map(d => d.date),
      datasets: [{ label: 'Среднее время (мс)', data: days.map(d => d.avgTime), borderColor: '#667eea', backgroundColor: 'rgba(102, 126, 234, 0.2)', fill: true, tension: 0.4 }]
    };
  };

  const getModelDistributionData = () => {
    const modelCounts: Record<string, number> = {};
    modelUsageHistory.forEach(r => { modelCounts[r.modelName || r.model] = (modelCounts[r.modelName || r.model] || 0) + 1; });
    return {
      labels: Object.keys(modelCounts),
      datasets: [{ data: Object.values(modelCounts), backgroundColor: ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b'] }]
    };
  };

  const getModelStatsTable = () => {
    const stats: Record<string, { count: number; totalTime: number; totalTokens: number }> = {};
    modelUsageHistory.forEach(r => {
      if (!stats[r.modelName]) stats[r.modelName] = { count: 0, totalTime: 0, totalTokens: 0 };
      stats[r.modelName].count += 1;
      stats[r.modelName].totalTime += r.responseTime;
      stats[r.modelName].totalTokens += r.tokens;
    });
    return Object.entries(stats).map(([model, data]) => ({
      model,
      count: data.count,
      avgTime: Math.round(data.totalTime / data.count),
      totalTokens: data.totalTokens
    }));
  };

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: isDarkTheme ? '#e0e0e0' : '#333' } } },
    scales: {
      x: { ticks: { color: isDarkTheme ? '#e0e0e0' : '#333' }, grid: { color: isDarkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' } },
      y: { ticks: { color: isDarkTheme ? '#e0e0e0' : '#333' }, grid: { color: isDarkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' } }
    }
  };

  const models = [
    { id: 'qwen/qwen3.5-9b', name: 'Qwen 3.5 9B' },
    { id: 'google/gemma-4-12b-qat', name: 'Gemma 4 12B' },
    { id: 'phi-3-mini-4k-instruct', name: 'Phi-3-mini' }
  ];

  const starters = [
    { text: 'Напиши функцию на Python для парсинга JSON', icon: '🐍' },
    { text: 'Как перевести фразу с учётом контекста?', icon: '🌐' },
    { text: 'Составь таблицу расходов на неделю', icon: '📊' },
    { text: 'Объясни, что такое квантование моделей', icon: '🧠' }
  ];

  const themeKey = isDarkTheme ? 'dark' : 'light';
  const isNewChat = activeChat && activeChat.messages.length <= 1 && activeChat.messages[0]?.role === 'assistant';

  return (
    <div className="app-container" data-theme={isDarkTheme ? 'dark' : 'light'}>
      {notification && <div className="notification">{notification}</div>}

      <input ref={fileInputRef} type="file" accept="image/*,.txt,.md,.json,.py,.js,.ts,.html,.css,.csv,.xml,.yaml,.yml" multiple onChange={handleFileUpload} style={{ display: 'none' }} />

      <div className="hotkeys-hint">
        <span>Ctrl+Z: новый чат</span><span>Ctrl+X: тема</span><span>Ctrl+B: панель</span>
        <span>Ctrl+Shift+S: статистика</span><span>Ctrl+Shift+G: генерация</span><span>Ctrl+Shift+C: копировать</span><span>Ctrl+,: настройки</span>
      </div>

      {showStats && (
        <div className="stats-overlay" onClick={() => setShowStats(false)}>
          <div className="stats-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '1100px' }}>
            <h2>📊 Аналитика использования</h2>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-label">⏱️ Последнее время</div><div className="stat-value">{lastResponseTime ? formatTime(lastResponseTime) : '—'}</div></div>
              <div className="stat-card"><div className="stat-label">🔤 Последние токены</div><div className="stat-value">{lastTokens ? lastTokens.toLocaleString() : '—'}</div></div>
              <div className="stat-card"><div className="stat-label">💬 Всего чатов</div><div className="stat-value">{chats.length}</div></div>
              <div className="stat-card"><div className="stat-label">📝 Всего запросов</div><div className="stat-value">{modelUsageHistory.length}</div></div>
            </div>

            {modelUsageHistory.length > 0 && (
              <>
                <h3>📈 Статистика по моделям</h3>
                <table className="usage-table stats-table">
                  <thead><tr><th>Модель</th><th>Запросов</th><th>Среднее время</th><th>Всего токенов</th></tr></thead>
                  <tbody>
                    {getModelStatsTable().map((row, i) => (
                      <tr key={i}><td>{row.model}</td><td>{row.count}</td><td>{formatTime(row.avgTime)}</td><td>{row.totalTokens.toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
                  <div>
                    <h3>📉 Время ответа (7 дней)</h3>
                    <div style={{ height: '200px' }}><Line data={getTimeSeriesData()} options={chartOptions} /></div>
                  </div>
                  <div>
                    <h3>🥧 Распределение по моделям</h3>
                    <div style={{ height: '200px' }}><Doughnut data={getModelDistributionData()} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: isDarkTheme ? '#e0e0e0' : '#333' } } } }} /></div>
                  </div>
                </div>
              </>
            )}
            <div style={{display: 'flex', gap: '12px', marginTop: '24px'}}>
              <button onClick={() => { setModelUsageHistory([]); localStorage.removeItem('modelUsageHistory'); showNotification('🗑️ История очищена'); }} className="action-button" style={{padding: '10px 20px', borderRadius: '8px', border: 'none', background: 'rgba(244, 67, 54, 0.9)', color: 'white', cursor: 'pointer'}}>🗑️ Очистить историю</button>
              <button onClick={() => setShowStats(false)} className="action-button" style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'rgba(102, 126, 234, 0.9)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>Закрыть</button>
            </div>
          </div>
        </div>
      )}

      {showChatSettings && activeChat && (
        <div className="stats-overlay" onClick={() => setShowChatSettings(false)}>
          <div className="stats-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px' }}>
            <h2>⚙️ Настройки чата: {activeChat.title}</h2>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, color: 'var(--text-dark)' }}>Системный промпт</label>
              <textarea value={chatSettingsPrompt} onChange={(e) => setChatSettingsPrompt(e.target.value)}
                style={{ width: '100%', minHeight: '150px', padding: '12px', borderRadius: '8px', border: `1px solid ${isDarkTheme ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`, background: isDarkTheme ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.9)', color: 'var(--text-dark)', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' }}
                placeholder="Опиши, как модель должна себя вести..." />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setChatSettingsPrompt(DEFAULT_SYSTEM_PROMPT)} className="action-button" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'rgba(158, 158, 158, 0.5)', color: 'white', cursor: 'pointer' }}>🔄 Сбросить</button>
              <button onClick={saveChatSettings} className="action-button" style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'rgba(76, 175, 80, 0.9)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>💾 Сохранить</button>
              <button onClick={() => setShowChatSettings(false)} className="action-button" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'rgba(158, 158, 158, 0.5)', color: 'white', cursor: 'pointer' }}>❌ Отмена</button>
            </div>
          </div>
        </div>
      )}

      {showGenerationSettings && (
        <div className="stats-overlay" onClick={() => setShowGenerationSettings(false)}>
          <div className="stats-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <h2>⚙️ Настройки генерации</h2>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ fontWeight: 600, color: 'var(--text-dark)' }}>🌡️ Temperature (креативность)</label>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{tempSettings.temperature.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="2" step="0.1" value={tempSettings.temperature} onChange={(e) => setTempSettings(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))} className="settings-slider" />
            </div>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ fontWeight: 600, color: 'var(--text-dark)' }}>📏 Max Tokens (длина)</label>
                <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{tempSettings.maxTokens}</span>
              </div>
              <input type="range" min="128" max="4096" step="128" value={tempSettings.maxTokens} onChange={(e) => setTempSettings(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))} className="settings-slider" />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={resetGenerationSettings} className="action-button" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'rgba(158, 158, 158, 0.5)', color: 'white', cursor: 'pointer' }}>🔄 Сбросить</button>
              <button onClick={saveGenerationSettings} className="action-button" style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'rgba(76, 175, 80, 0.9)', color: 'white', cursor: 'pointer', fontWeight: 600 }}>💾 Сохранить</button>
              <button onClick={() => setShowGenerationSettings(false)} className="action-button" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: 'rgba(158, 158, 158, 0.5)', color: 'white', cursor: 'pointer' }}>❌ Отмена</button>
            </div>
          </div>
        </div>
      )}

      <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
        <div className="sidebar-header">
          <h2 className="sidebar-title">💬 Чаты ({chats.length})</h2>
          <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dark)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
        </div>
        <button className="new-chat-btn" onClick={createNewChat}>✨ Новый чат</button>
        <div className="chat-list">
          {chats.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">💬</div><div>Нет чатов</div></div>
          ) : chats.map(chat => (
            <div key={chat.id} className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`} onClick={() => switchToChat(chat.id)}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                {editingChatId === chat.id ? (
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input className="chat-title-input" value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') { setEditingChatId(null); setEditingTitle(''); } }}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                      style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--accent-primary)', background: isDarkTheme ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.9)', color: 'var(--text-dark)', fontSize: '14px', outline: 'none' }} />
                    <button onClick={(e) => { e.stopPropagation(); saveTitle(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }} title="Сохранить">💾</button>
                  </div>
                ) : (
                  <>
                    <div className="chat-item-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingChatId(chat.id); setEditingTitle(chat.title); }} title="Двойной клик для редактирования">{chat.title}</div>
                    <div className="chat-item-info">{chat.messages.length} сообщ. · {formatDate(chat.createdAt)}</div>
                  </>
                )}
              </div>
              <button className="chat-item-delete" onClick={(e) => deleteChat(chat.id, e)} title="Удалить">🗑️</button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="top-panel">
          <div className="top-panel-left">
            {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', color: 'var(--text-dark)', cursor: 'pointer', fontSize: '20px' }} title="Открыть панель (Ctrl+B)">☰</button>}
            <h1 className="top-panel-title">AI Assistant (nlux)</h1>
          </div>
          <div className="top-panel-right">
            <button onClick={() => setIsDarkTheme(!isDarkTheme)} className="action-button" style={{ background: 'rgba(255, 193, 7, 0.9)', color: '#333', fontSize: '16px' }} title="Сменить тему">{isDarkTheme ? '☀️' : '🌙'}</button>
            <button onClick={() => setShowStats(true)} className="action-button" style={{ background: 'rgba(156, 39, 176, 0.9)', color: 'white' }} title="Статистика">📊</button>
            <button onClick={() => { setShowGenerationSettings(true); setTempSettings(generationSettings); }} className="action-button" style={{ background: 'rgba(255, 87, 34, 0.9)', color: 'white' }} title="Настройки генерации">⚙️</button>
            <button onClick={openChatSettings} disabled={!activeChat} className="action-button" style={{ background: activeChat ? 'rgba(33, 150, 243, 0.9)' : 'rgba(158, 158, 158, 0.5)', color: 'white' }} title="Настройки чата">🔧</button>
            <select value={selectedModel} onChange={e => { setSelectedModel(e.target.value); setChatKey(prev => prev + 1); }} style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.9)', color: '#333', fontSize: '14px', cursor: 'pointer' }}>
              {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button onClick={regenerateLastResponse} disabled={!activeChat || activeChat.messages.length < 2} className="action-button" style={{ background: activeChat && activeChat.messages.length >= 2 ? 'rgba(156, 39, 176, 0.9)' : 'rgba(158,158,158,0.5)', color: 'white' }} title="Перегенерировать">🔄</button>
            <button onClick={undoLastExchange} disabled={!activeChat || activeChat.messages.length < 2} className="action-button" style={{ background: activeChat && activeChat.messages.length >= 2 ? 'rgba(255, 152, 0, 0.9)' : 'rgba(158,158,158,0.5)', color: 'white' }} title="Отменить">↩️</button>
            <button onClick={copyLastResponse} disabled={!lastAssistantMessage} className="action-button" style={{ background: lastAssistantMessage ? 'rgba(33, 150, 243, 0.9)' : 'rgba(158,158,158,0.5)', color: 'white' }} title="Копировать">📋</button>
            <button onClick={exportChat} disabled={!activeChat || activeChat.messages.length === 0} className="action-button" style={{ background: activeChat && activeChat.messages.length > 0 ? 'rgba(76, 175, 80, 0.9)' : 'rgba(158,158,158,0.5)', color: 'white' }} title="Экспорт">📥</button>
            <button onClick={clearChat} disabled={!activeChat || activeChat.messages.length === 0} className="action-button" style={{ background: activeChat && activeChat.messages.length > 0 ? 'rgba(244, 67, 54, 0.9)' : 'rgba(158,158,158,0.5)', color: 'white' }} title="Очистить">🗑️</button>
          </div>
        </div>

        {!isServerOnline && (
          <div className="server-error-banner">
            <span style={{ fontSize: '24px' }}>⚠️</span>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Сервер недоступен</div><div style={{ fontSize: '14px', opacity: 0.9 }}>{serverError}</div></div>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid white', background: 'transparent', color: 'white', fontWeight: 600, cursor: 'pointer' }}>🔄</button>
          </div>
        )}

        <div className="chat-area">
          {!activeChat ? (
            <div className="empty-state" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <div className="empty-state-icon">👋</div>
              <div style={{ fontSize: '24px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-dark)' }}>Добро пожаловать!</div>
              <button className="new-chat-btn" onClick={createNewChat} style={{ padding: '16px 32px', fontSize: '16px' }}>✨ Создать первый чат</button>
            </div>
          ) : (
            <div className="nlux-chat-wrapper" key={`${chatKey}-${themeKey}`}>
              <AiChat
                api={api}
                adapter={adapter}
                initialConversation={activeChat.messages.filter((m, idx) => {
                  if (pendingUserMessageRef.current && m.role === 'user' && m.message === pendingUserMessageRef.current && idx === activeChat.messages.length - 1) return false;
                  return true;
                }).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', message: m.message }))}
                personaOptions={{
                  assistant: { name: 'Ассистент Анатолия', tagline: `Работает на ${selectedModel} через LM Studio`, avatar: <span style={{ fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>🤖</span> },
                  user: { name: 'Анатолий', avatar: <span style={{ fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>👨</span> }
                }}
                composerOptions={{ placeholder: 'Введите свой запрос... (Enter для отправки, Shift+Enter для новой строки)' }}
                displayOptions={{ colorScheme: isDarkTheme ? 'dark' : 'light' }}
              />
              {isNewChat && (
                <div className="welcome-overlay">
                  <div className="welcome-screen">
                    <div className="welcome-starters">
                      {starters.map((starter, idx) => (
                        <button key={idx} className="welcome-starter-btn" onClick={() => handleStarterClick(starter.text)}>
                          <span className="starter-icon">{starter.icon}</span>
                          <span>{starter.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;