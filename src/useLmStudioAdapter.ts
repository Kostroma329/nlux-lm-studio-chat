import { useAsStreamAdapter } from '@nlux/react';
import type { StreamingAdapterObserver, ChatAdapterExtras } from '@nlux/core';
import type { 
  LmStudioAdapterOptions, 
  GenerationSettings,
  ChatMessage
} from './types.ts';

/**
 * Кастомный хук-адаптер для подключения к локальному серверу LM Studio.
 */
export const useLmStudioAdapter = (options: LmStudioAdapterOptions | string) => {
  const modelName = typeof options === 'string' ? options : options.modelName;
  const history = typeof options === 'object' ? (options.history || []) : [];
  const systemPrompt = typeof options === 'object' ? (options.systemPrompt || 'Ты полезный ИИ-ассистент.') : 'Ты полезный ИИ-ассистент.';
  const generationSettings: GenerationSettings = typeof options === 'object' && options.generationSettings 
    ? options.generationSettings 
    : { temperature: 0.7, maxTokens: 2048 };
  const abortControllerRef = typeof options === 'object' ? options.abortControllerRef : undefined;
  const onMessageSent = typeof options === 'object' ? options.onMessageSent : undefined;
  const onMessageReceived = typeof options === 'object' ? options.onMessageReceived : undefined;
  const attachedImages = typeof options === 'object' ? (options.attachedImages || []) : [];
  const attachedTexts = typeof options === 'object' ? (options.attachedTexts || []) : [];

  return useAsStreamAdapter(
    async (message: string, observer: StreamingAdapterObserver, _extras: ChatAdapterExtras) => {
      const startTime = Date.now();
      
      try {
        if (onMessageSent) onMessageSent(message);

        const messages: any[] = [{ role: 'system', content: systemPrompt }];
        history.forEach((msg: ChatMessage) => {
          messages.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.message });
        });
        
        const hasAttachments = attachedImages.length > 0 || attachedTexts.length > 0;
        if (hasAttachments) {
          const content: any[] = [];
          attachedTexts.forEach((txt: { name: string; content: string }) => 
            content.push({ type: 'text', text: `📄 Файл "${txt.name}":\n\`\`\`\n${txt.content}\n\`\`\`` })
          );
          attachedImages.forEach((img: string) => 
            content.push({ type: 'image_url', image_url: { url: img } })
          );
          if (message.trim()) content.push({ type: 'text', text: message });
          messages.push({ role: 'user', content });
        } else {
          messages.push({ role: 'user', content: message });
        }

        const controller = new AbortController();
        if (abortControllerRef) abortControllerRef.current = controller;

        const response = await fetch('http://localhost:1234/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
          body: JSON.stringify({ 
            model: modelName, 
            messages, 
            stream: true, 
            temperature: generationSettings.temperature, 
            max_tokens: generationSettings.maxTokens 
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          throw new Error(`LM Studio error ${response.status}: ${errorText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        let usageTokens: number | undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split('\n')) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
              const data = trimmedLine.slice(6).trim();
              if (data === '[DONE]') break;
              if (data) {
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (parsed.usage) usageTokens = parsed.usage.completion_tokens || parsed.usage.total_tokens;
                  if (content) {
                    fullResponse += content;
                    observer.next(content);
                  }
                } catch (e) {
                  console.warn('Ошибка парсинга JSON:', e);
                }
              }
            }
          }
        }
        
        observer.complete();
        
        const responseTime = Date.now() - startTime;
        const tokens = usageTokens ?? Math.ceil(fullResponse.length / 4);
        
        if (onMessageReceived && fullResponse) {
          onMessageReceived(fullResponse, { responseTime, tokens, model: modelName, timestamp: Date.now() });
        }
      } catch (error: any) {
        if (error.name === 'AbortError' || error.message?.includes('aborted')) {
          observer.complete();
          return;
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Неизвестная ошибка';

        if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
          observer.next('️ **Ошибка подключения:** LM Studio не запущен или недоступен.');
        } else if (errorMessage.includes('404')) {
          observer.next(`⚠️ **Модель не найдена:** "${modelName}"`);
        } else {
          observer.next(`⚠️ **Ошибка:** ${errorMessage}`);
        }
        observer.complete(); 
      }
    }
  );
};